import test from "node:test";
import assert from "node:assert/strict";
import { validateWodV2, WodValidationError } from "../src/wod-validator.js";

function wod(overrides = {}) {
  return {
    schemaVersion: 2,
    title: "5 RFT",
    workout: {
      format: "rounds_for_time",
      description: "5 rondas por tiempo",
      movements: [{ id: "m1", name: "Deadlift", prescription: "10 reps", load: "60 kg", notes: null }],
      structure: { type: "rounds", count: 5, items: [{ type: "movement", movementId: "m1" }] }
    },
    timer: { type: "sequence", label: "5 RFT", blocks: [{ type: "countup", label: "For Time", timeCapSeconds: 900, rounds: 5 }] },
    interpretation: { status: "ready", issues: [] },
    ...overrides
  };
}

test("accepts a valid RFT with semantic rounds and a separate timer", () => {
  assert.equal(validateWodV2(wod()), true);
});

test("accepts explicit irregular ladder steps without deriving a progression", () => {
  const value = wod({
    workout: {
      format: "ladder",
      description: "Ladder irregular",
      movements: [{ id: "m1", name: "Burpee", prescription: null, load: null, notes: null }],
      structure: { type: "ladder", direction: "custom", steps: [
        { label: "2 reps", items: [{ type: "movement", movementId: "m1", prescription: "2 reps" }] },
        { label: "5 reps", items: [{ type: "movement", movementId: "m1", prescription: "5 reps" }] },
        { label: "9 reps", items: [{ type: "movement", movementId: "m1", prescription: "9 reps" }] }
      ]}
    }
  });
  assert.equal(validateWodV2(value), true);
});

test("accepts a descending explicit ladder", () => {
  const value = wod({
    workout: {
      format: "ladder", description: "Descending ladder",
      movements: [{ id: "m1", name: "Pull-up", prescription: null, load: null, notes: null }],
      structure: { type: "ladder", direction: "descending", steps: [
        { label: "10", items: [{ type: "movement", movementId: "m1", prescription: "10 reps" }] },
        { label: "8", items: [{ type: "movement", movementId: "m1", prescription: "8 reps" }] }
      ]}
    }
  });
  assert.equal(validateWodV2(value), true);
});

test("rejects duplicate movement IDs", () => {
  const value = wod();
  value.workout.movements.push({ ...value.workout.movements[0] });
  assert.throws(() => validateWodV2(value), error =>
    error instanceof WodValidationError && error.code === "DUPLICATE_MOVEMENT_ID");
});

test("rejects unknown movement references", () => {
  const value = wod();
  value.workout.structure.items[0].movementId = "missing";
  assert.throws(() => validateWodV2(value), error => error.code === "UNKNOWN_MOVEMENT_REFERENCE");
});

test("rejects incompatible format and structure", () => {
  const value = wod();
  value.workout.format = "ladder";
  assert.throws(() => validateWodV2(value), error => error.code === "FORMAT_STRUCTURE_MISMATCH");
});

test("rejects empty rounds, empty ladder steps, and invalid counts", () => {
  const emptyRounds = wod();
  emptyRounds.workout.structure.count = 0;
  assert.throws(() => validateWodV2(emptyRounds), error => error.code === "INVALID_ROUND_COUNT");

  const emptyLadder = wod({ workout: {
    format: "ladder", description: "", movements: [{ id: "m1", name: "Burpee", prescription: null, load: null, notes: null }],
    structure: { type: "ladder", direction: "ascending", steps: [{ label: "1", items: [] }] }
  }});
  assert.throws(() => validateWodV2(emptyLadder), error => error.code === "EMPTY_LADDER_STEP");
});

test("rejects duplicate section IDs and accepts nested sections", () => {
  const value = wod({ workout: {
    format: "strength_plus_wod", description: "Strength + WOD",
    movements: [{ id: "m1", name: "Front squat", prescription: "5x3", load: null, notes: null }],
    structure: { type: "sections", sections: [
      { id: "s1", name: "Strength", structure: { type: "sequence", items: [{ type: "movement", movementId: "m1" }] } },
      { id: "s1", name: "WOD", structure: { type: "sequence", items: [{ type: "movement", movementId: "m1" }] } }
    ]}
  }});
  assert.throws(() => validateWodV2(value), error => error.code === "DUPLICATE_SECTION_ID");
  value.workout.structure.sections[1].id = "s2";
  assert.equal(validateWodV2(value), true);
});

test("requires an explicit timer for ready WODs and preserves needs-review drafts", () => {
  const ready = wod({ timer: null });
  assert.throws(() => validateWodV2(ready), error => error.code === "INVALID_READY_WOD");
  const draft = wod({ timer: null, interpretation: { status: "needs_review", issues: [] } });
  assert.equal(validateWodV2(draft), true);
});

test("rejects unsupported schema versions", () => {
  assert.throws(() => validateWodV2(wod({ schemaVersion: 1 })), error => error.code === "UNSUPPORTED_SCHEMA");
});

test("accepts a variable-repetition ladder inside an intervals workout", () => {
  const value = wod({
    workout: {
      format: "intervals",
      description: "5 intervalos con repeticiones descendentes",
      movements: [
        { id: "c2b", name: "Chest-to-Bar", prescription: null, load: null, notes: null },
        { id: "hspu", name: "HSPU", prescription: null, load: null, notes: null },
        { id: "bjo", name: "Box Jump Over", prescription: null, load: null, notes: null }
      ],
      structure: { type: "ladder", direction: "descending", steps: [
        { label: "Intervalo 1", items: [
          { type: "movement", movementId: "c2b", prescription: "20" },
          { type: "movement", movementId: "hspu", prescription: "20" },
          { type: "movement", movementId: "bjo", prescription: "max" }
        ]},
        { label: "Intervalo 2", items: [
          { type: "movement", movementId: "c2b", prescription: "18" },
          { type: "movement", movementId: "hspu", prescription: "18" },
          { type: "movement", movementId: "bjo", prescription: "max" }
        ]}
      ]}
    },
    timer: { type: "sequence", label: "Intervals", blocks: [
      { type: "intervals", label: "Trabajo", rounds: 5, workSeconds: 120, restSeconds: 60, startWithRest: false }
    ]}
  });
  assert.equal(validateWodV2(value), true);
});


test("accepts a load override on an individual ladder movement occurrence", () => {
  const value = wod({
    workout: {
      format: "ladder",
      description: "Ladder con cargas progresivas",
      movements: [{ id: "m1", name: "Clean", prescription: null, load: "40/30 kg", notes: null }],
      structure: { type: "ladder", direction: "ascending", steps: [
        { label: "Ronda 1", items: [{ type: "movement", movementId: "m1", prescription: "6", load: "40/30 kg" }] },
        { label: "Ronda 2", items: [{ type: "movement", movementId: "m1", prescription: "6", load: "50/37,5 kg" }] }
      ]}
    }
  });
  assert.equal(validateWodV2(value), true);
});

test("rejects a non-text load override on a structure movement", () => {
  const value = wod({
    workout: {
      format: "ladder",
      description: "Ladder",
      movements: [{ id: "m1", name: "Clean", prescription: null, load: null, notes: null }],
      structure: { type: "ladder", direction: "ascending", steps: [
        { label: "Ronda 1", items: [{ type: "movement", movementId: "m1", load: 50 }] }
      ]}
    }
  });
  assert.throws(() => validateWodV2(value), error => error.code === "INVALID_MOVEMENT_LOAD");
});
