// js/main.js
import { renderMyTeam } from "./pages/my-team.js";
import { renderAllPlayers } from "./pages/all-players.js";
import { renderFixtures } from "./pages/fixtures.js";
import { renderGwExplorer } from "./pages/gw-explorer.js";
import { renderMiniLeague } from "./pages/mini-league.js";
import { renderPlanner } from "./pages/planner.js";
import { renderMeta } from "./pages/meta.js";
import { renderHelp } from "./pages/help.js";
import { initTooltips } from "./components/tooltip.js";
import { api } from "./api.js";
import { state } from "./state.js";

const APP_VERSION = "1.2.0";

/* ---------- Confetti System ---------- */
function createConfetti(count = 50) {
  const container = document.createElement("div");
  container.className = "confetti-container";

  const colors = ["#fbbf24", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];
  const shapes = ["square", "circle"];

  for (let i = 0; i < count; i++) {
    const confetti = document.createElement("div");
    confetti.className = "confetti";

    const color = colors[Math.floor(Math.random() * colors.length)];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    const size = Math.random() * 8 + 6;
    const left = Math.random() * 100;
    const delay = Math.random() * 0.5;
    const duration = Math.random() * 2 + 2;

    confetti.style.cssText = `
      left: ${left}%;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${shape === "circle" ? "50%" : "2px"};
      animation-delay: ${delay}s;
      animation-duration: ${duration}s;
    `;

    container.appendChild(confetti);
  }

  document.body.appendChild(container);
  setTimeout(() => container.remove(), 4000);
}

// Export for use in other modules
window.createConfetti = createConfetti;

/* ---------- Copy Entry ID ---------- */
function bindCopyEntryId() {
  const input = document.getElementById("entryIdInput");
  const btn = document.getElementById("copyEntryIdBtn");

  if (!input || !btn) return;

  // Show/hide button based on input value
  const updateBtnVisibility = () => {
    const hasValue = input.value.trim().length > 0;
    btn.style.display = hasValue ? "flex" : "none";
  };

  input.addEventListener("input", updateBtnVisibility);
  updateBtnVisibility();

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;

    // Extract just the ID if it's a URL
    const idMatch = value.match(/\/entry\/(\d+)/) || value.match(/^(\d+)$/);
    const textToCopy = idMatch ? idMatch[1] : value;

    try {
      await navigator.clipboard.writeText(textToCopy);
      btn.classList.add("copied");
      btn.querySelector(".copy-icon").textContent = "✓";

      setTimeout(() => {
        btn.classList.remove("copied");
        btn.querySelector(".copy-icon").textContent = "📋";
      }, 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  });
}

/* ---------- Keyboard Shortcuts ---------- */
const KEYBOARD_SHORTCUTS = {
  "1": "#/my-team",
  "2": "#/all-players",
  "3": "#/fixtures",
  "4": "#/gw-explorer",
  "5": "#/mini-league",
  "6": "#/planner",
  "7": "#/meta",
  "8": "#/help",
};

function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Ignore if user is typing in an input
    if (e.target.matches("input, textarea, select")) return;

    // Ignore if modifier keys are held
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.toLowerCase();

    // Number keys for navigation
    if (KEYBOARD_SHORTCUTS[key]) {
      e.preventDefault();
      location.hash = KEYBOARD_SHORTCUTS[key];
      return;
    }

    // "/" for search - focus the search input on All Players
    if (key === "/") {
      e.preventDefault();
      // Navigate to all-players if not there
      if (!location.hash.includes("all-players")) {
        location.hash = "#/all-players";
      }
      // Focus search after a small delay for page render
      setTimeout(() => {
        const searchInput = document.querySelector("#playerSearch, input[placeholder*='Search']");
        if (searchInput) searchInput.focus();
      }, 100);
      return;
    }

    // "?" for help overlay
    if (key === "?" || (e.shiftKey && key === "/")) {
      e.preventDefault();
      showKeyboardShortcutsHelp();
      return;
    }

    // "Escape" to close modals/overlays
    if (key === "escape") {
      const modal = document.querySelector(".modal__backdrop");
      if (modal) modal.click();
      const helpOverlay = document.getElementById("keyboardHelpOverlay");
      if (helpOverlay) helpOverlay.remove();
      return;
    }

    // "s" to toggle sidebar
    if (key === "s") {
      e.preventDefault();
      toggleSidebar();
      return;
    }
  });
}

function showKeyboardShortcutsHelp() {
  // Remove existing overlay if present
  const existing = document.getElementById("keyboardHelpOverlay");
  if (existing) {
    existing.remove();
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "keyboardHelpOverlay";
  overlay.className = "keyboard-help-overlay";
  overlay.innerHTML = `
    <div class="keyboard-help-modal">
      <div class="keyboard-help-header">
        <h3>Keyboard Shortcuts</h3>
        <button class="keyboard-help-close">&times;</button>
      </div>
      <div class="keyboard-help-content">
        <div class="shortcut-group">
          <h4>Navigation</h4>
          <div class="shortcut-row"><kbd>1</kbd> My Team</div>
          <div class="shortcut-row"><kbd>2</kbd> All Players</div>
          <div class="shortcut-row"><kbd>3</kbd> Fixtures</div>
          <div class="shortcut-row"><kbd>4</kbd> GW Explorer</div>
          <div class="shortcut-row"><kbd>5</kbd> Mini-League</div>
          <div class="shortcut-row"><kbd>6</kbd> Planner</div>
          <div class="shortcut-row"><kbd>7</kbd> Meta</div>
          <div class="shortcut-row"><kbd>8</kbd> Help</div>
        </div>
        <div class="shortcut-group">
          <h4>Actions</h4>
          <div class="shortcut-row"><kbd>/</kbd> Search players</div>
          <div class="shortcut-row"><kbd>S</kbd> Toggle sidebar</div>
          <div class="shortcut-row"><kbd>?</kbd> Show shortcuts</div>
          <div class="shortcut-row"><kbd>Esc</kbd> Close modal</div>
        </div>
      </div>
    </div>
  `;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".keyboard-help-close")) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
}

