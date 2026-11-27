import test from "node:test";
import assert from "node:assert/strict";
import { getImportedWorkoutTitle } from "../src/workout-title.js";

test("adds a local timestamp when the imported WOD has no name", () => {
  const date = new Date(2026, 10, 27, 16, 5, 9);
  assert.equal(getImportedWorkoutTitle("NUEVO WOD", date), "NUEVO WOD · 27/11/2026, 16:05:09");
});

test("preserves a title explicitly supplied by the source", () => {
  assert.equal(getImportedWorkoutTitle("  SPIDER-PIG  ", new Date(2026, 10, 27)), "SPIDER-PIG");
});

test("uses the fallback for a missing title", () => {
  assert.equal(getImportedWorkoutTitle("", new Date(2026, 10, 27, 8, 2, 1)), "NUEVO WOD · 27/11/2026, 08:02:01");
});
