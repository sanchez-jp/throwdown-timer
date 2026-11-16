import { TimerEngine } from "./timer-engine.js";
import { createWorkoutRepository } from "./workout-repository.js";
import { buildTimerPlan, flattenTimerPlan, timerPlanRequiredIssue } from "./timer-plan-builder.js";

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
let wakeLock = null;
let repository = null;
let returnView = "home";
let deletedWorkout = null;
let editingWorkoutId = null;
let creatingWorkout = false;
let editorReturnView = "library";
let timerPlanLoadError = false;

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
function playTone(frequency=880, duration=.12) {
  if (!$("soundButton").getAttribute("aria-pressed") || $("soundButton").getAttribute("aria-pressed")==="false") return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audioContext ||= new Audio();
    if (audioContext.state === "suspended") audioContext.resume();
    const oscillator=audioContext.createOscillator(), gain=audioContext.createGain();
    oscillator.frequency.value=frequency;
    gain.gain.setValueAtTime(.0001,audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.07,audioContext.currentTime+.012);
    gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+duration);
    oscillator.connect(gain);gain.connect(audioContext.destination);
    oscillator.start();oscillator.stop(audioContext.currentTime+duration+.02);
  } catch {}
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
  $("pauseButton").textContent = snapshot.state==="running" ? "PAUSAR" : snapshot.state==="paused" ? "REANUDAR" : snapshot.state==="idle" ? "INICIAR" : "FINALIZADO";
  $("pauseButton").disabled = ["completed","capped"].includes(snapshot.state);
  $("pauseButton").style.opacity = $("pauseButton").disabled ? ".45" : "1";
  $("skipButton").classList.toggle("hidden",!snapshot.can.skip);
  $("finishButton").classList.toggle("hidden",!snapshot.can.finish);
  $("statusMessage").textContent = snapshot.state==="capped" ? "Se ha alcanzado el Time Cap." : snapshot.state==="completed" ? "WOD finalizado." : snapshot.state==="paused" ? "Cronómetro pausado." : snapshot.state==="running" ? "Entrenamiento en curso." : "El cronómetro está listo.";
}
function updateCountdownCue(snapshot) {
  if (snapshot.state!=="running" || snapshot.blockType==="countup" || snapshot.phaseRemainingMs===null) {
    lastCountdownCue=null; return;
  }
  const second=Math.ceil(snapshot.phaseRemainingMs/1000);
  if (second>=1 && second<=10 && second!==lastCountdownCue) {
    lastCountdownCue=second;
    playTone(second<=3?1320:880,.075);
  }
}
function stopDisplayLoop() { if(displayFrame!==null) cancelAnimationFrame(displayFrame); displayFrame=null; }
function displayLoop() {
  if(!engine) return;
  const snapshot=engine.tick();
  processEvents();
  updateCountdownCue(snapshot);
  renderTimer(snapshot);
  if(snapshot.state==="running") displayFrame=requestAnimationFrame(displayLoop);
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
  const active=!!document.fullscreenElement;
  $("fullscreenButton").textContent=active?"SALIR PANTALLA COMPLETA":"PANTALLA COMPLETA";
  $("fullscreenButton").setAttribute("aria-pressed",String(active));
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else $("statusMessage").textContent="La pantalla completa no está disponible en este navegador.";
  } catch {
    $("statusMessage").textContent="No se ha podido activar la pantalla completa en este dispositivo.";
  }
  updateFullscreenButton();
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
  const movements = w.movements || (w.workout?.movements || []).map(m => [m.prescription, m.name, m.load].filter(Boolean).join(" · "));
  $("timerMovements").replaceChildren(...movements.map(m=>{const s=document.createElement("span");s.textContent=m;return s;}));
  lastCountdownCue=null;
  renderTimer(engine.snapshot());
}
document.querySelectorAll("[data-preset]").forEach(b=>b.addEventListener("click",()=>{selected=b.dataset.preset;renderPreset();$("saveWorkoutButton").disabled=false;$("saveWorkoutButton").textContent="GUARDAR ESTE WOD";}));
$("startButton").addEventListener("click",async()=>{
  showTimer();
  if ($("soundButton").getAttribute("aria-pressed")==="true") {
    try { const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){audioContext ||= new Audio();await audioContext.resume();} } catch {}
  }
  const snap=engine.start();processEvents();renderTimer(snap);
  await requestWakeLock();startDisplayLoop();
});
$("pauseButton").addEventListener("click",async()=>{
  if(!engine)return;
  const state=engine.snapshot().state;
  const result=state==="running"?engine.pause():state==="paused"?engine.resume():state==="idle"?engine.start():engine.snapshot();
  processEvents();renderTimer(result);
  if(result.state==="running"){await requestWakeLock();startDisplayLoop();}else{stopDisplayLoop();await releaseWakeLock();}
});
$("resetButton").addEventListener("click",async()=>{if(!engine)return;const snap=engine.reset();processEvents();lastCountdownCue=null;renderTimer(snap);stopDisplayLoop();await releaseWakeLock();});
$("skipButton").addEventListener("click",()=>{if(!engine)return;const snap=engine.skip();processEvents();lastCountdownCue=null;renderTimer(snap);if(snap.state==="running")startDisplayLoop();});
$("finishButton").addEventListener("click",async()=>{if(!engine)return;const snap=engine.finish();processEvents();renderTimer(snap);stopDisplayLoop();await releaseWakeLock();});
$("backButton").addEventListener("click",async()=>{stopDisplayLoop();await releaseWakeLock();engine=null;$("timerPanel").classList.add("hidden");$(returnView==="library"?"libraryPanel":"setupPanel").classList.remove("hidden");});
$("soundButton").addEventListener("click",async()=>{
  const enabled=$("soundButton").getAttribute("aria-pressed")!=="true";
  $("soundButton").setAttribute("aria-pressed",String(enabled));
  $("soundButton").textContent=enabled?"SONIDO: ON":"SONIDO: OFF";
  if(enabled){try{const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){audioContext ||= new Audio();await audioContext.resume();playTone(880,.1);}}catch{}}
});
$("fullscreenButton").addEventListener("click",toggleFullscreen);
document.addEventListener("fullscreenchange",updateFullscreenButton);
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
  remove.addEventListener("click", () => row.remove());
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
    $("editorHeading").innerHTML = 'Editar WOD<span>.</span>';
    $("editorIntro").textContent = "Modifica el nombre, la descripción y las prescripciones. La configuración del temporizador se conserva.";
    $("saveEditorButton").textContent = "GUARDAR CAMBIOS";
    $("editTitle").value = record.title;
    $("editFormat").value = record.workout.format;
    $("editDescription").value = record.workout.description || "";
    $("movementEditorList").replaceChildren(...record.workout.movements.map(createMovementEditorRow));
    renderTimerBlocks(record.timer);
    $("editorStatus").textContent = "";
    $("libraryPanel").classList.add("hidden");
    $("editorPanel").classList.remove("hidden");
    $("editTitle").focus();
  } catch (error) { showLibraryError(error); }
}
async function openNewEditor(sourceView = "library") {
  creatingWorkout = true;
  editorReturnView = sourceView;
  editingWorkoutId = null;
  $("editTitle").value = "";
  $("editFormat").value = "custom";
  $("editDescription").value = "";
  $("movementEditorList").replaceChildren(createMovementEditorRow());
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
  remove.addEventListener("click", () => { row.remove(); updateTimerBlockEmptyState(); });
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
    const blocks = flattenTimerPlan(plan);
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

function collectEditedMovements() {
  return [...$("movementEditorList").querySelectorAll(".movement-editor-row")].map(row => {
    const value = name => row.querySelector('[name="' + name + '"]').value.trim();
    return {
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
$("addMovementButton").addEventListener("click", () => {
  $("movementEditorList").append(createMovementEditorRow());
  $("movementEditorList").lastElementChild.querySelector('[name="name"]').focus();
});
$("workoutEditor").addEventListener("submit", async event => {
  event.preventDefault();
  if (!repository || (!creatingWorkout && !editingWorkoutId)) return;
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
    const workout = {
      format: $("editFormat").value,
      description: $("editDescription").value.trim(),
      movements
    };
    const interpretation = timer
      ? { status: "ready", issues: [] }
      : { status: "needs_review", issues: [timerPlanRequiredIssue()] };
    if (creatingWorkout) {
      await repository.create({ schemaVersion: 1, title, sourceText: null, workout, timer, interpretation });
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
