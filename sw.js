// Keep VERSION in step with APP_BUILD in ./src/version.js.
// The Settings dialog shows APP_BUILD so a stale cached build is visible at a
// glance — "deployed" and "running on the device" are not the same thing.
const VERSION = "2026.09.05-release";
const CACHE_NAME = `grove-${VERSION}`;

// Required to run. addAll() is deliberate here: if one of these is missing the
// install must fail loudly rather than activate a half-cached shell.
const APP_SHELL = [
  "./",
  "./index.html",
  "./assets/app.css",
  "./assets/fonts/lexend-400.woff2",
  "./assets/fonts/lexend-700.woff2",
  "./src/app.js",
  "./src/version.js",
  "./src/model.js",
  "./src/store.js",
  "./src/sync.js",
  "./src/sync-runner.js",
  "./src/journal.js",
  "./src/journal-record.js",
  "./src/activity-session.js",
  "./src/history.js",
  "./src/formats.js",
  "./src/markdown.js",
  "./src/mode-policy.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// Nice to have offline, but not worth blocking an install over.
// The shared sync module lives in another repository on the same origin.
const OPTIONAL_SHELL = [
  "./docs/README-KO.md",
  "../shared/v1/sync.js",
  "../shared/v2/journal.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // cache: 'reload' bypasses the browser's own HTTP cache — without it, a
    // recently-visited asset can still be HTTP-cache-fresh and get copied
    // straight into the new versioned CACHE_NAME unchanged, silently
    // defeating the whole point of bumping VERSION on a real edit.
    await Promise.all(APP_SHELL.map(async (url) => {
      const response = await fetch(new Request(url, { cache: "reload" }));
      if (!response.ok) throw new Error(`Could not cache ${url}: ${response.status}`);
      await cache.put(url, response);
    }));
    await Promise.all(OPTIONAL_SHELL.map((url) => fetch(new Request(url, { cache: "reload" }))
      .then((response) => (response.ok ? cache.put(url, response) : null))
      .catch(() => null)));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("grove-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // Cross-origin requests are left entirely alone. Sync talks to
  // https://api.github.com; if this handler answered those from the cache,
  // every GET (read) would fail while PUT/DELETE (write) still went through —
  // an upload would then see "no remote file", merge against nothing and
  // overwrite real maps with an empty list.
  if (new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function networkFirstNavigation(request) {
  try {
    const response = await withTimeout(fetch(request), 3500);
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put("./index.html", response.clone());
    }
    return response;
  } catch {
    return await caches.match(request)
      || await caches.match("./index.html")
      || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && new URL(request.url).origin === self.location.origin) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

function withTimeout(promise, milliseconds) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Network timeout")), milliseconds)),
  ]);
}
