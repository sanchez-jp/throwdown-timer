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
let lastBeepSecond = null;
let audioContext = null;

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
function renderTimer(snapshot) {
  const phase = engine.phases[snapshot.blockIndex ?? 0];
  const countup = snapshot.blockType === "countup";
  const time = countup ? snapshot.phaseElapsedMs : snapshot.phaseRemainingMs;
  $("clock").textContent = time == null ? "00:00" : formatTime(time, countup && time < 60000);
  $("clock").classList.toggle("countup",countup);
  $("clock").classList.toggle("urgent",!countup && time !== null && time <= 10000 && snapshot.state==="running");
  $("timerLabel").textContent = countup ? "TIME ELAPSED" : snapshot.phase === "rest" ? "REST" : "TIME REMAINING";
  $("phaseLabel").textContent = snapshot.state==="completed" ? "COMPLETADO" : snapshot.state==="capped" ? "TIME CAP" : snapshot.state==="paused" ? "PAUSADO" : snapshot.state==="idle" ? "PREPARADO" : (phase?.label || "EN CURSO").toUpperCase();
  $("roundValue").textContent = snapshot.round ? `${snapshot.round.current} / ${snapshot.round.total}` : "—";
  $("totalValue").textContent = snapshot.totalRemainingMs == null ? formatTime(snapshot.totalElapsedMs) : formatTime(snapshot.totalRemainingMs);
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
function stopDisplayLoop() { if(displayFrame!==null) cancelAnimationFrame(displayFrame); displayFrame=null; }
function displayLoop() {
  if(!engine) return;
  const snapshot=engine.tick();
  renderTimer(snapshot);
  if(snapshot.state==="running") displayFrame=requestAnimationFrame(displayLoop);
  else stopDisplayLoop();
}
function startDisplayLoop() { stopDisplayLoop(); displayFrame=requestAnimationFrame(displayLoop); }
function showTimer() {
  const w=presets[selected];
  engine=new TimerEngine(w.plan);
  $("setupPanel").classList.add("hidden");
  $("timerPanel").classList.remove("hidden");
  $("timerFormat").textContent=w.tag;
  $("timerWorkoutName").textContent=w.name;
  $("timerMovements").replaceChildren(...w.movements.map(m=>{const s=document.createElement("span");s.textContent=m;return s;}));
  lastBeepSecond=null;
  renderTimer(engine.snapshot());
}
function beep() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if(audioContext.state==="suspended") audioContext.resume();
    const osc=audioContext.createOscillator(), gain=audioContext.createGain();
    osc.frequency.value=880; gain.gain.value=.055;
    osc.connect(gain);gain.connect(audioContext.destination);
    osc.start();osc.stop(audioContext.currentTime+.11);
  } catch {}
}
document.querySelectorAll("[data-preset]").forEach(b=>b.addEventListener("click",()=>{selected=b.dataset.preset;renderPreset();}));
$("startButton").addEventListener("click",()=>{showTimer();engine.start();renderTimer(engine.snapshot());startDisplayLoop();});
$("pauseButton").addEventListener("click",()=>{
  if(!engine)return;
  const state=engine.snapshot().state;
  const result=state==="running"?engine.pause():state==="paused"?engine.resume():state==="idle"?engine.start():engine.snapshot();
  renderTimer(result);
  if(result.state==="running")startDisplayLoop();else stopDisplayLoop();
});
$("resetButton").addEventListener("click",()=>{if(!engine)return;renderTimer(engine.reset());stopDisplayLoop();});
$("skipButton").addEventListener("click",()=>{if(!engine)return;renderTimer(engine.skip());if(engine.snapshot().state==="running")startDisplayLoop();});
$("finishButton").addEventListener("click",()=>{if(!engine)return;renderTimer(engine.finish());stopDisplayLoop();});
$("backButton").addEventListener("click",()=>{stopDisplayLoop();engine=null;$("timerPanel").classList.add("hidden");$("setupPanel").classList.remove("hidden");});
document.addEventListener("visibilitychange",()=>{
  if(!engine)return;
  if(document.visibilityState==="visible"){
    const snap=engine.tick();renderTimer(snap);
    if(snap.state==="running")startDisplayLoop();else stopDisplayLoop();
  } else stopDisplayLoop();
});
function onFrame() {
  if(!engine || document.visibilityState!=="visible")return;
  const s=engine.tick();renderTimer(s);
  if(s.state==="running")displayFrame=requestAnimationFrame(onFrame);
}
renderPreset();
