import { TimerEngine } from "./timer-engine.js";
import { getCountdownCueSecond } from "./audio-cues.js";
import { createWorkoutRepository } from "./workout-repository.js";
import { buildTimerPlan, copyTimerPlanBlocks, timerPlanRequiredIssue } from "./timer-plan-builder.js";

const $ = (id) => document.getElementById(id);
const presets = {
  amrap: {
    tag:"AMRAP", name:"12' AMRAP", description:"Máximas rondas en 12 minutos",
    movements:["10 Burpees","15 Wall Balls","20 Double Unders"],
    plan:{type:"sequence",blocks:[{type:"countdown",label:"AMRAP",durationSeconds:720}]}
  },
  fortime: {
    tag:"FOR TIME", name:"21-15-9", description:"For Time · Time Cap 15 minutos",
    movements:["21 Thrusters","15 Pull-ups","9 Thrusters","9 Pull-ups"],
    plan:{type:"sequence",blocks:[{type:"countup",label:"FOR TIME",timeCapSeconds:900,rounds:null}]}
  },
  emom: {
    tag:"EMOM", name:"EMOM 10'", description:"10 intervalos de 1 minuto",
    movements:["Minuto impar · 12/10 cal Bike","Minuto par · 10 Burpees"],
    plan:{type:"sequence",blocks:[{type:"emom",label:"EMOM",durationSeconds:600,intervalSeconds:60,rounds:10}]}
  },
  tabata: {
    tag:"TABATA", name:"TABATA 8 ROUNDS", description:"20 segundos trabajo / 10 segundos descanso",
    movements:["Air Squats","Máximo trabajo en cada intervalo"],
    plan:{type:"sequence",blocks:[{type:"intervals",label:"TABATA",rounds:8,workSeconds:20,restSeconds:10,startWithRest:false}]}
  }
};
let selected = "amrap";
let engine = null;
let displayFrame = null;
let audioContext = null;
let lastCountdownCue = null;
let prestartState = null;
let prestartStartedAt = 0;
let prestartRemainingMs = 10000;
let lastPrestartCue = 11;
let wakeLock = null;
let repository = null;
let returnView = "home";
let deletedWorkout = null;
let editingWorkoutId = null;
let creatingWorkout = false;
let editorReturnView = "library";
let timerPlanLoadError = false;
let editingSchemaVersion = 2;
let editingLegacyFormat = null;
let editingStructureSupported = true;

