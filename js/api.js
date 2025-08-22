// Use the Worker (no local proxy) with ad-blocker-safe paths
const ORIGIN = "https://fpl-proxy.myles-fpl-proxy.workers.dev/api";

const cache = new Map();
async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const data = await res.json();
  cache.set(url, data);
  return data;
}

export const api = {
  // rewritten endpoints (no "/event" in the client URL)
  bootstrap:        () => getJSON(`${ORIGIN}/bs`),
  elementSummary:   (id)      => getJSON(`${ORIGIN}/es/${id}`),
  eventLive:        (gw)      => getJSON(`${ORIGIN}/ev/${gw}/live`),
  entry:            (id)      => getJSON(`${ORIGIN}/en/${id}`),
  entryHistory:     (id)      => getJSON(`${ORIGIN}/en/${id}/history`),
  entryPicks:       (id, gw)  => getJSON(`${ORIGIN}/ep/${id}/${gw}/picks`),
  fixtures:         (eventId) => getJSON(eventId ? `${ORIGIN}/fx/${eventId}` : `${ORIGIN}/fx`),
  leagueClassic:    (lid, p=1)=> getJSON(`${ORIGIN}/lc/${lid}/${p}`),
  clearCache: () => cache.clear(),
};
