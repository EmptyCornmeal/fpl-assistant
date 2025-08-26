// js/main.js
import { renderMyTeam } from "./pages/my-team.js";
import { renderAllPlayers } from "./pages/all-players.js";
import { renderFixtures } from "./pages/fixtures.js";
import { renderGwExplorer } from "./pages/gw-explorer.js";
import { renderPlanner } from "./pages/planner.js";
import { renderMiniLeague } from "./pages/mini-league.js";
import { renderHelp } from "./pages/help.js";
import { renderMeta } from "./pages/meta.js";
import { initTooltips } from "./components/tooltip.js";
import { api } from "./api.js";
import { state } from "./state.js";

const APP_VERSION = "1.0.0";

const routes = {
  "my-team": renderMyTeam,
  "all-players": renderAllPlayers,
  "fixtures": renderFixtures,
  "gw-explorer": renderGwExplorer,
  "planner": renderPlanner,
  "mini-league": renderMiniLeague,
  "meta": renderMeta,
  "help": renderHelp,
};

function getTabFromHash(hash) {
  const raw = (hash || location.hash || "#/my-team").replace(/^#\//, "");
  return routes[raw] ? raw : "my-team";
}

function highlightActiveNav(tab) {
  const links = document.querySelectorAll(".nav a");
  links.forEach((a) => {
    const target = (a.getAttribute("href") || "").replace(/^#\//, "");
    const isActive = target === tab;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function navigate(hash) {
  const main = document.querySelector("main");
  const tab = getTabFromHash(hash);
  const render = routes[tab] || renderMyTeam;
  main.innerHTML = "";
  render(main);
  highlightActiveNav(tab);
  initTooltips(main);
  window.scrollTo({ top: 0, behavior: "instant" });
  adjustForFixedFooter();
}

function qsAny(...sel) {
  for (const s of sel) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function setStatePatch(patch) {
  if (typeof state.set === "function") state.set(patch);
  else Object.assign(state, patch);
}

/* ---------- Smart-paste helpers ---------- */
function extractEntryId(str) {
  if (!str) return null;
  const numOnly = str.trim().match(/^\d+$/);
  if (numOnly) return Number(numOnly[0]);
  const m = str.match(/\/entry\/(\d+)\b/);
  return m ? Number(m[1]) : null;
}
function extractLeagueIds(str) {
  if (!str) return [];
  return str
    .split(",")
    .map(s => s.trim())
    .flatMap(tok => {
      const n = tok.match(/^\d+$/);
      if (n) return [Number(n[0])];
      const m = tok.match(/\/leagues\/classic\/(\d+)\b/);
      if (m) return [Number(m[1])];
      return [];
    });
}

/* ---------- Sidebar binding ---------- */
function bindSidebar() {
  const entryInput = qsAny("#entryIdInput", "#entry-id");
  const leagueInput = qsAny("#leagueIdInput", "#league-ids");
  const saveBtn = qsAny("#saveIdsBtn", "#save-ids");

  if (entryInput) entryInput.value = state.entryId ?? "";
  if (leagueInput) leagueInput.value = (state.leagueIds || []).join(", ");

  saveBtn?.addEventListener("click", () => {
    const entryRaw = entryInput?.value?.trim() || "";
    const leaguesRaw = leagueInput?.value || "";
    const entryParsed = extractEntryId(entryRaw);
    const leaguesParsed = extractLeagueIds(leaguesRaw);

    setStatePatch({ entryId: entryParsed ?? null, leagueIds: leaguesParsed });
    navigate(location.hash);
  });
}

/* ---------- small UI helpers ---------- */
function setText(id, val) {
  const n = document.getElementById(id);
  if (n) n.textContent = val;
}
function chip(text) {
  const s = document.createElement("span");
  s.className = "chip chip-dim";
  s.textContent = text;
  return s;
}

/* ---------- GW helpers (robust markers) ---------- */
function computeMarkers(events = []) {
  const byId = new Map(events.map(e => [e.id, e]));
  const finished = events.filter(e => e.data_checked);
  const lastFinishedId = finished.length ? Math.max(...finished.map(e => e.id)) : null;
  const lastFinished = lastFinishedId ? byId.get(lastFinishedId) : null;

  const current = events.find(e => e.is_current) || null;

  // Next: prefer is_next; else infer sequentially
  let next = events.find(e => e.is_next) || null;
  if (!next) {
    const base = current?.id ?? (lastFinishedId != null ? lastFinishedId : null);
    if (base != null) next = byId.get(base + 1) || null;
  }

  return { lastFinished, current, next };
}

function setHeaderStatusFromBootstrap(bs) {
  const { lastFinished, current, next } = computeMarkers(bs.events || []);

  const liveBadge = document.getElementById("liveBadge");
  const headerChips = document.getElementById("headerChips");

  if (liveBadge) {
    if (current && !current.data_checked) {
      liveBadge.style.display = "inline-flex";
      liveBadge.textContent = `LIVE • GW ${current.id}`;
    } else {
      liveBadge.style.display = "none";
    }
  }

  if (headerChips) {
    headerChips.innerHTML = "";
    if (lastFinished) headerChips.appendChild(chip(`Last: GW${lastFinished.id}`));
    if (current) {
      headerChips.appendChild(
        chip(current.data_checked ? `Current: GW${current.id} (final)` : `Current: GW${current.id} (live)`)
      );
    }
    if (next) headerChips.appendChild(chip(`Next: GW${next.id}`));
  }
}

/* ---------- Chart.js sensible defaults ---------- */
function initChartDefaults() {
  if (!window.Chart) return;
  const { Chart } = window;
  Chart.defaults.font.family = "'Inter', system-ui, -apple-system, Segoe UI, Roboto";
  Chart.defaults.color = "rgba(230,235,242,.92)";
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.elements.line.tension = 0.25;
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.line.borderColor = "rgba(150,180,255,.22)";
  Chart.defaults.elements.point.radius = 3;
  Chart.defaults.elements.point.hoverRadius = 6;
  Chart.defaults.elements.point.backgroundColor = "rgba(190,205,255,.95)";
  Chart.defaults.maintainAspectRatio = false;
}

/* ---------- Fixed footer padding ---------- */
function adjustForFixedFooter() {
  const footer = document.querySelector(".footer");
  const main = document.querySelector("main");
  if (!footer || !main) return;
  const h = Math.ceil(footer.getBoundingClientRect().height);
  document.body.style.paddingBottom = `${h + 8}px`;
}

/* -------------------- INIT -------------------- */
async function init() {
  // Prefetch bootstrap (non-fatal if it fails)
  try {
    state.bootstrap = await api.bootstrap();
  } catch {}

  // Sidebar stats + header status
  if (state.bootstrap) {
    const bs = state.bootstrap;
    setText("teamsCount", (bs.teams?.length ?? "—").toString());
    setText("playersCount", (bs.elements?.length ?? "—").toString());

    // Use robust "last finished" based on data_checked
    const { lastFinished } = computeMarkers(bs.events || []);
    setText("lastFinishedGw", lastFinished ? String(lastFinished.id) : "—");

    const note = document.querySelector(".sidebar .sidebar-note");
    if (note) note.textContent = "Live-aware: shows the current GW when it’s in progress.";
    setHeaderStatusFromBootstrap(bs);
  }

  // Footer meta
  setText("year", new Date().getFullYear());
  setText("appVersion", APP_VERSION);

  bindSidebar();
  initChartDefaults();
  initTooltips(document.body);

  if (!location.hash) location.hash = "#/my-team";
  navigate(location.hash);
  window.addEventListener("hashchange", () => navigate(location.hash));
  window.addEventListener("resize", adjustForFixedFooter);
  adjustForFixedFooter();
}

document.addEventListener("DOMContentLoaded", init);
