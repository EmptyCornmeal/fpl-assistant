const SW_VERSION = "2024.10.08";
const STATIC_CACHE = `static-${SW_VERSION}`;
const DATA_CACHE_PREFIX = `data-${SW_VERSION}-`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/main.js",
  "./js/api.js",
  "./js/api/fplClient.js",
  "./js/api/fetchHelper.js",
  "./js/config.js",
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

function dataCacheName(host) {
  return `${DATA_CACHE_PREFIX}${host}`;
}

async function purgeOldCaches(currentApiHost = null) {
  const keys = await caches.keys();
  await Promise.all(
    keys.map((key) => {
      const isStatic = key === STATIC_CACHE;
      const isDataCache = key.startsWith(DATA_CACHE_PREFIX);
      const isCurrentData = isDataCache && currentApiHost && key === dataCacheName(currentApiHost);
      if (isStatic || isCurrentData) return Promise.resolve();
      if (isDataCache && !currentApiHost) return Promise.resolve();
      return caches.delete(key);
    })
  );
}

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
      await purgeOldCaches();
      await broadcastStatus("live", "Offline cache ready");
      await self.clients.claim();
    })()
  );
});

async function networkFirstDocument(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
      await broadcastStatus("live");
      return response;
    }
  } catch {
    // fall through
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

async function staleWhileRevalidateStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
        await broadcastStatus("live");
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => null);
    return cached;
  }

  const fresh = await networkPromise;
  if (fresh) return fresh;

  return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
}

async function networkFirstApi(request) {
  const url = new URL(request.url);
  const apiHost = url.host;
  await purgeOldCaches(apiHost);

  const cache = await caches.open(dataCacheName(apiHost));
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
      await broadcastStatus("live");
      return response;
    }
  } catch {
    // fall through to cache
  }

  const cached = await cache.match(request);
  if (cached) {
    await broadcastStatus("offline", "Serving cached API response");
    return cached;
  }

  return new Response(JSON.stringify({ ok: false, message: "Offline" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Only handle same-origin API requests
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirstDocument(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidateStatic(request));
  }
});
