import test from "node:test";
import assert from "node:assert/strict";
import { expandDescendingIntervalProgression, expandProgressiveLoadLadder, expandAlternatingCleanVariants, normalizeLadderDirection } from "../supabase/functions/interpret-wod/wod-progression.js";

function result() {
  return {
    schemaVersion: 2,
    title: "Intervalos descendentes",
    workout: {
      format: "intervals",
      description: "5 intervalos de 2 minutos de trabajo y 1 minuto de descanso, restando 2 repeticiones a los movimientos contados en cada ronda sucesiva.",
      movements: [
        { id: "c2b", name: "Chest-to-Bar", prescription: null },
        { id: "hspu", name: "HSPU", prescription: null },
        { id: "bjo", name: "Box Jump Over", prescription: null }
      ],
      structure: {
        type: "rounds",
        count: 5,
        direction: "descending",
        items: [
          { type: "movement", movementId: "c2b", prescription: "20" },
          { type: "movement", movementId: "hspu", prescription: "20" },
          { type: "movement", movementId: "bjo", prescription: "max" }
        ]
      },
    },
  };
}

test("expands a stated descending interval progression into explicit ladder steps", () => {
  const expanded = expandDescendingIntervalProgression(result());
  assert.equal(expanded.workout.structure.type, "ladder");
  assert.equal(expanded.workout.structure.direction, "descending");
  assert.deepEqual(expanded.workout.structure.steps.map(step =>
    step.items.map(item => item.prescription)), [
    ["20", "20", "max"],
    ["18", "18", "max"],
    ["16", "16", "max"],
    ["14", "14", "max"],
    ["12", "12", "max"],
  ]);
  assert.equal(expanded.workout.structure.steps.length, 5);
});

test("rejects a descending marker when the decrement is missing", () => {
  const value = result();
  value.workout.description = "5 intervalos de 2 minutos de trabajo y 1 minuto de descanso.";
  assert.throws(() => expandDescendingIntervalProgression(value), /no ha especificado el decremento/);
});

test("does not create non-positive prescriptions", () => {
  const value = result();
  value.workout.structure.count = 12;
  assert.throws(() => expandDescendingIntervalProgression(value), /progresión descendente/);
});


test("calculates and labels the progressive load for every ladder round", () => {
  const value = {
    schemaVersion: 2,
    title: "Ladder de clean",
    workout: {
      format: "rounds_for_time",
      description: "En parejas, 10 rondas.",
      movements: [
        { id: "run", name: "Run", load: null },
        { id: "clean", name: "Clean", load: "40/30 kg (incrementa 10/7,5 kg después de cada ronda)" },
      ],
      structure: {
        type: "ladder",
        direction: "custom",
        steps: Array.from({ length: 10 }, (_, index) => ({
          label: "Ronda " + (index + 1),
          items: [
            { type: "movement", movementId: "run", prescription: "200 m" },
            { type: "movement", movementId: "clean", prescription: String(10 - Math.floor(index / 2) * 2) },
          ],
        })),
      },
    },
  };
  const source = "WOD en parejas 10 rondas. * start with 40/30kg and increase 10/7,5kg after each round";
  const expanded = expandProgressiveLoadLadder(value, source);
  assert.deepEqual(expanded.workout.structure.steps.map(step => step.label), [
    "Ronda 1 · Clean 40/30 kg",
    "Ronda 2 · Clean 50/37,5 kg",
    "Ronda 3 · Clean 60/45 kg",
    "Ronda 4 · Clean 70/52,5 kg",
    "Ronda 5 · Clean 80/60 kg",
    "Ronda 6 · Clean 90/67,5 kg",
    "Ronda 7 · Clean 100/75 kg",
    "Ronda 8 · Clean 110/82,5 kg",
    "Ronda 9 · Clean 120/90 kg",
    "Ronda 10 · Clean 130/97,5 kg",
  ]);
});


