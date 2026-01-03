const ALLOWED_ORIGINS = [
  "https://emptycornmeal.github.io",
  "https://emptycornmeal.github.io/fpl-assistant",
  "http://localhost:4173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
];

function resolveOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

function buildCorsHeaders(request, extra = {}) {
  return {
    "Access-Control-Allow-Origin": resolveOrigin(request),
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    ...extra,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ----- CORS preflight -----
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(request),
      });
    }

    // Health ping
    if (url.pathname === "/api/up") {
      return json(request, 200, { ok: true, ts: Date.now() });
    }

    // Non-API paths → simple OK
    if (!url.pathname.startsWith("/api/")) {
      return new Response("OK", {
        status: 200,
        headers: buildCorsHeaders(request, {
          "Cache-Control": "no-store",
          "CDN-Cache-Control": "no-store",
        })
      });
    }

    // Map friendly path to FPL API path
    const sub = url.pathname.slice(5); // strip "/api/"
    const mapped = mapPath(sub);
    if (!mapped.ok) {
      return json(request, 404, { error: "Unknown API path", sub, hint: mapped.hint });
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
      const corsHeaders = buildCorsHeaders(request, {
        "Cache-Control": "no-store",
        "CDN-Cache-Control": "no-store",
      });
      Object.entries(corsHeaders).forEach(([k, v]) => h.set(k, v));
      if (!h.has("Content-Type")) h.set("Content-Type", "application/json; charset=utf-8");

      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    } catch (err) {
      return json(request, 502, {
        error: "Upstream fetch failed",
        details: String(err?.message || err),
        upstream: upstream.toString()
      });
    }
  }
};

/* ---------------- helpers ---------------- */
function json(request, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: buildCorsHeaders(request, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
    })
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
