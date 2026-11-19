import test from "node:test";
import assert from "node:assert/strict";
import {
  findUnverifiedMovementCoverage,
  normalizeExplicitWorkRestIntervals,
  parseExplicitWorkRestIntervals,
} from "../supabase/functions/interpret-wod/wod-semantic-review.js";

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

test("parses an explicit repeated AMRAP work and rest prescription", () => {
  assert.deepEqual(parseExplicitWorkRestIntervals("5 × 3’ AMRAP / 1’ REST"), {
    rounds: 5, workSeconds: 180, restSeconds: 60, startWithRest: false,
  });
  assert.deepEqual(parseExplicitWorkRestIntervals("5 rounds of 3 min AMRAP / 1 min rest"), {
    rounds: 5, workSeconds: 180, restSeconds: 60, startWithRest: false,
  });
});

test("repairs an invalid interval timer from explicit source values", () => {
  const result = normalizeExplicitWorkRestIntervals({
    type: "sequence", label: "Intervals", blocks: [{ type: "intervals", rounds: null, workSeconds: 0, restSeconds: null }],
  }, "5 × 3' AMRAP / 1' REST");
  assert.deepEqual(result.blocks[0], {
    type: "intervals", rounds: 5, workSeconds: 180, restSeconds: 60,
    startWithRest: false, label: "Trabajo / descanso",
  });
});

test("reconstructs an interval timer when the source is explicit and timer is missing", () => {
  assert.deepEqual(normalizeExplicitWorkRestIntervals(null, "5 × 3' AMRAP / 1' REST"), {
    type: "sequence", label: "Trabajo / descanso", blocks: [{
      type: "intervals", label: "Trabajo / descanso", rounds: 5, workSeconds: 180,
      restSeconds: 60, startWithRest: false,
    }],
  });
  assert.equal(normalizeExplicitWorkRestIntervals(null, "3 rounds for time"), null);
});