function formatTime(ms, tenths=false) {
  const total = Math.max(0, ms);
  const seconds = Math.floor(total / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (tenths && minutes === 0) return `${rest.toString().padStart(2,"0")}.${Math.floor((total % 1000)/100)}`;
  return `${minutes.toString().padStart(2,"0")}:${rest.toString().padStart(2,"0")}`;
}
function renderPreset() {
  const w = presets[selected];
  $("formatTag").textContent = w.tag;
  $("workoutName").textContent = w.name;
  $("workoutDescription").textContent = w.description;
  $("movementList").replaceChildren(...w.movements.map(m => {const s=document.createElement("span");s.textContent=m;return s;}));
  document.querySelectorAll("[data-preset]").forEach(b=>b.classList.toggle("selected",b.dataset.preset===selected));
}
async function unlockAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) throw new Error("Este navegador no admite Web Audio.");
  if (!audioContext || audioContext.state === "closed") audioContext = new Audio();
  if (audioContext.state !== "running") await audioContext.resume();
  if (audioContext.state !== "running") throw new Error("El navegador no ha permitido activar el audio.");
  return audioContext;
}
async function playTone(frequency=880, duration=.13) {
  if ($("soundButton").getAttribute("aria-pressed") !== "true") return;
  try {
    // Once audio has been unlocked by a real user gesture, schedule tones
    // synchronously. Re-awaiting resume() for every cue can lose timing and
    // is unreliable on iOS Safari.
    const context = audioContext?.state === "running" ? audioContext : await unlockAudio();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.35, now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + .02);
  } catch (error) {
    $("soundButton").textContent = "SONIDO: ERROR";
    $("statusMessage").textContent = "No se ha podido reproducir el sonido. Pulsa SONIDO para volver a activarlo y comprueba el volumen.";
    console.warn("Throwdown Timer audio:", error);
  }
}
function processEvents() {
  if (!engine) return;
  for (const event of engine.drainEvents()) {
    if (event.type === "phase_changed") {
      lastCountdownCue=null;
      playTone(1046,.16);
    } else if (event.type === "time_cap_reached" || event.type === "timer_completed") {
      playTone(440,.45);
    }
  }
}
function renderTimer(snapshot) {
  const phase = engine.phases[snapshot.blockIndex ?? 0];
  const countup = snapshot.blockType === "countup";
  const time = countup ? snapshot.phaseElapsedMs : snapshot.phaseRemainingMs;
  $("clock").textContent = time == null ? "00:00" : formatTime(time, countup && time < 60000);
  $("clock").classList.toggle("countup",countup);
  $("clock").classList.toggle("urgent",!countup && time !== null && time <= 10000 && snapshot.state==="running");
  $("timerLabel").textContent = countup ? "TIME ELAPSED" : snapshot.phase === "rest" ? "REST" : "TIME REMAINING";
  $("phaseLabel").textContent = snapshot.state==="completed" ? "COMPLETADO" : snapshot.state==="capped" ? "TIME CAP" : snapshot.state==="paused" ? "PAUSADO" : snapshot.state==="idle" ? "PREPARADO" : snapshot.phase==="rest" ? "DESCANSO" : (phase?.label || "EN CURSO").toUpperCase();
  $("roundValue").textContent = snapshot.round ? `${snapshot.round.current} / ${snapshot.round.total}` : "—";
  const totalLabel = countup ? (snapshot.totalRemainingMs === null ? "TIEMPO TRANSCURRIDO" : "HASTA TIME CAP") : "TIEMPO RESTANTE";
  $("totalLabel").textContent = totalLabel;
  const total = countup && snapshot.totalRemainingMs === null ? snapshot.totalElapsedMs : snapshot.totalRemainingMs;
  $("totalValue").textContent = total == null ? "—" : formatTime(total);
  const duration = phase?.durationMs;
  const progress = duration ? Math.min(100,Math.max(0,(snapshot.phaseElapsedMs/duration)*100)) : 0;
  $("progressFill").style.width = `${progress}%`;
  const pauseAction = snapshot.state==="running" ? "Pausar" : snapshot.state==="paused" ? "Reanudar" : snapshot.state==="idle" ? "Iniciar" : "Finalizado";
  $("pauseButton").textContent = snapshot.state==="running" ? "Ⅱ" : snapshot.state==="completed" || snapshot.state==="capped" ? "✓" : "▶";
  $("pauseButton").setAttribute("aria-label", pauseAction);
  $("pauseButton").title = pauseAction;
  $("pauseButton").disabled = ["completed","capped"].includes(snapshot.state);
  $("pauseButton").style.opacity = $("pauseButton").disabled ? ".45" : "1";
  $("skipButton").classList.toggle("hidden",!snapshot.can.skip);
  $("finishButton").classList.toggle("hidden",!snapshot.can.finish);
  $("statusMessage").textContent = snapshot.state==="capped" ? "Se ha alcanzado el Time Cap." : snapshot.state==="completed" ? "WOD finalizado." : snapshot.state==="paused" ? "Cronómetro pausado." : snapshot.state==="running" ? "Entrenamiento en curso." : "El cronómetro está listo.";
}
function updateCountdownCue(snapshot) {
  const second = getCountdownCueSecond(snapshot);
  if (second === null) {
    lastCountdownCue = null;
    return;
  }
  if (second !== lastCountdownCue) {
    lastCountdownCue = second;
    playTone(second <= 3 ? 1320 : 880, .075);
  }
}
function stopDisplayLoop() { if(displayFrame!==null) cancelAnimationFrame(displayFrame); displayFrame=null; }
function renderPrestart(remainingMs = prestartRemainingMs) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  $("clock").textContent = formatTime(seconds * 1000);
  $("clock").classList.remove("countup", "urgent");
  $("timerLabel").textContent = "PREPARACIÓN";
  $("phaseLabel").textContent = "LA SESIÓN COMIENZA EN BREVE";
  $("roundValue").textContent = "—";
  $("totalLabel").textContent = "INICIO EN";
  $("totalValue").textContent = formatTime(seconds * 1000);
  $("progressFill").style.width = `${Math.min(100, Math.max(0, (10000 - remainingMs) / 10000 * 100))}%`;
  $("pauseButton").textContent = prestartState === "running" ? "Ⅱ" : "▶";
  $("pauseButton").setAttribute("aria-label", prestartState === "running" ? "Pausar cuenta atrás" : "Continuar cuenta atrás");
  $("pauseButton").title = prestartState === "running" ? "Pausar cuenta atrás" : "Continuar cuenta atrás";
  $("pauseButton").disabled = false;
  $("pauseButton").style.opacity = "1";
  $("skipButton").classList.add("hidden");
  $("finishButton").classList.add("hidden");
  $("statusMessage").textContent = prestartState === "paused" ? "Cuenta atrás pausada." : "Prepárate para comenzar.";
}
function beginPrestart() {
  prestartState = "running";
  prestartRemainingMs = 10000;
  prestartStartedAt = performance.now();
  lastPrestartCue = 11;
  renderPrestart();
  requestWakeLock();
  playTone(660, .12);
  startDisplayLoop();
}
function displayLoop() {
  if (!engine) return;
  if (prestartState === "running") {
    prestartRemainingMs = Math.max(0, 10000 - (performance.now() - prestartStartedAt));
    const second = Math.ceil(prestartRemainingMs / 1000);
    if (second >= 1 && second <= 3 && second !== lastPrestartCue) {
      lastPrestartCue = second;
      playTone(880, .13);
    }
    if (prestartRemainingMs <= 0) {
      prestartState = null;
      prestartRemainingMs = 10000;
      lastCountdownCue = null;
      playTone(1040, .5);
      const started = engine.start();
      processEvents();
      renderTimer(started);
      startDisplayLoop();
      return;
    }
    renderPrestart(prestartRemainingMs);
    displayFrame = requestAnimationFrame(displayLoop);
    return;
  }
  const snapshot = engine.tick();
  processEvents();
  updateCountdownCue(snapshot);
  renderTimer(snapshot);
  if (snapshot.state === "running") displayFrame = requestAnimationFrame(displayLoop);
  else { stopDisplayLoop(); releaseWakeLock(); }
}
function startDisplayLoop() { stopDisplayLoop(); displayFrame=requestAnimationFrame(displayLoop); }
async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState!=="visible") return;
  try {
    wakeLock=await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release",()=>{wakeLock=null;});
  } catch { wakeLock=null; }
}
async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); } catch {}
  wakeLock=null;
}
function updateFullscreenButton() {
  const button = $("fullscreenButton");
  const active = $("timerPanel").classList.contains("timer-immersive");
  button.textContent = active ? "SALIR DE PANTALLA COMPLETA" : "PANTALLA COMPLETA";
  button.setAttribute("aria-pressed", String(active));
}

async function toggleFullscreen() {
  const panel = $("timerPanel");
  const active = panel.classList.contains("timer-immersive");
  if (active) {
    panel.classList.remove("timer-immersive");
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch {}
    }
  } else {
    panel.classList.add("timer-immersive");
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent) && !document.fullscreenElement && panel.requestFullscreen) {
      try { await panel.requestFullscreen(); } catch {}
    }
  }
  updateFullscreenButton();
}

function renderTimerDescription(workout) {
  const panel = $("timerDescription");
  panel.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "timer-description-heading";
  const title = document.createElement("h2");
  title.textContent = workout.title || workout.name || "WOD";
  heading.append(title);
  const format = document.createElement("span");
  format.className = "tag";
  format.textContent = workout.tag || String(workout.workout?.format || "WOD").replaceAll("_", " ").toUpperCase();
  heading.append(format);
  panel.append(heading);

  const descriptionText = workout.description || workout.workout?.description;
  if (descriptionText) {
    const description = document.createElement("p");
    description.className = "timer-description-summary";
    description.textContent = descriptionText;
    panel.append(description);
  }

  const movements = workout.movements || (workout.workout?.movements || []).map(m =>
    [m.prescription, m.name, m.load].filter(Boolean).join(" · ")
  );
  if (movements.length) {
    const label = document.createElement("h3");
    label.textContent = "MOVIMIENTOS";
    panel.append(label);
    const list = document.createElement("ul");
    list.className = "timer-description-list";
    movements.forEach(movement => {
      const item = document.createElement("li");
      item.textContent = typeof movement === "string" ? movement : movement.name || "";
      list.append(item);
    });
    panel.append(list);
  }

  const notesText = workout.notes || workout.workout?.notes;
  if (notesText) {
    const notes = document.createElement("p");
    notes.className = "timer-description-notes";
    notes.textContent = notesText;
    panel.append(notes);
  }
  panel.classList.remove("hidden");
}

