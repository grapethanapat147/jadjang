/*
 * Service worker for จัดแจง.
 *
 * Hand-written rather than generated: the build has no asset manifest to read,
 * and it does not need one. Everything under /_next/static/ is content-hashed
 * and served immutable, so a cached copy is always the right copy, and anything
 * that is not hashed is small enough to revalidate in the background.
 *
 * Offline matters here beyond convenience — the product's promise is that files
 * never leave the device, and an app that still works with the network off
 * demonstrates that rather than asserting it.
 */

const CACHE = "jadjang-v1";

const PRECACHE = [
  "/",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
  "/tool-icons/organize.png",
  "/tool-icons/merge.png",
  "/tool-icons/split.png",
  "/tool-icons/compress.png",
  "/tool-icons/convert.png",
];

/**
 * Which caching strategy a request should use.
 *
 * Kept as a plain function of (request, origin) so it can be exercised without
 * a browser — it is the part most likely to be wrong.
 */
function strategyFor(request, pageOrigin) {
  if (request.method !== "GET") {
    return "bypass";
  }

  const url = new URL(request.url);
  if (url.origin !== pageOrigin) {
    return "bypass";
  }

  // The HTML names the hashed chunks, so a stale copy would point at files that
  // no longer exist after a deploy. Only fall back to cache when offline.
  if (request.mode === "navigate") {
    return "network-first";
  }

  // Content-hashed and immutable: a hit can never be stale.
  if (url.pathname.startsWith("/_next/static/")) {
    return "cache-first";
  }

  return "stale-while-revalidate";
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    // A deep link opened offline still gets the app shell.
    const shell = await cache.match("/");
    if (shell) {
      return shell;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fromNetwork = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || fromNetwork;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Added one at a time: a single missing entry must not fail the install.
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy === "bypass") {
    return;
  }
  if (strategy === "network-first") {
    event.respondWith(networkFirst(event.request));
  } else if (strategy === "cache-first") {
    event.respondWith(cacheFirst(event.request));
  } else {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});
