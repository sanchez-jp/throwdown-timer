import test from "node:test";
import assert from "node:assert/strict";
import {
  findUnverifiedMovementCoverage,
  normalizeExplicitWorkRestIntervals,
  parseExplicitWorkRestIntervals,
  shouldFlagUnverifiedMovementCoverage,
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


test("covers repeated catalogue entries for the same movement when loads differ", () => {
  const repeatedWorkout = {
    movements: [
      { id: "wall-walks", name: "Wall Walks" },
      { id: "power-snatches-40-24", name: "Power Snatches", load: "40/24 kg" },
      { id: "wall-facing-hspu", name: "Wall-Facing HSPU" },
      { id: "power-snatches-50-35", name: "Power Snatches", load: "50/35 kg" },
      { id: "handstand-walk", name: "Handstand Walk" },
      { id: "power-snatches-60-40", name: "Power Snatches", load: "60/40 kg" },
    ],
  };
  const evidence = [
    { sourceName: "Wall Walks", movementId: "wall-walks", sourceEvidence: "3 Wall Walks" },
    { sourceName: "Power Snatches", movementId: "power-snatches-40-24", sourceEvidence: "9 Power Snatches" },
    { sourceName: "Wall-Facing HSPU", movementId: "wall-facing-hspu", sourceEvidence: "6 Wall-Facing HSPU" },
    { sourceName: "Handstand Walk", movementId: "handstand-walk", sourceEvidence: "9-M Handstand Walk" },
  ];
  assert.deepEqual(findUnverifiedMovementCoverage(repeatedWorkout, evidence), {
    hasUnmappedSourceMovement: false,
    uncoveredMovementIds: [],
    hasEvidence: true,
  });
});

test("maps a repeated movement by source name when its evidence has no catalogue id", () => {
  const repeatedWorkout = {
    movements: [
      { id: "power-snatches-40", name: "Power Snatches" },
      { id: "power-snatches-50", name: "Power Snatches" },
    ],
  };
  const coverage = findUnverifiedMovementCoverage(repeatedWorkout, [
    { sourceName: "Power Snatches", movementId: null, sourceEvidence: "9 Power Snatches" },
  ]);
  assert.deepEqual(coverage, {
    hasUnmappedSourceMovement: false,
    uncoveredMovementIds: [],
    hasEvidence: true,
  });
});

test("still flags a genuinely different movement that has no source evidence", () => {
  const repeatedWorkout = {
    movements: [
      { id: "power-snatches-40", name: "Power Snatches" },
      { id: "wall-walks", name: "Wall Walks" },
    ],
  };
  const coverage = findUnverifiedMovementCoverage(repeatedWorkout, [
    { sourceName: "Power Snatches", movementId: "power-snatches-40", sourceEvidence: "9 Power Snatches" },
  ]);
  assert.deepEqual(coverage.uncoveredMovementIds, ["wall-walks"]);
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

test("does not add a movement coverage warning when an uncertain review supplied no roster", () => {
  const coverage = findUnverifiedMovementCoverage(workout, []);
  assert.equal(shouldFlagUnverifiedMovementCoverage("uncertain", [], coverage), false);
  assert.equal(shouldFlagUnverifiedMovementCoverage("valid", [], coverage), true);
});

test("uses independent movement evidence even when another semantic check is uncertain", () => {
  const evidence = workout.movements.map((movement, index) => ({
    sourceName: movement.id,
    movementId: movement.id,
    sourceEvidence: `movement ${index + 1}`,
  }));
  const coverage = findUnverifiedMovementCoverage(workout, evidence);
  assert.equal(shouldFlagUnverifiedMovementCoverage("uncertain", evidence, coverage), false);
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