function showTimer(w = presets[selected], sourceView = "home") {
  returnView = sourceView;
  const plan = w.plan || w.timer;
  if (!plan) return;
  engine=new TimerEngine(plan);
  $("setupPanel").classList.add("hidden");
  $("timerPanel").classList.remove("hidden");
  $("timerFormat").textContent=w.tag || String(w.workout?.format || "WOD").replaceAll("_"," ").toUpperCase();
  $("timerWorkoutName").textContent=w.name || w.title;
  renderTimerDescription(w);
  const movements = w.movements || (w.workout?.movements || []).map(m => [m.prescription, m.name, m.load].filter(Boolean).join(" · "));
  $("timerMovements").replaceChildren(...movements.map(m=>{const s=document.createElement("span");s.textContent=m;return s;}));
  lastCountdownCue=null;
  renderTimer(engine.snapshot());
}
document.querySelectorAll("[data-preset]").forEach(b=>b.addEventListener("click",()=>{selected=b.dataset.preset;renderPreset();$("saveWorkoutButton").disabled=false;$("saveWorkoutButton").textContent="GUARDAR ESTE WOD";}));
$("startButton").addEventListener("click", async () => {
  showTimer();
  if ($("soundButton").getAttribute("aria-pressed") === "true") {
    try { await unlockAudio(); }
    catch (error) { $("statusMessage").textContent = "El cronómetro puede funcionar, pero no se ha podido activar el audio."; }
  }
  beginPrestart();
});
$("pauseButton").addEventListener("click", async () => {
  if (!engine) return;
  if (prestartState === "running") {
    prestartRemainingMs = Math.max(0, 10000 - (performance.now() - prestartStartedAt));
    prestartState = "paused";
    stopDisplayLoop();
    await releaseWakeLock();
    renderPrestart(prestartRemainingMs);
    return;
  }
  if (prestartState === "paused") {
    prestartState = "running";
    prestartStartedAt = performance.now() - (10000 - prestartRemainingMs);
    await requestWakeLock();
    renderPrestart(prestartRemainingMs);
    startDisplayLoop();
    return;
  }
  const state = engine.snapshot().state;
  if (state === "idle") {
    if ($("soundButton").getAttribute("aria-pressed") === "true") {
      try { await unlockAudio(); } catch (error) { $("statusMessage").textContent = "El cronómetro puede funcionar, pero no se ha podido activar el audio."; }
    }
    beginPrestart();
    return;
  }
  const result = state === "running" ? engine.pause() : state === "paused" ? engine.resume() : engine.snapshot();
  processEvents();
  renderTimer(result);
  if (result.state === "running") { await requestWakeLock(); startDisplayLoop(); }
  else { stopDisplayLoop(); await releaseWakeLock(); }
});
$("resetButton").addEventListener("click", async () => {
  if (!engine) return;
  prestartState = null;
  prestartRemainingMs = 10000;
  lastPrestartCue = 11;
  const snap = engine.reset();
  processEvents();
  lastCountdownCue = null;
  renderTimer(snap);
  stopDisplayLoop();
  await releaseWakeLock();
});
$("skipButton").addEventListener("click",()=>{if(!engine)return;const snap=engine.skip();processEvents();lastCountdownCue=null;renderTimer(snap);if(snap.state==="running")startDisplayLoop();});
$("finishButton").addEventListener("click",async()=>{if(!engine)return;const snap=engine.finish();processEvents();renderTimer(snap);stopDisplayLoop();await releaseWakeLock();});
$("backButton").addEventListener("click",async()=>{stopDisplayLoop();await releaseWakeLock();engine=null;$("timerPanel").classList.remove("timer-immersive");updateFullscreenButton();$("timerPanel").classList.add("hidden");$(returnView==="library"?"libraryPanel":"setupPanel").classList.remove("hidden");});
$("soundButton").addEventListener("click", async () => {
  const enabled = $("soundButton").getAttribute("aria-pressed") !== "true";
  $("soundButton").setAttribute("aria-pressed", String(enabled));
  $("soundButton").textContent = enabled ? "SONIDO: ON" : "SONIDO: OFF";
  if (enabled) {
    try { await unlockAudio(); await playTone(880, .16); }
    catch (error) { $("statusMessage").textContent = "No se ha podido activar el audio en este navegador."; }
  }
});
$("fullscreenButton").addEventListener("click",toggleFullscreen);
document.addEventListener("fullscreenchange",updateFullscreenButton);
updateFullscreenButton();
document.addEventListener("visibilitychange",async()=>{
  if(!engine)return;
  if(document.visibilityState==="visible"){
    const snap=engine.tick();processEvents();updateCountdownCue(snap);renderTimer(snap);
    if(snap.state==="running"){await requestWakeLock();startDisplayLoop();}else stopDisplayLoop();
  } else {stopDisplayLoop();await releaseWakeLock();}
});

function presetAsWod() {
  const preset = presets[selected];
  const formatMap = { amrap:"amrap", fortime:"for_time", emom:"emom", tabata:"tabata" };
  return {
    schemaVersion: 1,
    title: preset.name,
    sourceText: preset.description,
    workout: {
      format: formatMap[selected],
      description: preset.description,
      movements: preset.movements.map(text => ({ name: text, prescription: null, load: null, notes: null }))
    },
    timer: preset.plan,
    interpretation: { status: "ready", issues: [] }
  };
}
function showLibrary() {
  $("setupPanel").classList.add("hidden");
  $("libraryPanel").classList.remove("hidden");
  renderLibrary();
}
function makeLibraryCard(record) {
  const card = document.createElement("article");
  card.className = "library-card";
  const top = document.createElement("div");
  top.className = "library-card-top";
  const heading = document.createElement("h2");
  heading.textContent = record.title;
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = record.workout.format.replaceAll("_", " ").toUpperCase();
  top.append(heading, tag);
  const description = document.createElement("p");
  description.textContent = record.workout.description || record.workout.movements.map(m => m.name).join(" · ");
  const meta = document.createElement("small");
  meta.textContent = "Actualizado " + new Date(record.updatedAt).toLocaleDateString("es-ES");
  const actions = document.createElement("div");
  actions.className = "library-card-actions";
  const open = document.createElement("button");
  open.className = "primary-button";
  open.type = "button";
  open.textContent = record.timer && record.interpretation.status === "ready" ? "ABRIR TIMER" : "PENDIENTE TIMER";
  open.disabled = !record.timer || record.interpretation.status !== "ready";
  open.addEventListener("click", () => {
    if (!record.timer) return;
    $("libraryPanel").classList.add("hidden");
    showTimer(record, "library");
  });
  const edit = document.createElement("button");
  edit.className = "secondary-button";
  edit.type = "button";
  edit.textContent = "EDITAR";
  edit.addEventListener("click", () => openEditor(record.id));
  const duplicate = document.createElement("button");
  duplicate.className = "secondary-button";
  duplicate.type = "button";
  duplicate.textContent = "DUPLICAR";
  duplicate.addEventListener("click", async () => {
    try { await repository.duplicate(record.id); await renderLibrary(); }
    catch (error) { showLibraryError(error); }
  });
  const remove = document.createElement("button");
  remove.className = "secondary-button";
  remove.type = "button";
  remove.textContent = "ELIMINAR";
  remove.addEventListener("click", async () => {
    try {
      deletedWorkout = await repository.delete(record.id);
      $("undoArea").classList.remove("hidden");
      $("undoMessage").textContent = "“" + record.title + "” eliminado.";
      await renderLibrary();
    } catch (error) { showLibraryError(error); }
  });
  actions.append(open, edit, duplicate, remove);
  card.append(top, description, meta, actions);
  return card;
}

