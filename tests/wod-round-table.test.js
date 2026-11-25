import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExplicitForTimeRoundTable } from "../supabase/functions/interpret-wod/wod-round-table.js";

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
