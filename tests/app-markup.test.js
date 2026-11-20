import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("all timer controls referenced during app initialization exist in the page", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["pauseButton", "finishButton", "resetButton", "skipButton", "backButton"]) {
    assert.match(html, new RegExp('id="' + id + '"'), "Missing timer control: " + id);
  }
});