function createMovementEditorRow(movement = {}) {
  const row = document.createElement("div");
  row.className = "movement-editor-row";
  row.dataset.movementId = movement.id || "";
  const fields = [
    ["name", "Movimiento", movement.name || "", true],
    ["prescription", "Reps / series", movement.prescription || "", false],
    ["load", "Carga", movement.load || "", false],
    ["notes", "Notas", movement.notes || "", false]
  ];
  for (const [name, placeholder, value, required] of fields) {
    const input = document.createElement("input");
    input.className = "editor-input movement-field";
    input.name = name;
    input.placeholder = placeholder;
    input.value = value;
    input.maxLength = 160;
    input.setAttribute("aria-label", placeholder);
    if (required) input.required = true;
    row.append(input);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-movement-button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Eliminar movimiento");
  remove.addEventListener("click", () => {
    const movementId = row.dataset.movementId;
    row.remove();
    if (movementId) $("semanticStructureEditor")?.querySelectorAll('[name="movementId"]').forEach(select => {
      if (select.value === movementId) select.closest(".structure-item-row")?.remove();
      else select.querySelectorAll("option").forEach(option => { if (option.value === movementId) option.remove(); });
    });
  });
  row.append(remove);
  return row;
}
async function openEditor(id) {
  try {
    creatingWorkout = false;
    editorReturnView = "library";
    const record = await repository.get(id);
    if (!record) throw new Error("No se ha encontrado el WOD.");
    editingWorkoutId = id;
    editingSchemaVersion = record.schemaVersion;
    editingLegacyFormat = record.workout.legacyFormat || null;
    $("editorHeading").innerHTML = 'Editar WOD<span>.</span>';
    $("editorIntro").textContent = "Modifica el nombre, la descripción y las prescripciones. La configuración del temporizador se conserva.";
    $("saveEditorButton").textContent = "GUARDAR CAMBIOS";
    $("editTitle").value = record.title;
    $("editFormat").value = record.workout.format;
    $("editDescription").value = record.workout.description || "";
    $("movementEditorList").replaceChildren(...record.workout.movements.map(createMovementEditorRow));
    record.workout.movements.forEach((movement, index) => { $("movementEditorList").children[index].dataset.movementId = movement.id || "legacy-movement-" + (index + 1); });
    setStructureEditorVisible(record.schemaVersion === 2);
    if (record.schemaVersion === 2) {
      configureStructureEditor(record.workout.format, record.workout.structure);
      editingStructureSupported = isStructureEditorCompatible(record.workout.structure);
      if (!editingStructureSupported) $("editorStatus").textContent = "Esta estructura contiene nodos anidados que todavía no admite el editor visual. No se guardarán cambios para evitar perder información.";
    } else editingStructureSupported = true;
    renderTimerBlocks(record.timer);
    $("editorStatus").textContent = "";
    $("libraryPanel").classList.add("hidden");
    $("editorPanel").classList.remove("hidden");
    $("editTitle").focus();
  } catch (error) { showLibraryError(error); }
}
async function openNewEditor(sourceView = "library") {
  creatingWorkout = true;
  editingSchemaVersion = 2;
  editingLegacyFormat = null;
  editorReturnView = sourceView;
  editingWorkoutId = null;
  $("editTitle").value = "";
  $("editFormat").value = "custom";
  $("editDescription").value = "";
  $("movementEditorList").replaceChildren(createMovementEditorRow());
  $("movementEditorList").firstElementChild.dataset.movementId = "movement-1";
  setStructureEditorVisible(true);
  configureStructureEditor("custom");
  renderTimerBlocks(null);
  $("editorHeading").innerHTML = 'Crear WOD<span>.</span>';
  $("editorIntro").textContent = "Añade los movimientos y guarda el WOD. Después podrás configurar su temporizador.";
  $("saveEditorButton").textContent = "CREAR WOD";
  $("editorStatus").textContent = "Se guardará como borrador hasta que configures el temporizador.";
  $("libraryPanel").classList.add("hidden");
  $("setupPanel").classList.add("hidden");
  $("editorPanel").classList.remove("hidden");
  $("editTitle").focus();
}
const timerBlockTypes = [
  ["countdown", "Cuenta atrás"],
  ["countup", "For Time · Cuenta ascendente"],
  ["emom", "EMOM / E2MOM"],
  ["intervals", "Intervalos · Trabajo / descanso"],
  ["rest", "Descanso"],
  ["repeat", "Grupo de rondas repetidas"]
];
const timerBlockLabels = {
  countdown: "Bloque de trabajo", countup: "For Time", emom: "EMOM",
  intervals: "Intervalos", rest: "Descanso", repeat: "Grupo repetido"
};
function timeParts(seconds) {
  if (!Number.isInteger(seconds)) return ["", ""];
  return [String(Math.floor(seconds / 60)), String(seconds % 60)];
}
function timerField(fields, name, label, value = "", options = {}) {
  const wrap = document.createElement("div");
  if (options.wide) wrap.classList.add("wide-field");
  const caption = document.createElement("label");
  caption.className = "field-label";
  caption.textContent = label;
  const input = document.createElement("input");
  input.className = "editor-input";
  input.name = name;
  input.type = options.type || "number";
  input.value = value;
  input.placeholder = options.placeholder || "";
  if (input.type === "number") {
    input.min = options.min ?? "0";
    input.step = "1";
    input.inputMode = "numeric";
  } else input.maxLength = 80;
  caption.htmlFor = "timer-" + name + "-" + Math.random().toString(36).slice(2, 8);
  input.id = caption.htmlFor;
  wrap.append(caption, input);
  fields.append(wrap);
  return input;
}
function timerCheckbox(fields, name, label, checked = false) {
  const wrap = document.createElement("label");
  wrap.className = "checkbox-field";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.checked = checked;
  const text = document.createElement("span");
  text.textContent = label;
  wrap.append(input, text);
  fields.append(wrap);
}
function renderTimerBlockFields(row, block = {}) {
  const fields = row.querySelector(".timer-block-fields");
  fields.replaceChildren();
  const type = row.querySelector('[name="blockType"]').value;
  const label = timerField(fields, "label", "Nombre del bloque", block.label || timerBlockLabels[type], { type: "text", wide: true });
  label.required = true;
  const addTime = (prefix, caption, seconds, required = true) => {
    const [minutes, rest] = timeParts(seconds);
    timerField(fields, prefix + "Minutes", caption + " · minutos", minutes, { placeholder: required ? "Obligatorio" : "Sin límite" });
    timerField(fields, prefix + "Seconds", caption + " · segundos", rest, { placeholder: required ? "0–59" : "Opcional" });
  };
  if (type === "repeat") {
    timerField(fields, "repeatCount", "Número de rondas del grupo", block.repeatCount ?? 2, { placeholder: "Ej. 3", min: "1" });
    const hint = document.createElement("div");
    hint.className = "timer-plan-help wide-field";
    hint.textContent = "Los bloques interiores se ejecutarán en el orden indicado en cada ronda.";
    fields.append(hint);
    const children = document.createElement("div");
    children.className = "timer-block-list timer-block-children";
    for (const child of block.blocks || []) children.append(createTimerBlockRow(child));
    if (!children.children.length) {
      const empty = document.createElement("div");
      empty.className = "timer-block-empty";
      empty.textContent = "Añade al menos un bloque a este grupo.";
      children.append(empty);
    }
    const addChild = document.createElement("button");
    addChild.type = "button";
    addChild.className = "text-button timer-group-add";
    addChild.textContent = "+ AÑADIR BLOQUE AL GRUPO";
    addChild.addEventListener("click", () => {
      children.querySelector(".timer-block-empty")?.remove();
      const child = createTimerBlockRow();
      children.append(child);
      child.querySelector("[name=label]")?.focus();
    });
    fields.append(children, addChild);
  } else if (type === "countdown" || type === "rest") {
    addTime("duration", "Duración", block.durationSeconds);
    if (type === "countdown") timerCheckbox(fields, "allowSkip", "Permitir saltar este bloque", block.allowSkip === true);
    else timerCheckbox(fields, "allowSkip", "Permitir saltar el descanso", block.allowSkip === true);
  } else if (type === "countup") {
    addTime("cap", "Time Cap", block.timeCapSeconds ?? null, false);
    timerField(fields, "rounds", "Rondas objetivo (opcional)", block.rounds ?? "", { placeholder: "Sin objetivo" });
    const hint = document.createElement("div");
    hint.className = "timer-plan-help wide-field";
    hint.textContent = "RFT y Ladder usan este cronómetro ascendente. El temporizador no detecta rondas, repeticiones ni peldaños automáticamente.";
    fields.append(hint);
  } else if (type === "emom") {
    addTime("duration", "Duración total", block.durationSeconds);
    addTime("interval", "Duración de cada intervalo", block.intervalSeconds);
    const rounds = block.rounds ? String(block.rounds) + " intervalos" : "Se calcularán al guardar";
    const hint = document.createElement("div");
    hint.className = "timer-plan-help wide-field";
    hint.textContent = "Número de intervalos: " + rounds + ". La duración total debe ser múltiplo del intervalo.";
    fields.append(hint);
    timerCheckbox(fields, "allowSkip", "Permitir saltar intervalos", block.allowSkip === true);
  } else if (type === "intervals") {
    timerField(fields, "rounds", "Número de rondas", block.rounds ?? "", { placeholder: "Obligatorio" });
    addTime("work", "Tiempo de trabajo", block.workSeconds);
    addTime("rest", "Tiempo de descanso (escribe 0 si no hay)", block.restSeconds, true);
    timerCheckbox(fields, "startWithRest", "Comenzar descansando", block.startWithRest === true);
    timerCheckbox(fields, "allowSkip", "Permitir saltar fases", block.allowSkip === true);
  }
}
function createTimerBlockRow(block = {}) {
  const row = document.createElement("article");
  row.className = "timer-block-card";
  const top = document.createElement("div");
  top.className = "timer-block-top";
  const select = document.createElement("select");
  select.className = "editor-input";
  select.name = "blockType";
  select.setAttribute("aria-label", "Tipo de bloque temporal");
  for (const [value, label] of timerBlockTypes) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = block.type || "countdown";
  const controls = document.createElement("div");
  controls.className = "timer-block-controls";
  const move = (label, title, direction) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timer-block-move";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", () => {
      if (direction < 0 && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
      if (direction > 0 && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
    });
    controls.append(button);
  };
  move("↑", "Subir bloque", -1);
  move("↓", "Bajar bloque", 1);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "timer-block-remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Eliminar bloque");
  remove.addEventListener("click", () => { const parent = row.parentElement; row.remove(); updateTimerBlockEmptyState(parent); });
  controls.append(remove);
  top.append(select, controls);
  const fields = document.createElement("div");
  fields.className = "timer-block-fields";
  row.append(top, fields);
  select.addEventListener("change", () => renderTimerBlockFields(row));
  renderTimerBlockFields(row, block);
  return row;
}
function updateTimerBlockEmptyState(list = $("timerBlockList")) {
  const hasBlocks = [...list.children].some(child => child.classList.contains("timer-block-card"));
  const empty = [...list.children].find(child => child.classList.contains("timer-block-empty"));
  if (!hasBlocks && !empty) {
    const message = document.createElement("div");
    message.className = "timer-block-empty";
    message.textContent = "Todavía no hay bloques. Añade uno para configurar el cronómetro o guarda el WOD como borrador.";
    list.append(message);
  } else if (hasBlocks && empty) empty.remove();
}
function renderTimerBlocks(plan) {
  timerPlanLoadError = false;
  const list = $("timerBlockList");
  list.replaceChildren();
  try {
    const blocks = copyTimerPlanBlocks(plan);
    list.replaceChildren(...blocks.map(createTimerBlockRow));
    $("timerPlanStatus").textContent = "";
    $("timerPlanStatus").classList.remove("timer-plan-status-error");
    updateTimerBlockEmptyState();
  } catch (error) {
    timerPlanLoadError = true;
    $("timerPlanStatus").textContent = error.message + " No guardaremos cambios hasta que puedas revisar este plan.";
    $("timerPlanStatus").classList.add("timer-plan-status-error");
  }
}
function readTimerSeconds(row, prefix, options = {}) {
  const rawMinutes = row.querySelector('[name="' + prefix + 'Minutes"]').value.trim();
  const rawSeconds = row.querySelector('[name="' + prefix + 'Seconds"]').value.trim();
  if (!rawMinutes && !rawSeconds) {
    if (options.optional) return null;
    throw new Error(options.message || "Completa " + options.label + ".");
  }
  const minutes = rawMinutes === "" ? 0 : Number(rawMinutes);
  const seconds = rawSeconds === "" ? 0 : Number(rawSeconds);
  if (!Number.isInteger(minutes) || minutes < 0 || !Number.isInteger(seconds) || seconds < 0 || seconds > 59) {
    throw new Error(options.label + ": introduce minutos y segundos válidos (0–59 segundos).");
  }
  const total = minutes * 60 + seconds;
  if (options.allowZero ? total < 0 : total <= 0) throw new Error(options.label + " debe ser mayor que cero.");
  return total;
}
function collectTimerBlocks(list = $("timerBlockList")) {
  return [...list.children]
    .filter(row => row.classList.contains("timer-block-card"))
    .map((row, index) => {
      const value = name => row.querySelector('[name="' + name + '"]')?.value.trim() ?? "";
      const checked = name => row.querySelector('[name="' + name + '"]')?.checked === true;
      const type = value("blockType");
      const label = value("label") || timerBlockLabels[type];
      const block = { type, label };
      if (type === "repeat") {
        const repeatCount = Number(value("repeatCount"));
        if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > 1000) throw new Error("El número de rondas del grupo debe estar entre 1 y 1000.");
        block.repeatCount = repeatCount;
        const children = row.querySelector(".timer-block-children");
        block.blocks = collectTimerBlocks(children);
        if (!block.blocks.length) throw new Error("Añade al menos un bloque dentro de cada grupo repetido.");
      } else if (type === "countdown" || type === "rest") {
        block.durationSeconds = readTimerSeconds(row, "duration", { label: "La duración" });
        block.allowSkip = checked("allowSkip");
      } else if (type === "countup") {
        block.timeCapSeconds = readTimerSeconds(row, "cap", { label: "El Time Cap", optional: true });
        const rounds = value("rounds");
        if (rounds && (!Number.isInteger(Number(rounds)) || Number(rounds) <= 0)) throw new Error("Las rondas objetivo deben ser un entero mayor que cero.");
        block.rounds = rounds ? Number(rounds) : null;
      } else if (type === "emom") {
        block.durationSeconds = readTimerSeconds(row, "duration", { label: "La duración total" });
        block.intervalSeconds = readTimerSeconds(row, "interval", { label: "La duración del intervalo" });
        if (block.durationSeconds % block.intervalSeconds !== 0) throw new Error("En un EMOM, la duración total debe ser múltiplo exacto del intervalo.");
        block.rounds = block.durationSeconds / block.intervalSeconds;
        block.allowSkip = checked("allowSkip");
      } else if (type === "intervals") {
        const rounds = value("rounds");
        if (!rounds || !Number.isInteger(Number(rounds)) || Number(rounds) <= 0) throw new Error("Indica un número de rondas válido para los intervalos.");
        block.rounds = Number(rounds);
        block.workSeconds = readTimerSeconds(row, "work", { label: "El tiempo de trabajo" });
        block.restSeconds = readTimerSeconds(row, "rest", { label: "El tiempo de descanso", allowZero: true });
        block.startWithRest = checked("startWithRest");
        block.allowSkip = checked("allowSkip");
      }
      return block;
    });
}
function collectTimerPlan(title) {
  if (timerPlanLoadError) throw new Error("No se ha podido cargar la configuración temporal guardada. No se han aplicado cambios.");
  return buildTimerPlan(title, collectTimerBlocks());
}
$("addTimerBlockButton").addEventListener("click", () => {
  const empty = $("timerBlockList").querySelector(".timer-block-empty");
  if (empty) empty.remove();
  const row = createTimerBlockRow();
  $("timerBlockList").append(row);
  row.querySelector('[name="label"]').focus();
});


