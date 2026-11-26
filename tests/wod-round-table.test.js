import test from "node:test";
import assert from "node:assert/strict";
import { inferExplicitWorkoutFormat, inferWorkoutFormatFromStructure, inferWorkoutTitle, normalizeExplicitForTimeRoundTable, normalizeExplicitLadderRoundTable, normalizeWorkoutTitle } from "../supabase/functions/interpret-wod/wod-round-table.js";

test("turns an explicit descending For Time table into fixed round groups", () => {
  const raw = {
    schemaVersion: 2,
    title: "STONEHENGE",
    workout: {
      format: "for_time",
      description: "Objetivo: <14 min",
      movements: [
        { id: "chest-to-bar-pull-ups", name: "Chest-to-Bar Pull-Ups", prescription: "21", load: null, notes: null },
        { id: "walking-lunges", name: "Front Rack Dumbbell Walking Lunges", prescription: "15 m", load: null, notes: null },
        { id: "handstand-push-ups", name: "Handstand Push-Ups", prescription: "21", load: null, notes: null },
      ],
      structure: { type: "sequence", items: [{ type: "movement", movementId: "chest-to-bar-pull-ups", prescription: "21", repProgression: { increment: "3", every: "round" } }] },
    },
    timer: { type: "sequence", label: "For Time", blocks: [{ type: "countup", label: "For Time", timeCapSeconds: 1080, rounds: null }] },
  };
  const source = `SOUTH PARK\nFOR TIME\n21 CHEST-TO-BARS PULL-UPS\n15-m FRONT RACK DUMBBELL WALKING LUNGES\n21 HANDSTAND PUSH-UPS\n18 CHEST-TO-BARS PULL-UPS\n15-m FRONT RACK DUMBBELL WALKING LUNGES\n18 HANDSTAND PUSH-UPS\n15 CHEST-TO-BARS PULL-UPS\n15-m FRONT RACK DUMBBELL WALKING LUNGES\n15 HANDSTAND PUSH-UPS\n12 CHEST-TO-BARS PULL-UPS\n15-m FRONT RACK DUMBBELL WALKING LUNGES\n12 HANDSTAND PUSH-UPS\n9 CHEST-TO-BARS PULL-UPS\n15-m FRONT RACK DUMBBELL WALKING LUNGES\n9 HANDSTAND PUSH-UPS\nDUMBBELL - 2x22.5/15 KG\nTIME CAP 18 MINUTES\nTARGET <14 MINUTES`;
  const result = normalizeExplicitForTimeRoundTable(raw, source);
  assert.equal(result.workout.structure.type, "sequence");
  assert.equal(result.workout.structure.items.length, 5);
  assert.deepEqual(result.workout.structure.items.map(round => round.items.map(item => item.prescription)), [
    ["21", "15 m", "21"], ["18", "15 m", "18"], ["15", "15 m", "15"],
    ["12", "15 m", "12"], ["9", "15 m", "9"],
  ]);
  assert.equal(result.workout.structure.items[0].label, "RONDA 1");
  assert.equal(result.workout.movements[1].load, "2 × 22.5/15 kg");
  assert.equal("repProgression" in result.workout.structure.items[0].items[0], false);
  assert.equal(result.workout.description, "Objetivo: <14 min");
});

test("leaves a For Time structure untouched when source rows do not match all movements", () => {
  const raw = {
    workout: {
      format: "for_time",
      movements: [{ id: "pullups", name: "Pull-Ups" }, { id: "pushups", name: "Push-Ups" }],
      structure: { type: "sequence", items: [] },
    },
  };
  assert.equal(normalizeExplicitForTimeRoundTable(raw, "21 Pull-Ups\n18 Pull-Ups"), raw);
});


test("normalizes aligned repetitions and per-round loads written across movement rows", () => {
  const raw = {
    workout: {
      format: "for_time",
      description: "",
      movements: [
        { id: "db-bench-press", name: "DB Bench Press", prescription: "30", load: "25/30/35 kg" },
        { id: "bar-muscle-ups", name: "Bar Muscle-Ups", prescription: "15", load: null },
        { id: "sit-ups", name: "Sit-Ups", prescription: "30", load: null },
      ],
      structure: { type: "sequence", items: [] },
    },
  };
  const source = `-GIMNASTICOS
FOR TIME 14 MIN
30-20-10 DB BENCH PRESS 25/30/35 KG
15-10-5 BMU
30-30-30 SIT UPS`;
  const result = normalizeExplicitForTimeRoundTable(raw, source);
  assert.equal(result.workout.structure.items.length, 3);
  assert.deepEqual(result.workout.structure.items.map(round => round.items.map(item => item.prescription)), [
    ["30", "15", "30"], ["20", "10", "30"], ["10", "5", "30"],
  ]);
  assert.deepEqual(result.workout.structure.items.map(round => round.items[0].load), ["25 kg", "30 kg", "35 kg"]);
  assert.equal(result.workout.movements[0].load, null);
  assert.equal(result.workout.movements[1].prescription, null);
});

