import test from "node:test";
import assert from "node:assert/strict";
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

test("flattens nested sequences and repeats into ordered editable blocks", () => {
  const blocks = flattenTimerPlan({ type: "sequence", label: "Compound", blocks: [
    { type: "countdown", label: "A", durationSeconds: 60 },
    { type: "repeat", label: "Repeat", repeatCount: 2, blocks: [
      { type: "rest", label: "Rest", durationSeconds: 10 },
      { type: "countup", label: "For Time", timeCapSeconds: null, rounds: null }
    ]}
  ]});
  assert.deepEqual(blocks.map(block => block.type), ["countdown", "rest", "countup", "rest", "countup"]);
});

test("reports missing timer configuration with all schema issue fields", () => {
  const issue = timerPlanRequiredIssue();
  assert.deepEqual(Object.keys(issue), ["severity", "code", "message", "fieldPath", "question"]);
  assert.equal(issue.severity, "blocking");
});

test("requires a For Time block to be the final segment in the current editor", () => {
  assert.throws(() => buildTimerPlan("Compound", [
    { type: "countup", label: "For Time", timeCapSeconds: null, rounds: null },
    { type: "rest", label: "Rest", durationSeconds: 60 }
  ]), /For Time debe ser el último segmento/);
});