const structureFormats = {
  rounds_for_time: ["rounds"],
  chipper: ["chipper"],
  ladder: ["ladder"],
  strength_plus_wod: ["sections"],
  for_time: ["sequence", "rounds", "chipper", "sections"],
  amrap: ["sequence", "rounds", "sections"],
  emom: ["sequence", "sections"],
  e2mom: ["sequence", "sections"],
  tabata: ["sequence", "sections"],
  intervals: ["sequence", "sections"],
  death_by: ["sequence", "ladder", "sections"],
  custom: ["sequence", "rounds", "chipper", "ladder", "sections"]
};
const structureLabels = { sequence: "Secuencia", rounds: "Rondas", chipper: "Chipper", ladder: "Ladder", sections: "Secciones" };
function currentMovementOptions() {
  return [...$("movementEditorList").querySelectorAll(".movement-editor-row")].map((row, index) => ({
    id: row.dataset.movementId || "movement-" + (index + 1),
    name: row.querySelector('[name="name"]').value.trim() || "Movimiento " + (index + 1)
  }));
}
function movementSelect(selectedId = "") {
  const select = document.createElement("select");
  select.className = "editor-input";
  select.name = "movementId";
  const options = currentMovementOptions();
  for (const item of options) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    option.selected = item.id === selectedId;
    select.append(option);
  }
  return select;
}
function structureRemoveButton(label, onRemove) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "remove-movement-button";
  button.textContent = "×";
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onRemove);
  return button;
}
function createStructureItemRow(item = {}) {
  const row = document.createElement("div");
  row.className = "structure-item-row";
  row.append(movementSelect(item.movementId || currentMovementOptions()[0]?.id));
  const prescription = document.createElement("input");
  prescription.className = "editor-input";
  prescription.name = "prescription";
  prescription.placeholder = "Prescripción opcional";
  prescription.value = item.prescription || "";
  row.append(prescription);
  row.append(structureRemoveButton("Eliminar movimiento de la estructura", () => row.remove()));
  return row;
}
function createLadderStepRow(step = {}) {
  const row = document.createElement("div");
  row.className = "structure-step-row";
  const label = document.createElement("input");
  label.className = "editor-input";
  label.name = "stepLabel";
  label.placeholder = "Peldaño (ej. 10 reps)";
  label.value = step.label || "";
  const items = document.createElement("div");
  items.className = "structure-items";
  (step.items?.length ? step.items : [{}]).forEach(item => items.append(createStructureItemRow(item)));
  const add = document.createElement("button");
  add.type = "button";
  add.className = "structure-add-button";
  add.textContent = "+ MOVIMIENTO";
  add.addEventListener("click", () => items.append(createStructureItemRow()));
  const remove = structureRemoveButton("Eliminar peldaño", () => row.remove());
  row.append(label, items, add, remove);
  return row;
}
function createSectionRow(section = {}) {
  const row = document.createElement("div");
  row.className = "structure-section-row";
  const name = document.createElement("input");
  name.className = "editor-input";
  name.name = "sectionName";
  name.placeholder = "Nombre de la sección";
  name.value = section.name || "";
  const remove = structureRemoveButton("Eliminar sección", () => row.remove());
  row.append(name, remove);
  const children = document.createElement("div");
  children.className = "structure-section-items";
  const childItems = section.structure?.items || [];
  (childItems.length ? childItems : [{}]).forEach(item => children.append(createStructureItemRow(item)));
  const add = document.createElement("button");
  add.type = "button";
  add.className = "structure-add-button";
  add.textContent = "+ AÑADIR MOVIMIENTO";
  add.addEventListener("click", () => children.append(createStructureItemRow()));
  children.append(add);
  row.append(children);
  return row;
}
function renderStructureSettings(structure = null) {
  const type = $("structureType").value;
  const settings = $("structureSettings");
  settings.replaceChildren();
  if (type === "rounds") {
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = "Número de rondas";
    const count = document.createElement("input");
    count.className = "editor-input structure-count";
    count.type = "number";
    count.name = "roundCount";
    count.min = "1";
    count.step = "1";
    count.value = structure?.count || 5;
    label.append(count);
    settings.append(label);
  }
  if (type === "sequence" || type === "rounds" || type === "chipper") {
    const list = document.createElement("div");
    list.className = "structure-items";
    const items = structure?.items || [{}];
    items.forEach(item => list.append(createStructureItemRow(item)));
    const add = document.createElement("button");
    add.type = "button";
    add.className = "structure-add-button";
    add.textContent = "+ AÑADIR MOVIMIENTO";
    add.addEventListener("click", () => list.append(createStructureItemRow()));
    settings.append(list, add);
  } else if (type === "ladder") {
    const direction = document.createElement("select");
    direction.className = "editor-input";
    direction.name = "ladderDirection";
    for (const [value, label] of [["ascending","Ascendente"],["descending","Descendente"],["alternating","Alterna"],["custom","Personalizada"]]) {
      const option = document.createElement("option");
      option.value = value; option.textContent = label;
      option.selected = (structure?.direction || "custom") === value;
      direction.append(option);
    }
    const list = document.createElement("div");
    list.className = "structure-steps";
    (structure?.steps || [{ label: "", items: [{}] }]).forEach(step => list.append(createLadderStepRow(step)));
    const add = document.createElement("button");
    add.type = "button";
    add.className = "structure-add-button";
    add.textContent = "+ AÑADIR PELDAÑO";
    add.addEventListener("click", () => list.append(createLadderStepRow()));
    settings.append(direction, list, add);
  } else if (type === "sections") {
    const list = document.createElement("div");
    list.className = "structure-sections";
    (structure?.sections || [{ name: "", structure: { type: "sequence", items: [{}] } }]).forEach(section => list.append(createSectionRow(section)));
    const add = document.createElement("button");
    add.type = "button";
    add.className = "structure-add-button";
    add.textContent = "+ AÑADIR SECCIÓN";
    add.addEventListener("click", () => list.append(createSectionRow()));
    settings.append(list, add);
  }
}
function isStructureEditorCompatible(structure) {
  const onlyMovements = items => Array.isArray(items) && items.every(item => item && item.type === "movement");
  if (!structure) return false;
  if (["sequence", "rounds", "chipper"].includes(structure.type)) return onlyMovements(structure.items);
  if (structure.type === "ladder") return Array.isArray(structure.steps) && structure.steps.every(step => onlyMovements(step.items));
  if (structure.type === "sections") return Array.isArray(structure.sections) && structure.sections.every(section =>
    section.structure?.type === "sequence" && onlyMovements(section.structure.items));
  return false;
}
function setStructureEditorVisible(visible) {
  $("semanticStructureEditor").classList.toggle("hidden", !visible);
}
function configureStructureEditor(format, structure = null) {
  const allowed = structureFormats[format] || ["sequence", "rounds", "chipper", "ladder", "sections"];
  const select = $("structureType");
  select.replaceChildren(...allowed.map(type => {
    const option = document.createElement("option");
    option.value = type; option.textContent = structureLabels[type];
    return option;
  }));
  select.value = structure && allowed.includes(structure.type) ? structure.type : allowed[0];
  renderStructureSettings(structure && structure.type === select.value ? structure : null);
}
function collectSemanticStructure() {
  const type = $("structureType").value;
  const movementItems = container => [...container.querySelectorAll(":scope > .structure-item-row")].map(row => ({
    type: "movement",
    movementId: row.querySelector('[name="movementId"]').value,
    ...(row.querySelector('[name="prescription"]').value.trim() ? { prescription: row.querySelector('[name="prescription"]').value.trim() } : {})
  }));
  if (["sequence", "rounds", "chipper"].includes(type)) {
    const items = movementItems($("structureSettings").querySelector(".structure-items"));
    if (!items.length) throw new Error("Añade al menos un movimiento a la estructura.");
    return type === "rounds"
      ? { type, count: Number($("structureSettings").querySelector('[name="roundCount"]').value), items }
      : { type, items };
  }
  if (type === "ladder") {
    const steps = [...$("structureSettings").querySelectorAll(".structure-step-row")].map(row => ({
      label: row.querySelector('[name="stepLabel"]').value.trim(),
      items: movementItems(row.querySelector(".structure-items"))
    }));
    if (!steps.length || steps.some(step => !step.label)) throw new Error("Cada peldaño de la ladder necesita una etiqueta.");
    return { type, direction: $("structureSettings").querySelector('[name="ladderDirection"]').value, steps };
  }
  const sections = [...$("structureSettings").querySelectorAll(".structure-section-row")].map((row, index) => ({
    id: "section-" + (index + 1),
    name: row.querySelector('[name="sectionName"]').value.trim(),
    structure: { type: "sequence", items: movementItems(row.querySelector(".structure-section-items")) }
  }));
  if (!sections.length || sections.some(section => !section.name || !section.structure.items.length)) {
    throw new Error("Cada sección necesita un nombre y al menos un movimiento.");
  }
  return { type: "sections", sections };
}