test("applies progressive loads to separate clean movements when loads include units per athlete", () => {
  const value = {
    workout: {
      format: "ladder",
      movements: [
        { id: "run", name: "Run", load: null },
        { id: "ski", name: "Ski or Row Cal", load: null },
        { id: "squat-clean", name: "Squat Clean", load: "40 kg / 30 kg" },
        { id: "power-clean", name: "Power Clean", load: "40 kg / 30 kg" },
      ],
      structure: {
        type: "ladder",
        direction: "descending",
        steps: Array.from({ length: 10 }, (_, index) => ({
          label: "Ronda " + (index + 1),
          items: [
            { type: "movement", movementId: "run", prescription: "200 m" },
            { type: "movement", movementId: "ski", prescription: String(20 - Math.floor(index / 2) * 2) + " cal" },
            { type: "movement", movementId: "squat-clean", prescription: String(Math.max(1, 6 - Math.floor(index / 2) * 2)) },
            { type: "movement", movementId: "power-clean", prescription: String(Math.max(1, 4 - Math.floor(index / 2) * 2)) },
          ],
        })),
      },
    },
  };
  const source = "WOD en parejas. * start with 40/30kg and increase 10/7,5kg after each round";
  const expanded = expandProgressiveLoadLadder(value, source);
  assert.deepEqual(expanded.workout.structure.steps.map(step =>
    step.items.filter(item => item.movementId === "squat-clean" || item.movementId === "power-clean")
      .map(item => item.load)
  ), [
    ["40/30 kg", "40/30 kg"],
    ["50/37,5 kg", "50/37,5 kg"],
    ["60/45 kg", "60/45 kg"],
    ["70/52,5 kg", "70/52,5 kg"],
    ["80/60 kg", "80/60 kg"],
    ["90/67,5 kg", "90/67,5 kg"],
    ["100/75 kg", "100/75 kg"],
    ["110/82,5 kg", "110/82,5 kg"],
    ["120/90 kg", "120/90 kg"],
    ["130/97,5 kg", "130/97,5 kg"],
  ]);
});

test("does not invent a load progression when multiple movements share the same starting load", () => {
  const value = {
    workout: {
      movements: [
        { id: "a", name: "Clean", load: "40/30 kg" },
        { id: "b", name: "Deadlift", load: "40/30 kg" },
      ],
      structure: { type: "ladder", steps: [{ label: "Ronda 1", items: [] }, { label: "Ronda 2", items: [] }] },
    },
  };
  const source = "Start with 40/30kg and increase 10/7,5kg after each round";
  const expanded = expandProgressiveLoadLadder(value, source);
  assert.equal(expanded.workout.structure.steps[0].label, "Ronda 1");
});

test("splits an alternating Clean ladder into Squat Clean and Power Clean in the stated order", () => {
  const value = {
    workout: {
      movements: [{ id: "clean", name: "Clean", prescription: null, load: "40/30 kg" }],
      structure: {
        type: "ladder",
        direction: "descending",
        steps: [
          { label: "Ronda 1", items: [{ type: "movement", movementId: "clean", prescription: "10 reps" }] },
          { label: "Ronda 2", items: [{ type: "movement", movementId: "clean", prescription: "9 reps" }] },
        ],
      },
    },
  };
  const expanded = expandAlternatingCleanVariants(value,
    "Alternate SC and PC: 1 squat clean + 1 power clean + 1 squat... until 10 reps");
  assert.deepEqual(expanded.workout.movements.map(movement => movement.name), ["Squat Clean", "Power Clean"]);
  assert.deepEqual(expanded.workout.structure.steps.map(step =>
    step.items.map(item => [item.movementId, item.prescription])), [
    [["clean", "5 reps"], ["power-clean", "5 reps"]],
    [["clean", "5 reps"], ["power-clean", "4 reps"]],
  ]);
  assert.equal(expanded.workout.movements[1].load, "40/30 kg");
});