test("infers an explicit workout format from model description when OCR text is unavailable", () => {
  assert.equal(inferExplicitWorkoutFormat("", "FOR TIME 14 MIN", "GIMNÁSTICOS"), "for_time");
  assert.equal(inferExplicitWorkoutFormat("", "AMRAP 12 MIN"), "amrap");
  assert.equal(inferExplicitWorkoutFormat("", "E2MOM 10 MIN"), "e2mom");
  assert.equal(inferExplicitWorkoutFormat("", "custom workout"), null);
});


test("recovers omitted workout format from coherent structure and timer without another AI request", () => {
  assert.equal(inferWorkoutFormatFromStructure(
    { structure: { type: "sequence" } },
    { type: "sequence", blocks: [{ type: "countup", label: "For Time", timeCapSeconds: 840 }] }
  ), "for_time");
  assert.equal(inferWorkoutFormatFromStructure(
    { structure: { type: "rounds" } },
    { type: "sequence", blocks: [{ type: "countup", label: "For Time", rounds: 5 }] }
  ), "rounds_for_time");
  assert.equal(inferWorkoutFormatFromStructure(
    { structure: { type: "sequence" } },
    { type: "sequence", blocks: [{ type: "countdown", label: "AMRAP" }] }
  ), null);
  assert.equal(inferWorkoutFormatFromStructure(
    { structure: { type: "sequence" } }, null
  ), null);
});

test("normalizes fixed For Time rounds from aligned rows when one movement has constant reps", () => {
  const raw = {
    title: "NUEVO WOD",
    workout: {
      format: "custom",
      description: "",
      movements: [
        { id: "db-bench-press", name: "DB Bench Press", prescription: "30-20-10", load: "25/30/35 kg" },
        { id: "bar-muscle-ups", name: "Bar Muscle-Ups", prescription: "15-10-5", load: null },
        { id: "sit-ups", name: "Sit-Ups", prescription: "30", load: null },
      ],
      structure: { type: "sequence", items: [
        { type: "rounds", count: 1, label: "RONDA 1", items: [] },
        { type: "rounds", count: 1, label: "RONDA 2", items: [] },
        { type: "rounds", count: 1, label: "RONDA 3", items: [] },
      ] },
    },
    timer: { type: "sequence", label: "For Time", blocks: [{ type: "countup", label: "For Time", timeCapSeconds: 840 }] },
  };
  const result = normalizeExplicitForTimeRoundTable(raw, "");
  assert.equal(result.workout.format, "for_time");
  assert.deepEqual(result.workout.structure.items.map(round => round.items.map(item => item.prescription)), [
    ["30", "15", "30"], ["20", "10", "30"], ["10", "5", "30"],
  ]);
  assert.deepEqual(result.workout.structure.items.map(round => round.items[0].load), ["25 kg", "30 kg", "35 kg"]);
  assert.equal(result.workout.movements[0].prescription, null);
  assert.equal(result.workout.movements[0].load, null);
});

test("normalizes aligned source rows with a scalar movement repeated across rounds", () => {
  const raw = {
    workout: {
      format: "for_time",
      description: "",
      movements: [
        { id: "db-bench-press", name: "DB Bench Press", prescription: null, load: null },
        { id: "bar-muscle-ups", name: "Bar Muscle-Ups", prescription: null, load: null },
        { id: "sit-ups", name: "Sit-Ups", prescription: null, load: null },
      ],
      structure: { type: "sequence", items: [] },
    },
    timer: { type: "sequence", label: "For Time", blocks: [{ type: "countup", label: "For Time", timeCapSeconds: 840 }] },
  };
  const source = "FOR TIME 14 MIN\n30-20-10 DB BENCH PRESS 25/30/35 KG\n15-10-5 BMU\n30 SIT UPS";
  const result = normalizeExplicitForTimeRoundTable(raw, source);
  assert.deepEqual(result.workout.structure.items.map(round => round.items.map(item => item.prescription)), [
    ["30", "15", "30"], ["20", "10", "30"], ["10", "5", "30"],
  ]);
  assert.deepEqual(result.workout.structure.items.map(round => round.items[0].load), ["25 kg", "30 kg", "35 kg"]);
});

test("does not treat a bulleted category heading as a WOD title", () => {
  assert.equal(inferWorkoutTitle("-GIMNÁSTICOS\nFOR TIME 14 MIN\n30-20-10 DB BENCH PRESS"), null);
  assert.equal(inferWorkoutTitle("• GIMNÁSTICOS\nFOR TIME 14 MIN"), null);
  assert.equal(inferWorkoutTitle("FOR TIME 14 MIN"), null);
});


