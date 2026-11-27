import test from "node:test";
import assert from "node:assert/strict";
import { nestFlatMovementsUnderEmptyRoundHeaders, normalizeEmomStructure, normalizeRestStructureNodes, normalizeRoundMovementAliases } from "../supabase/functions/interpret-wod/wod-structure-normalization.js";

const catalogue = [
  { id: "wall-walks", name: "Wall Walks", prescription: "3", load: null },
  { id: "snatch-40", name: "Power Snatches", prescription: "9", load: "40 kg" },
  { id: "hspu", name: "Wall-Facing HSPU", prescription: "6", load: null },
];

test("canonicalizes round movements aliases only when references resolve uniquely", () => {
  const workout = { movements: catalogue, structure: { type: "sequence", items: [{
    type: "rounds", count: 1, label: "AMRAP 6 MINUTES",
    movements: [{ name: "Wall Walks", reps: 3 }, { movementId: "snatch-40", prescription: "9", load: "40 kg" }],
  }] } };
  normalizeRoundMovementAliases(workout);
  assert.deepEqual(workout.structure.items[0].items, [
    { type: "movement", movementId: "wall-walks", prescription: "3", load: null },
    { type: "movement", movementId: "snatch-40", prescription: "9", load: "40 kg" },
  ]);
  assert.equal("movements" in workout.structure.items[0], false);
});

test("does not guess an ambiguous movement alias", () => {
  const workout = { movements: [
    { id: "snatch-40", name: "Power Snatches" }, { id: "snatch-50", name: "Power Snatches" },
  ], structure: { type: "sequence", items: [{
    type: "rounds", count: 1, label: "AMRAP", movements: ["Power Snatches"],
  }] } };
  normalizeRoundMovementAliases(workout);
  assert.equal(workout.structure.items[0].items, undefined);
});

test("nests flat movements and converts explicit rest headers between rounds", () => {
  const workout = { structure: { type: "sequence", items: [
    { type: "rounds", count: 1, label: "AMRAP 6 MINUTES" },
    { type: "movement", movementId: "wall-walks" },
    { type: "movement", movementId: "snatch-40" },
    { type: "rounds", count: 1, label: "REST 3 MINUTES" },
    { type: "rounds", count: 1, label: "AMRAP 6 MINUTES" },
    { type: "movement", movementId: "hspu" },
    { type: "movement", movementId: "snatch-40" },
  ] } };
  normalizeRestStructureNodes(workout);
  const result = nestFlatMovementsUnderEmptyRoundHeaders(workout);
  assert.deepEqual(result.structure.items.map(node => node.type), ["rounds", "rest", "rounds"]);
  assert.deepEqual(result.structure.items.map(node => node.type === "rounds" ? node.items.length : node.durationSeconds), [2, 180, 2]);
});

test("leaves incomplete rounds unchanged rather than borrowing catalogue movements", () => {
  const workout = { movements: catalogue, structure: { type: "sequence", items: [
    { type: "rounds", count: 1, label: "Round 1" }, { type: "rounds", count: 1, label: "Round 2" },
  ] } };
  assert.equal(nestFlatMovementsUnderEmptyRoundHeaders(workout), workout);
});

test("preserves already populated round groups", () => {
  const workout = { structure: { type: "sequence", items: [
    { type: "rounds", count: 1, items: [{ type: "movement", movementId: "wall-walks" }] },
  ] } };
  assert.equal(nestFlatMovementsUnderEmptyRoundHeaders(workout), workout);
});


test("consolidates duplicate empty round headers and keeps Cash Out outside the rounds", () => {
  const movements = [
    { id: "sandbag", name: "Sandbag Carry" },
    { id: "row", name: "Row" },
    { id: "snatch", name: "Power Snatches" },
    { id: "pullups", name: "Pull-Ups" },
    { id: "situps", name: "AbMat Sit-Ups" },
    { id: "pushups", name: "Hand-Release Push-Ups" },
  ];
  const emptyHeader = () => ({ type: "rounds", count: 5, label: "5 ROUNDS" });
  const workout = { movements, structure: { type: "sequence", items: [
    { type: "movement", movementId: "sandbag" },
    emptyHeader(), emptyHeader(), emptyHeader(), emptyHeader(),
    ...movements.slice(1).map(movement => ({ type: "movement", movementId: movement.id })),
  ] } };
  const source = "CASH IN 60 m Sandbag Carry 5 ROUNDS 400 m Row 8 Power Snatches 12 Pull-Ups 20 AbMat Sit-Ups CASH OUT 30 Hand-Release Push-Ups";
  const result = nestFlatMovementsUnderEmptyRoundHeaders(workout, source);
  assert.deepEqual(result.structure.items.map(node => node.type), ["movement", "rounds", "movement"]);
  assert.equal(result.structure.items[1].count, 5);
  assert.deepEqual(result.structure.items[1].items.map(node => node.movementId), ["row", "snatch", "pullups", "situps"]);
  assert.equal(result.structure.items[2].movementId, "pushups");
});

