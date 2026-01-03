const APP_VERSION = "1.2.0";
const STATIC_CACHE = `cache-v${APP_VERSION}`;
const DATA_CACHE = `data-v${APP_VERSION}`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/main.js",
  "./js/api.js",
  "./js/api/fplClient.js",
  "./js/api/fetchHelper.js",
  "./js/state.js",
  "./js/utils.js",
  "./js/logger.js",
  "./js/components/tooltip.js",
  "./js/pages/portal.js",
  "./js/pages/my-team.js",
  "./js/pages/all-players.js",
  "./js/pages/fixtures.js",
  "./js/pages/gw-explorer.js",
  "./js/pages/mini-league.js",
  "./js/pages/stat-picker.js",
  "./js/pages/planner.js",
  "./js/pages/meta.js",
  "./js/pages/help.js",
  "./js/pages/index.js",
  "./favicon.png",
];

let lastBroadcastStatus = null;

async function broadcastStatus(status, detail = "") {
  if (status === lastBroadcastStatus && !detail) return;
  lastBroadcastStatus = status;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: "api-status", status, detail }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.addAll(CORE_ASSETS);
        await broadcastStatus("updating", "Caching shell for offline use…");
      } catch (err) {
        console.error("Service worker: pre-cache failed", err);
        await broadcastStatus("offline", "Offline cache incomplete");
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => (key.startsWith("cache-v") || key.startsWith("data-v")) && key !== STATIC_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      );
      await broadcastStatus("live", "Offline cache ready");
      await self.clients.claim();
    })()
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    return response;
  } catch (err) {
    await broadcastStatus("offline", "Offline — asset unavailable");
    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
      await broadcastStatus("live");
      return response;
    }
  } catch (err) {
    // fall through to cache
  }

  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    await broadcastStatus("offline", "Serving cached shell");
    return cached;
  }

  return new Response("Offline", {
    status: 503,
    headers: { "Content-Type": "text/plain" },
  });
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status || "fail"}`);
      }
      cache.put(request, response.clone());
      await broadcastStatus("live");
      return response;
    })
    .catch(async () => {
      await broadcastStatus("offline", "API unreachable; using cache");
      if (cached) return cached;
      throw new Error("Network failure");
    });

  if (cached) {
    // Update cache in background
    networkPromise.catch(() => null);
    return cached;
  }

  try {
    return await networkPromise;
  } catch {
    return new Response(JSON.stringify({ ok: false, message: "Offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const accept = request.headers.get("accept") || "";

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (accept.includes("application/json") || url.pathname.startsWith("/api/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});
