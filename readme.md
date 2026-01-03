# FPL Assistant — Live-Aware Dashboard (2025/26)

A fast, client-side dashboard for Fantasy Premier League. It pulls official FPL data via a Cloudflare Worker proxy, shows **live gameweek** points, and includes planning, fixtures, meta analysis, and mini-league visualizations.

> **Author:** © Myles — All rights reserved.  
> **Demo (GitHub Pages):** `https://emptycornmeal.github.io/fpl-assistant/`

---

## Features

- **Live-aware**: shows `Last`, `Current (live/final)`, and `Next` GW in the header and across pages.
- **My Team**: last GW stats, current live points/minutes, **xP next** and **xP window**, fixtures strip, health/status, and a clean breakdown modal.
- **Fixtures**: matrix with official FDR or model **xFDR** (pos-aware), doubles/blank flags, swings, and a **horizontal difficulty chart** (easiest → hardest).
- **GW Explorer**: filterable live GW table (by team/position/starters/hauls/cards) + **Team of the Week** builder.
- **Planner**: suggests the best XI for the **next GW** and gives **one-for-one** transfer recommendations (xP against a configurable window).
- **Mini-League**: standings + **cumulative** and **per-GW** charts with translucent lines & hoverable points; supports multiple leagues.
- **Meta**: cross-league ownership (EO), **Template XI** by formation, **Template vs You**, **Captain EV**, and **EO vs xP** scatter. Includes a plain-English explainer.

---

## Architecture

- **Frontend**: vanilla JS + Chart.js, hash-based routing, no build step (just static hosting).
- **Proxy**: Cloudflare Worker with ad-blocker-safe paths under `/api` (e.g. `/api/bs`, `/api/ev/:gw/live`).
- **No secrets**: all calls are public FPL endpoints via the Worker.

### API Configuration

The app uses a configurable API base with the following resolution order:

1. **`window.__FPL_API_BASE__`** — runtime injection (highest priority)
2. **`localStorage.fpl.apiBase`** — user override
3. **Same-origin `/api`** — only if not GitHub Pages or file://
4. **Previously validated host** — from successful health check (stored in localStorage)

**Key file:** `js/config.js`
```js
// API base is resolved dynamically, no hardcoded hosts
import { getApiBase } from "./config.js";
const apiBase = getApiBase(); // Returns configured API base or null
```

**Local Development:**
Create `config.local.js` in the root directory to set a custom proxy:
```js
window.__FPL_API_BASE__ = "https://your-worker.example.com/api";
```

**Note:** The app gracefully handles missing API configuration by showing a setup banner. No hardcoded fallback hosts are used to avoid unreliable dependencies.

---

## Caching

- **Memory cache**: Fast in-session caching with configurable TTLs
- **localStorage**: Slim bootstrap (~500KB) instead of full (~5MB) to avoid quota errors
- **Service Worker**: Network-first for HTML (immediate deploys), stale-while-revalidate for static assets
- **Offline fallback**: Cached data is shown when API is unreachable
