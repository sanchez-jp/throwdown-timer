const CACHE_PREFIX = "throwdown-timer-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v105`;
const APP_SHELL = [
  "",
  "index.html",
  "manifest.webmanifest",
  "assets/icon.svg",
  "assets/favicon-32.png",
  "assets/apple-touch-icon.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "src/styles.css?v=85",
  "src/app.js?v=47",
  "src/audio-cues.js",
  "src/timer-engine.js",
  "src/timer-plan-builder.js",
  "src/timer-description.js",
  "src/workout-repository.js",
  "src/wod-validator.js",
  "src/wod-migration.js",
  "src/ai-client.js"
].map((path) => new URL(path, self.registration.scope).toString());

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (requestUrl.origin !== scopeUrl.origin || !requestUrl.href.startsWith(scopeUrl.href)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        const cacheKey = request.mode === "navigate"
          ? new URL("index.html", scopeUrl).toString()
          : request;
        await cache.put(cacheKey, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        return (await caches.match(new URL("index.html", scopeUrl).toString()))
          || (await caches.match(new URL("", scopeUrl).toString()));
      }
      return new Response("Recurso no disponible sin conexión.", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
