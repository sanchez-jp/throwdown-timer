import test from "node:test";
import assert from "node:assert/strict";
import { TimerEngine } from "../src/timer-engine.js";
import { buildTimerPlan } from "../src/timer-plan-builder.js";

function clock() {
  let value = 0;
  return {
    now: () => value,
    advance: milliseconds => { value += milliseconds; }
  };
}

test("AMRAP 12:00 compiles as one countdown with the full duration", () => {
  const plan = buildTimerPlan("AMRAP 12", [
    { type: "countdown", label: "AMRAP", durationSeconds: 12 * 60 }
  ]);
  const timer = new TimerEngine(plan, { now: () => 0 });

  assert.equal(timer.phases.length, 1);
  assert.equal(timer.phases[0].type, "countdown");
  assert.equal(timer.phases[0].durationMs, 12 * 60 * 1000);
  assert.equal(timer.snapshot().totalRemainingMs, 12 * 60 * 1000);
});

test("EMOM 10:00 with 60-second intervals creates ten correctly numbered rounds", () => {
  const c = clock();
  const plan = buildTimerPlan("EMOM 10", [
    { type: "emom", label: "EMOM", durationSeconds: 10 * 60, intervalSeconds: 60, rounds: 10 }
  ]);
  const timer = new TimerEngine(plan, { now: c.now });

  assert.equal(timer.phases.length, 10);
  assert.equal(timer.snapshot().round.current, 1);
  assert.equal(timer.snapshot().round.total, 10);

  timer.start();
  c.advance(60 * 1000);
  const nextRound = timer.tick();
  assert.equal(nextRound.round.current, 2);
  assert.equal(nextRound.round.total, 10);
  assert.equal(nextRound.phaseRemainingMs, 60 * 1000);
});

test("Tabata 8 x 20/10 creates eight work phases and seven rests, with no final rest", () => {
  const c = clock();
  const plan = buildTimerPlan("Tabata 8", [
    { type: "intervals", label: "Tabata", rounds: 8, workSeconds: 20, restSeconds: 10, startWithRest: false }
  ]);
  const timer = new TimerEngine(plan, { now: c.now });

  assert.equal(timer.phases.length, 15);
  assert.equal(timer.phases.filter(phase => phase.phase === "work").length, 8);
  assert.equal(timer.phases.filter(phase => phase.phase === "rest").length, 7);
  assert.equal(timer.phases.at(-1).phase, "work");

  timer.start();
  c.advance(20 * 1000);
  assert.equal(timer.tick().phase, "rest");
  c.advance(10 * 1000);
  assert.equal(timer.tick().phase, "work");
  c.advance(230 * 1000 - 30 * 1000);
  assert.equal(timer.tick().state, "completed");
  assert.equal(timer.snapshot().totalElapsedMs, 230 * 1000);
});

test("strength + rest + For Time runs in order and permits manual completion", () => {
  const c = clock();
  const plan = buildTimerPlan("Strength + WOD", [
    { type: "countdown", label: "Strength", durationSeconds: 10 * 60 },
    { type: "rest", label: "Rest", durationSeconds: 2 * 60 },
    { type: "countup", label: "For Time", timeCapSeconds: 15 * 60, rounds: null }
  ]);
  const timer = new TimerEngine(plan, { now: c.now });

  assert.deepEqual(timer.phases.map(phase => phase.type), ["countdown", "rest", "countup"]);

  timer.start();
  c.advance(10 * 60 * 1000);
  assert.equal(timer.tick().blockLabel, "Rest");
  c.advance(2 * 60 * 1000);
  const forTime = timer.tick();
  assert.equal(forTime.blockType, "countup");
  assert.equal(forTime.can.finish, true);

  c.advance(123456);
  const result = timer.finish();
  assert.equal(result.state, "completed");
  assert.equal(result.completionReason, "user_finished");
  assert.equal(result.totalElapsedMs, 10 * 60 * 1000 + 2 * 60 * 1000 + 123456);
});
