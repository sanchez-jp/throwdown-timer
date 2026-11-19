import test from "node:test";
import assert from "node:assert/strict";
import { findUnverifiedMovementCoverage } from "../supabase/functions/interpret-wod/wod-semantic-review.js";

const workout = { movements: [{ id: "double-unders" }, { id: "hang-clean" }, { id: "lunges" }] };

test("accepts movement coverage when every source movement maps to the candidate", () => {
  const evidence = [
    { sourceName: "Double Unders", movementId: "double-unders", sourceEvidence: "40 Double Unders" },
    { sourceName: "Hang Clean", movementId: "hang-clean", sourceEvidence: "8 DB Hang Clean" },
    { sourceName: "Lunges", movementId: "lunges", sourceEvidence: "8 Overhead Lunges" },
  ];
  assert.deepEqual(findUnverifiedMovementCoverage(workout, evidence), {
    hasUnmappedSourceMovement: false,
    uncoveredMovementIds: [],
    hasEvidence: true,
  });
});

test("flags a source movement the candidate has not represented", () => {
  const evidence = [
    { sourceName: "Double Unders", movementId: "double-unders", sourceEvidence: "40 Double Unders" },
    { sourceName: "Hang Clean", movementId: "hang-clean", sourceEvidence: "8 DB Hang Clean" },
    { sourceName: "Lunges", movementId: null, sourceEvidence: "8 Overhead Lunges" },
  ];
  assert.deepEqual(findUnverifiedMovementCoverage(workout, evidence), {
    hasUnmappedSourceMovement: true,
    uncoveredMovementIds: ["lunges"],
    hasEvidence: true,
  });
});

test("flags missing, unsupported or unmapped coverage evidence", () => {
  assert.equal(findUnverifiedMovementCoverage(workout, []).hasEvidence, false);
  assert.equal(findUnverifiedMovementCoverage(workout, [
    { sourceName: "Made up", movementId: "unknown", sourceEvidence: "Made up" },
  ]).hasUnmappedSourceMovement, true);
  assert.equal(findUnverifiedMovementCoverage(workout, [
    { sourceName: "", movementId: "double-unders", sourceEvidence: "40 Double Unders" },
  ]).hasUnmappedSourceMovement, true);
});
