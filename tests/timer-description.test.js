import test from "node:test";
import assert from "node:assert/strict";
import { TimerEngine } from "../src/timer-engine.js";
import { getIntervalPhaseGroups } from "../src/timer-description.js";

test("maps repeated countdown work and rest phases to ladder intervals", () => {
  const engine = new TimerEngine({ type: "sequence", blocks: [
    { type: "repeat", repeatCount: 5, blocks: [
      { type: "countdown", label: "Work", durationSeconds: 120 },
      { type: "rest", label: "Rest", durationSeconds: 60 }
    ]}
  ]}, { now: () => 0 });
  const phases = engine.phases.map((phase, index) => ({ ...phase, index }));
  const groups = getIntervalPhaseGroups(phases, 5);
  assert.deepEqual(groups.map(group => group.map(phase => phase.type)), [
    ["countdown", "rest"],
    ["countdown", "rest"],
    ["countdown", "rest"],
    ["countdown", "rest"],
    ["countdown", "rest"]
  ]);
  assert.deepEqual(groups.map(group => group.map(phase => phase.index)), [
    [0, 1], [2, 3], [4, 5], [6, 7], [8, 9]
  ]);
});

test("maps intervals blocks with rests between work periods", () => {
  const engine = new TimerEngine({ type: "sequence", blocks: [
    { type: "intervals", rounds: 5, workSeconds: 120, restSeconds: 60 }
  ]}, { now: () => 0 });
  const phases = engine.phases.map((phase, index) => ({ ...phase, index }));
  const groups = getIntervalPhaseGroups(phases, 5);
  assert.deepEqual(groups.map(group => group.map(phase => phase.type)), [
    ["intervals", "rest"],
    ["intervals", "rest"],
    ["intervals", "rest"],
    ["intervals", "rest"],
    ["intervals"]
  ]);
});

test("does not attach an unrelated timer schedule to ladder intervals", () => {
  const phases = [
    { type: "countdown", index: 0 },
    { type: "countdown", index: 1 },
    { type: "rest", index: 2 }
  ];
  assert.equal(getIntervalPhaseGroups(phases, 5), null);
});
