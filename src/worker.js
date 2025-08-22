export default {
    async fetch(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) {
        return new Response("OK", { status: 200 });
      }
  
      // Strip /api/ and rewrite friendly paths -> real FPL paths
      const sub = url.pathname.slice(5); // after "/api/"
      const rules = [
        [/^bs\/?$/,                  m => "bootstrap-static/"],
        [/^es\/(\d+)\/?$/,          m => `element-summary/${m[1]}/`],
        // avoid "/event/" in client URL
        [/^ev\/(\d+)\/live\/?$/,    m => `event/${m[1]}/live/`],
        // avoid "/entry/.../event/..."
        [/^ep\/(\d+)\/(\d+)\/picks\/?$/, m => `entry/${m[1]}/event/${m[2]}/picks/`],
        [/^en\/(\d+)\/?$/,          m => `entry/${m[1]}/`],
        [/^en\/(\d+)\/history\/?$/, m => `entry/${m[1]}/history/`],
        [/^fx\/?$/,                 m => "fixtures/"],
        [/^fx\/(\d+)\/?$/,          m => `fixtures/?event=${m[1]}`],
        [/^lc\/(\d+)\/(\d+)\/?$/,   m => `leagues-classic/${m[1]}/standings/?page_standings=${m[2]}`],
      ];
  
      let upstreamPath = sub;
      for (const [re, to] of rules) {
        const m = sub.match(re);
        if (m) { upstreamPath = to(m); break; }
      }
  
      const upstream = `https://fantasy.premierleague.com/api/${upstreamPath}${url.search}`;
  
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400"
          }
        });
      }
  
      const r = await fetch(upstream, { method: "GET" });
      const hdrs = new Headers(r.headers);
      hdrs.set("Access-Control-Allow-Origin", "*");
      hdrs.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      hdrs.set("Access-Control-Allow-Headers", "Content-Type");
      hdrs.set("Cache-Control", "no-store");
  
      return new Response(r.body, { status: r.status, headers: hdrs });
    }
  };
  