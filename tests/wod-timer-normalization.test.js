import test from "node:test";
import assert from "node:assert/strict";
import { removeUnsupportedCountupStages } from "../supabase/functions/interpret-wod/wod-timer-normalization.js";

test("removes invented invalid stages from an ordinary For Time cap", () => {
  const timer = { type: "sequence", label: "For Time", blocks: [{
    type: "countup", label: "For Time", timeCapSeconds: 1080, rounds: null,
    stages: [{ label: "Round 1", durationSeconds: 60 }, { label: "Round 2", durationSeconds: 60 }],
  }] };
  const result = removeUnsupportedCountupStages(timer, "for_time", `FOR TIME
TIME CAP 18 MINUTES`);
  assert.equal("stages" in result.blocks[0], false);
  assert.equal(result.blocks[0].timeCapSeconds, 1080);
});

test("preserves explicit clock stages that align with the cap", () => {
  const timer = { type: "sequence", label: "For Time", blocks: [{
    type: "countup", timeCapSeconds: 360, stages: [{ label: "Bike", durationSeconds: 300 }, { label: "Run", durationSeconds: 60 }],
  }] };
  const result = removeUnsupportedCountupStages(timer, "for_time", `RUNNING CLOCK 6 MINUTES
0'-5'
Bike
5'-6'
Run`);
  assert.deepEqual(result.blocks[0].stages, timer.blocks[0].stages);
});

test("leaves explicit but inconsistent source stages for validation", () => {
  const timer = { type: "sequence", label: "For Time", blocks: [{
    type: "countup", timeCapSeconds: 360, stages: [{ label: "Bike", durationSeconds: 300 }],
  }] };
  const result = removeUnsupportedCountupStages(timer, "for_time", `RUNNING CLOCK 6 MINUTES
0'-5'
Bike`);
  assert.deepEqual(result, timer);
});
