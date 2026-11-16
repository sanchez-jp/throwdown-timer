import test from "node:test";
import assert from "node:assert/strict";
import { TimerEngine } from "../src/timer-engine.js";
import { buildTimerPlan, flattenTimerPlan, timerPlanRequiredIssue } from "../src/timer-plan-builder.js";

test("builds and validates an ordered multi-block plan", () => {
  const plan = buildTimerPlan("Strength + WOD", [
    { type: "countdown", label: "Strength", durationSeconds: 600 },
    { type: "rest", label: "Rest", durationSeconds: 120 },
    { type: "countdown", label: "AMRAP", durationSeconds: 720 }
  ]);
  assert.equal(plan.label, "Strength + WOD");
  assert.deepEqual(plan.blocks.map(block => block.type), ["countdown", "rest", "countdown"]);
});

test("returns null when no timer blocks have been configured", () => {
  assert.equal(buildTimerPlan("Draft", []), null);
});

test("rejects invalid EMOM arithmetic", () => {
  assert.throws(() => buildTimerPlan("Bad", [
    { type: "emom", label: "EMOM", durationSeconds: 600, intervalSeconds: 90, rounds: 6 }
  ]), /EMOM duration/);
});

test("preserves nested repeat groups when loading an existing plan", () => {
  const original = { type: "sequence", label: "Compound", blocks: [
    { type: "countdown", label: "Warm-up", durationSeconds: 60 },
    { type: "repeat", label: "3 rounds", repeatCount: 3, blocks: [
      { type: "countdown", label: "Work", durationSeconds: 30 },
      { type: "rest", label: "Rest", durationSeconds: 10 }
    ]}
  ]};
  const editable = flattenTimerPlan(original);
  assert.deepEqual(editable, original.blocks);
  assert.notEqual(editable[1], original.blocks[1]);
  editable[1].repeatCount = 2;
  assert.equal(original.blocks[1].repeatCount, 3);
});

test("repeat groups expand into the expected execution order", () => {
  const plan = buildTimerPlan("3 rounds", [
    { type: "repeat", label: "3 rounds", repeatCount: 3, blocks: [
      { type: "countdown", label: "Work", durationSeconds: 30 },
      { type: "rest", label: "Rest", durationSeconds: 10 }
    ]}
  ]);
  const engine = new TimerEngine(plan, { now: () => 0 });
  assert.deepEqual(engine.phases.map(phase => phase.label), [
    "Work", "Rest", "Work", "Rest", "Work", "Rest"
  ]);
  assert.equal(engine.phases.length, 6);
});

test("supports RFT as a count-up timer with an optional target round count", () => {
  const plan = buildTimerPlan("5 RFT", [
    { type: "countup", label: "5 RFT", timeCapSeconds: 900, rounds: 5 }
  ]);
  const engine = new TimerEngine(plan, { now: () => 0 });
  assert.equal(engine.phases[0].type, "countup");
  assert.equal(engine.phases[0].rounds, 5);
});

test("supports a ladder workout as a count-up timer without inventing rep progress", () => {
  const plan = buildTimerPlan("Ladder 1-10", [
    { type: "countup", label: "Ladder 1-10", timeCapSeconds: 600, rounds: null }
  ]);
  const engine = new TimerEngine(plan, { now: () => 0 });
  assert.equal(engine.phases[0].type, "countup");
  assert.equal(engine.snapshot().round, null);
});

test("reports missing timer configuration with all schema issue fields", () => {
  const issue = timerPlanRequiredIssue();
  assert.deepEqual(Object.keys(issue), ["severity", "code", "message", "fieldPath", "question"]);
  assert.equal(issue.severity, "blocking");
});

test("requires a For Time block to be the final expanded segment", () => {
  assert.throws(() => buildTimerPlan("Compound", [
    { type: "countup", label: "For Time", timeCapSeconds: null, rounds: null },
    { type: "rest", label: "Rest", durationSeconds: 60 }
  ]), /For Time debe ser el último segmento/);
});

test("rejects For Time inside a group repeated more than once", () => {
  assert.throws(() => buildTimerPlan("Invalid repeat", [
    { type: "repeat", label: "2 rounds", repeatCount: 2, blocks: [
      { type: "countdown", label: "Work", durationSeconds: 30 },
      { type: "countup", label: "For Time", timeCapSeconds: null, rounds: null }
    ]}
  ]), /For Time no puede estar dentro de un grupo/);
});
