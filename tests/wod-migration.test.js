import test from "node:test";
import assert from "node:assert/strict";
import { migrateWodV1ToV2 } from "../src/wod-migration.js";

function legacy(overrides = {}) {
  return {
    id: "saved-wod-42",
    schemaVersion: 1,
    title: "5 RFT",
    sourceText: "5 rounds for time: 10 deadlifts",
    workout: {
      format: "rounds_for_time",
      description: "5 rondas por tiempo",
      movements: [{ name: "Deadlift", prescription: "10 reps", load: "60 kg", notes: "Mantener técnica" }]
    },
    timer: { type: "sequence", label: "RFT", blocks: [{ type: "countup", label: "For Time", timeCapSeconds: 900, rounds: 5 }] },
    interpretation: { status: "ready", issues: [] },
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-02-01T10:00:00.000Z",
    ...overrides
  };
}

test("migrates explicit RFT rounds and preserves identity, timestamps, source and timer", () => {
  const old = legacy();
  const migrated = migrateWodV1ToV2(old);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.id, old.id);
  assert.equal(migrated.createdAt, old.createdAt);
  assert.equal(migrated.updatedAt, old.updatedAt);
  assert.equal(migrated.sourceText, old.sourceText);
  assert.deepEqual(migrated.timer, old.timer);
  assert.deepEqual(migrated.workout.structure, {
    type: "rounds", count: 5, items: [{ type: "movement", movementId: "legacy-movement-1" }]
  });
  assert.equal(migrated.interpretation.status, "ready");
});

test("maps a chipper to an ordered one-pass structure", () => {
  const migrated = migrateWodV1ToV2(legacy({
    workout: { format: "chipper", description: "Chipper", movements: [
      { name: "Row", prescription: "500 m", load: null, notes: null },
      { name: "Burpee", prescription: "30 reps", load: null, notes: null }
    ] }
  }));
  assert.equal(migrated.workout.structure.type, "chipper");
  assert.deepEqual(migrated.workout.structure.items.map(item => item.movementId), ["legacy-movement-1", "legacy-movement-2"]);
});

test("does not invent ladder steps and preserves the legacy format for review", () => {
  const migrated = migrateWodV1ToV2(legacy({
    workout: { format: "ladder", description: "2-4-6-8-10", movements: [
      { name: "Pull-up", prescription: "2-4-6-8-10", load: null, notes: null }
    ] }
  }));
  assert.equal(migrated.workout.format, "custom");
  assert.equal(migrated.workout.legacyFormat, "ladder");
  assert.deepEqual(migrated.workout.structure, {
    type: "sequence", items: [{ type: "movement", movementId: "legacy-movement-1" }]
  });
  assert.equal(migrated.interpretation.status, "needs_review");
  assert.equal(migrated.interpretation.issues[0].code, "LEGACY_STRUCTURE_REQUIRES_REVIEW");
});

test("does not invent RFT round count when timer has none", () => {
  const migrated = migrateWodV1ToV2(legacy({
    timer: { type: "sequence", label: "For Time", blocks: [{ type: "countup", label: "For Time", timeCapSeconds: 900, rounds: null }] }
  }));
  assert.equal(migrated.workout.format, "custom");
  assert.equal(migrated.workout.legacyFormat, "rounds_for_time");
  assert.equal(migrated.interpretation.status, "needs_review");
});

test("rejects empty or malformed legacy movement lists and non-v1 sources", () => {
  assert.throws(() => migrateWodV1ToV2(legacy({ schemaVersion: 2 })), error => error.code === "MIGRATION_SOURCE_UNSUPPORTED");
  assert.throws(() => migrateWodV1ToV2(legacy({ workout: { format: "amrap", description: "", movements: [] } })), error => error.code === "EMPTY_LEGACY_MOVEMENTS");
  assert.throws(() => migrateWodV1ToV2(legacy({ workout: { format: "amrap", description: "", movements: [{ name: " " }] } })), error => error.code === "INVALID_LEGACY_MOVEMENT");
});
