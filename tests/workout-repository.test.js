import test from "node:test";
import assert from "node:assert/strict";
import { createWorkoutRepository, WorkoutRepositoryError } from "../src/workout-repository.js";

function memoryStorage() {
  const records = new Map();
  return {
    getAll: async () => [...records.values()].map(value => structuredClone(value)),
    get: async id => records.has(id) ? structuredClone(records.get(id)) : undefined,
    put: async record => { records.set(record.id, structuredClone(record)); return record.id; },
    delete: async id => records.delete(id)
  };
}

function wod(overrides = {}) {
  return {
    schemaVersion: 1,
    title: "AMRAP 12'",
    sourceText: "12 min AMRAP",
    workout: {
      format: "amrap",
      description: "Máximas rondas en 12 minutos.",
      movements: [{ name: "Burpee", prescription: "10 reps", load: null, notes: null }]
    },
    timer: {
      type: "sequence",
      label: "AMRAP",
      blocks: [{ type: "countdown", label: "AMRAP", durationSeconds: 720 }]
    },
    interpretation: { status: "ready", issues: [] },
    ...overrides
  };
}

function setup() {
  let id = 0;
  let time = 0;
  const storage = memoryStorage();
  const repository = createWorkoutRepository({
    storage,
    uuid: () => `workout-${++id}`,
    now: () => new Date(1700000000000 + ++time * 1000).toISOString()
  });
  return { repository, storage };
}

test("create stores a normalized WOD with stable metadata", async () => {
  const { repository } = setup();
  const created = await repository.create(wod());
  assert.equal(created.id, "workout-1");
  assert.equal(created.title, "AMRAP 12'");
  assert.equal(created.schemaVersion, 1);
  assert.equal(created.sourceText, "12 min AMRAP");
  assert.ok(created.createdAt);
  assert.equal(created.createdAt, created.updatedAt);
  assert.equal((await repository.get(created.id)).id, created.id);
});

test("list returns workouts ordered by most recently updated", async () => {
  const { repository } = setup();
  const first = await repository.create(wod());
  const second = await repository.create(wod({ title: "For Time" }));
  const list = await repository.list();
  assert.deepEqual(list.map(item => item.id), [second.id, first.id]);
});

test("update preserves id and creation time and refreshes updated time", async () => {
  const { repository } = setup();
  const created = await repository.create(wod());
  const updated = await repository.update(created.id, { title: "  AMRAP editado  " });
  assert.equal(updated.id, created.id);
  assert.equal(updated.title, "AMRAP editado");
  assert.equal(updated.createdAt, created.createdAt);
  assert.notEqual(updated.updatedAt, created.updatedAt);
});

test("duplicate creates an independent record", async () => {
  const { repository } = setup();
  const original = await repository.create(wod());
  const copy = await repository.duplicate(original.id);
  assert.equal(copy.title, "AMRAP 12' (copia)");
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.createdAt, copy.updatedAt);
  copy.workout.movements[0].prescription = "20 reps";
  assert.equal((await repository.get(original.id)).workout.movements[0].prescription, "10 reps");
});

test("delete returns the record and restore brings it back without changing its id", async () => {
  const { repository } = setup();
  const created = await repository.create(wod());
  const deleted = await repository.delete(created.id);
  assert.equal(await repository.get(created.id), null);
  const restored = await repository.restore(deleted);
  assert.equal(restored.id, created.id);
  assert.equal((await repository.get(created.id)).title, created.title);
});

test("restore refuses to overwrite an existing workout", async () => {
  const { repository } = setup();
  const created = await repository.create(wod());
  await assert.rejects(repository.restore(created), error =>
    error instanceof WorkoutRepositoryError && error.code === "ALREADY_EXISTS");
});

