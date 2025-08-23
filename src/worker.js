export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ----- CORS preflight -----
    if (request.method === "OPTIONS") {
      const allowHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type";
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": allowHeaders,
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin",
        }
      });
    }

    // Health ping
    if (url.pathname === "/api/up") {
      return json(200, { ok: true, ts: Date.now() });
    }

    // Non-API paths → simple OK
    if (!url.pathname.startsWith("/api/")) {
      return new Response("OK", {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "CDN-Cache-Control": "no-store",
          "Vary": "Origin"
        }
      });
    }

    // Map friendly path to FPL API path
    const sub = url.pathname.slice(5); // strip "/api/"
    const mapped = mapPath(sub);
    if (!mapped.ok) {
      return json(404, { error: "Unknown API path", sub, hint: mapped.hint });
    }

    // Build upstream URL and preserve querystring only if rule didn't add one
    const upstream = new URL(`https://fantasy.premierleague.com/api/${mapped.path}`);
    if (!upstream.search && url.search) upstream.search = url.search;

    try {
      const r = await fetch(upstream.toString(), {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FPL-Dashboard/1.0)",
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Origin": "https://fantasy.premierleague.com",
          "Referer": "https://fantasy.premierleague.com/"
        },
        cf: { cacheTtl: 0, cacheEverything: false }
      });

      const h = new Headers(r.headers);
      h.set("Access-Control-Allow-Origin", "*");
      h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      h.set("Access-Control-Allow-Headers", "Content-Type");
      h.set("Cache-Control", "no-store");
      h.set("CDN-Cache-Control", "no-store");
      h.set("Vary", "Origin");
      if (!h.has("Content-Type")) h.set("Content-Type", "application/json; charset=utf-8");

      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    } catch (err) {
      return json(502, {
        error: "Upstream fetch failed",
        details: String(err?.message || err),
        upstream: upstream.toString()
      });
    }
  }
};

/* ---------------- helpers ---------------- */
function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Vary": "Origin"
    }
  });
}

/**
 * Friendly → FPL API path mapper.
 * Ensures trailing slashes where FPL expects them (avoids 301s/CORS).
 */
function mapPath(sub) {
  const rules = [
    // Bootstrap & element summaries
    [/^bs\/?$/,                     () => "bootstrap-static/"],
    [/^es\/(\d+)\/?$/,              m => `element-summary/${m[1]}/`],

    // Live scoring + status
    [/^ev\/(\d+)\/live\/?$/,        m => `event/${m[1]}/live/`],
    [/^ev\/status\/?$/,             () => "event-status/"],

    // Entry & picks
    [/^ep\/(\d+)\/(\d+)\/picks\/?$/, m => `entry/${m[1]}/event/${m[2]}/picks/`],
    [/^en\/(\d+)\/?$/,               m => `entry/${m[1]}/`],
    [/^en\/(\d+)\/history\/?$/,      m => `entry/${m[1]}/history/`],

    // Fixtures (optionally by event)
    [/^fx\/?$/,                     () => "fixtures/"],
    [/^fx\/(\d+)\/?$/,              m => `fixtures/?event=${m[1]}`],

    // Classic leagues (paginated)
    [/^lc\/(\d+)\/(\d+)\/?$/,       m => `leagues-classic/${m[1]}/standings/?page_standings=${m[2]}`],
  ];

  for (const [re, to] of rules) {
    const m = sub.match(re);
    if (m) return { ok: true, path: to(m) };
  }
  return { ok: false, hint: "Unknown pattern. Example: ev/2/live, ev/status, bs, es/1, en/12345" };
}
