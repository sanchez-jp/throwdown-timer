import test from "node:test";
import assert from "node:assert/strict";
import { TimerEngine, TimerError } from "../src/timer-engine.js";

function clock() {
  let value = 0;
  return { now: () => value, set: v => { value = v; }, advance: ms => { value += ms; } };
}
const plan = (...blocks) => ({ type: "sequence", label: "Test", blocks });

test("countdown completes at duration", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"countdown",label:"AMRAP",durationSeconds:60}), {now:c.now});
  timer.start(); c.advance(59999);
  assert.equal(timer.tick().state, "running");
  c.advance(1);
  assert.equal(timer.tick().state, "completed");
  assert.equal(timer.snapshot().completionReason, "plan_completed");
});

test("pause and resume preserve elapsed time", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"countdown",label:"Work",durationSeconds:10}), {now:c.now});
  timer.start(); c.advance(3000); timer.pause();
  assert.equal(timer.snapshot().phaseElapsedMs, 3000);
  c.advance(5000); timer.resume(); c.advance(6999);
  assert.equal(timer.tick().state, "running");
  c.advance(1);
  assert.equal(timer.tick().state, "completed");
});

test("count-up can finish manually", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"countup",label:"For Time",timeCapSeconds:null,rounds:5}), {now:c.now});
  assert.equal(timer.snapshot().round, null, "target rounds are not live round progress");
  timer.start(); c.advance(12345);
  assert.equal(timer.snapshot().round, null);
  const result = timer.finish();
  assert.equal(result.state, "completed");
  assert.equal(result.completionReason, "user_finished");
  assert.equal(result.totalElapsedMs, 12345);
});

test("count-up reaches cap and is distinguished from finish", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"countup",label:"For Time",timeCapSeconds:10,rounds:null}), {now:c.now});
  timer.start(); c.advance(11000);
  assert.equal(timer.tick().state, "capped");
  assert.equal(timer.snapshot().completionReason, "time_cap_reached");
});

test("EMOM advances intervals and catches up after delayed tick", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"emom",label:"EMOM",durationSeconds:180,intervalSeconds:60,rounds:3}), {now:c.now});
  timer.start(); c.advance(125000);
  const s = timer.tick();
  assert.equal(s.state, "running");
  assert.equal(s.round.current, 3);
  assert.equal(s.phaseRemainingMs, 55000);
});

test("EMOM repeats its minute labels and marks programmed rest", () => {
  const timer = new TimerEngine(plan({
    type:"emom", label:"EMOM", durationSeconds:240, intervalSeconds:60, rounds:4,
    intervalLabels:["Ski","Handstand Walk","Burpee Box Jump Over","DESCANSO"]
  }), {now:()=>0});
  assert.deepEqual(timer.phases.map(phase => [phase.label, phase.phase, phase.round]), [
    ["Ski","work",1],
    ["Handstand Walk","work",2],
    ["Burpee Box Jump Over","work",3],
    ["DESCANSO","rest",4]
  ]);
});

test("intervals do not add a final rest", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"intervals",label:"Tabata",rounds:2,workSeconds:20,restSeconds:10,startWithRest:false}), {now:c.now});
  assert.equal(timer.phases.length, 3);
  timer.start(); c.advance(50000);
  assert.equal(timer.tick().state, "completed");
  assert.equal(timer.snapshot().totalElapsedMs, 50000);
});

test("nested repeat and sequence execute in order", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"repeat",label:"2 rounds",repeatCount:2,blocks:[
    {type:"countdown",label:"A",durationSeconds:1},
    {type:"rest",label:"Rest",durationSeconds:1}
  ]}), {now:c.now});
  assert.equal(timer.phases.length, 4);
  timer.start(); c.advance(4000);
  assert.equal(timer.tick().state, "completed");
});

test("skip is rejected unless explicitly allowed", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"countdown",label:"No skip",durationSeconds:10}), {now:c.now});
  timer.start();
  assert.equal(timer.skip().blockLabel, "No skip");
  assert.equal(timer.snapshot().state, "running");
});

test("skip advances an allowed block", () => {
  const c = clock();
  const timer = new TimerEngine(plan(
    {type:"countdown",label:"Warm-up",durationSeconds:60,allowSkip:true},
    {type:"countdown",label:"WOD",durationSeconds:120}
  ), {now:c.now});
  timer.start();
  assert.equal(timer.skip().blockLabel, "WOD");
});

test("invalid EMOM arithmetic is rejected", () => {
  assert.throws(() => new TimerEngine(plan({type:"emom",label:"Bad",durationSeconds:100,intervalSeconds:60,rounds:2}), {now:()=>0}), TimerError);
});

test("zero-rest intervals create only work phases", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"intervals",label:"Work",rounds:3,workSeconds:5,restSeconds:0,startWithRest:false}), {now:c.now});
  assert.equal(timer.phases.length, 3);
  timer.start(); c.advance(15000);
  assert.equal(timer.tick().state, "completed");
});