test("uses the default title for category headings, not workout names", () => {
  assert.equal(normalizeWorkoutTitle("GIMNASTICOS"), "NUEVO WOD");
  assert.equal(normalizeWorkoutTitle("Gimnásticos"), "NUEVO WOD");
  assert.equal(normalizeWorkoutTitle("-GIMNÁSTICOS"), "NUEVO WOD");
  assert.equal(normalizeWorkoutTitle("WEIGHTLIFTING"), "NUEVO WOD");
  assert.equal(normalizeWorkoutTitle("FRAN"), "FRAN");
  assert.equal(normalizeWorkoutTitle("NUEVO WOD"), "NUEVO WOD");
});


test("reconstructs Ladder reps and per-round loads from source transcription", () => {
  const raw = {
    title: "NUEVO WOD",
    workout: {
      format: "ladder",
      movements: [
        { id: "db-bench", name: "DB Bench Press", prescription: "30-20-10", load: "25 kg" },
        { id: "bmu", name: "Bar Muscle-Up", prescription: "15-10-5", load: null },
        { id: "situps", name: "Sit-Ups", prescription: "30-20-10", load: null },
      ],
      structure: { type: "ladder", direction: "descending", steps: [] },
    },
  };
  const source = "-GIMNASTICOS\\nFOR TIME 14 MIN\\n30-20-10 DB BENH PRESS 25/30/35 KG\\n15-10-5 BMU\\n30-30-30 SIT UPS";
  const result = normalizeExplicitLadderRoundTable(raw.workout, source);
  assert.equal(result.structure.steps.length, 3);
  assert.deepEqual(result.structure.steps.map(step => step.items.map(item => item.prescription)), [
    ["30", "15", "30"], ["20", "10", "30"], ["10", "5", "30"],
  ]);
  assert.deepEqual(result.structure.steps.map(step => step.items[0].load), [
    "25 kg", "30 kg", "35 kg",
  ]);
  assert.equal(result.movements[0].load, null);
  assert.equal(result.movements[2].prescription, "30");
});

test("expands a Ladder catalogue progression into per-round movement prescriptions and loads", () => {
  const raw = {
    title: "NUEVO WOD",
    workout: {
      format: "ladder",
      description: "FOR TIME 14 MIN",
      movements: [
        { id: "db-bench-press", name: "DB Bench Press", prescription: "30-20-10", load: "25/30/35 kg" },
        { id: "bar-muscle-ups", name: "Bar Muscle-Ups", prescription: "15-10-5", load: null },
        { id: "sit-ups", name: "Sit-Ups", prescription: "30-30-30", load: null },
      ],
      structure: {
        type: "ladder",
        direction: "descending",
        steps: [
          { label: "Ronda 1", items: [] },
          { label: "Ronda 2", items: [] },
          { label: "Ronda 3", items: [] },
        ],
      },
    },
  };
  const result = normalizeExplicitLadderRoundTable(raw, "LADDER\nFOR TIME 14 MIN");
  assert.equal(result.workout.format, "ladder");
  assert.equal(result.workout.structure.steps.length, 3);
  assert.deepEqual(result.workout.structure.steps.map(step => step.items.map(item => item.prescription)), [
    ["30", "15", "30"], ["20", "10", "30"], ["10", "5", "30"],
  ]);
  assert.deepEqual(result.workout.structure.steps.map(step => step.items[0].load), [
    "25 kg", "30 kg", "35 kg",
  ]);
  assert.equal(result.workout.movements[0].prescription, null);
  assert.equal(result.workout.movements[0].load, null);
  assert.equal(result.workout.movements[1].prescription, null);
  assert.equal(result.workout.movements[2].prescription, "30");
});

test("rebuilds a single flattened Ladder round header from aligned catalogue progressions", () => {
  const raw = {
    workout: {
      format: "ladder",
      movements: [
        { id: "db-bench-press", name: "DB Bench Press", prescription: "30-20-10", load: "25/30/35 kg" },
        { id: "bar-muscle-ups", name: "Bar Muscle-Ups", prescription: "15-10-5", load: null },
        { id: "sit-ups", name: "Sit-Ups", prescription: "30", load: null },
      ],
      structure: {
        type: "sequence",
        items: [{ type: "rounds", count: 1, label: "RONDA 1", items: [
          { type: "movement", movementId: "db-bench-press" },
          { type: "movement", movementId: "bar-muscle-ups" },
          { type: "movement", movementId: "sit-ups" },
        ] }],
      },
    },
  };
  const result = normalizeExplicitLadderRoundTable(raw.workout, "LADDER");
  assert.equal(result.workout.structure.type, "ladder");
  assert.equal(result.workout.structure.steps.length, 3);
  assert.deepEqual(result.workout.structure.steps.map(step => step.items.map(item => item.prescription)), [
    ["30", "15", "30"], ["20", "10", "30"], ["10", "5", "30"],
  ]);
});

