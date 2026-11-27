import { canonicalizeAmrapBlockNodes } from "../supabase/functions/interpret-wod/wod-structure-normalization.js";
import test from "node:test";
import assert from "node:assert/strict";
import { nestFlatMovementsUnderEmptyRoundHeaders, normalizeRestStructureNodes, normalizeRoundMovementAliases } from "../supabase/functions/interpret-wod/wod-structure-normalization.js";

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

test("canonicalizes timed AMRAP blocks to the only supported grouped structure node", () => {
  const workout = { format: "amrap", structure: { type: "sequence", items: [
    { type: "amrap", label: "AMRAP 6 MINUTES", durationSeconds: 360, items: [
      { type: "movement", movementId: "wall-walks", prescription: "3" },
      { type: "movement", movementId: "snatch-40", prescription: "9" },
    ] },
    { type: "rest", label: "REST 3 MINUTES", durationSeconds: 180 },
    { type: "amrap", label: "AMRAP 6 MINUTES", durationSeconds: 360, items: [
      { type: "movement", movementId: "hspu", prescription: "6" },
    ] },
  ] } };
  canonicalizeAmrapBlockNodes(workout);
  assert.deepEqual(workout.structure.items.map(node => node.type), ["rounds", "rest", "rounds"]);
  assert.deepEqual(workout.structure.items.filter(node => node.type === "rounds").map(node => node.count), [1, 1]);
  assert.deepEqual(workout.structure.items.filter(node => node.type === "rounds").map(node => node.items.length), [2, 1]);
  assert.equal(workout.format, "amrap");
});

test("does not fabricate contents for empty AMRAP blocks", () => {
  const workout = { structure: { type: "sequence", items: [
    { type: "amrap", label: "AMRAP 6 MINUTES", items: [] },
  ] } };
  canonicalizeAmrapBlockNodes(workout);
  assert.equal(workout.structure.items[0].type, "amrap");
});