test("does not consolidate repeated empty round headers without a source Cash Out boundary", () => {
  const workout = { movements: [{ id: "row", name: "Row" }], structure: { type: "sequence", items: [
    { type: "rounds", count: 5, label: "5 ROUNDS" },
    { type: "rounds", count: 5, label: "5 ROUNDS" },
    { type: "movement", movementId: "row" },
  ] } };
  assert.equal(nestFlatMovementsUnderEmptyRoundHeaders(workout), workout);
});


test("populates a single empty rounds header and keeps Cash Out outside", () => {
  const movements = [
    { id: "sandbag", name: "Sandbag Carry" },
    { id: "row", name: "Row" },
    { id: "snatch", name: "Power Snatches" },
    { id: "pullups", name: "Pull-Ups" },
    { id: "situps", name: "AbMat Sit-Ups" },
    { id: "pushups", name: "Hand-Release Push-Ups" },
  ];
  const workout = { movements, structure: { type: "sequence", items: [
    { type: "movement", movementId: "sandbag" },
    { type: "rounds", count: 5, label: "5 ROUNDS" },
    ...movements.slice(1).map(movement => ({ type: "movement", movementId: movement.id })),
  ] } };
  const source = "CASH IN 60 m Sandbag Carry 5 ROUNDS 400 m Row 8 Power Snatches 12 Pull-Ups 20 AbMat Sit-Ups CASH OUT 30 Hand-Release Push-Ups";
  const result = nestFlatMovementsUnderEmptyRoundHeaders(workout, source);
  assert.deepEqual(result.structure.items.map(node => node.type), ["movement", "rounds", "movement"]);
  assert.deepEqual(result.structure.items[1].items.map(node => node.movementId), ["row", "snatch", "pullups", "situps"]);
  assert.equal(result.structure.items[2].movementId, "pushups");
});


test("normalizes an EMOM timer-rounds container to a sequence and keeps rest out of movement structure", () => {
  const workout = {
    format: "emom",
    movements: [
      { id: "ski", name: "Ski" },
      { id: "hsw", name: "Handstand Walk" },
      { id: "burpees", name: "Burpee Box Jump Over" },
    ],
    structure: { type: "rounds", count: 20, items: [
      { type: "movement", movementId: "ski", prescription: "14/11 cal" },
      { type: "movement", movementId: "hsw", prescription: "15 m" },
      { type: "movement", movementId: "burpees", prescription: "10" },
      { type: "rest", label: "REST", movementId: null },
    ] },
  };
  const result = normalizeEmomStructure(workout);
  assert.equal(result.structure.type, "sequence");
  assert.deepEqual(result.structure.items.map(item => item.type), ["movement", "movement", "movement"]);
  assert.deepEqual(result.structure.items.map(item => item.movementId), ["ski", "hsw", "burpees"]);
  assert.equal(result.structure.count, undefined);
});

test("normalizes EMOM rest nodes without altering non-EMOM round structures", () => {
  const emom = { format: "e2mom", structure: { type: "sequence", items: [
    { type: "movement", movementId: "bike" },
    { type: "rest", label: "REST", durationSeconds: null },
  ] } };
  normalizeEmomStructure(emom);
  assert.deepEqual(emom.structure.items.map(item => item.type), ["movement"]);

  const forTime = { format: "for_time", structure: { type: "rounds", count: 5, items: [
    { type: "movement", movementId: "bike" },
    { type: "rest", label: "REST", durationSeconds: 60 },
  ] } };
  normalizeEmomStructure(forTime);
  assert.equal(forTime.structure.type, "rounds");
  assert.equal(forTime.structure.items.length, 2);
});