/* ---------- Collapsible Sidebar ---------- */
function initSidebar() {
  const sidebar = document.querySelector(".sidebar");

  if (!sidebar) return;

  // Check saved preference
  const collapsed = localStorage.getItem("fpl.sidebarCollapsed") === "true";
  if (collapsed) {
    document.body.classList.add("sidebar-collapsed");
  }

  // Create toggle button (fixed position, append to body)
  const toggle = document.createElement("button");
  toggle.className = "sidebar-toggle";
  toggle.innerHTML = `<span class="toggle-icon">◀</span>`;
  toggle.title = "Toggle sidebar (S)";
  toggle.addEventListener("click", toggleSidebar);

  document.body.appendChild(toggle);

  // Update icon based on initial state
  if (collapsed) {
    toggle.querySelector(".toggle-icon").textContent = "▶";
  }
}

function toggleSidebar() {
  const isCollapsed = document.body.classList.toggle("sidebar-collapsed");
  localStorage.setItem("fpl.sidebarCollapsed", isCollapsed);

  // Update toggle icon
  const toggleIcon = document.querySelector(".sidebar-toggle .toggle-icon");
  if (toggleIcon) {
    toggleIcon.textContent = isCollapsed ? "▶" : "◀";
  }
}

const routes = {
  "my-team": renderMyTeam,
  "all-players": renderAllPlayers,
  "fixtures": renderFixtures,
  "gw-explorer": renderGwExplorer,
  "mini-league": renderMiniLeague,
  "planner": renderPlanner,
  "meta": renderMeta,
  "help": renderHelp,
};

/* ---------- Refresh state ---------- */
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
  const theme = saved || (prefersDark ? "dark" : "light");

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

/* ---------- Manual Refresh ---------- */
function checkIfLiveGw() {
  const bs = state.bootstrap;
  if (!bs?.events) return false;

  const current = bs.events.find(e => e.is_current);
  return current && !current.data_checked;
}

async function refreshData() {
  const refreshBtn = document.getElementById("refreshDataBtn");
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<span class="refresh-icon">⟳</span> Refreshing...';
  }

  try {
    // Clear cache and refetch
    api.clearCache();
    state.bootstrap = await api.bootstrap();
    updateLastFetchTime();

    // Update live status
    isLiveGw = checkIfLiveGw();

    // Update UI
    setHeaderStatusFromBootstrap(state.bootstrap);

    // Refresh current page
    navigate(location.hash);

  } catch (e) {
    console.error("Refresh failed:", e);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<span class="refresh-icon">⟳</span> Refresh';
    }
  }
}

function bindRefreshButton() {
  const refreshBtn = document.getElementById("refreshDataBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshData);
  }
}

/* ---------- Routing ---------- */
function getTabFromHash(hash) {
  const raw = (hash || location.hash || "#/my-team").replace(/^#\//, "");
  if (routes[raw]) return { tab: raw, valid: true };
  return { tab: raw, valid: false };
}

function render404(main, attemptedRoute) {
  main.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "card error-404";
  wrap.innerHTML = `
    <h2>Page Not Found</h2>
    <p>The route <code>#/${attemptedRoute}</code> does not exist.</p>
    <p class="sub">Available pages:</p>
    <ul class="route-list">
      <li><a href="#/my-team">My Team</a></li>
      <li><a href="#/all-players">All Players</a></li>
      <li><a href="#/fixtures">Fixtures</a></li>
      <li><a href="#/gw-explorer">GW Explorer</a></li>
      <li><a href="#/mini-league">Mini-League</a></li>
      <li><a href="#/planner">Planner</a></li>
      <li><a href="#/meta">Meta</a></li>
      <li><a href="#/help">Help</a></li>
    </ul>
    <button class="btn-primary" onclick="location.hash='#/my-team'">Go to My Team</button>
  `;
  main.appendChild(wrap);
}

function highlightActiveNav(tab) {
  // Desktop nav
  const links = document.querySelectorAll(".nav a");
  links.forEach((a) => {
    const target = (a.getAttribute("href") || "").replace(/^#\//, "");
    const isActive = target === tab;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  // Mobile bottom nav
  const mobileLinks = document.querySelectorAll(".mobile-bottom-nav a");
  mobileLinks.forEach((a) => {
    const target = (a.getAttribute("href") || "").replace(/^#\//, "");
    const isActive = target === tab;
    a.classList.toggle("active", isActive);
  });
}

function navigate(hash) {
  const main = document.querySelector("main");
  const result = getTabFromHash(hash);

  if (!result.valid) {
    render404(main, result.tab);
    highlightActiveNav(null);
    window.scrollTo({ top: 0, behavior: "instant" });
    adjustForFixedFooter();
    return;
  }

  const render = routes[result.tab];
  main.innerHTML = "";
  render(main);
  highlightActiveNav(result.tab);
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
  bindCopyEntryId();
  bindKeyboardShortcuts();
  bindRefreshButton();
  initSidebar();
  initChartDefaults();
  initTooltips(document.body);

  if (!location.hash) location.hash = "#/my-team";
  navigate(location.hash);
  window.addEventListener("hashchange", () => navigate(location.hash));
  window.addEventListener("resize", adjustForFixedFooter);
  adjustForFixedFooter();
}

document.addEventListener("DOMContentLoaded", init);
