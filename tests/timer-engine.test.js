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
  timer.start(); c.advance(12345);
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
