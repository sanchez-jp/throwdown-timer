import { TimerEngine } from "./timer-engine.js";

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
function showTimer() {
  const w=presets[selected];
  engine=new TimerEngine(w.plan);
  $("setupPanel").classList.add("hidden");
  $("timerPanel").classList.remove("hidden");
  $("timerFormat").textContent=w.tag;
  $("timerWorkoutName").textContent=w.name;
  $("timerMovements").replaceChildren(...w.movements.map(m=>{const s=document.createElement("span");s.textContent=m;return s;}));
  lastCountdownCue=null;
  renderTimer(engine.snapshot());
}
document.querySelectorAll("[data-preset]").forEach(b=>b.addEventListener("click",()=>{selected=b.dataset.preset;renderPreset();}));
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
$("backButton").addEventListener("click",async()=>{stopDisplayLoop();await releaseWakeLock();engine=null;$("timerPanel").classList.add("hidden");$("setupPanel").classList.remove("hidden");});
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
renderPreset();
updateFullscreenButton();


async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  } catch (error) {
    console.warn("No se ha podido registrar el modo offline de Throwdown Timer.", error);
  }
}

registerServiceWorker();
