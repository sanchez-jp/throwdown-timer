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


test("prefers the independent Gemini model for image corrections before Groq", async () => {
  const { buildCorrectionCandidates } = await import("../supabase/functions/interpret-wod/provider-retry.js");
  assert.deepEqual(buildCorrectionCandidates({
    selectedProvider: "gemini",
    selectedModel: "gemini-primary",
    geminiModels: ["gemini-primary", "gemini-fallback"],
    groqAvailable: true,
    groqModel: "qwen-vision",
    preferGeminiFallback: true,
  }), [
    { provider: "gemini", model: "gemini-fallback" },
    { provider: "groq", model: "qwen-vision" },
  ]);
});

test("keeps Groq first for text corrections and uses Gemini if it is unavailable", async () => {
  const { buildCorrectionCandidates } = await import("../supabase/functions/interpret-wod/provider-retry.js");
  assert.deepEqual(buildCorrectionCandidates({
    selectedProvider: "gemini",
    selectedModel: "gemini-primary",
    geminiModels: ["gemini-primary", "gemini-fallback"],
    groqAvailable: true,
    groqModel: "groq-text",
  }), [
    { provider: "groq", model: "groq-text" },
    { provider: "gemini", model: "gemini-fallback" },
  ]);
});

test("uses Gemini as the correction fallback when Groq produced the initial result", async () => {
  const { buildCorrectionCandidates } = await import("../supabase/functions/interpret-wod/provider-retry.js");
  assert.deepEqual(buildCorrectionCandidates({
    selectedProvider: "groq",
    selectedModel: "groq-text",
    geminiModels: ["gemini-primary", "gemini-fallback"],
    groqAvailable: true,
    groqModel: "groq-text",
  }), [{ provider: "gemini", model: "gemini-primary" }]);
});
