import test from "node:test";
import assert from "node:assert/strict";
import { TimerEngine } from "../src/timer-engine.js";
import { getDescriptionScrollDelta, getIntervalPhaseGroups, getSequencePhaseGroups, getStructureIntervalPhaseGroups } from "../src/timer-description.js";

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


test("maps interval timer phases to nested interval rounds in a sequence", () => {
  const engine = new TimerEngine({ type: "sequence", blocks: [
    { type: "intervals", rounds: 5, workSeconds: 120, restSeconds: 60 }
  ]}, { now: () => 0 });
  const phases = engine.phases.map((phase, index) => ({ ...phase, index }));
  const structure = { type: "sequence", items: Array.from({ length: 5 }, (_, index) => ({
    type: "rounds", count: 1, label: `${index + 1}° INTERVAL`, items: []
  })) };
  const groups = getStructureIntervalPhaseGroups(phases, structure);
  assert.deepEqual(groups.map(group => group.map(phase => phase.type)), [
    ["intervals", "rest"], ["intervals", "rest"], ["intervals", "rest"], ["intervals", "rest"], ["intervals"]
  ]);
  assert.deepEqual(groups.map(group => group.map(phase => phase.durationMs)), [
    [120000, 60000], [120000, 60000], [120000, 60000], [120000, 60000], [120000]
  ]);
});


test("maps mixed sequence work and rest nodes to their own active timer phases", () => {
  const engine = new TimerEngine({ type: "sequence", blocks: [
    { type: "countdown", label: "AMRAP 1", durationSeconds: 360 },
    { type: "rest", label: "REST 3 MINUTES", durationSeconds: 180 },
    { type: "countdown", label: "AMRAP 2", durationSeconds: 360 },
    { type: "rest", label: "REST 3 MINUTES", durationSeconds: 180 },
    { type: "countdown", label: "AMRAP 3", durationSeconds: 360 }
  ]}, { now: () => 0 });
  const phases = engine.phases.map((phase, index) => ({ ...phase, index }));
  const structure = { type: "sequence", items: [
    { type: "rounds", label: "AMRAP 6 MINUTES", items: [] },
    { type: "rest", label: "REST 3 MINUTES", durationSeconds: 180 },
    { type: "rounds", label: "AMRAP 6 MINUTES", items: [] },
    { type: "rest", label: "REST 3 MINUTES", durationSeconds: 180 },
    { type: "rounds", label: "AMRAP 6 MINUTES", items: [] }
  ]};
  const groups = getSequencePhaseGroups(phases, structure);
  assert.deepEqual(groups.map(group => group.map(phase => phase.index)), [[0], [1], [2], [3], [4]]);
  assert.deepEqual(groups.map(group => group[0].type), ["countdown", "rest", "countdown", "rest", "countdown"]);
});

test("does not map sequence nodes when timer phases do not identify matching top-level blocks", () => {
  const structure = { type: "sequence", items: [{ type: "rest" }, { type: "rounds" }] };
  assert.equal(getSequencePhaseGroups([{ type: "rest", index: 0 }], structure), null);
});


test("maps every phase in a sequence rest node so the whole rest block can highlight", () => {
  const phases = [
    { type: "countdown", index: 0, sourcePath: "blocks[0]" },
    { type: "rest", index: 1, sourcePath: "blocks[1]" },
    { type: "rest", index: 2, sourcePath: "blocks[1].blocks[0]" },
    { type: "countdown", index: 3, sourcePath: "blocks[2]" }
  ];
  const structure = { type: "sequence", items: [
    { type: "rounds", label: "AMRAP 1", items: [] },
    { type: "rest", label: "REST 3 MINUTES", durationSeconds: 180 },
    { type: "rounds", label: "AMRAP 2", items: [] }
  ]};
  const groups = getSequencePhaseGroups(phases, structure);
  assert.deepEqual(groups.map(group => group.map(phase => phase.index)), [[0], [1, 2], [3]]);
});

test("keeps the active description item within the scroll viewport", () => {
  const container = { top: 100, bottom: 400, height: 300 };
  assert.equal(getDescriptionScrollDelta(container, { top: 80, bottom: 130, height: 50 }), -32);
  assert.equal(getDescriptionScrollDelta(container, { top: 380, bottom: 430, height: 50 }), 42);
  assert.equal(getDescriptionScrollDelta(container, { top: 180, bottom: 230, height: 50 }), 0);
});

test("aligns an active description item taller than the available viewport to its top", () => {
  const container = { top: 100, bottom: 300, height: 200 };
  assert.equal(getDescriptionScrollDelta(container, { top: 60, bottom: 340, height: 280 }), -52);
});
