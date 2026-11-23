import { TimerEngine } from "./timer-engine.js";
import { getCountdownCueSecond } from "./audio-cues.js";
import { createWorkoutRepository } from "./workout-repository.js";
import { buildTimerPlan, copyTimerPlanBlocks, timerPlanRequiredIssue } from "./timer-plan-builder.js";
import { getStructureIntervalPhaseGroups } from "./timer-description.js";

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
    plan:{type:"sequence",blocks:[{type:"emom",label:"EMOM",durationSeconds:600,intervalSeconds:60,rounds:10,intervalLabels:["Minuto impar · 12/10 cal Bike","Minuto par · 10 Burpees"]}]}
  },
  tabata: {
    tag:"TABATA", name:"TABATA 8 ROUNDS", description:"20 segundos trabajo / 10 segundos descanso",
    movements:["Air Squats","Máximo trabajo en cada intervalo"],
    plan:{type:"sequence",blocks:[{type:"intervals",label:"TABATA",rounds:8,workSeconds:20,restSeconds:10,startWithRest:false}]}
  },
  fran: {
    tag:"FOR TIME", name:"FRAN", description:"21-15-9 · Thrusters y Pull-ups",
    movements:["Thrusters","Pull-ups"],
    workout:{
      format:"for_time", description:"Completa 21, 15 y 9 repeticiones de cada movimiento, en ese orden.",
      movements:[
        {id:"thrusters",name:"Thrusters",prescription:null,load:"43 kg / 30 kg",notes:null},
        {id:"pull-ups",name:"Pull-ups",prescription:null,load:null,notes:null}
      ],
      structure:{type:"sequence",items:[
        {type:"movement",movementId:"thrusters",prescription:"21"},
        {type:"movement",movementId:"pull-ups",prescription:"21"},
        {type:"movement",movementId:"thrusters",prescription:"15"},
        {type:"movement",movementId:"pull-ups",prescription:"15"},
        {type:"movement",movementId:"thrusters",prescription:"9"},
        {type:"movement",movementId:"pull-ups",prescription:"9"}
      ]}
    },
    plan:{type:"sequence",blocks:[{type:"countup",label:"FOR TIME",timeCapSeconds:null,rounds:null}]}
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
let rftRoundCount = 0;
let rftRoundTarget = null;
let amrapExtraReps = 0;
let manualCounterMode = null;
let editingSchemaVersion = 2;
let editingLegacyFormat = null;
let editingStructureSupported = true;
let aiSourceText = null;
let aiReviewRequired = false;
let importMode = null;
let selectedImportImage = null;
let selectedImportObjectUrl = null;

function formatRepProgression(progression) {
  if (!progression || progression.every !== "round" || !progression.increment) return null;
  return "+" + progression.increment + " reps / ronda";
}
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
async function playTone(frequency=880, duration=.13, delaySeconds=0) {
  if ($("soundButton").getAttribute("aria-pressed") !== "true") return;
  try {
    // Once audio has been unlocked by a real user gesture, schedule tones
    // synchronously. Re-awaiting resume() for every cue can lose timing and
    // is unreliable on iOS Safari.
    const context = audioContext?.state === "running" ? audioContext : await unlockAudio();
    const now = context.currentTime + delaySeconds;
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
    if (event.type === "block_completed" && event.index < engine.phases.length - 1) {
      playTone(784,.12);
    } else if (event.type === "phase_changed") {
      lastCountdownCue=null;
      playTone(1046,.22,.16);
    } else if (event.type === "time_cap_reached" || event.type === "timer_completed") {
      playTone(440,.45);
    }
  }
}
function renderRftRoundCounter() {
  $("rftRoundValue").textContent = String(rftRoundCount);
  $("rftRoundTarget").textContent = rftRoundTarget === null ? "" : ` / ${rftRoundTarget}`;
  $("rftRoundMinus").disabled = rftRoundCount === 0;
  $("rftRoundPlus").disabled = rftRoundTarget !== null && rftRoundCount >= rftRoundTarget;
  $("amrapRepValue").textContent = String(amrapExtraReps);
  $("amrapRepMinus").disabled = amrapExtraReps === 0;
  $("amrapRepCounter").classList.toggle("hidden", manualCounterMode !== "amrap");
  $("rftRoundCounter").classList.toggle("is-amrap", manualCounterMode === "amrap");
}
function getRftRoundTarget(workout, plan) {
  const timerRounds = plan?.blocks?.find(block => block?.type === "countup" && Number.isInteger(block.rounds) && block.rounds > 0)?.rounds;
  if (timerRounds) return timerRounds;
  const structure = workout?.structure;
  if (structure?.type === "rounds" && Number.isInteger(structure.count) && structure.count > 0) return structure.count;
  if (structure?.type === "ladder" && Array.isArray(structure.steps) && structure.steps.length) return structure.steps.length;
  return null;
}
function renderTimer(snapshot) {
  const phase = engine.phases[snapshot.blockIndex ?? 0];
  const emomMinute = snapshot.blockType === "emom" && snapshot.round
    ? `MINUTO ${snapshot.round.current}/${snapshot.round.total} · ${phase?.label || "EMOM"}`
    : null;
  const countupStage = snapshot.blockType === "countup" ? snapshot.stageLabel : null;
  updateTimerDescriptionActive(snapshot);
  const countup = snapshot.blockType === "countup";
  const time = countup ? snapshot.phaseElapsedMs : snapshot.phaseRemainingMs;
  $("clock").textContent = time == null ? "00:00" : formatTime(time, countup && time < 60000);
  $("clock").classList.toggle("countup",countup);
  const stageWarning = !countup && time !== null && time <= 10000 && snapshot.state === "running" && snapshot.blockIndex < snapshot.blockCount - 1;
  $("clock").classList.toggle("urgent",!countup && time !== null && time <= 10000 && snapshot.state==="running" && !stageWarning);
  $("clock").classList.toggle("stage-urgent",stageWarning);
  $("timerLabel").textContent = countup ? "TIME ELAPSED" : snapshot.phase === "rest" ? "REST" : "TIME REMAINING";
  $("phaseLabel").textContent = snapshot.state==="completed" ? "COMPLETADO" : snapshot.state==="capped" ? "TIME CAP" :
    snapshot.state==="paused" ? (emomMinute ? "PAUSADO · " + emomMinute : countupStage ? "PAUSADO · " + countupStage.toUpperCase() : "PAUSADO") :
    snapshot.phase==="rest" ? (emomMinute ? "DESCANSO · MINUTO " + snapshot.round.current + "/" + snapshot.round.total : "DESCANSO") :
    emomMinute || (countupStage ? countupStage.toUpperCase() : (snapshot.state==="idle" ? "PREPARADO" : (phase?.label || "EN CURSO").toUpperCase()));
  $("roundValue").textContent = snapshot.round ? `${snapshot.round.current} / ${snapshot.round.total}` : "—";
  renderRftRoundCounter();
  const totalLabel = countup ? (snapshot.totalRemainingMs === null ? "TIEMPO TRANSCURRIDO" : "HASTA TIME CAP") : "TIEMPO RESTANTE";
  $("totalLabel").textContent = totalLabel;
  const total = countup && snapshot.totalRemainingMs === null ? snapshot.totalElapsedMs : snapshot.totalRemainingMs;
  $("totalValue").textContent = total == null ? "—" : formatTime(total);
  const duration = phase?.durationMs;
  const progress = duration ? Math.min(100,Math.max(0,(snapshot.phaseElapsedMs/duration)*100)) : 0;
  $("progressFill").style.width = `${progress}%`;
  const pauseAction = snapshot.state==="running" ? "Pausar" : snapshot.state==="paused" ? "Reanudar" : snapshot.state==="idle" ? "Iniciar" : "Finalizado";
  $("pauseButton").textContent = snapshot.state==="running" ? "❚❚" : snapshot.state==="completed" || snapshot.state==="capped" ? "✓" : "▶︎";
  $("pauseButton").setAttribute("aria-label", pauseAction);
  $("pauseButton").title = pauseAction;
  const terminal = ["completed","capped"].includes(snapshot.state);
  $("pauseButton").classList.toggle("hidden", terminal);
  $("pauseButton").disabled = terminal;
  $("resetButton").disabled = snapshot.state === "idle";
  $("resetButton").setAttribute("aria-label", "Reiniciar cronómetro");
  $("resetButton").title = "Reiniciar cronómetro";
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
    playTone(880, .075);
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
  $("pauseButton").textContent = prestartState === "running" ? "❚❚" : "▶︎";
  $("pauseButton").setAttribute("aria-label", prestartState === "running" ? "Pausar cuenta atrás" : "Continuar cuenta atrás");
  $("pauseButton").title = prestartState === "running" ? "Pausar cuenta atrás" : "Continuar cuenta atrás";
  $("pauseButton").disabled = false;
  $("pauseButton").classList.remove("hidden");
  $("resetButton").disabled = false;
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
  button.textContent = active ? "×" : "⛶";
  button.setAttribute("aria-label", active ? "Salir de pantalla completa" : "Activar pantalla completa");
  button.title = active ? "Salir de pantalla completa" : "Activar pantalla completa";
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

function toggleWorkoutDetails() {
  const panel = $("timerPanel");
  const button = $("workoutDetailsButton");
  const open = panel.classList.toggle("description-open");
  button.setAttribute("aria-expanded", String(open));
  button.textContent = open ? "CERRAR DESCRIPCIÓN" : "VER DESCRIPCIÓN";
}

function formatLoadProgression(progression) {
  if (!progression || progression.every !== "round" || !progression.increment) return "";
  return "+" + progression.increment + " " + (progression.unit || "kg") + " por ronda";
}

function renderTimerDescription(workout, timerPlan = null) {
  const panel = $("timerDescription");
  panel.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "timer-description-heading";
  const title = document.createElement("h2");
  title.textContent = workout.title || workout.name || "WOD";
  heading.append(title);
  panel.append(heading);

  const workoutData = workout.workout || workout;
  const movements = Array.isArray(workoutData.movements) ? workoutData.movements : [];
  const structure = workoutData.structure;
  const team = normalizeTeamSettings(workoutData.team);
  if (team.athletes > 1) {
    const teamSummary = document.createElement("p");
    teamSummary.className = "timer-description-team";
    teamSummary.textContent = [team.athletes + (team.athletes === 2 ? " atletas" : " atletas"), teamModeLabels[team.mode],
      team.mode === "i_go_you_go" ? teamRotationLabels[team.rotation] : null].filter(Boolean).join(" · ");
    panel.append(teamSummary);
  }
  const movementById = new Map(movements.filter(m => m && m.id).map(m => [m.id, m]));
  const emomBlock = timerPlan?.blocks?.find(block => block?.type === "emom" && Array.isArray(block.intervalLabels) && block.intervalLabels.length);
  const timedStageBlock = timerPlan?.blocks?.find(block => block?.type === "countup" && Array.isArray(block.stages) && block.stages.length);
  const intervalPhaseGroups = timerPlan ? getStructureIntervalPhaseGroups(
    new TimerEngine(timerPlan, { now: () => 0 }).phases.map((phase, index) => ({ ...phase, index })),
    structure
  ) : null;
  const renderStructureNodes = (items, container, isEmomSequence = false, phaseGroups = null) => {
    const list = document.createElement("ul");
    list.className = "timer-description-list" + (isEmomSequence ? " timer-emom-schedule" : "");
    (items || []).forEach((entry, index) => {
      const item = document.createElement("li");
      if (isEmomSequence) item.dataset.intervalIndex = String(index);
      if (entry?.type === "movement") {
        const movement = movementById.get(entry.movementId);
        const movementName = movement?.name || "Movimiento no disponible";
        const prescription = entry.prescription || movement?.prescription;
        const visiblePrescription = prescription && !movementName.toLocaleLowerCase().includes(String(prescription).toLocaleLowerCase()) ? prescription : null;
        const visibleNotes = String(movement?.notes || "").split(" · ")
          .map(note => note.trim()).filter(note => note && !movementName.toLocaleLowerCase().includes(note.toLocaleLowerCase()));
        item.textContent = [visiblePrescription, movementName, entry.load || movement?.load, formatLoadProgression(entry.loadProgression), formatRepProgression(entry.repProgression), ...visibleNotes].filter(Boolean).join(" · ");
      } else if (entry?.type === "rounds") {
        const phases = phaseGroups?.[index] || [];
        const nested = document.createElement("section");
        nested.className = "timer-description-nested-group" + (phases.length ? " timer-description-stage" : "");
        if (phases.length) nested.dataset.timerIntervalIndex = String(index);
        const heading = document.createElement("h4"); heading.textContent = entry.label || ((Number(entry.count) || 1) + ((Number(entry.count) || 1) === 1 ? " RONDA" : " RONDAS"));
        nested.append(heading);
        if (phases.length) {
          const schedule = document.createElement("div"); schedule.className = "timer-description-phase-schedule";
          phases.forEach(phase => {
            const phaseLabel = document.createElement("div");
            phaseLabel.className = "timer-description-phase";
            phaseLabel.dataset.timerPhaseIndex = String(phase.index);
            phaseLabel.textContent = `${phase.type === "rest" ? "DESCANSO" : "TRABAJO"} · ${formatTime(phase.durationMs)}`;
            schedule.append(phaseLabel);
          });
          nested.append(schedule);
        }
        renderStructureNodes(entry.items, nested); item.append(nested);
      } else if (entry?.type === "choice") {
        const choice = document.createElement("section"); choice.className = "timer-description-choice";
        const heading = document.createElement("h4"); heading.textContent = "ELIGE UNA OPCIÓN"; choice.append(heading);
        (entry.alternatives || []).forEach(alternative => {
          const option = document.createElement("div"); option.className = "timer-description-choice-option";
          const optionItems = Array.isArray(alternative.items) ? alternative.items : [];
          const singleMovement = optionItems.length === 1 && optionItems[0]?.type === "movement"
            ? movementById.get(optionItems[0].movementId) : null;
          const labelText = String(alternative.label || "").trim().toLocaleLowerCase();
          const movementName = String(singleMovement?.name || "").trim().toLocaleLowerCase();
          if (!singleMovement || !labelText || labelText !== movementName) {
            const label = document.createElement("strong"); label.textContent = alternative.label || "Alternativa";
            option.append(label);
          }
          renderStructureNodes(optionItems, option); choice.append(option);
        });
        item.append(choice);
      }
      list.append(item);
    });
    container.append(list);
  };
  const addStructureGroup = (label, items, stageIndex = null, phases = [], timerPhaseIndex = null) => {
    const group = document.createElement("section");
    group.className = "timer-description-structure-group" + (stageIndex === null && timerPhaseIndex === null ? "" : " timer-description-stage");
    if (stageIndex !== null) group.dataset.timerStageIndex = String(stageIndex);
    if (timerPhaseIndex !== null) group.dataset.timerPhaseIndex = String(timerPhaseIndex);
    const heading = document.createElement("h3"); heading.textContent = label;
    const headingRow = document.createElement("div");
    headingRow.className = "timer-description-group-heading";
    headingRow.append(heading);
    if (label.endsWith(" RONDAS") || label.startsWith("PELDAÑO") || label.startsWith("INTERVALO")) {
      const counter = $("rftRoundCounter");
      if (!counter.classList.contains("hidden")) headingRow.append(counter);
    }
    group.append(headingRow);
    if (phases.length) {
      const schedule = document.createElement("div");
      schedule.className = "timer-description-phase-schedule";
      phases.forEach(phase => {
        const phaseLabel = document.createElement("div");
        phaseLabel.className = "timer-description-phase";
        phaseLabel.dataset.timerPhaseIndex = String(phase.index);
        phaseLabel.textContent = `${phase.type === "rest" ? "DESCANSO" : "TRABAJO"} · ${formatTime(phase.durationMs)}`;
        schedule.append(phaseLabel);
      });
      group.append(schedule);
    }
    const isEmomSequence = label === "SECUENCIA" && emomBlock;
    if (isEmomSequence) {
      const list = document.createElement("ul");
      list.className = "timer-description-list timer-emom-schedule";
      emomBlock.intervalLabels.forEach((intervalLabel, index) => {
        const item = document.createElement("li");
        item.dataset.intervalIndex = String(index);
        item.textContent = /^(rest|descanso)$/i.test(intervalLabel.trim()) ? "Rest" : intervalLabel;
        list.append(item);
      });
      group.append(list);
    } else {
      renderStructureNodes(items, group, false, intervalPhaseGroups);
    }
    panel.append(group);
  };

  if (structure && ["sequence", "rounds", "chipper"].includes(structure.type)) {
    const label = structure.type === "rounds"
      ? (Number(structure.count) || 1) + " RONDAS"
      : structure.type === "chipper" ? "CHIPPER" : "SECUENCIA";
    addStructureGroup(label, structure.items);
  } else if (structure?.type === "ladder" && Array.isArray(structure.steps)) {
    const direction = { ascending: "ASCENDENTE", descending: "DESCENDENTE", alternating: "ALTERNANDO", custom: "PERSONALIZADA" }[structure.direction] || "";
    const ladderGroup = document.createElement("section");
    ladderGroup.className = "timer-description-structure-group timer-description-ladder";
    const headingRow = document.createElement("div");
    headingRow.className = "timer-description-group-heading";
    const heading = document.createElement("h3");
    heading.textContent = ["LADDER", direction].filter(Boolean).join(" · ");
    headingRow.append(heading);
    const counter = $("rftRoundCounter");
    if (!counter.classList.contains("hidden")) headingRow.append(counter);
    ladderGroup.append(headingRow);
    panel.append(ladderGroup);
    structure.steps.forEach((step, index) => {
      const phases = intervalPhaseGroups?.[index] || [];
      addStructureGroup(step.label || "PELDAÑO " + (index + 1), step.items, null, phases);
      ladderGroup.append(panel.lastElementChild);
    });
  } else if (structure?.type === "sections" && Array.isArray(structure.sections)) {
    const heading = document.createElement("h3");
    heading.textContent = "ESTRUCTURA POR SECCIONES";
    panel.append(heading);
    const hasTimedStages = timedStageBlock && timedStageBlock.stages.length === structure.sections.length;
    const hasAlternatingTimerBlocks = timerPlan?.type === "sequence" &&
      timerPlan.blocks.length === structure.sections.length &&
      timerPlan.blocks.every(block => ["countdown", "countup", "emom", "intervals", "rest"].includes(block?.type));
    structure.sections.forEach((section, index) =>
      addStructureGroup(section.name || "SECCIÓN " + (index + 1), section.structure?.items,
        hasTimedStages ? index : null, [], hasAlternatingTimerBlocks ? index : null)
    );
  } else if (emomBlock) {
    addStructureGroup("SECUENCIA", []);
  } else if (movements.length) {
    const label = document.createElement("h3");
    label.textContent = "MOVIMIENTOS";
    panel.append(label);
    const list = document.createElement("ul");
    list.className = "timer-description-list";
    movements.forEach(movement => {
      const item = document.createElement("li");
      item.textContent = typeof movement === "string"
        ? movement
        : [movement.prescription, movement.name, movement.load].filter(Boolean).join(" · ");
      list.append(item);
    });
    panel.append(list);
  }

  const manualCounter = $("rftRoundCounter");
  if (!manualCounter.classList.contains("hidden") && !panel.contains(manualCounter)) {
    const fallbackGroup = panel.querySelector(".timer-description-structure-group");
    (fallbackGroup || panel).append(manualCounter);
  }

  const notesText = workout.notes || workout.workout?.notes;
  if (notesText) {
    const notes = document.createElement("p");
    notes.className = "timer-description-notes";
    notes.textContent = notesText;
    panel.append(notes);
  }

  const descriptionText = workout.description || workout.workout?.description;
  if (descriptionText) {
    const description = document.createElement("p");
    description.className = "timer-description-summary";
    description.textContent = descriptionText;
    panel.append(description);
  }
  panel.classList.remove("hidden");
}

function updateTimerDescriptionActive(snapshot) {
  const activeState = ["running", "paused"].includes(snapshot.state);
  document.querySelectorAll(".timer-emom-schedule").forEach(schedule => {
    const items = [...schedule.querySelectorAll("[data-interval-index]")];
    const current = activeState && snapshot.blockType === "emom" && snapshot.round && items.length
      ? (snapshot.round.current - 1) % items.length : -1;
    items.forEach((item, index) => {
      const active = index === current;
      item.classList.toggle("is-active", active);
      item.classList.toggle("is-paused", active && snapshot.state === "paused");
    });
  });
  const activeTimerPhase = activeState && Number.isInteger(snapshot.blockIndex)
    ? document.querySelector(`[data-timer-phase-index="${snapshot.blockIndex}"]`) : null;
  document.querySelectorAll("[data-timer-interval-index]").forEach(item => {
    const active = Boolean(activeTimerPhase && item.contains(activeTimerPhase));
    item.classList.toggle("is-active", active);
    item.classList.toggle("is-paused", active && snapshot.state === "paused");
  });
  document.querySelectorAll(".timer-description-phase").forEach(item => {
    const active = activeState && Number(item.dataset.timerPhaseIndex) === snapshot.blockIndex;
    item.classList.toggle("is-active", active);
    item.classList.toggle("is-paused", active && snapshot.state === "paused");
  });
  document.querySelectorAll("[data-timer-stage-index]").forEach(item => {
    const active = activeState && snapshot.blockType === "countup" &&
      Number(item.dataset.timerStageIndex) === snapshot.stageIndex;
    item.classList.toggle("is-active", active);
    item.classList.toggle("is-paused", active && snapshot.state === "paused");
  });
  document.querySelectorAll("[data-timer-phase-index]").forEach(item => {
    const active = activeState && Number(item.dataset.timerPhaseIndex) === snapshot.blockIndex;
    item.classList.toggle("is-active", active);
    item.classList.toggle("is-paused", active && snapshot.state === "paused");
  });
}

function showTimer(w = presets[selected], sourceView = "home") {
  returnView = sourceView;
  const plan = w.plan || w.timer;
  if (!plan) return;
  const format = String(w.workout?.format || w.format || "").toLowerCase();
  const isRft = format === "rounds_for_time";
  const isAmrap = format === "amrap";
  manualCounterMode = isRft ? "rft" : isAmrap ? "amrap" : null;
  rftRoundCount = 0;
  amrapExtraReps = 0;
  rftRoundTarget = isRft ? getRftRoundTarget(w.workout, plan) : null;
  $("rftRoundCounter").classList.toggle("hidden", !manualCounterMode);
  renderRftRoundCounter();
  engine=new TimerEngine(plan);
  $("setupPanel").classList.add("hidden");
  $("timerPanel").classList.remove("hidden");
  $("timerFormat").textContent=w.tag || String(w.workout?.format || "WOD").replaceAll("_"," ").toUpperCase();
  $("timerWorkoutName").textContent=w.name || w.title;
  renderTimerDescription(w, plan);
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
$("rftRoundMinus").addEventListener("click", () => {
  rftRoundCount = Math.max(0, rftRoundCount - 1);
  renderRftRoundCounter();
});
$("rftRoundPlus").addEventListener("click", () => {
  rftRoundCount = rftRoundTarget === null ? rftRoundCount + 1 : Math.min(rftRoundTarget, rftRoundCount + 1);
  renderRftRoundCounter();
});
$("amrapRepMinus").addEventListener("click", () => {
  amrapExtraReps = Math.max(0, amrapExtraReps - 1);
  renderRftRoundCounter();
});
$("amrapRepPlus").addEventListener("click", () => {
  amrapExtraReps++;
  renderRftRoundCounter();
});
$("resetButton").addEventListener("click", async () => {
  if (!engine) return;
  prestartState = null;
  rftRoundCount = 0;
  amrapExtraReps = 0;
  renderRftRoundCounter();
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
$("backButton").addEventListener("click",async()=>{
  stopDisplayLoop();
  await releaseWakeLock();
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch {}
  }
  engine=null;
  $("timerPanel").classList.remove("timer-immersive","description-open");
  $("workoutDetailsButton").setAttribute("aria-expanded","false");
  $("workoutDetailsButton").textContent="VER DESCRIPCIÓN";
  updateFullscreenButton();
  $("timerPanel").classList.add("hidden");
  $(returnView==="library"?"libraryPanel":"setupPanel").classList.remove("hidden");
});
$("soundButton").addEventListener("click", async () => {
  const enabled = $("soundButton").getAttribute("aria-pressed") !== "true";
  $("soundButton").setAttribute("aria-pressed", String(enabled));
  $("soundButton").textContent = enabled ? "◖))" : "◖×";
  $("soundButton").setAttribute("aria-label", enabled ? "Desactivar sonido" : "Activar sonido");
  $("soundButton").title = enabled ? "Desactivar sonido" : "Activar sonido";
  if (enabled) {
    try { await unlockAudio(); await playTone(880, .16); }
    catch (error) { $("statusMessage").textContent = "No se ha podido activar el audio en este navegador."; }
  }
});
$("fullscreenButton").addEventListener("click",toggleFullscreen);
$("workoutDetailsButton").addEventListener("click",toggleWorkoutDetails);
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
  if (preset.workout) {
    return {
      schemaVersion: 2,
      title: preset.name,
      sourceText: preset.description,
      workout: structuredClone(preset.workout),
      timer: structuredClone(preset.plan),
      interpretation: { status: "ready", issues: [] }
    };
  }
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
  const canOpenTimer = record.timer && record.interpretation.status === "ready";
  open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10-6.5z" /></svg><span class="button-label">' + (canOpenTimer ? "Abrir Timer" : "Pendiente Timer") + '</span>';
  open.disabled = !record.timer || record.interpretation.status !== "ready";
  open.addEventListener("click", () => {
    if (!record.timer) return;
    $("libraryPanel").classList.add("hidden");
    showTimer(record, "library");
  });
  const edit = document.createElement("button");
  edit.className = "secondary-button";
  edit.type = "button";
  edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 5 4 4M4 20l4.2-.9L19 8.3 15.7 5 4.9 15.8 4 20z" /></svg><span>Editar</span>';
  edit.addEventListener("click", () => openEditor(record.id));
  const duplicate = document.createElement("button");
  duplicate.className = "secondary-button";
  duplicate.type = "button";
  duplicate.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg><span>Duplicar</span>';
  duplicate.addEventListener("click", async () => {
    try { await repository.duplicate(record.id); await renderLibrary(); }
    catch (error) { showLibraryError(error); }
  });
  const remove = document.createElement("button");
  remove.className = "secondary-button danger-button";
  remove.type = "button";
  remove.setAttribute("aria-label", "Borrar WOD");
  remove.title = "Borrar WOD";
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18M8 6V4h8v2m3 0-.9 14H5.9L5 6m4 4v6m6-6v6" /></svg>';
  remove.addEventListener("click", async () => {
    const confirmed = window.confirm("¿Seguro que quieres eliminar el WOD «" + record.title + "»? Esta acción se puede deshacer desde la biblioteca.");
    if (!confirmed) return;
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
  resetAiReview();
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
    $("ai-import-section").hidden = true;
    $("ai-import-section").classList.add("hidden");
    $("ai-import-section").open = false;
    $("saveEditorButton").textContent = "GUARDAR CAMBIOS";
    $("editTitle").value = record.title;
    $("editFormat").value = record.workout.format;
    $("editDescription").value = record.workout.description || "";
    renderTeamSettings(record.workout.team);
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
    const teamAthletes = normalizeTeamSettings(record.workout.team).athletes;
    $("teamModeSettings").classList.toggle("hidden", teamAthletes === 1);
    $("teamEditorSection").open = teamAthletes > 1;
    $("editTitle").focus();
  } catch (error) { showLibraryError(error); }
}
async function openNewEditor(sourceView = "library") {
  resetAiReview();
  creatingWorkout = true;
  editingSchemaVersion = 2;
  editingLegacyFormat = null;
  editorReturnView = sourceView;
  editingWorkoutId = null;
  $("editTitle").value = "";
  $("editFormat").value = "custom";
  $("editDescription").value = "";
  renderTeamSettings({ athletes: 1, mode: "individual" });
  $("movementEditorList").replaceChildren(createMovementEditorRow());
  $("movementEditorList").firstElementChild.dataset.movementId = "movement-1";
  setStructureEditorVisible(true);
  configureStructureEditor("custom");
  renderTimerBlocks(null);
  $("editorHeading").innerHTML = 'Crear WOD<span>.</span>';
  $("editorIntro").textContent = "Pega la descripción del entrenamiento para importarlo, o completa los apartados manualmente.";
  $("ai-import-section").hidden = false;
  $("ai-import-section").classList.remove("hidden");
  $("ai-import-section").open = true;
  ["basic-editor-section","movement-editor-section","teamEditorSection","structureSection","timerSection"].forEach(id => { $(id).open = false; });
  $("saveEditorButton").textContent = "CREAR WOD";
  $("editorStatus").textContent = "Se guardará como borrador hasta que configures el temporizador.";
  $("libraryPanel").classList.add("hidden");
  $("setupPanel").classList.add("hidden");
  $("editorPanel").classList.remove("hidden");
  $("teamModeSettings").classList.add("hidden");
  $("aiImportImageButton").focus();
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
    const stagesWrap = document.createElement("div");
    stagesWrap.className = "wide-field";
    const stagesLabel = document.createElement("label");
    stagesLabel.className = "field-label";
    stagesLabel.textContent = "Etapas temporizadas · duración mm:ss | nombre (una por línea)";
    const stagesInput = document.createElement("textarea");
    stagesInput.className = "editor-input";
    stagesInput.name = "stages";
    stagesInput.rows = Math.min(6, Math.max(3, block.stages?.length || 3));
    stagesInput.value = (block.stages || []).map(stage => {
      const [minutes, seconds] = timeParts(stage.durationSeconds);
      return String(minutes) + ":" + String(seconds).padStart(2, "0") + " | " + stage.label;
    }).join("\n");
    stagesLabel.htmlFor = "timer-stages-" + Math.random().toString(36).slice(2, 8);
    stagesInput.id = stagesLabel.htmlFor;
    stagesWrap.append(stagesLabel, stagesInput);
    fields.append(stagesWrap);
    const hint = document.createElement("div");
    hint.className = "timer-plan-help wide-field";
    hint.textContent = "RFT y Ladder usan este cronómetro ascendente. Si defines etapas, sus duraciones deben sumar el Time Cap.";
    fields.append(hint);
  } else if (type === "emom") {
    addTime("duration", "Duración total", block.durationSeconds);
    addTime("interval", "Duración de cada intervalo", block.intervalSeconds);
    const wrap = document.createElement("div");
    wrap.className = "wide-field";
    const caption = document.createElement("label");
    caption.className = "field-label";
    caption.textContent = "Qué toca en cada minuto (uno por línea)";
    const input = document.createElement("textarea");
    input.className = "editor-input";
    input.name = "intervalLabels";
    input.rows = Math.min(8, Math.max(3, block.intervalLabels?.length || 3));
    input.value = (block.intervalLabels || []).join("\n");
    caption.htmlFor = "timer-emom-labels-" + Math.random().toString(36).slice(2, 8);
    input.id = caption.htmlFor;
    wrap.append(caption, input);
    fields.append(wrap);
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
        const stagesText = row.querySelector('[name="stages"]')?.value ?? "";
        const stages = stagesText.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
          const match = line.match(/^(\d+):([0-5]\d)\s*[|·]\s*(.+)$/);
          if (!match || !match[3].trim()) throw new Error("Cada etapa debe seguir el formato mm:ss | nombre.");
          return { durationSeconds: Number(match[1]) * 60 + Number(match[2]), label: match[3].trim() };
        });
        if (stages.length) {
          if (stages.some(stage => stage.durationSeconds <= 0)) throw new Error("La duración de cada etapa debe ser mayor que cero.");
          if (block.timeCapSeconds === null || stages.reduce((sum, stage) => sum + stage.durationSeconds, 0) !== block.timeCapSeconds) {
            throw new Error("La suma de las etapas debe coincidir con el Time Cap.");
          }
          block.stages = stages;
        }
      } else if (type === "emom") {
        block.durationSeconds = readTimerSeconds(row, "duration", { label: "La duración total" });
        block.intervalSeconds = readTimerSeconds(row, "interval", { label: "La duración del intervalo" });
        if (block.durationSeconds % block.intervalSeconds !== 0) throw new Error("En un EMOM, la duración total debe ser múltiplo exacto del intervalo.");
        block.rounds = block.durationSeconds / block.intervalSeconds;
        const labelsInput = row.querySelector('[name="intervalLabels"]')?.value ?? "";
        const intervalLabels = labelsInput.split(/\r?\n/).map(label => label.trim()).filter(Boolean);
        if (intervalLabels.length) block.intervalLabels = intervalLabels;
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
  rounds_for_time: ["rounds", "ladder"],
  chipper: ["chipper"],
  ladder: ["ladder"],
  strength_plus_wod: ["sections"],
  for_time: ["sequence", "rounds", "chipper", "sections"],
  amrap: ["sequence", "rounds", "sections"],
  emom: ["sequence", "sections"],
  e2mom: ["sequence", "sections"],
  tabata: ["sequence", "sections"],
  intervals: ["sequence", "rounds", "ladder", "sections"],
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
function structureField(labelText, control) {
  const wrapper = document.createElement("label");
  wrapper.className = "structure-field";
  const label = document.createElement("span");
  label.textContent = labelText;
  wrapper.append(label, control);
  return wrapper;
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
function createRepProgressionStepper(value) {
  const stepper = document.createElement("div");
  stepper.className = "rep-progression-stepper";
  const input = document.createElement("input");
  input.className = "editor-input";
  input.type = "number";
  input.name = "repProgression";
  input.min = "1";
  input.step = "1";
  input.inputMode = "numeric";
  input.placeholder = "Vacío = sin incremento";
  const initial = Number(value);
  input.value = Number.isSafeInteger(initial) && initial > 0 ? String(initial) : "";
  input.setAttribute("aria-label", "Incremento de repeticiones por ronda");
  input.addEventListener("change", () => {
    if (input.value !== "" && Number(input.value) === 0) input.value = "";
  });

  const button = (label, action, accessibleLabel) => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "rep-progression-stepper-button";
    control.textContent = label;
    control.setAttribute("aria-label", accessibleLabel);
    control.addEventListener("click", action);
    return control;
  };
  const decrement = button("−", () => {
    const current = Number(input.value);
    if (!Number.isSafeInteger(current) || current <= 1) input.value = "";
    else input.value = String(current - 1);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, "Reducir el incremento de repeticiones");
  const increment = button("+", () => {
    const current = Number(input.value);
    const next = input.value === "" ? 1 : current + 1;
    if (Number.isSafeInteger(next)) input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, "Aumentar el incremento de repeticiones");
  stepper.append(decrement, input, increment);
  return stepper;
}
function createStructureItemRow(item = {}) {
  const row = document.createElement("div"); row.className = "structure-item-row"; row.dataset.structureType = item.type || "movement";
  if (item.type === "rounds") {
    row.classList.add("structure-nested-group");
    row.dataset.structureLabel = typeof item.label === "string" ? item.label : "";
    const heading = document.createElement("div"); heading.className = "structure-nested-heading";
    const title = document.createElement("strong");
    title.textContent = row.dataset.structureLabel
      ? "Grupo de rondas · " + row.dataset.structureLabel
      : "Grupo de rondas";
    const count = document.createElement("input"); count.className = "editor-input structure-count"; count.type = "number"; count.name = "nestedRoundCount"; count.min = "1"; count.max = "1000"; count.value = item.count || 5;
    heading.append(title, structureField("Número de rondas", count));
    const children = document.createElement("div"); children.className = "structure-items";
    (item.items?.length ? item.items : [{}]).forEach(child => children.append(createStructureItemRow(child)));
    row.append(heading, children, createStructureNodeActions(children), structureRemoveButton("Eliminar grupo de rondas", () => row.remove())); return row;
  }
  if (item.type === "choice") {
    row.classList.add("structure-choice-group");
    const heading = document.createElement("strong"); heading.textContent = "Elección: realizar una sola alternativa";
    const alternatives = document.createElement("div"); alternatives.className = "structure-choice-alternatives";
    (item.alternatives?.length ? item.alternatives : [{label:"Row o Ski",items:[{}]},{label:"Bike",items:[{}]}]).forEach(option => alternatives.append(createChoiceAlternativeRow(option)));
    const add = document.createElement("button"); add.type = "button"; add.className = "structure-add-button"; add.textContent = "+ AÑADIR ALTERNATIVA";
    add.addEventListener("click", () => alternatives.append(createChoiceAlternativeRow({label:"Nueva alternativa",items:[{}]})));
    row.append(heading, alternatives, add, structureRemoveButton("Eliminar elección", () => row.remove())); return row;
  }
  const movement = movementSelect(item.movementId || currentMovementOptions()[0]?.id);
  const prescription = document.createElement("input"); prescription.className = "editor-input"; prescription.name = "prescription"; prescription.placeholder = "Ej. 12 repeticiones"; prescription.value = item.prescription || "";
  const load = document.createElement("input"); load.className = "editor-input"; load.name = "itemLoad"; load.placeholder = "Ej. 60/40 kg"; load.value = item.load || "";
  const progression = document.createElement("input"); progression.className = "editor-input"; progression.name = "loadProgression"; progression.placeholder = "Ej. 10/5"; progression.value = item.loadProgression?.increment || "";
  const repProgression = createRepProgressionStepper(item.repProgression?.increment);
  row.append(
    structureField("Movimiento", movement),
    structureField("Repeticiones / prescripción", prescription),
    structureField("Carga inicial (opcional)", load),
    structureField("Incremento de repeticiones por ronda (opcional)", repProgression),
    structureField("Incremento por ronda en kg (opcional)", progression),
    structureRemoveButton("Eliminar movimiento de la estructura", () => row.remove())
  ); return row;
}
function createStructureNodeActions(container) {
  const actions = document.createElement("div"); actions.className = "structure-node-actions";
  for (const [label,type] of [["+ MOVIMIENTO","movement"],["+ GRUPO DE RONDAS","rounds"],["+ ELECCIÓN","choice"]]) {
    const button = document.createElement("button"); button.type = "button"; button.className = "structure-add-button"; button.textContent = label;
    button.addEventListener("click", () => container.append(createStructureItemRow(type === "rounds" ? {type,count:5,items:[{}]} : type === "choice" ? {type,alternatives:[{label:"Row o Ski",items:[{}]},{label:"Bike",items:[{}]}]} : {})));
    actions.append(button);
  }
  return actions;
}
function createChoiceAlternativeRow(alternative = {}) {
  const row = document.createElement("div"); row.className = "structure-choice-alternative";
  const label = document.createElement("input"); label.className = "editor-input"; label.name = "alternativeLabel"; label.placeholder = "Ej. Remo o Ski"; label.value = alternative.label || "";
  const items = document.createElement("div"); items.className = "structure-items";
  (alternative.items?.length ? alternative.items : [{}]).forEach(item => items.append(createStructureItemRow(item)));
  row.append(structureField("Nombre de la alternativa", label), items, createStructureNodeActions(items), structureRemoveButton("Eliminar alternativa", () => row.remove())); return row;
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
  row.append(structureField("Nombre del peldaño", label), items, add, remove);
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
  row.append(structureField("Nombre de la sección", name), remove);
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
const teamModeLabels = {
  individual: "Individual",
  i_go_you_go: "I Go, You Go",
  synchro: "Synchro",
  shared: "Repartido libremente",
  team: "Team / Combinado"
};
const teamRotationLabels = {
  complete: "Al completar el bloque o ronda",
  reps: "Cada número de repeticiones establecido",
  free: "Libre elección del equipo"
};
function normalizeTeamSettings(team = null) {
  const athletes = [1, 2, 3, 4].includes(Number(team?.athletes)) ? Number(team.athletes) : 1;
  const mode = athletes === 1 ? "individual" :
    ["i_go_you_go", "synchro", "shared", "team"].includes(team?.mode) ? team.mode : "i_go_you_go";
  const rotation = ["complete", "reps", "free"].includes(team?.rotation) ? team.rotation : "complete";
  return { athletes, mode, ...(mode === "i_go_you_go" ? { rotation } : {}) };
}
function renderTeamSettings(team = null) {
  const value = normalizeTeamSettings(team);
  $("teamAthletes").value = String(value.athletes);
  $("teamMode").value = value.mode;
  $("teamRotation").value = value.rotation || "complete";
  $("teamModeSettings").classList.toggle("hidden", value.athletes === 1);
  $("teamRotationSettings").classList.toggle("hidden", value.mode !== "i_go_you_go");
}
function collectTeamSettings() {
  const athletes = Number($("teamAthletes").value);
  let mode = $("teamMode").value;
  if (![1, 2, 3, 4].includes(athletes)) throw new Error("Selecciona entre 1 y 4 participantes.");
  if (athletes === 1) mode = "individual";
  if (athletes > 1 && mode === "individual") mode = "i_go_you_go";
  if (!Object.hasOwn(teamModeLabels, mode)) throw new Error("Selecciona un modo de trabajo válido.");
  return {
    athletes,
    mode,
    ...(mode === "i_go_you_go" ? { rotation: $("teamRotation").value } : {})
  };
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
    settings.append(list, createStructureNodeActions(list));
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
    settings.append(structureField("Dirección de la ladder", direction), list, add);
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
  const validNodes = items => Array.isArray(items) && items.length > 0 && items.every(item => {
    if (item?.type === "movement") return true;
    if (item?.type === "rounds") return Number.isInteger(item.count) && item.count > 0 && validNodes(item.items);
    if (item?.type === "choice") return Array.isArray(item.alternatives) && item.alternatives.length >= 2 && item.alternatives.every(option => option.label?.trim() && validNodes(option.items));
    return false;
  });
  if (!structure) return false;
  if (["sequence","rounds","chipper"].includes(structure.type)) return validNodes(structure.items);
  if (structure.type === "ladder") return Array.isArray(structure.steps) && structure.steps.every(step => validNodes(step.items));
  if (structure.type === "sections") return Array.isArray(structure.sections) && structure.sections.every(section => section.structure?.type === "sequence" && validNodes(section.structure.items));
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
  const collectNodes = container => [...container.querySelectorAll(":scope > .structure-item-row")].map(row => {
    const nodeType = row.dataset.structureType || "movement";
    if (nodeType === "rounds") {
      const count = Number(row.querySelector('[name="nestedRoundCount"]').value);
      const items = collectNodes(row.querySelector(":scope > .structure-items"));
      if (!Number.isInteger(count) || count < 1 || !items.length) throw new Error("Completa el número de rondas y sus movimientos.");
      const label = row.dataset.structureLabel?.trim();
      return {type:"rounds",count,...(label?{label}:{}),items};
    }
    if (nodeType === "choice") {
      const alternatives = [...row.querySelectorAll(":scope > .structure-choice-alternatives > .structure-choice-alternative")].map(option => ({label:option.querySelector('[name="alternativeLabel"]').value.trim(),items:collectNodes(option.querySelector(".structure-items"))}));
      if (alternatives.length < 2 || alternatives.some(option => !option.label || !option.items.length)) throw new Error("Cada elección necesita al menos dos alternativas completas.");
      return {type:"choice",alternatives};
    }
    const load = row.querySelector('[name="itemLoad"]').value.trim();
    const increment = row.querySelector('[name="loadProgression"]').value.trim().replace(/,/g, ".");
    let repIncrement = row.querySelector('[name="repProgression"]').value.trim();
    if (repIncrement !== "" && Number(repIncrement) === 0) repIncrement = "";
    if (increment && !/^[0-9]+(?:[.][0-9]+)?(?:\/[0-9]+(?:[.][0-9]+)?)?$/.test(increment.replace(/\s/g, ""))) {
      throw new Error("El incremento por ronda debe ser un número o dos valores separados por /, por ejemplo 10/5.");
    }
    if (increment && !load) throw new Error("Indica también la carga inicial para aplicar un incremento por ronda.");
    if (repIncrement && !/^[1-9]\d*$/.test(repIncrement)) throw new Error("El incremento de repeticiones por ronda debe ser un entero positivo.");
    return {type:"movement",movementId:row.querySelector('[name="movementId"]').value,
      ...(row.querySelector('[name="prescription"]').value.trim()?{prescription:row.querySelector('[name="prescription"]').value.trim()}:{}),
      ...(load?{load}:{}),
      ...(increment?{loadProgression:{increment,unit:"kg",every:"round"}}:{}),
      ...(repIncrement?{repProgression:{increment:repIncrement,every:"round"}}:{})};
  });
  if (["sequence", "rounds", "chipper"].includes(type)) {
    const items = collectNodes($("structureSettings").querySelector(".structure-items"));
    if (!items.length) throw new Error("Añade al menos un movimiento a la estructura.");
    return type === "rounds"
      ? { type, count: Number($("structureSettings").querySelector('[name="roundCount"]').value), items }
      : { type, items };
  }
  if (type === "ladder") {
    const steps = [...$("structureSettings").querySelectorAll(".structure-step-row")].map(row => ({
      label: row.querySelector('[name="stepLabel"]').value.trim(),
      items: collectNodes(row.querySelector(".structure-items"))
    }));
    if (!steps.length || steps.some(step => !step.label)) throw new Error("Cada peldaño de la ladder necesita una etiqueta.");
    return { type, direction: $("structureSettings").querySelector('[name="ladderDirection"]').value, steps };
  }
  const sections = [...$("structureSettings").querySelectorAll(".structure-section-row")].map((row, index) => ({
    id: "section-" + (index + 1),
    name: row.querySelector('[name="sectionName"]').value.trim(),
    structure: { type: "sequence", items: collectNodes(row.querySelector(".structure-section-items")) }
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
$("teamAthletes").addEventListener("change", () => {
  const athletes = Number($("teamAthletes").value);
  if (athletes === 1) $("teamMode").value = "individual";
  else if ($("teamMode").value === "individual") $("teamMode").value = "i_go_you_go";
  renderTeamSettings({ athletes, mode: $("teamMode").value, rotation: $("teamRotation").value });
  $("teamEditorSection").open = athletes > 1;
  if (athletes > 1) $("teamModeSettings").scrollIntoView({ behavior: "smooth", block: "nearest" });
});
$("teamMode").addEventListener("change", () => {
  if ($("teamMode").value === "individual") $("teamAthletes").value = "1";
  else if (Number($("teamAthletes").value) === 1) $("teamAthletes").value = "2";
  renderTeamSettings({ athletes: Number($("teamAthletes").value), mode: $("teamMode").value, rotation: $("teamRotation").value });
});
$("editFormat").addEventListener("change", () => {
  if (editingSchemaVersion !== 2) return;
  $("structureSection").open = true;
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
  if (aiReviewRequired && !$("aiReviewConfirmed").checked) {
    $("editorStatus").textContent = "Revisa la interpretación y confirma que el orden, las repeticiones y el temporizador son correctos antes de guardar.";
    $("aiReviewConfirmed").focus();
    return;
  }
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
      team: collectTeamSettings(),
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
      await repository.create({ schemaVersion: editingSchemaVersion, title, sourceText: aiSourceText, workout, timer, interpretation });
    } else {
      await repository.update(editingWorkoutId, { title, sourceText: aiSourceText === null ? undefined : aiSourceText, workout, timer, interpretation });
    }
    creatingWorkout = false;
    editingWorkoutId = null;
    resetAiReview();
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


function clearSelectedImportImage() {
  if (selectedImportObjectUrl) URL.revokeObjectURL(selectedImportObjectUrl);
  selectedImportObjectUrl = null;
  selectedImportImage = null;
  $("aiImagePreview")?.classList.add("hidden");
  $("aiImagePrompt")?.classList.remove("hidden");
  if ($("aiImageFileInput")) $("aiImageFileInput").value = "";
}
function setImportMode(mode, preserveImage = false) {
  importMode = mode;
  if (mode !== "image" || !preserveImage) clearSelectedImportImage();
  $("aiTextImport").classList.toggle("hidden", mode !== "text");
  $("aiImageImport").classList.toggle("hidden", mode !== "image");
  $("aiImportImageButton").setAttribute("aria-pressed", String(mode === "image"));
  $("aiImportTextButton").setAttribute("aria-pressed", String(mode === "text"));
  $("interpretWithAiButton").classList.toggle("hidden", mode === "none" || (mode === "image" && !selectedImportImage));
  $("aiInterpretationStatus").textContent = "";
}
function readImageAsBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      const separator = value.indexOf(",");
      if (separator < 0) reject(new Error("No se ha podido leer la imagen."));
      else resolve({ mimeType: blob.type || "image/jpeg", data: value.slice(separator + 1) });
    };
    reader.onerror = () => reject(new Error("No se ha podido leer el archivo de imagen."));
    reader.readAsDataURL(blob);
  });
}
async function compressImportImage(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error("La imagen es demasiado grande. Selecciona una imagen de menos de 20 MB.");
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (allowedTypes.includes(file.type) && file.size <= 4 * 1024 * 1024) return file;
  let bitmap = null;
  try {
    if (typeof createImageBitmap === "function") bitmap = await createImageBitmap(file);
  } catch { /* Safari puede no decodificar todos los formatos mediante createImageBitmap. */ }
  let image = bitmap;
  let objectUrl = null;
  if (!image) {
    objectUrl = URL.createObjectURL(file);
    image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("El navegador no puede leer esta imagen. Prueba con JPG, PNG o WebP."));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  const scale = Math.min(1, 2400 / Math.max(image.width || image.naturalWidth, image.height || image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((image.width || image.naturalWidth) * scale));
  canvas.height = Math.max(1, Math.round((image.height || image.naturalHeight) * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No se ha podido preparar la imagen.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  bitmap?.close?.();
  const toBlob = quality => new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  let result = await toBlob(.9);
  if (!result || result.size > 4 * 1024 * 1024) {
    const reduced = document.createElement("canvas");
    const ratio = Math.min(.82, 1900 / Math.max(canvas.width, canvas.height));
    reduced.width = Math.max(1, Math.round(canvas.width * ratio));
    reduced.height = Math.max(1, Math.round(canvas.height * ratio));
    reduced.getContext("2d", { alpha: false }).drawImage(canvas, 0, 0, reduced.width, reduced.height);
    result = await new Promise(resolve => reduced.toBlob(resolve, "image/jpeg", .84));
  }
  if (!result || result.size > 4 * 1024 * 1024) throw new Error("No se ha podido reducir la imagen a un tamaño válido. Prueba con otra imagen.");
  return result;
}
async function prepareImportImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Selecciona un archivo de imagen.");
  const blob = await compressImportImage(file);
  return { blob, payload: await readImageAsBase64(blob) };
}
function showImportImage(blob, payload, name) {
  clearSelectedImportImage();
  selectedImportImage = payload;
  selectedImportObjectUrl = URL.createObjectURL(blob);
  $("aiImagePreviewElement").src = selectedImportObjectUrl;
  $("aiImageFileName").textContent = name || "Imagen del WOD";
  $("aiImagePrompt").classList.add("hidden");
  $("aiImagePreview").classList.remove("hidden");
  $("interpretWithAiButton").classList.remove("hidden");
  $("aiInterpretationStatus").textContent = "Imagen preparada. Pulsa INTERPRETAR para reconocer el WOD.";
}
async function handleImportImage(file, name = file?.name || "Imagen del WOD") {
  if (!file) return;
  const status = $("aiInterpretationStatus");
  const button = $("interpretWithAiButton");
  button.disabled = true;
  button.classList.add("hidden");
  status.textContent = "Preparando imagen…";
  try {
    const prepared = await prepareImportImage(file);
    setImportMode("image", true);
    showImportImage(prepared.blob, prepared.payload, name);
  } catch (error) {
    status.textContent = error.message || "No se ha podido preparar la imagen.";
  } finally {
    button.disabled = false;
  }
}
function resetAiReview() {
  aiSourceText = null;
  aiReviewRequired = false;
  importMode = null;
  clearSelectedImportImage();
  const confirmation = $("aiReviewConfirmation");
  if (confirmation) confirmation.classList.add("hidden");
  if ($("aiReviewConfirmed")) $("aiReviewConfirmed").checked = false;
  if ($("aiSourceText")) $("aiSourceText").value = "";
  if ($("aiTextImport")) $("aiTextImport").classList.add("hidden");
  if ($("aiImageImport")) $("aiImageImport").classList.add("hidden");
  if ($("aiImportImageButton")) $("aiImportImageButton").setAttribute("aria-pressed", "false");
  if ($("aiImportTextButton")) $("aiImportTextButton").setAttribute("aria-pressed", "false");
  if ($("aiInterpretationStatus")) $("aiInterpretationStatus").textContent = "";
  if ($("interpretWithAiButton")) {
    $("interpretWithAiButton").disabled = false;
    $("interpretWithAiButton").textContent = "INTERPRETAR";
    $("interpretWithAiButton").classList.add("hidden");
  }
}
$("aiImportImageButton").addEventListener("click", () => {
  setImportMode("image");
  $("aiImageFileInput").click();
});
$("aiImageChangeButton").addEventListener("click", () => $("aiImageFileInput").click());
$("aiImportTextButton").addEventListener("click", () => {
  setImportMode("text");
  $("aiSourceText").focus();
});
$("aiImageFileInput").addEventListener("change", event => handleImportImage(event.target.files?.[0]));

$("interpretWithAiButton").addEventListener("click", async () => {
  const sourceText = importMode === "text" ? $("aiSourceText").value.trim() : "";
  const image = importMode === "image" ? selectedImportImage : null;
  const status = $("aiInterpretationStatus");
  const button = $("interpretWithAiButton");
  if (importMode === "text" && sourceText.length < 8) {
    status.textContent = "Escribe o pega la descripción completa del WOD.";
    $("aiSourceText").focus();
    return;
  }
  if (importMode === "image" && !image) {
    status.textContent = "Selecciona una imagen del WOD.";
    return;
  }
  if (!sourceText && !image) return;
  button.disabled = true;
  button.textContent = "INTERPRETANDO…";
  status.textContent = image ? "Enviando imagen para reconocer el WOD…" : "Conectando con el servicio de IA…";
  try {
    const { interpretWod } = await import("./ai-client.js");
    const result = await interpretWod(image ? { image } : sourceText);
    editingSchemaVersion = 2;
    editingLegacyFormat = null;
    editingStructureSupported = true;
    $("editTitle").value = result.title;
    $("basic-editor-section").open = true;
    $("movement-editor-section").open = true;
    $("editFormat").value = result.workout.format;
    $("editDescription").value = result.workout.description;
    renderTeamSettings(result.workout.team);
    $("teamEditorSection").open = normalizeTeamSettings(result.workout.team).athletes > 1;
    $("structureSection").open = true;
    $("timerSection").open = true;
    const movementRows = result.workout.movements.map(movement => createMovementEditorRow(movement));
    $("movementEditorList").replaceChildren(...movementRows);
    result.workout.movements.forEach((movement, index) => {
      $("movementEditorList").children[index].dataset.movementId = movement.id;
    });
    setStructureEditorVisible(true);
    configureStructureEditor(result.workout.format, result.workout.structure);
    editingStructureSupported = isStructureEditorCompatible(result.workout.structure) &&
      $("structureType").value === result.workout.structure.type;
    renderTimerBlocks(result.timer);
    aiSourceText = sourceText || result.sourceText || null;
    aiReviewRequired = true;
    $("aiReviewConfirmation").classList.remove("hidden");
    $("aiReviewConfirmed").checked = false;
    const issues = result.interpretation.issues || [];
    status.textContent = issues.length
      ? "Interpretación recibida con observaciones:\n" + issues.map(item => "• " + item.message + (item.question ? " " + item.question : "")).join("\n") + "\nRevisa todos los campos antes de guardar."
      : "Interpretación recibida. Revisa el título, los movimientos, su orden y el temporizador antes de guardar.";
    if (result.timer === null) {
      status.textContent += "\nNo se ha inventado una duración: configura el temporizador manualmente.";
    }
    $("editorStatus").textContent = "";
    $("editTitle").focus();
  } catch (error) {
    status.textContent = error.message || "No se ha podido interpretar el WOD. Comprueba tu conexión e inténtalo de nuevo.";
  } finally {
    button.disabled = false;
    button.textContent = "INTERPRETAR";
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
    const registration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
    await registration.update();
  } catch (error) {
    console.warn("No se ha podido registrar el modo offline de Throwdown Timer.", error);
  }
}

registerServiceWorker();
