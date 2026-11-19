const TRANSIENT_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export function isTransientProviderStatus(status) {
  return TRANSIENT_STATUS_CODES.has(status);
}

export function canUseGroqVision(image) {
  return Boolean(image && ["image/jpeg", "image/png", "image/webp"].includes(image.mimeType) &&
    typeof image.data === "string" && image.data.length > 0);
}

export function buildGroqUserContent(prompt, image = null) {
  if (!image) return prompt;
  return [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
  ];
}

export function parseProviderRetryDelayMs(retryAfter, body = "", nowMs = Date.now()) {
  if (typeof retryAfter === "string" && retryAfter.trim()) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);
  }
  if (typeof body !== "string") return null;
  const match = body.match(/(?:retry(?:\s+again)?\s+(?:after|in)|try again in|"retryDelay"\s*:\s*")\s*([\d.]+)\s*(ms|msec|milliseconds?|s|sec|seconds?)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.ceil(amount * (/^m/i.test(match[2]) ? 1 : 1000));
}