test("missing records are handled explicitly", async () => {
  const { repository } = setup();
  assert.equal(await repository.get("missing"), null);
  assert.equal(await repository.delete("missing"), null);
  await assert.rejects(repository.update("missing", { title: "No existe" }), error =>
    error instanceof WorkoutRepositoryError && error.code === "NOT_FOUND");
});

test("invalid and unsupported WODs are rejected", async () => {
  const { repository } = setup();
  await assert.rejects(repository.create(wod({ schemaVersion: 3 })), error => error.code === "UNSUPPORTED_SCHEMA");
  await assert.rejects(repository.create(wod({ title: " " })), error => error.code === "INVALID_TITLE");
  await assert.rejects(repository.create(wod({ timer: null })), error => error.code === "INVALID_READY_WOD");
  await assert.rejects(repository.create(wod({ timer: {
    type: "sequence", label: "Bad", blocks: [{ type: "emom", label: "Bad", durationSeconds: 100, intervalSeconds: 60, rounds: 2 }]
  }})), error => error.code === "INVALID_TIMER");
});

test("needs-review WODs may be saved without an executable timer", async () => {
  const { repository } = setup();
  const saved = await repository.create(wod({
    timer: null,
    interpretation: { status: "needs_review", issues: [{ severity: "blocking", message: "Falta duración" }] }
  }));
  assert.equal(saved.timer, null);
  assert.equal(saved.interpretation.status, "needs_review");
});

test("ready WODs cannot contain blocking interpretation issues", async () => {
  const { repository } = setup();
  await assert.rejects(repository.create(wod({
    interpretation: { status: "ready", issues: [{ severity: "blocking", message: "Conflicto" }] }
  })), error => error.code === "BLOCKING_ISSUES");
});

test("v1 and v2 records coexist and v2 semantic structure survives repository round-trip", async () => {
  const { repository } = setup();
  const legacy = await repository.create(wod());
  const semanticWod = {
    schemaVersion: 2,
    title: "Ladder irregular",
    sourceText: "2-5-9 burpees",
    workout: {
      format: "ladder",
      description: "2, 5 y 9 burpees",
      movements: [{ id: "m1", name: "Burpee", prescription: null, load: null, notes: null }],
      structure: {
        type: "ladder",
        direction: "custom",
        steps: [
          { label: "2 reps", items: [{ type: "movement", movementId: "m1", prescription: "2 reps" }] },
          { label: "5 reps", items: [{ type: "movement", movementId: "m1", prescription: "5 reps" }] },
          { label: "9 reps", items: [{ type: "movement", movementId: "m1", prescription: "9 reps" }] }
        ]
      }
    },
    timer: { type: "sequence", label: "Ladder", blocks: [{ type: "countup", label: "Ladder", timeCapSeconds: 600, rounds: null }] },
    interpretation: { status: "ready", issues: [] }
  };
  const saved = await repository.create(semanticWod);
  const loaded = await repository.get(saved.id);
  assert.equal(legacy.schemaVersion, 1);
  assert.equal(loaded.schemaVersion, 2);
  assert.deepEqual(loaded.workout.structure, semanticWod.workout.structure);
  assert.deepEqual((await repository.list()).map(item => item.schemaVersion).sort(), [1, 2]);
});

test("repository rejects invalid v2 semantic references", async () => {
  const { repository } = setup();
  const invalid = {
    schemaVersion: 2,
    title: "Broken RFT",
    workout: {
      format: "rounds_for_time",
      description: "5 rounds",
      movements: [{ id: "m1", name: "Deadlift", prescription: "10 reps", load: null, notes: null }],
      structure: { type: "rounds", count: 5, items: [{ type: "movement", movementId: "missing" }] }
    },
    timer: { type: "sequence", label: "RFT", blocks: [{ type: "countup", label: "RFT", timeCapSeconds: 600, rounds: 5 }] },
    interpretation: { status: "ready", issues: [] }
  };
  await assert.rejects(repository.create(invalid), error => error.code === "UNKNOWN_MOVEMENT_REFERENCE");
});
