const SW_VERSION = "2025.01.03";
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
  "./js/lib/images.js",
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
  "./assets/placeholder-player.svg",
];

// Known API path patterns to intercept (cross-origin or same-origin)
const API_PATH_PATTERNS = [
  /\/api\/bs\/?$/,          // bootstrap
  /\/api\/fx\/?/,           // fixtures
  /\/api\/en\/\d+/,         // entry
  /\/api\/ep\/\d+\/\d+/,    // entry picks
  /\/api\/es\/\d+/,         // element summary
  /\/api\/lc\/\d+/,         // league classic
  /\/api\/ev\/\d+\/live/,   // event live
  /\/api\/up\/?/,           // health check
  /\/api\/health\/?/,       // health check alias
];

let lastBroadcastStatus = null;

function isApiRequest(url) {
  try {
    const u = new URL(url);
    // Check if any API path pattern matches
    return API_PATH_PATTERNS.some(pattern => pattern.test(u.pathname));
  } catch {
    return false;
  }
}

function dataCacheName(host) {
  return `${DATA_CACHE_PREFIX}${host}`;
}

async function purgeOldCaches(currentApiHost = null) {
  const keys = await caches.keys();
  await Promise.all(
    keys.map((key) => {
      // Keep current static cache
      if (key === STATIC_CACHE) return Promise.resolve();

      // For data caches, keep only the current API host's cache
      const isDataCache = key.startsWith(DATA_CACHE_PREFIX) ||
                          key.startsWith("data-"); // Also match older version prefixes

      if (isDataCache) {
        // If we have a current API host, only keep its cache
        if (currentApiHost && key === dataCacheName(currentApiHost)) {
          return Promise.resolve();
        }
        // Delete old data caches
        return caches.delete(key);
      }

      // Delete any other old caches (old static versions, etc.)
      if (key.startsWith("static-") && key !== STATIC_CACHE) {
        return caches.delete(key);
      }

      return Promise.resolve();
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
        await broadcastStatus("updating", "Caching shell for offline use...");
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

// Network-first for document requests (ensures deploys propagate)
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

// Stale-while-revalidate for static assets
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

// Network-first for API requests (both same-origin and cross-origin)
async function networkFirstApi(request) {
  const url = new URL(request.url);
  const apiHost = url.host;

  // Purge old caches when API host changes
  await purgeOldCaches(apiHost);

  const cache = await caches.open(dataCacheName(apiHost));

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // Clone and cache the successful response
      cache.put(request, response.clone());
      await broadcastStatus("live");
      return response;
    }
  } catch {
    // Network failed, fall through to cache
  }

  // Try to serve from cache
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

  // Handle API requests (both same-origin and cross-origin)
  if (isApiRequest(request.url)) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // Handle same-origin /api/* requests (legacy pattern)
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // Handle document/navigation requests - network-first for deploy propagation
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(networkFirstDocument(request));
    return;
  }

  // Handle same-origin static assets
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidateStatic(request));
  }

  // Don't intercept other cross-origin requests (CDNs, fonts, etc.)
});
