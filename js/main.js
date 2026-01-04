// js/main.js
import { renderPortal } from "./pages/portal.js";
import { renderMyTeam } from "./pages/my-team.js";
import { renderAllPlayers } from "./pages/all-players.js";
import { renderFixtures } from "./pages/fixtures.js";
import { renderGwExplorer } from "./pages/gw-explorer.js";
import { renderMiniLeague } from "./pages/mini-league.js";
import { renderHelp } from "./pages/help.js";
import { renderStatPicker } from "./pages/stat-picker.js";
import { initTooltips } from "./components/tooltip.js";
import { api } from "./api.js";
import { fplClient } from "./api/fplClient.js";
import { state, setPageUpdated, isTeamPinned, togglePinnedTeam, getPinnedTeams, getWatchlist } from "./state.js";
import { utils } from "./utils.js";
import { log } from "./logger.js";
import { getApiBase, markApiBaseValidated, getApiBaseInfo } from "./config.js";
import { formatCacheAge } from "./api/fetchHelper.js";

const APP_VERSION = "1.2.0";
const COMMIT_HASH = "b0868d2"; // Auto-updated during build/deploy

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

function bindCopyExampleUrls() {
  const buttons = document.querySelectorAll("[data-copy-url]");
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const url = btn.dataset.copyUrl;
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        btn.classList.add("copied");
        const orig = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.classList.remove("copied");
          btn.textContent = orig;
        }, 1800);
      } catch (err) {
        console.error("Failed to copy example URL", err);
      }
    });
  });
}

