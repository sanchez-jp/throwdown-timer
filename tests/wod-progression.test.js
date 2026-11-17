import test from "node:test";
import assert from "node:assert/strict";
import { expandDescendingIntervalProgression } from "../supabase/functions/interpret-wod/wod-progression.js";

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
