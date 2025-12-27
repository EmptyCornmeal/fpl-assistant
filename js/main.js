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

const APP_VERSION = "1.1.0";

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

/* ---------- Auto-refresh state ---------- */
let autoRefreshInterval = null;
let countdownInterval = null;
let countdownSeconds = 60;
let lastFetchTime = null;
let isLiveGw = false;

/* ---------- Deadline Countdown ---------- */
let deadlineInterval = null;

function updateDeadlineCountdown() {
  const bs = state.bootstrap;
  if (!bs?.events) return;

  const now = Date.now();
  
  // Find next GW with deadline in the future
  const upcomingEvent = bs.events.find(e => {
    const deadline = new Date(e.deadline_time).getTime();
    return deadline > now;
  });

  const deadlineBox = document.getElementById("deadlineBox");
  const deadlineTimer = document.getElementById("deadlineTimer");
  const deadlineGw = document.getElementById("deadlineGw");

  if (!upcomingEvent) {
    if (deadlineTimer) deadlineTimer.textContent = "Season Over";
    if (deadlineGw) deadlineGw.textContent = "";
    if (deadlineBox) deadlineBox.classList.add("deadline-ended");
    return;
  }

  const deadline = new Date(upcomingEvent.deadline_time).getTime();
  const diff = deadline - now;

  if (diff <= 0) {
    if (deadlineTimer) deadlineTimer.textContent = "LOCKED";
    if (deadlineBox) deadlineBox.classList.add("deadline-locked");
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  let timeStr;
  if (days > 0) {
    timeStr = `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    timeStr = `${hours}h ${minutes}m ${seconds}s`;
  } else {
    timeStr = `${minutes}m ${seconds}s`;
  }

  if (deadlineTimer) deadlineTimer.textContent = timeStr;
  if (deadlineGw) deadlineGw.textContent = `GW ${upcomingEvent.id}`;

  // Add urgency classes
  if (deadlineBox) {
    deadlineBox.classList.remove("deadline-urgent", "deadline-critical", "deadline-locked");
    if (diff < 1000 * 60 * 60) { // Less than 1 hour
      deadlineBox.classList.add("deadline-critical");
    } else if (diff < 1000 * 60 * 60 * 24) { // Less than 24 hours
      deadlineBox.classList.add("deadline-urgent");
    }
  }
}

function startDeadlineCountdown() {
  updateDeadlineCountdown();
  if (deadlineInterval) clearInterval(deadlineInterval);
  deadlineInterval = setInterval(updateDeadlineCountdown, 1000);
}

/* ---------- Theme Toggle ---------- */
function initTheme() {
  const saved = localStorage.getItem("fpl.theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (prefersDark ? "dark" : "dark"); // default dark
  
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcon(theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("fpl.theme", next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  btn.classList.toggle("is-light", theme === "light");
}

function bindThemeToggle() {
  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.addEventListener("click", toggleTheme);
  }
}

/* ---------- Last Updated Timestamp ---------- */
function updateLastFetchTime() {
  lastFetchTime = Date.now();
  updateLastUpdatedDisplay();
}

function updateLastUpdatedDisplay() {
  const el = document.getElementById("lastUpdatedText");
  if (!el || !lastFetchTime) return;

  const now = Date.now();
  const diff = Math.floor((now - lastFetchTime) / 1000);

  let text;
  if (diff < 5) {
    text = "Just now";
  } else if (diff < 60) {
    text = `${diff}s ago`;
  } else if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    text = `${mins}m ago`;
  } else {
    const hrs = Math.floor(diff / 3600);
    text = `${hrs}h ago`;
  }

  el.textContent = `Updated ${text}`;
  
  // Update dot color based on freshness
  const dot = el.previousElementSibling;
  if (dot && dot.classList.contains("update-dot")) {
    dot.classList.remove("stale", "old");
    if (diff > 300) dot.classList.add("old"); // >5 min
    else if (diff > 60) dot.classList.add("stale"); // >1 min
  }
}

// Update display every 10 seconds
setInterval(updateLastUpdatedDisplay, 10000);

/* ---------- Auto-Refresh for Live GW ---------- */
function checkIfLiveGw() {
  const bs = state.bootstrap;
  if (!bs?.events) return false;
  
  const current = bs.events.find(e => e.is_current);
  return current && !current.data_checked;
}

function updateAutoRefreshUI() {
  const statusEl = document.getElementById("autoRefreshStatus");
  const countdownEl = document.getElementById("refreshCountdown");
  
  if (!statusEl) return;
  
  if (isLiveGw) {
    statusEl.style.display = "flex";
    if (countdownEl) countdownEl.textContent = `${countdownSeconds}s`;
  } else {
    statusEl.style.display = "none";
  }
}

function startAutoRefresh() {
  if (!isLiveGw) return;
  
  // Clear existing intervals
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  if (countdownInterval) clearInterval(countdownInterval);
  
  countdownSeconds = 60;
  updateAutoRefreshUI();
  
  // Countdown ticker
  countdownInterval = setInterval(() => {
    countdownSeconds--;
    updateAutoRefreshUI();
    
    if (countdownSeconds <= 0) {
      countdownSeconds = 60;
      refreshData();
    }
  }, 1000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  
  const statusEl = document.getElementById("autoRefreshStatus");
  if (statusEl) statusEl.style.display = "none";
}

async function refreshData() {
  try {
    // Clear cache and refetch
    api.clearCache();
    state.bootstrap = await api.bootstrap();
    updateLastFetchTime();
    
    // Check if still live
    isLiveGw = checkIfLiveGw();
    if (!isLiveGw) {
      stopAutoRefresh();
    }
    
    // Update UI
    setHeaderStatusFromBootstrap(state.bootstrap);
    
    // Refresh current page
    navigate(location.hash);
    
  } catch (e) {
    console.error("Auto-refresh failed:", e);
  }
}

/* ---------- Routing ---------- */
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

  // Check if live
  isLiveGw = current && !current.data_checked;

  if (liveBadge) {
    if (isLiveGw) {
      liveBadge.style.display = "inline-flex";
      liveBadge.querySelector(".live-text").textContent = `LIVE GW${current.id}`;
    } else {
      liveBadge.style.display = "none";
    }
  }

  if (headerChips) {
    headerChips.innerHTML = "";
    if (lastFinished) headerChips.appendChild(chip(`Last: GW${lastFinished.id}`));
    if (current && !isLiveGw) {
      headerChips.appendChild(chip(`Current: GW${current.id}`));
    }
    if (next) headerChips.appendChild(chip(`Next: GW${next.id}`));
  }

  // Start/stop auto-refresh based on live status
  if (isLiveGw) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
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
  // Initialize theme first (prevents flash)
  initTheme();
  bindThemeToggle();

  // Prefetch bootstrap (non-fatal if it fails)
  try {
    state.bootstrap = await api.bootstrap();
    updateLastFetchTime();
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
    if (note) note.textContent = "Live-aware: shows the current GW when it's in progress.";
    setHeaderStatusFromBootstrap(bs);
    
    // Start deadline countdown
    startDeadlineCountdown();
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
