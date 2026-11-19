import test from "node:test";
import assert from "node:assert/strict";
import { isTransientProviderStatus, parseProviderRetryDelayMs } from "../supabase/functions/interpret-wod/provider-retry.js";

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