function collectEditedMovements() {
  return [...$("movementEditorList").querySelectorAll(".movement-editor-row")].map(row => {
    const value = name => row.querySelector('[name="' + name + '"]').value.trim();
    return {
      id: row.dataset.movementId || "movement-" + (row.parentElement ? [...row.parentElement.children].indexOf(row) + 1 : 1),
      name: value("name"),
      prescription: value("prescription") || null,
      load: value("load") || null,
      notes: value("notes") || null
    };
  });
}
$("editorBackButton").addEventListener("click", () => {
  $("editorPanel").classList.add("hidden");
  $(editorReturnView === "home" ? "setupPanel" : "libraryPanel").classList.remove("hidden");
});
$("structureType").addEventListener("change", () => renderStructureSettings());
$("editFormat").addEventListener("change", () => {
  if (editingSchemaVersion !== 2) return;
  let current = null;
  try { current = collectSemanticStructure(); } catch {}
  const allowed = structureFormats[$("editFormat").value] || [];
  const compatible = current && allowed.includes(current.type) ? current : null;
  configureStructureEditor($("editFormat").value, compatible);
  if (current && !compatible) $("editorStatus").textContent = "El formato elegido necesita otra estructura. Revisa los movimientos y la organización antes de guardar.";
});
$("addMovementButton").addEventListener("click", () => {
  const row = createMovementEditorRow();
  row.dataset.movementId = "movement-" + ($("movementEditorList").children.length + 1);
  $("movementEditorList").append(row);
  if (!$("semanticStructureEditor").classList.contains("hidden")) {
    const option = document.createElement("option");
    option.value = row.dataset.movementId;
    option.textContent = row.querySelector('[name="name"]').value.trim() || "Movimiento " + $("movementEditorList").children.length;
    $("semanticStructureEditor").querySelectorAll('[name="movementId"]').forEach(select => select.append(option.cloneNode(true)));
  }
  $("movementEditorList").lastElementChild.querySelector('[name="name"]').focus();
});
$("movementEditorList").addEventListener("input", event => {
  if (event.target.name !== "name") return;
  const row = event.target.closest(".movement-editor-row");
  const id = row?.dataset.movementId;
  if (!id) return;
  const label = event.target.value.trim() || "Movimiento";
  $("semanticStructureEditor").querySelectorAll('[name="movementId"]').forEach(select => {
    const option = [...select.options].find(item => item.value === id);
    if (option) option.textContent = label;
  });
});
$("workoutEditor").addEventListener("submit", async event => {
  event.preventDefault();
  if (!repository || (!creatingWorkout && !editingWorkoutId)) return;
  if (editingSchemaVersion === 2 && !editingStructureSupported) {
    $("editorStatus").textContent = "No se puede guardar: esta estructura aún no es editable sin pérdida de información.";
    return;
  }
  const title = $("editTitle").value.trim();
  const movements = collectEditedMovements();
  if (!title) {
    $("editorStatus").textContent = "Escribe un nombre para el WOD.";
    $("editTitle").focus();
    return;
  }
  if (!movements.length || movements.some(movement => !movement.name)) {
    $("editorStatus").textContent = "Añade al menos un movimiento y completa su nombre.";
    return;
  }
  let timer;
  try {
    timer = collectTimerPlan(title);
    $("timerPlanStatus").textContent = timer ? "Configuración temporal válida." : "Se guardará sin temporizador y quedará pendiente de configurar.";
    $("timerPlanStatus").classList.remove("timer-plan-status-error");
  } catch (error) {
    $("timerPlanStatus").textContent = error.message;
    $("timerPlanStatus").classList.add("timer-plan-status-error");
    return;
  }
  const save = $("saveEditorButton");
  save.disabled = true;
  save.textContent = "GUARDANDO…";
  try {
    const format = $("editFormat").value;
    const workout = {
      format,
      description: $("editDescription").value.trim(),
      movements: editingSchemaVersion === 2 ? movements.map((movement, index) => ({
        id: movement.id || "movement-" + (index + 1),
        name: movement.name,
        prescription: movement.prescription,
        load: movement.load,
        notes: movement.notes
      })) : movements.map(({ id, ...movement }) => movement)
    };
    if (editingSchemaVersion === 2) {
      workout.structure = collectSemanticStructure();
      if (editingLegacyFormat) workout.legacyFormat = editingLegacyFormat;
    }
    const interpretation = timer
      ? { status: "ready", issues: [] }
      : { status: "needs_review", issues: [timerPlanRequiredIssue()] };
    if (creatingWorkout) {
      await repository.create({ schemaVersion: editingSchemaVersion, title, sourceText: null, workout, timer, interpretation });
    } else {
      await repository.update(editingWorkoutId, { title, workout, timer, interpretation });
    }
    creatingWorkout = false;
    editingWorkoutId = null;
    $("editorStatus").textContent = "WOD guardado.";
    $("editorPanel").classList.add("hidden");
    $("libraryPanel").classList.remove("hidden");
    await renderLibrary();
  } catch (error) {
    $("editorStatus").textContent = error.message || "No se han podido guardar los cambios.";
  } finally {
    save.disabled = false;
    save.textContent = creatingWorkout ? "CREAR WOD" : "GUARDAR CAMBIOS";
  }
});