test("does not split Clean when the source does not explicitly request alternation", () => {
  const value = {
    workout: {
      movements: [{ id: "clean", name: "Clean", prescription: null }],
      structure: { type: "ladder", steps: [{ label: "Ronda 1", items: [{ type: "movement", movementId: "clean", prescription: "10" }] }] },
    },
  };
  const expanded = expandAlternatingCleanVariants(value, "10 rounds of Clean");
  assert.equal(expanded.workout.movements.length, 1);
  assert.equal(expanded.workout.structure.steps[0].items.length, 1);
});


test("defaults a ladder with steps but no valid direction to custom", () => {
  const value = {
    workout: {
      movements: [{ id: "clean", name: "Clean" }],
      structure: {
        type: "ladder",
        steps: [{ label: "Ronda 1", items: [{ type: "movement", movementId: "clean", prescription: "10" }] }],
      },
    },
  };
  const normalized = normalizeLadderDirection(value);
  assert.equal(normalized.workout.structure.direction, "custom");
  assert.equal(normalized.workout.structure.steps.length, 1);
  assert.equal(normalized.workout.structure.steps[0].items[0].movementId, "clean");
});

test("preserves an explicit ladder direction", () => {
  const value = { workout: { structure: { type: "ladder", direction: "descending", steps: [{ label: "Ronda 1", items: [{}] }] } } };
  assert.equal(normalizeLadderDirection(value), value);
});


test("applies each progressive load to the ladder label for both alternating clean variants", () => {
  const value = {
    workout: {
      movements: [
        { id: "run", name: "Run", load: null },
        { id: "ski", name: "Ski or Row", load: null },
        { id: "squat-clean", name: "Squat Clean", load: "40/30 kg" },
        { id: "power-clean", name: "Power Clean", load: "40/30 kg" },
      ],
      structure: {
        type: "ladder",
        direction: "descending",
        steps: Array.from({ length: 10 }, (_, index) => ({
          label: "Ronda " + (index + 1),
          items: [
            { type: "movement", movementId: "run", prescription: "200 m" },
            { type: "movement", movementId: "ski", prescription: String(20 - Math.floor(index / 2) * 2) + " cal" },
            { type: "movement", movementId: "squat-clean", prescription: "5" },
            { type: "movement", movementId: "power-clean", prescription: "5" },
          ],
        })),
      },
    },
  };
  const source = "WOD en parejas 10 rondas. start with 40/30kg and increase 10/7,5kg after each round";
  const expanded = expandProgressiveLoadLadder(value, source);
  assert.deepEqual(expanded.workout.structure.steps.map(step => step.label), [
    "Ronda 1 · Squat Clean / Power Clean 40/30 kg",
    "Ronda 2 · Squat Clean / Power Clean 50/37,5 kg",
    "Ronda 3 · Squat Clean / Power Clean 60/45 kg",
    "Ronda 4 · Squat Clean / Power Clean 70/52,5 kg",
    "Ronda 5 · Squat Clean / Power Clean 80/60 kg",
    "Ronda 6 · Squat Clean / Power Clean 90/67,5 kg",
    "Ronda 7 · Squat Clean / Power Clean 100/75 kg",
    "Ronda 8 · Squat Clean / Power Clean 110/82,5 kg",
    "Ronda 9 · Squat Clean / Power Clean 120/90 kg",
    "Ronda 10 · Squat Clean / Power Clean 130/97,5 kg",
  ]);
  assert.deepEqual(expanded.workout.structure.steps.map(step => step.items.filter(item => item.load).map(item => item.load)), [
    ["40/30 kg", "40/30 kg"], ["50/37,5 kg", "50/37,5 kg"],
    ["60/45 kg", "60/45 kg"], ["70/52,5 kg", "70/52,5 kg"],
    ["80/60 kg", "80/60 kg"], ["90/67,5 kg", "90/67,5 kg"],
    ["100/75 kg", "100/75 kg"], ["110/82,5 kg", "110/82,5 kg"],
    ["120/90 kg", "120/90 kg"], ["130/97,5 kg", "130/97,5 kg"],
  ]);
});
