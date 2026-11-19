import test from "node:test";
import assert from "node:assert/strict";
import { buildGroqUserContent, canUseGroqVision, isTransientProviderStatus, parseProviderRetryDelayMs } from "../supabase/functions/interpret-wod/provider-retry.js";

test("marks only transient provider and gateway responses for retry", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(isTransientProviderStatus(status), true);
  for (const status of [200, 400, 401, 403, 404, 422]) assert.equal(isTransientProviderStatus(status), false);
});

test("reads retry delays from headers and provider error messages", () => {
  assert.equal(parseProviderRetryDelayMs("2"), 2000);
  assert.equal(parseProviderRetryDelayMs(null, "Please retry in 1.5s."), 1500);
  assert.equal(parseProviderRetryDelayMs(null, "try again in 250ms"), 250);
  assert.equal(parseProviderRetryDelayMs(null, "no timing provided"), null);
});

test("builds Groq vision input with the image and prompt", () => {
  assert.deepEqual(buildGroqUserContent("Interpret the WOD", { mimeType: "image/png", data: "abc123" }), [
    { type: "text", text: "Interpret the WOD" },
    { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
  ]);
  assert.equal(buildGroqUserContent("Interpret the text"), "Interpret the text");
});

test("only sends supported image types to the Groq vision fallback", () => {
  assert.equal(canUseGroqVision({ mimeType: "image/jpeg", data: "abc" }), true);
  assert.equal(canUseGroqVision({ mimeType: "image/png", data: "abc" }), true);
  assert.equal(canUseGroqVision({ mimeType: "image/heic", data: "abc" }), false);
  assert.equal(canUseGroqVision({ mimeType: "image/png", data: "" }), false);
});