function showLibraryError(error) {
  $("libraryStatus").textContent = error?.message || "No se ha podido acceder a la biblioteca.";
  $("libraryStatus").classList.add("error");
}
async function renderLibrary() {
  const list = $("workoutLibrary");
  const status = $("libraryStatus");
  list.replaceChildren();
  status.classList.remove("error");
  status.textContent = "Cargando biblioteca…";
  try {
    const records = await repository.list();
    if (!records.length) {
      status.textContent = "Todavía no tienes WODs guardados. Crea uno nuevo o guarda un WOD de prueba.";
      return;
    }
    status.textContent = records.length + (records.length === 1 ? " WOD guardado" : " WODs guardados");
    list.replaceChildren(...records.map(makeLibraryCard));
  } catch (error) { showLibraryError(error); }
}
async function initializeRepository() {
  try {
    repository = createWorkoutRepository();
    await repository.list();
    $("saveWorkoutButton").disabled = false;
    $("libraryButton").disabled = false;
    $("createWorkoutButton").disabled = false;
    $("newWorkoutButton").disabled = false;
  } catch (error) {
    repository = null;
    $("saveWorkoutButton").disabled = true;
    $("libraryButton").disabled = true;
    $("createWorkoutButton").disabled = true;
    $("newWorkoutButton").disabled = true;
    $("libraryStatus").textContent = error.message || "El almacenamiento local no está disponible.";
    $("libraryStatus").classList.add("error");
  }
}
$("saveWorkoutButton").addEventListener("click", async () => {
  if (!repository) return;
  try {
    const record = await repository.create(presetAsWod());
    $("saveWorkoutButton").textContent = "GUARDADO ✓";
    $("saveWorkoutButton").disabled = true;
    $("libraryButton").textContent = "MIS WODS · " + (await repository.list()).length;
  } catch (error) {
    $("libraryStatus").textContent = error.message;
    $("libraryStatus").classList.add("error");
  }
});
$("createWorkoutButton").addEventListener("click", () => { if (repository) openNewEditor("home"); });
$("newWorkoutButton").addEventListener("click", () => { if (repository) openNewEditor(); });
$("libraryButton").addEventListener("click", () => {
  if (!repository) return;
  $("undoArea").classList.add("hidden");
  showLibrary();
});
$("libraryBackButton").addEventListener("click", () => {
  $("libraryPanel").classList.add("hidden");
  $("setupPanel").classList.remove("hidden");
});
$("undoDeleteButton").addEventListener("click", async () => {
  if (!repository || !deletedWorkout) return;
  try {
    await repository.restore(deletedWorkout);
    deletedWorkout = null;
    $("undoArea").classList.add("hidden");
    await renderLibrary();
  } catch (error) { showLibraryError(error); }
});

renderPreset();
updateFullscreenButton();
initializeRepository();


async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  } catch (error) {
    console.warn("No se ha podido registrar el modo offline de Throwdown Timer.", error);
  }
}

registerServiceWorker();
