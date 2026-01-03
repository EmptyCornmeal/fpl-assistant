// Point directly at your deployed Cloudflare Worker (works in dev & prod)
// Allow overrides via window.__FPL_API_BASE__ to avoid mismatched origins.
export const API_BASE =
  (typeof window !== "undefined" && window.__FPL_API_BASE__) ||
  "https://fpl-proxy.myles-fpl-proxy.workers.dev/api";

// Tiny in-memory cache for static-ish endpoints (bootstrap, elementSummary, etc.)
const cache = new Map();

async function getJSON(url, { live = false } = {}) {
  // Bypass cache for live endpoints and add a cache-buster
  const finalUrl = live
    ? `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`
    : url;

  if (!live && cache.has(finalUrl)) return cache.get(finalUrl);

  const res = await fetch(finalUrl, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(
      `HTTP ${res.status} ${res.statusText} for ${finalUrl} :: ${text.slice(0, 200)}`
    );
  }
  const data = await res.json();
  if (!live) cache.set(finalUrl, data);
  return data;
}

export const api = {
  // rewritten endpoints (no "/event" in the client URL)
  bootstrap:        () => getJSON(`${API_BASE}/bs`),
  elementSummary:   (id)      => getJSON(`${API_BASE}/es/${id}`),

  // Live scoring + status (no caching)
  eventStatus:      ()        => getJSON(`${API_BASE}/ev/status`,     { live: true }),
  eventLive:        (gw)      => getJSON(`${API_BASE}/ev/${gw}/live`, { live: true }),

  entry:            (id)      => getJSON(`${API_BASE}/en/${id}`),
  entryHistory:     (id)      => getJSON(`${API_BASE}/en/${id}/history`),
  entryPicks:       (id, gw)  => getJSON(`${API_BASE}/ep/${id}/${gw}/picks`),

  fixtures:         (eventId) => getJSON(eventId ? `${API_BASE}/fx/${eventId}` : `${API_BASE}/fx`),
  leagueClassic:    (lid, p=1)=> getJSON(`${API_BASE}/lc/${lid}/${p}`),

  // Health check (useful during setup)
  up:               ()        => getJSON(`${API_BASE}/up`, { live: true }),

  clearCache: () => cache.clear(),
};
