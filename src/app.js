import { TimerEngine } from "./timer-engine.js";
import { createWorkoutRepository } from "./workout-repository.js";

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
  $("editorHeading").innerHTML = 'Crear WOD<span>.</span>';
  $("editorIntro").textContent = "Añade los movimientos y guarda el WOD. Después podrás configurar su temporizador.";
  $("saveEditorButton").textContent = "CREAR WOD";
  $("editorStatus").textContent = "Se guardará como borrador hasta que configures el temporizador.";
  $("libraryPanel").classList.add("hidden");
  $("setupPanel").classList.add("hidden");
  $("editorPanel").classList.remove("hidden");
  $("editTitle").focus();
}
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
  const save = $("saveEditorButton");
  save.disabled = true;
  save.textContent = "GUARDANDO…";
  try {
    const workout = {
      format: $("editFormat").value,
      description: $("editDescription").value.trim(),
      movements
    };
    if (creatingWorkout) {
      await repository.create({
        schemaVersion: 1,
        title,
        sourceText: null,
        workout,
        timer: null,
        interpretation: {
          status: "needs_review",
          issues: [{
            severity: "blocking",
            code: "TIMER_PLAN_REQUIRED",
            message: "Configura el temporizador antes de iniciar este WOD.",
            fieldPath: "timer",
            question: "¿Qué formato y duración debe tener el temporizador?"
          }]
        }
      });
    } else {
      await repository.update(editingWorkoutId, { title, workout });
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