test("reset returns to idle and clears elapsed time", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"countdown",label:"Test",durationSeconds:20}), {now:c.now});
  timer.start(); c.advance(5000); timer.reset();
  assert.equal(timer.snapshot().state, "idle");
  assert.equal(timer.snapshot().phaseElapsedMs, 0);
});


test("skip at an expired phase boundary does not skip the next block", () => {
  const c = clock();
  const timer = new TimerEngine(plan(
    {type:"countdown",label:"Skippable",durationSeconds:1,allowSkip:true},
    {type:"countdown",label:"Next",durationSeconds:20,allowSkip:true}
  ), {now:c.now});
  timer.start(); c.advance(1000);
  assert.equal(timer.skip().blockLabel, "Next");
  assert.equal(timer.snapshot().phaseElapsedMs, 0);
});

test("finish at or after a count-up cap records cap, not manual finish", () => {
  const c = clock();
  const timer = new TimerEngine(plan({type:"countup",label:"For Time",timeCapSeconds:5,rounds:null}), {now:c.now});
  timer.start(); c.advance(5000);
  assert.equal(timer.finish().state, "capped");
  assert.equal(timer.snapshot().completionReason, "time_cap_reached");
});

import { getCountdownCueSecond } from "../src/audio-cues.js";

test("Tabata work phase only cues in the final three seconds", () => {
  const snapshot = { state:"running", blockType:"intervals", phase:"work", phaseRemainingMs:10000 };
  assert.equal(getCountdownCueSecond(snapshot), null);
  snapshot.phaseRemainingMs = 3000;
  assert.equal(getCountdownCueSecond(snapshot), 3);
  snapshot.phaseRemainingMs = 2000;
  assert.equal(getCountdownCueSecond(snapshot), 2);
  snapshot.phaseRemainingMs = 1000;
  assert.equal(getCountdownCueSecond(snapshot), 1);
});

test("Tabata rest phase uses the same final-three-second cues", () => {
  const snapshot = { state:"running", blockType:"rest", phase:"rest", phaseRemainingMs:10000 };
  assert.equal(getCountdownCueSecond(snapshot), null);
  snapshot.phaseRemainingMs = 3000;
  assert.equal(getCountdownCueSecond(snapshot), 3);
  snapshot.phaseRemainingMs = 2000;
  assert.equal(getCountdownCueSecond(snapshot), 2);
  snapshot.phaseRemainingMs = 1000;
  assert.equal(getCountdownCueSecond(snapshot), 1);
});

test("all timed phases cue only in the final three seconds", () => {
  const snapshot = { state:"running", blockType:"countdown", phase:null, phaseRemainingMs:10000 };
  assert.equal(getCountdownCueSecond(snapshot), null);
  snapshot.phaseRemainingMs = 4000;
  assert.equal(getCountdownCueSecond(snapshot), null);
  snapshot.phaseRemainingMs = 3000;
  assert.equal(getCountdownCueSecond(snapshot), 3);
  snapshot.phaseRemainingMs = 2000;
  assert.equal(getCountdownCueSecond(snapshot), 2);
  snapshot.phaseRemainingMs = 1000;
  assert.equal(getCountdownCueSecond(snapshot), 1);
});

test("count-up exposes timed stages and changes stage at the exact boundary", () => {
  const c = clock();
  const timer = new TimerEngine(plan({
    type:"countup",label:"Running clock",timeCapSeconds:660,rounds:null,
    stages:[
      {label:"Bike Erg",durationSeconds:300},
      {label:"Clean & Jerk + Snatch",durationSeconds:360}
    ]
  }), {now:c.now});
  timer.start();
  assert.equal(timer.snapshot().stageIndex, 0);
  assert.equal(timer.snapshot().stageLabel, "Bike Erg");
  c.advance(299999);
  assert.equal(timer.tick().stageIndex, 0);
  c.advance(1);
  const next = timer.tick();
  assert.equal(next.stageIndex, 1);
  assert.equal(next.stageLabel, "Clean & Jerk + Snatch");
  assert.equal(next.stageElapsedMs, 0);
  c.advance(1000);
  timer.pause();
  assert.equal(timer.snapshot().stageIndex, 1);
  assert.equal(timer.snapshot().stageElapsedMs, 1000);
});

test("count-up stages are inactive before start and after time cap", () => {
  const c = clock();
  const timer = new TimerEngine(plan({
    type:"countup",label:"Running clock",timeCapSeconds:10,rounds:null,
    stages:[{label:"A",durationSeconds:5},{label:"B",durationSeconds:5}]
  }), {now:c.now});
  assert.equal(timer.snapshot().stageIndex, null);
  timer.start();
  c.advance(10000);
  assert.equal(timer.tick().state, "capped");
  assert.equal(timer.snapshot().stageIndex, null);
});