/* ---------- Keyboard Shortcuts ---------- */
const KEYBOARD_SHORTCUTS = {
  "0": "#/",
  "1": "#/my-team",
  "2": "#/all-players",
  "3": "#/fixtures",
  "4": "#/gw-explorer",
  "5": "#/mini-league",
  "6": "#/stat-picker",
  "7": "#/help",
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

    // "/" for global search
    if (key === "/") {
      e.preventDefault();
      const globalSearch = document.getElementById("globalSearchInput");
      if (globalSearch) globalSearch.focus();
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

    // "d" to toggle dev panel
    if (key === "d") {
      e.preventDefault();
      log.toggleDevPanel();
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
          <div class="shortcut-row"><kbd>0</kbd> Portal (Home)</div>
          <div class="shortcut-row"><kbd>1</kbd> My Team</div>
          <div class="shortcut-row"><kbd>2</kbd> All Players</div>
          <div class="shortcut-row"><kbd>3</kbd> Fixtures</div>
          <div class="shortcut-row"><kbd>4</kbd> GW Explorer</div>
          <div class="shortcut-row"><kbd>5</kbd> Mini-League</div>
          <div class="shortcut-row"><kbd>6</kbd> Help</div>
        </div>
        <div class="shortcut-group">
          <h4>Actions</h4>
          <div class="shortcut-row"><kbd>/</kbd> Focus search</div>
          <div class="shortcut-row"><kbd>S</kbd> Toggle sidebar</div>
          <div class="shortcut-row"><kbd>D</kbd> Toggle dev console</div>
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
  // Phase 10: Enhanced tooltip with keyboard shortcut hint
  const toggle = document.createElement("button");
  toggle.className = "sidebar-toggle";
  toggle.innerHTML = `<span class="toggle-icon">◀</span>`;
  toggle.title = collapsed ? "Expand sidebar (S)" : "Collapse sidebar (S)";
  toggle.setAttribute("aria-label", "Toggle sidebar");
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

  // Update toggle icon and tooltip
  const toggle = document.querySelector(".sidebar-toggle");
  const toggleIcon = toggle?.querySelector(".toggle-icon");
  if (toggleIcon) {
    toggleIcon.textContent = isCollapsed ? "▶" : "◀";
  }
  if (toggle) {
    toggle.title = isCollapsed ? "Expand sidebar (S)" : "Collapse sidebar (S)";
  }
}

const routes = {
  "": renderPortal,
  "portal": renderPortal,
  "my-team": renderMyTeam,
  "all-players": renderAllPlayers,
  "players": renderAllPlayers, // Alias for consistency
  "fixtures": renderFixtures,
  "gw-explorer": renderGwExplorer,
  "explorer": renderGwExplorer, // Alias for consistency
  "mini-league": renderMiniLeague,
  "league": renderMiniLeague, // Alias for consistency
  "stat-picker": renderStatPicker,
  "help": renderHelp,
};

// Track navigation history to improve back navigation from player profiles
let lastNonPlayerHash = "#/";
let lastPlayersHash = "#/all-players";
let lastHashValue = "#/";

/* ---------- Refresh state ---------- */
let lastFetchTime = null;
let isLiveGw = false;
let bootstrapMeta = null;
let bootstrapBannerDismissed = false;

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
function updateLastFetchTime(timestamp = Date.now()) {
  lastFetchTime = timestamp;
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

function renderBootstrapBanner() {
  const host = document.getElementById("appAlerts");
  if (!host) return;

  host.innerHTML = "";
  if (!bootstrapMeta || bootstrapBannerDismissed) return;

  const { fromCache, stale, cacheAge, apiBase } = bootstrapMeta;
  if (!fromCache && !stale) return;

  const banner = document.createElement("div");
  banner.className = "cached-banner cached-banner-global";

  const ageText = cacheAge != null ? formatCacheAge(cacheAge) : "unknown age";
  banner.innerHTML = `
    <div class="cached-banner-content">
      <span class="cached-banner-icon">📡</span>
      <span class="cached-banner-text">
        <strong>Using cached data</strong> — Last updated ${ageText}${apiBase ? ` · ${apiBase}` : ""}
      </span>
    </div>
    <div class="cached-banner-actions">
      <button class="btn-banner-refresh" type="button">Try Again</button>
      <button class="btn-banner-dismiss" type="button" title="Dismiss">✕</button>
    </div>
  `;

  banner.querySelector(".btn-banner-refresh")?.addEventListener("click", () => {
    bootstrapBannerDismissed = false;
    refreshData();
  });

  banner.querySelector(".btn-banner-dismiss")?.addEventListener("click", () => {
    bootstrapBannerDismissed = true;
    host.innerHTML = "";
  });

  host.appendChild(banner);
}

/* ---------- API Status + Offline Indicator ---------- */
const ApiStatus = {
  LIVE: "live",
  UPDATING: "updating",
  OFFLINE: "offline",
  UNKNOWN: "unknown",
};

let apiStatus = ApiStatus.LIVE;
let lastApiStatusCheck = 0;
const API_STATUS_BACKOFF_MS = 15_000;
let apiStatusPromise = null;

function setApiStatus(status, detail = "") {
  apiStatus = status;
  const badge = document.getElementById("apiStatusBadge");
  if (!badge) return;

  const label =
    status === ApiStatus.LIVE ? "Live" :
    status === ApiStatus.UPDATING ? "Updating" :
    status === ApiStatus.UNKNOWN ? "Status Unknown" :
    "Offline (cached)";

  badge.dataset.status = status;
  badge.textContent = label;
  badge.title = detail || label;
  badge.dataset.base = getApiBase();
}

async function refreshApiStatus(reason = "") {
  if (!navigator.onLine) {
    setApiStatus(ApiStatus.OFFLINE, "Device offline");
    return;
  }

  const apiBase = getApiBase();
  if (!apiBase) {
    // No API configured - show clear message
    const info = getApiBaseInfo();
    const hint = info.sameOriginViable
      ? "Set window.__FPL_API_BASE__ or localStorage 'fpl.apiBase'"
      : "Configure API via localStorage.setItem('fpl.apiBase', 'https://your-proxy/api')";
    setApiStatus(ApiStatus.OFFLINE, `No API configured. ${hint}`);
    log.warn(`No API base configured (source: ${info.source || "none"})`);
    return;
  }

  const now = Date.now();
  if (apiStatusPromise && now - lastApiStatusCheck < API_STATUS_BACKOFF_MS) {
    return apiStatusPromise;
  }
  lastApiStatusCheck = now;

  setApiStatus(ApiStatus.UPDATING, reason || "Checking API…");
  apiStatusPromise = (async () => {
    try {
      const res = await fplClient.healthCheck();
      if (res.ok) {
        // Mark this API base as validated for future use
        markApiBaseValidated(apiBase);
        const detail = res.degraded
          ? `Connected (${apiBase}) — health endpoint unavailable`
          : `Connected (${apiBase})`;
        setApiStatus(ApiStatus.LIVE, detail);
      } else {
        setApiStatus(ApiStatus.UNKNOWN, "Health endpoint unavailable");
      }
    } catch (err) {
      const msg = `${err?.message || err}`;
      const isMissing = msg.includes("HTTP 404") || msg.toLowerCase().includes("not found");
      log.warn("API health check failed", err);
      if (isMissing) {
        setApiStatus(ApiStatus.UNKNOWN, "Health endpoint missing or misconfigured");
      } else {
        setApiStatus(ApiStatus.OFFLINE, "API unreachable — showing cached data where possible");
      }
    } finally {
      apiStatusPromise = null;
    }
  })();

  return apiStatusPromise;
}

function bindApiStatusEvents() {
  window.addEventListener("online", () => refreshApiStatus("Back online"));
  window.addEventListener("offline", () => setApiStatus(ApiStatus.OFFLINE, "Device offline"));
}

function handleServiceWorkerMessage(event) {
  const data = event.data || {};
  if (data.type !== "api-status" || !data.status) return;

  if (data.status === "live") {
    setApiStatus(ApiStatus.LIVE, data.detail || "Connected to the FPL proxy");
  } else if (data.status === "updating") {
    setApiStatus(ApiStatus.UPDATING, data.detail || "Updating offline cache…");
  } else if (data.status === "offline") {
    setApiStatus(ApiStatus.OFFLINE, data.detail || "Using cached responses");
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    refreshApiStatus();
    return;
  }

  navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);

  navigator.serviceWorker.register("./sw.js").then((registration) => {
    setApiStatus(ApiStatus.UPDATING, "Preparing offline cache…");

    if (registration.installing) {
      setApiStatus(ApiStatus.UPDATING, "Downloading offline bundle…");
    }

    registration.addEventListener("updatefound", () => {
      setApiStatus(ApiStatus.UPDATING, "Updating offline bundle…");
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      setApiStatus(ApiStatus.UPDATING, "Reloading to the latest offline bundle…");
      refreshApiStatus();
    });

    refreshApiStatus();
  }).catch((err) => {
    log.warn("Service worker registration failed", err);
    setApiStatus(ApiStatus.OFFLINE, "Offline caching unavailable");
  });
}

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
    refreshBtn.style.animation = 'spin 0.8s linear infinite';
  }

  log.info("Refreshing data...");
  setApiStatus(ApiStatus.UPDATING, "Refreshing data…");

  try {
    // Clear in-memory cache and refetch
    fplClient.clearCache();
    bootstrapBannerDismissed = false;
    const result = await fetchBootstrap({ allowCacheFallback: true, forceRefresh: true });
    if (!result.ok) throw new Error("Bootstrap refresh failed");
    renderPinnedSidebar();

    // Update live status
    isLiveGw = checkIfLiveGw();

    // Update UI
    if (state.bootstrap) setHeaderStatusFromBootstrap(state.bootstrap);

    // Refresh current page
    navigate(location.hash);

    const stale = result.meta?.stale || result.meta?.fromCache;
    setApiStatus(stale ? ApiStatus.OFFLINE : ApiStatus.LIVE, stale ? "Data refreshed from cache" : "Data refreshed");
    log.info("Data refresh complete");
  } catch (e) {
    log.error("Refresh failed:", e);
    setApiStatus(ApiStatus.OFFLINE, "Refresh failed — using cached data");
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.style.animation = '';
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
  const raw = (hash || location.hash || "#/").replace(/^#\//, "");

  // Check for static routes first
  if (routes[raw]) return { tab: raw, valid: true, params: {} };

  // Check for dynamic routes (player/{id}, team/{id})
  const playerMatch = raw.match(/^player\/(\d+)$/);
  if (playerMatch) {
    return { tab: "player", valid: true, params: { playerId: parseInt(playerMatch[1]) } };
  }

  const teamMatch = raw.match(/^team\/(\d+)$/);
  if (teamMatch) {
    return { tab: "team", valid: true, params: { teamId: parseInt(teamMatch[1]) } };
  }

  return { tab: raw, valid: false, params: {} };
}

function render404(main, attemptedRoute) {
  main.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "card error-404";
  wrap.innerHTML = `
    <div class="error-404-icon">🔍</div>
    <h2>Page Not Found</h2>
    <p>The route <code>#/${attemptedRoute}</code> does not exist.</p>
    <p class="sub">Available pages:</p>
    <div class="route-buttons">
      <a href="#/" class="route-btn"><span class="route-icon">🏠</span> Portal</a>
      <a href="#/my-team" class="route-btn"><span class="route-icon">⚽</span> My Team</a>
      <a href="#/all-players" class="route-btn"><span class="route-icon">👥</span> Players</a>
      <a href="#/fixtures" class="route-btn"><span class="route-icon">📅</span> Fixtures</a>
      <a href="#/gw-explorer" class="route-btn"><span class="route-icon">🔍</span> Explorer</a>
      <a href="#/mini-league" class="route-btn"><span class="route-icon">🏆</span> League</a>
      <a href="#/stat-picker" class="route-btn"><span class="route-icon">📊</span> Stat Picker</a>
      <a href="#/help" class="route-btn"><span class="route-icon">❓</span> Help</a>
    </div>
    <button class="btn-primary" onclick="location.hash='#/'">Go to Portal</button>
  `;
  main.appendChild(wrap);
}

// Route aliases for nav highlighting (alias -> canonical route in nav)
const routeAliases = {
  "players": "all-players",
  "explorer": "gw-explorer",
  "league": "mini-league",
};

function highlightActiveNav(tab) {
  // Resolve alias to canonical nav route
  const canonicalTab = routeAliases[tab] || tab;

  const links = document.querySelectorAll(".nav a");
  links.forEach((a) => {
    const target = (a.getAttribute("href") || "").replace(/^#\//, "");
    const isActive = target === canonicalTab;
    a.classList.toggle("active", isActive);
    if (isActive) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

/* ---------- Player Profile ---------- */
async function renderPlayerProfile(main, playerId, backNav = {}) {
  // Show loading
  main.innerHTML = `<div class="card"><div class="loading-spinner"></div><p style="text-align:center;color:var(--muted)">Loading player...</p></div>`;

  try {
    const bs = await requireBootstrap();
    if (!bs) throw new Error("Bootstrap not available");
    const player = (bs.elements || []).find(p => p.id === playerId);

    if (!player) {
      main.innerHTML = `<div class="card error-404"><h2>Player Not Found</h2><p>No player with ID ${playerId}</p><button class="btn-primary" onclick="history.back()">Go Back</button></div>`;
      return;
    }

    const team = (bs.teams || []).find(t => t.id === player.team);
    const pos = (bs.element_types || []).find(p => p.id === player.element_type);
    const photoUrl = player.photo
      ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${String(player.photo).replace(/\.(png|jpg)$/i, '').replace(/^p/, '')}.png`
      : null;
    const badgeUrl = team ? `https://resources.premierleague.com/premierleague/badges/70/t${team.code}.png` : null;

    const statusClass = player.status === 'a' ? 'st-okay' :
                        player.status === 'd' ? 'st-doubt' :
                        player.status === 'i' ? 'st-inj' : 'st-out';
    const statusLabel = player.status === 'a' ? 'Available' :
                        player.status === 'd' ? 'Doubtful' :
                        player.status === 'i' ? 'Injured' :
                        player.status === 's' ? 'Suspended' : 'Unavailable';

    // Load player summary (history + fixtures) with cache-aware SW fallback
    let summaryData = null;
    let summarySource = null;
    let summaryError = null;

    try {
      summaryData = await api.elementSummary(player.id);
      summarySource = navigator.onLine ? "Live data" : "Offline cache";
    } catch (err) {
      log.warn("Player summary fetch failed", err);
      summaryError = "Player summary unavailable. Please retry in a moment.";
    }

    if (!summaryData) summarySource = null;

    const recentHistory = summaryData?.history ? summaryData.history.slice(-5).reverse() : [];
    const upcomingFixtures = summaryData?.fixtures ? summaryData.fixtures.slice(0, 5) : [];
    const priceSnapshots = summaryData?.history ? summaryData.history.slice(-5) : [];

    const backTarget = backNav.backTarget || "#/all-players";
    const secondaryBackTarget = backNav.secondaryBackTarget;

    const clampFDR = (n) => Math.max(1, Math.min(5, Number(n) || 3));
    const toLocal = (dt, tz = "Europe/London") => {
      if (!dt) return "—";
      try {
        const d = new Date(dt);
        return d.toLocaleString("en-GB", {
          timeZone: tz,
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        });
      } catch {
        return dt;
      }
    };

    // Calculate ICT index and value metrics
    const ictIndex = parseFloat(player.ict_index || 0).toFixed(1);
    const valueRatio = player.total_points > 0 ? (player.total_points / (player.now_cost / 10)).toFixed(1) : "0.0";
    const xGI = parseFloat(player.expected_goal_involvements || 0);
    const actualGI = player.goals_scored + player.assists;
    const giDiff = (actualGI - xGI).toFixed(2);
    const giDiffClass = actualGI >= xGI ? "text-good" : "text-bad";

    main.innerHTML = `
      <div class="player-profile">
        <div class="profile-header">
          <button class="back-btn" data-back-target="${backTarget}">← Back</button>
          <div class="profile-info">
            ${photoUrl ? `<img class="profile-photo" src="${photoUrl}" alt="${player.web_name}" onerror="this.style.display='none'">` : '<div class="profile-photo-placeholder">👤</div>'}
            <div class="profile-details">
              <h1 class="profile-name">${player.first_name} ${player.second_name}</h1>
              <div class="profile-meta">
                ${badgeUrl ? `<img class="profile-badge" src="${badgeUrl}" alt="${team?.short_name}">` : ''}
                <span class="profile-team">${team?.name || 'Unknown'}</span>
                <span class="profile-pos">${pos?.singular_name || 'Player'}</span>
                <span class="status-pill ${statusClass}">${statusLabel}</span>
              </div>
              ${player.news ? `<p class="profile-news">${player.news}</p>` : ''}
            </div>
          </div>
        </div>

        <div class="profile-stats-grid profile-stats-grid--wide">
          <div class="stat-card">
            <div class="stat-value">£${(player.now_cost / 10).toFixed(1)}m</div>
            <div class="stat-label">Price</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${player.total_points}</div>
            <div class="stat-label">Total Points</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" data-tooltip="Average points over last 5 GWs">${player.form}</div>
            <div class="stat-label">Form</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${player.selected_by_percent}%</div>
            <div class="stat-label">Ownership</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" data-tooltip="Points Per Game">${player.points_per_game}</div>
            <div class="stat-label">PPG</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${player.minutes}</div>
            <div class="stat-label">Minutes</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" data-tooltip="Influence + Creativity + Threat index">${ictIndex}</div>
            <div class="stat-label">ICT</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" data-tooltip="Points per £1m spent">${valueRatio}</div>
            <div class="stat-label">Value</div>
          </div>
        </div>

        <div class="profile-columns">
          <div class="profile-column">
            <div class="profile-section">
              <h3>Season Stats</h3>
              <div class="stats-table stats-table--compact">
                <div class="stat-row"><span>Goals</span><span>${player.goals_scored}</span></div>
                <div class="stat-row"><span>Assists</span><span>${player.assists}</span></div>
                <div class="stat-row"><span>Clean Sheets</span><span>${player.clean_sheets}</span></div>
                <div class="stat-row"><span>Bonus Points</span><span>${player.bonus}</span></div>
                <div class="stat-row"><span>BPS</span><span>${player.bps}</span></div>
              </div>
            </div>

            <div class="profile-section">
              <h3>Expected Stats</h3>
              <div class="stats-table stats-table--compact">
                <div class="stat-row"><span>xG</span><span>${parseFloat(player.expected_goals || 0).toFixed(2)}</span></div>
                <div class="stat-row"><span>xA</span><span>${parseFloat(player.expected_assists || 0).toFixed(2)}</span></div>
                <div class="stat-row"><span>xGI</span><span>${xGI.toFixed(2)}</span></div>
                <div class="stat-row"><span>Actual G+A</span><span>${actualGI}</span></div>
                <div class="stat-row"><span>vs xGI</span><span class="${giDiffClass}">${giDiff > 0 ? '+' : ''}${giDiff}</span></div>
              </div>
            </div>
          </div>

          <div class="profile-column">
            <div class="profile-section">
              <h3>Transfers This Week</h3>
              <div class="stats-table stats-table--compact">
                <div class="stat-row"><span>In</span><span class="text-good">+${(player.transfers_in_event || 0).toLocaleString()}</span></div>
                <div class="stat-row"><span>Out</span><span class="text-bad">-${(player.transfers_out_event || 0).toLocaleString()}</span></div>
                <div class="stat-row"><span>Net</span><span>${((player.transfers_in_event || 0) - (player.transfers_out_event || 0)).toLocaleString()}</span></div>
              </div>
            </div>

            <div class="profile-section">
              <h3>Discipline</h3>
              <div class="stats-table stats-table--compact">
                <div class="stat-row"><span>Yellow Cards</span><span>${player.yellow_cards}</span></div>
                <div class="stat-row"><span>Red Cards</span><span>${player.red_cards}</span></div>
                <div class="stat-row"><span>Own Goals</span><span>${player.own_goals || 0}</span></div>
                <div class="stat-row"><span>Penalties Missed</span><span>${player.penalties_missed || 0}</span></div>
              </div>
            </div>

            <div class="profile-section">
              <h3>Season Transfers</h3>
              <div class="stats-table stats-table--compact">
                <div class="stat-row"><span>Total In</span><span>${(player.transfers_in || 0).toLocaleString()}</span></div>
                <div class="stat-row"><span>Total Out</span><span>${(player.transfers_out || 0).toLocaleString()}</span></div>
                <div class="stat-row"><span>Cost Change</span><span class="${player.cost_change_start >= 0 ? 'text-good' : 'text-bad'}">${player.cost_change_start >= 0 ? '+' : ''}£${(player.cost_change_start / 10).toFixed(1)}m</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      ${secondaryBackTarget ? `<div class="back-fallback">Not coming from Players? <a href="${secondaryBackTarget}">Return to last page</a> or <a href="#/all-players">browse all players</a>.</div>` : ''}
    `;

    const backBtn = main.querySelector(".back-btn");
    if (backBtn) {
      backBtn.addEventListener("click", (e) => {
        e.preventDefault();
        location.hash = backTarget || "#/all-players";
      });
      if (secondaryBackTarget) {
        backBtn.setAttribute("aria-label", "Back to previous list");
      }
    }
  } catch (e) {
    console.error("Player profile error:", e);
    main.innerHTML = `
      <div class="card error-404">
        <h2>Error Loading Player</h2>
        <p>We couldn't load this player right now. Check your connection and try again.</p>
        <div class="error-actions">
          <button class="btn-primary" onclick="location.hash='#/all-players'">Back to Players</button>
          <button class="btn" onclick="history.back()">Go Back</button>
        </div>
      </div>`;
  }
}

/* ---------- Team Profile ---------- */
async function renderTeamProfile(main, teamId) {
  // Show loading
  main.innerHTML = `<div class="card"><div class="loading-spinner"></div><p style="text-align:center;color:var(--muted)">Loading team...</p></div>`;

  try {
    const bs = await requireBootstrap();
    if (!bs) throw new Error("Bootstrap not available");
    const teams = bs.teams || [];
    const teamIdNum = Number(teamId);
    const teamById = new Map(teams.map(t => [Number(t.id), t]));
    const team = teamById.get(teamIdNum);

    if (!team) {
      main.innerHTML = `<div class="card error-404"><h2>Team Not Found</h2><p>No team with ID ${teamId}</p><button class="btn-primary" onclick="history.back()">Go Back</button></div>`;
      return;
    }

    const badgeUrl = `https://resources.premierleague.com/premierleague/badges/100/t${team.code}.png`;
    const players = (bs.elements || []).filter(p => Number(p.team) === teamIdNum);
    const positions = bs.element_types || [];

    // Group players by position
    const byPosition = {};
    positions.forEach(pos => {
      byPosition[pos.id] = players
        .filter(p => p.element_type === pos.id)
        .sort((a, b) => b.total_points - a.total_points);
    });

    // Calculate team stats
    const totalPoints = players.reduce((sum, p) => sum + p.total_points, 0);
    const avgForm = players.length ? (players.reduce((sum, p) => sum + parseFloat(p.form || 0), 0) / players.length).toFixed(1) : "0.0";
    const topScorer = players.reduce((best, p) => p.total_points > (best?.total_points || 0) ? p : best, null);

    // Get strength breakdown with proper fallbacks
    const strengthAttHome = team.strength_attack_home || team.strengthAttackHome || 0;
    const strengthAttAway = team.strength_attack_away || team.strengthAttackAway || 0;
    const strengthDefHome = team.strength_defence_home || team.strengthDefenceHome || 0;
    const strengthDefAway = team.strength_defence_away || team.strengthDefenceAway || 0;
    const strengthHome = team.strength_overall_home || team.strengthOverallHome || 0;
    const strengthAway = team.strength_overall_away || team.strengthOverallAway || 0;

    // Strength tooltip explanation
    const strengthTooltip = "FPL's 1-1250 scale measuring team quality. Higher = stronger. Used to calculate Fixture Difficulty Rating (FDR).";

    const clampFDR = (n) => Math.max(1, Math.min(5, Number(n) || 3));

    // Upcoming + recent fixtures
    let allFixtures = [];
    let fixturesSource = null;
    let fixturesError = null;

    try {
      allFixtures = await api.fixtures();
      fixturesSource = navigator.onLine ? "Live data" : "Offline cache";
    } catch (err) {
      log.warn("Fixtures fetch failed for team profile", err);
      fixturesError = "Fixtures unavailable right now.";
    }

    const teamFixtures = allFixtures.filter(f => f.team_h === teamIdNum || f.team_a === teamIdNum);
    const upcoming = teamFixtures
      .filter(f => !f.finished && !f.finished_provisional)
      .sort((a, b) => new Date(a.kickoff_time || 0) - new Date(b.kickoff_time || 0))
      .slice(0, 5);
    const recent = teamFixtures
      .filter(f => f.finished || f.finished_provisional)
      .sort((a, b) => new Date(b.kickoff_time || 0) - new Date(a.kickoff_time || 0))
      .slice(0, 5);

    const formatResult = (fx) => {
      if (!Number.isFinite(fx.team_h_score) || !Number.isFinite(fx.team_a_score)) return "FT";
      const isHome = fx.team_h === teamIdNum;
      const gf = isHome ? fx.team_h_score : fx.team_a_score;
      const ga = isHome ? fx.team_a_score : fx.team_h_score;
      const outcome = gf > ga ? "W" : gf === ga ? "D" : "L";
      return `${outcome} ${gf}-${ga}`;
    };

    const teamPinned = isTeamPinned(teamIdNum);

    main.innerHTML = `
      <div class="team-profile">
        <div class="profile-header">
          <div class="profile-header-actions">
            <button class="back-btn" onclick="history.back()">← Back</button>
            <button class="pin-team-btn ${teamPinned ? "active" : ""}" data-team-id="${teamIdNum}">
              ${teamPinned ? "Unpin Team" : "Pin Team"}
            </button>
          </div>
          <div class="profile-info">
            <img class="team-badge-large" src="${badgeUrl}" alt="${team.name}">
            <div class="profile-details">
              <h1 class="profile-name">${team.name}</h1>
              <div class="profile-meta">
                <span class="team-short">${team.short_name}</span>
                <span data-tooltip="${strengthTooltip}">Strength: ${team.strength}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="profile-stats-grid profile-stats-grid--wide">
          <div class="stat-card">
            <div class="stat-value">${players.length}</div>
            <div class="stat-label">Squad Size</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${totalPoints}</div>
            <div class="stat-label">Total FPL Pts</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" data-tooltip="Average form across all players">${avgForm}</div>
            <div class="stat-label">Avg Form</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" data-tooltip="${strengthTooltip}">${team.strength}</div>
            <div class="stat-label">Strength</div>
          </div>
        </div>

        <div class="profile-insights-grid">
          <div class="profile-section">
            <div class="section-heading">
              <h3 data-tooltip="${strengthTooltip}">Strength Breakdown</h3>
              <span class="data-chip" title="${strengthTooltip}">Scale 1-1250</span>
            </div>
            <div class="stats-table stats-table--compact">
              <div class="stat-row" data-tooltip="${strengthTooltip}"><span>Overall Home</span><span>${strengthHome}</span></div>
              <div class="stat-row" data-tooltip="${strengthTooltip}"><span>Overall Away</span><span>${strengthAway}</span></div>
              <div class="stat-row" data-tooltip="${strengthTooltip}"><span>Attack Home</span><span>${strengthAttHome}</span></div>
              <div class="stat-row" data-tooltip="${strengthTooltip}"><span>Attack Away</span><span>${strengthAttAway}</span></div>
              <div class="stat-row" data-tooltip="${strengthTooltip}"><span>Defence Home</span><span>${strengthDefHome}</span></div>
              <div class="stat-row" data-tooltip="${strengthTooltip}"><span>Defence Away</span><span>${strengthDefAway}</span></div>
            </div>
          </div>

          <div class="profile-section">
            <div class="section-heading">
              <h3>Upcoming Fixtures</h3>
              ${fixturesSource ? `<span class="data-chip">${fixturesSource}</span>` : ""}
            </div>
            ${upcoming.length ? `
              <ul class="inline-fixture-list">
                ${upcoming.map(f => {
                  const isHome = f.team_h === teamIdNum;
                  const oppId = isHome ? f.team_a : f.team_h;
                  const opp = teamById.get(Number(oppId));
                  const diff = clampFDR(isHome ? f.team_h_difficulty : f.team_a_difficulty);
                  const date = f.kickoff_time ? new Date(f.kickoff_time).toLocaleDateString("en-GB", { month: "short", day: "numeric" }) : "TBC";
                  return `
                    <li class="inline-fixture-row">
                      <span class="fixture-opp" title="${opp?.name || "Opponent"}">${isHome ? "H" : "A"} ${opp?.name || oppId}</span>
                      <span class="fixture-meta">GW ${f.event ?? "?"} • ${date}</span>
                      <span class="fdr fdr-${diff}" aria-label="Fixture difficulty ${diff}">FDR ${diff}</span>
                    </li>
                  `;
                }).join("")}
              </ul>
            ` : `
              <div class="empty-inline">
                <span class="empty-icon">📆</span>
                <div>
                  <div class="empty-title">No upcoming fixtures</div>
                  <div class="empty-sub">${fixturesError || "Fixtures could not be fetched."}</div>
                </div>
                <a href="#/fixtures" class="empty-link">Open fixtures</a>
              </div>
            `}
          </div>

          <div class="profile-section">
            <div class="section-heading">
              <h3>Recent Form</h3>
              ${fixturesSource ? `<span class="data-chip">${fixturesSource}</span>` : ""}
            </div>
            ${recent.length ? `
              <div class="stat-rows">
                ${recent.map(f => {
                  const isHome = f.team_h === teamIdNum;
                  const oppId = isHome ? f.team_a : f.team_h;
                  const opp = teamById.get(Number(oppId));
                  return `
                    <div class="stat-row">
                      <span>${isHome ? "H" : "A"} ${opp?.short_name || oppId}</span>
                      <span>${formatResult(f)}</span>
                    </div>
                  `;
                }).join("")}
              </div>
            ` : `
              <div class="empty-inline">
                <span class="empty-icon">ℹ️</span>
                <div>
                  <div class="empty-title">Form unavailable</div>
                  <div class="empty-sub">${fixturesError || "We couldn't load recent results."}</div>
                </div>
              </div>
            `}
          </div>

          ${topScorer ? `
            <div class="profile-section">
              <h3>Top FPL Performer</h3>
              <a href="#/player/${topScorer.id}" class="top-performer-card">
                <div class="top-performer-info">
                  <span class="top-performer-name">${topScorer.web_name}</span>
                  <span class="top-performer-pos">${positions.find(p => p.id === topScorer.element_type)?.singular_name || ''}</span>
                </div>
                <div class="top-performer-stats">
                  <span class="top-performer-pts">${topScorer.total_points} pts</span>
                  <span class="top-performer-price">£${(topScorer.now_cost / 10).toFixed(1)}m</span>
                </div>
              </a>
            </div>
          ` : ''}

          <div class="profile-section squad-full">
            <div class="section-heading">
              <h3>Squad (${players.length} players)</h3>
              <span class="data-chip">Sorted by FPL pts</span>
            </div>
            ${positions.map(pos => {
              const posPlayers = byPosition[pos.id] || [];
              if (posPlayers.length === 0) return '';
              return `
                <div class="squad-position">
                  <h4>${pos.plural_name || pos.singular_name}</h4>
                  <div class="squad-grid">
                    ${posPlayers.map(p => `
                      <a href="#/player/${p.id}" class="squad-player">
                        <span class="squad-player-name">${p.web_name}</span>
                        <span class="squad-player-pts">${p.total_points} pts</span>
                        <span class="squad-player-price">£${(p.now_cost / 10).toFixed(1)}m</span>
                      </a>
                    `).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    const pinBtn = main.querySelector(".pin-team-btn");
    if (pinBtn) {
      pinBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const pinned = togglePinnedTeam(teamId);
        pinBtn.classList.toggle("active", pinned);
        pinBtn.textContent = pinned ? "Unpin Team" : "Pin Team";
        renderPinnedSidebar();
      });
    }
  } catch (e) {
    console.error("Team profile error:", e);
    main.innerHTML = `
      <div class="card error-404">
        <h2>Error Loading Team</h2>
        <p>We couldn't load this team right now. Please check your connection and retry.</p>
        <div class="error-actions">
          <button class="btn-primary" onclick="location.hash='#/fixtures'">See Fixtures</button>
          <button class="btn" onclick="history.back()">Go Back</button>
        </div>
      </div>`;
  }
}

function navigate(hash, previousHash = null) {
  const main = document.querySelector("main");
  const currentHash = hash || location.hash || "#/";
  const result = getTabFromHash(currentHash);
  const prev = previousHash ?? lastHashValue ?? "#/";

  if (result.tab !== "player") {
    lastNonPlayerHash = currentHash;
    if (result.tab === "all-players") {
      lastPlayersHash = currentHash;
    }
  }

  if (!result.valid) {
    render404(main, result.tab);
    highlightActiveNav(null);
    return;
  }

  main.innerHTML = "";

  // Track page navigation
  const pageName = result.tab || "portal";
  log.info(`Navigating to: ${pageName}`);

  // Handle dynamic routes
  if (result.tab === "player" && result.params.playerId) {
    const cameFromPlayers = prev.includes("#/all-players");
    const backTarget = cameFromPlayers ? prev : (lastPlayersHash || "#/all-players");
    const secondaryBackTarget = cameFromPlayers ? null : (lastNonPlayerHash || "#/");
    renderPlayerProfile(main, result.params.playerId, { backTarget, secondaryBackTarget });
    highlightActiveNav("all-players");
    setPageUpdated("player");
  } else if (result.tab === "team" && result.params.teamId) {
    renderTeamProfile(main, result.params.teamId);
    highlightActiveNav("fixtures");
    setPageUpdated("team");
  } else {
    const render = routes[result.tab];
    render(main);
    highlightActiveNav(result.tab);
    setPageUpdated(pageName);
  }

  initTooltips(main);

  // Update last hash for future back-navigation
  lastHashValue = currentHash;
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

function renderPinnedSidebar() {
  const teamList = document.getElementById("pinnedTeamsList");
  const playerList = document.getElementById("pinnedPlayersList");

  if (teamList) {
    teamList.innerHTML = "";
    const pinned = getPinnedTeams();
    const hasData = pinned.length > 0 && state.bootstrap?.teams?.length;
    if (!hasData) {
      teamList.classList.add("is-empty");
      teamList.innerHTML = `
        <li class="pin-placeholder">
          <div class="empty-title">No pinned teams yet</div>
          <div class="empty-sub">Open a team page and click <strong>Pin Team</strong>.</div>
        </li>
      `;
    } else {
      teamList.classList.remove("is-empty");
      const teamById = new Map(state.bootstrap.teams.map(t => [t.id, t]));
      pinned.forEach(id => {
        const t = teamById.get(id);
        const name = t?.name || `Team ${id}`;
        const li = document.createElement("li");
        li.className = "pin-row";
        li.innerHTML = `<a href="#/team/${id}" class="pin-link">${name}</a>`;
        teamList.append(li);
      });
    }
  }

  if (playerList) {
    playerList.innerHTML = "";
    const watchlist = getWatchlist();
    const hasData = watchlist.length > 0 && state.bootstrap?.elements?.length;
    if (!hasData) {
      playerList.classList.add("is-empty");
      playerList.innerHTML = `
        <li class="pin-placeholder">
          <div class="empty-title">No pinned players yet</div>
          <div class="empty-sub">Use the ☆ button on player cards to pin them here.</div>
        </li>
      `;
    } else {
      playerList.classList.remove("is-empty");
      const playerById = new Map(state.bootstrap.elements.map(p => [p.id, p]));
      watchlist.forEach(id => {
        const p = playerById.get(id);
        const name = p ? `${p.first_name} ${p.second_name}` : `Player ${id}`;
        const li = document.createElement("li");
        li.className = "pin-row";
        li.innerHTML = `<a href="#/player/${id}" class="pin-link">${name}</a>`;
        playerList.append(li);
      });
    }
  }
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

function updateSidebarStats() {
  const bs = state.bootstrap;
  if (!bs) return;

  setText("teamsCount", (bs.teams?.length ?? "—").toString());
  setText("playersCount", (bs.elements?.length ?? "—").toString());

  const { lastFinished } = computeMarkers(bs.events || []);
  setText("lastFinishedGw", lastFinished ? String(lastFinished.id) : "—");

  const note = document.querySelector(".sidebar .sidebar-note");
  if (note) note.textContent = "Live-aware: shows the current GW when it's in progress.";
}

function applyBootstrapData(bs, meta = {}) {
  const cacheTimestamp =
    meta.cacheTimestamp ?? meta.timestamp ??
    (meta.cacheAge != null ? Date.now() - meta.cacheAge : Date.now());

  const mergedMeta = { ...meta, cacheTimestamp };
  state.bootstrap = bs;
  state.bootstrapMeta = mergedMeta;
  bootstrapMeta = mergedMeta;
  if (!mergedMeta.fromCache && !mergedMeta.stale) {
    bootstrapBannerDismissed = false;
  }

  updateLastFetchTime(cacheTimestamp);
  setHeaderStatusFromBootstrap(bs);
  startDeadlineCountdown();
  updateSidebarStats();
  renderPinnedSidebar();
  renderBootstrapBanner();
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

/* ---------- Global Search ---------- */
function bindGlobalSearch() {
  const input = document.getElementById("globalSearchInput");
  const results = document.getElementById("globalSearchResults");
  if (!input || !results) return;

  let searchActive = -1;
  let searchItems = [];

  const setActiveIndex = (idx) => {
    searchActive = idx;
    searchItems.forEach((item, i) => item.classList.toggle("active", i === searchActive));
  };

  function hideResults() {
    results.classList.remove("active");
    results.innerHTML = "";
    searchItems = [];
    searchActive = -1;
  }

  function showResults() {
    const term = utils.normalizeText(input.value.trim());
    if (term.length < 2) {
      hideResults();
      return;
    }

    const bs = state.bootstrap;
    if (!bs) {
      results.innerHTML = '<div class="search-result-item"><span class="result-name" style="color:var(--muted)">Player search unavailable: bootstrap not loaded</span></div>';
      results.classList.add("active");
      searchItems = Array.from(results.querySelectorAll(".search-result-item"));
      searchActive = -1;
      return;
    }

    results.innerHTML = "";
    searchItems = [];

    // Search players (accent-insensitive: "odegaard" matches "Ødegaard", "guehi" matches "Guéhi")
    const players = (bs.elements || [])
      .filter(p => utils.normalizeText(`${p.first_name} ${p.second_name} ${p.web_name}`).includes(term))
      .slice(0, 5);

    // Search teams (accent-insensitive)
    const teams = (bs.teams || [])
      .filter(t => utils.normalizeText(t.name).includes(term) || utils.normalizeText(t.short_name).includes(term))
      .slice(0, 3);

    // Pages
    const pages = [
      { name: "My Team", route: "#/my-team", icon: "⚽" },
      { name: "All Players", route: "#/all-players", icon: "👥" },
      { name: "Fixtures", route: "#/fixtures", icon: "📅" },
      { name: "GW Explorer", route: "#/gw-explorer", icon: "🔍" },
      { name: "Mini-League", route: "#/mini-league", icon: "🏆" },
      { name: "Help", route: "#/help", icon: "❓" },
    ].filter(p => utils.normalizeText(p.name).includes(term));

    if (pages.length) {
      const group = document.createElement("div");
      group.className = "search-result-group";
      group.textContent = "Pages";
      results.appendChild(group);

      pages.forEach(page => {
        const item = document.createElement("div");
        item.className = "search-result-item";
        item.innerHTML = `
          <span class="result-icon">${page.icon}</span>
          <span class="result-name">${page.name}</span>
        `;
        item.addEventListener("click", () => {
          location.hash = page.route;
          hideResults();
          input.value = "";
        });
        item.addEventListener("mouseenter", () => setActiveIndex(searchItems.indexOf(item)));
        results.appendChild(item);
        searchItems.push(item);
      });
    }

    if (players.length) {
      const group = document.createElement("div");
      group.className = "search-result-group";
      group.textContent = "Players";
      results.appendChild(group);

      const teamMap = new Map((bs.teams || []).map(t => [t.id, t.short_name]));
      players.forEach(p => {
        const item = document.createElement("div");
        item.className = "search-result-item";
        item.dataset.playerId = p.id; // Use stable ID
        item.innerHTML = `
          <span class="result-icon">👤</span>
          <span class="result-name">${p.web_name}</span>
          <span class="result-meta">${teamMap.get(p.team) || ""} · £${(p.now_cost / 10).toFixed(1)}m</span>
        `;
        item.addEventListener("click", () => {
          // Route directly to player profile using ID
          location.hash = `#/player/${p.id}`;
          hideResults();
          input.value = "";
        });
        item.addEventListener("mouseenter", () => setActiveIndex(searchItems.indexOf(item)));
        results.appendChild(item);
        searchItems.push(item);
      });
    }

    if (teams.length) {
      const group = document.createElement("div");
      group.className = "search-result-group";
      group.textContent = "Teams";
      results.appendChild(group);

      teams.forEach(t => {
        const item = document.createElement("div");
        item.className = "search-result-item";
        item.dataset.teamId = t.id; // Use stable ID
        item.innerHTML = `
          <span class="result-icon">🏟️</span>
          <span class="result-name">${t.name}</span>
          <span class="result-meta" title="${t.name}">${t.short_name}</span>
        `;
        item.addEventListener("click", () => {
          // Route directly to team fixtures using ID
          location.hash = `#/team/${t.id}`;
          hideResults();
          input.value = "";
        });
        item.addEventListener("mouseenter", () => setActiveIndex(searchItems.indexOf(item)));
        results.appendChild(item);
        searchItems.push(item);
      });
    }

    if (searchItems.length === 0) {
      results.innerHTML = '<div class="search-result-item"><span class="result-name" style="color:var(--muted)">No results found</span></div>';
    }

    results.classList.add("active");
    searchActive = -1;
  }

  input.addEventListener("input", showResults);
  input.addEventListener("focus", showResults);

  input.addEventListener("keydown", (e) => {
    if (!results.classList.contains("active")) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(searchActive + 1, searchItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(searchActive - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searchItems.length) {
        const target = searchActive >= 0 ? searchItems[searchActive] : searchItems[0];
        target?.click();
      }
    } else if (e.key === "Escape") {
      hideResults();
      input.blur();
    }
  });

  document.addEventListener("click", (e) => {
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    const firstEl =
      path.find(n => n instanceof Element) ||
      (e.target instanceof Element ? e.target : e.target?.parentElement);

    if (!firstEl) return;

    if (!firstEl.closest(".global-search")) {
      hideResults();
    }
  });
}

function primeBootstrapFromCache() {
  if (state.bootstrap) return;
  const cached = fplClient.loadBootstrapFromCache();
  if (cached.ok) {
    const meta = {
      fromCache: true,
      cacheAge: cached.cacheAge,
      cacheTimestamp: cached.cacheTimestamp || (cached.cacheAge ? Date.now() - cached.cacheAge : Date.now()),
      stale: true,
      apiBase: cached.meta?.apiBase || getApiBase(),
    };
    applyBootstrapData(cached.data, meta);
    setApiStatus(ApiStatus.OFFLINE, "Using cached bootstrap");
  }
}

async function fetchBootstrap({ allowCacheFallback = true, forceRefresh = false } = {}) {
  let lastFailure = null;
  try {
    const result = await fplClient.bootstrap({ forceRefresh });
    if (result.ok) {
      const meta = {
        fromCache: !!result.fromCache,
        cacheAge: result.cacheAge ?? 0,
        cacheTimestamp: result.cacheTimestamp || (result.cacheAge ? Date.now() - result.cacheAge : Date.now()),
        stale: !!result.stale,
        apiBase: result.meta?.apiBase || getApiBase(),
      };
      applyBootstrapData(result.data, meta);
      const detail = meta.stale || meta.fromCache
        ? "Using cached bootstrap data"
        : `Connected to API (${meta.apiBase})`;
      setApiStatus(meta.stale ? ApiStatus.OFFLINE : ApiStatus.LIVE, detail);
      return { ok: true, meta };
    }
    lastFailure = result;
  } catch (e) {
    log.warn("Bootstrap fetch failed - some features may be limited:", e);
    lastFailure = lastFailure || e;
  }

  if (allowCacheFallback) {
    const cached = fplClient.loadBootstrapFromCache();
    if (cached.ok) {
      const meta = {
        fromCache: true,
        cacheAge: cached.cacheAge,
        cacheTimestamp: cached.cacheTimestamp || (cached.cacheAge ? Date.now() - cached.cacheAge : Date.now()),
        stale: true,
        apiBase: cached.meta?.apiBase || getApiBase(),
      };
      applyBootstrapData(cached.data, meta);
      setApiStatus(ApiStatus.OFFLINE, "Using cached bootstrap (API unreachable)");
      return { ok: true, meta, fallback: true };
    }
  }

  setApiStatus(ApiStatus.OFFLINE, "Bootstrap not loaded — check API base");
  return { ok: false, code: lastFailure?.code || null, message: lastFailure?.message || null };
}

async function requireBootstrap() {
  if (state.bootstrap) return state.bootstrap;
  await fetchBootstrap({ allowCacheFallback: true });
  return state.bootstrap;
}

/* -------------------- INIT -------------------- */
async function init() {
  // Initialize theme first (prevents flash)
  initTheme();
  bindThemeToggle();
  renderPinnedSidebar();
  setApiStatus(ApiStatus.UPDATING, "Starting up…");
  bindApiStatusEvents();
  registerServiceWorker();

  primeBootstrapFromCache();
  await fetchBootstrap({ allowCacheFallback: true });

  // Top bar version with commit hash
  const versionEl = document.getElementById("appVersion");
  if (versionEl) {
    versionEl.innerHTML = `${APP_VERSION}<span class="commit-hash">${COMMIT_HASH ? ` (${COMMIT_HASH})` : ''}</span>`;
  }

  log.info(`FPL Dashboard initialized - v${APP_VERSION} (${COMMIT_HASH || 'dev'})`);

  bindSidebar();
  bindCopyEntryId();
  bindCopyExampleUrls();
  bindKeyboardShortcuts();
  bindRefreshButton();
  bindGlobalSearch();
  initSidebar();
  initChartDefaults();
  initTooltips(document.body);
  initTooltipPositioning();
  initNavScrollAffordance();
  window.addEventListener("watchlist-changed", renderPinnedSidebar);
  window.addEventListener("pinned-teams-changed", renderPinnedSidebar);

  if (!location.hash) location.hash = "#/";
  let lastHashSeen = location.hash || "#/";
  navigate(location.hash, lastHashSeen);
  window.addEventListener("hashchange", () => {
    const newHash = location.hash || "#/";
    navigate(newHash, lastHashSeen);
    lastHashSeen = newHash;
  });
}

/* ---------- Navigation Scroll Affordance ---------- */
function initNavScrollAffordance() {
  const container = document.getElementById("navContainer");
  const nav = document.getElementById("mainNav");

  if (!container || !nav) return;

  // Overflow handler - move excess links into a "More" menu
  const moreWrap = document.createElement("div");
  moreWrap.className = "nav-more";
  const moreBtn = document.createElement("button");
  moreBtn.className = "nav-more-btn";
  moreBtn.type = "button";
  moreBtn.setAttribute("aria-haspopup", "true");
  moreBtn.setAttribute("aria-expanded", "false");
  moreBtn.textContent = "More…";
  const moreMenu = document.createElement("div");
  moreMenu.className = "nav-more-menu";
  moreWrap.append(moreBtn, moreMenu);
  nav.appendChild(moreWrap);

  const closeMore = () => {
    moreWrap.classList.remove("open");
    moreBtn.setAttribute("aria-expanded", "false");
  };

  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextState = !moreWrap.classList.contains("open");
    moreWrap.classList.toggle("open", nextState);
    moreBtn.setAttribute("aria-expanded", String(nextState));
  });

  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target && target.closest(".nav-more")) return;
    closeMore();
  });

  function redistributeNav() {
    // Move any overflowed links back into the main nav before recalculating
    Array.from(moreMenu.children).forEach(link => {
      nav.insertBefore(link, moreWrap);
    });

    const navLinks = Array.from(nav.querySelectorAll(".nav-link")).filter((link) => link.closest(".nav") === nav);
    const availableWidth = nav.clientWidth - moreWrap.offsetWidth - 8; // gap padding
    let used = 0;
    let overflowStarted = false;

    for (const link of navLinks) {
      const linkWidth = link.getBoundingClientRect().width + 6; // include gap
      if (!overflowStarted && used + linkWidth <= availableWidth) {
        used += linkWidth;
        continue;
      }
      overflowStarted = true;
      moreMenu.appendChild(link);
    }

    moreWrap.classList.toggle("has-items", moreMenu.children.length > 0);
    if (!moreMenu.children.length) closeMore();
  }

  function updateScrollAffordance() {
    const scrollLeft = nav.scrollLeft;
    const scrollWidth = nav.scrollWidth;
    const clientWidth = nav.clientWidth;
    const maxScroll = scrollWidth - clientWidth;

    // Show left gradient if scrolled right
    container.classList.toggle("scroll-left", scrollLeft > 5);
    // Show right gradient if more content to right
    container.classList.toggle("scroll-right", scrollLeft < maxScroll - 5);
  }

  // Update on scroll
  nav.addEventListener("scroll", updateScrollAffordance, { passive: true });

  // Update on resize (layout + overflow redistribution)
  window.addEventListener("resize", () => {
    redistributeNav();
    updateScrollAffordance();
  }, { passive: true });

  // Initial check
  redistributeNav();
  updateScrollAffordance();
}

// Tooltip positioning - adds classes for edge detection
function initTooltipPositioning() {
  document.addEventListener("mouseenter", (e) => {
    const t = e.target;
    const el = (t instanceof Element) ? t : t?.parentElement;
    if (!el) return;

    const tip = el.closest("[data-tooltip], .abbr-tip");
    if (!tip) return;

    const rect = tip.getBoundingClientRect();
    const vw = window.innerWidth;

    tip.classList.remove("tooltip-bottom", "tooltip-left", "tooltip-right", "tooltip-scroll");

    if (rect.top < 80) tip.classList.add("tooltip-bottom");
    if (rect.left < 150) tip.classList.add("tooltip-left");
    else if (rect.right > vw - 150) tip.classList.add("tooltip-right");

    const content = tip.dataset?.tooltip || tip.getAttribute("data-tooltip") || "";
    if (content.length > 200) tip.classList.add("tooltip-scroll");
  }, true);
}


document.addEventListener("DOMContentLoaded", init);
