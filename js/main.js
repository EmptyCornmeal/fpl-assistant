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
  // ensure tooltips are active for newly-rendered content
  initTooltips(main);
}

function qsAny(...sel) {
  for (const s of sel) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function setStatePatch(patch) {
  // Works whether state is a plain object or exposes a .set()
  if (typeof state.set === "function") state.set(patch);
  else Object.assign(state, patch);
}

function bindSidebar() {
  // Support both new and legacy IDs
  const entryInput = qsAny("#entryIdInput", "#entry-id");
  const leagueInput = qsAny("#leagueIdInput", "#league-ids");
  const saveBtn = qsAny("#saveIdsBtn", "#save-ids");

  if (entryInput) entryInput.value = state.entryId ?? "";
  if (leagueInput) leagueInput.value = (state.leagueIds || []).join(", ");

  saveBtn?.addEventListener("click", () => {
    const entryIdRaw = entryInput?.value?.trim();
    const leaguesRaw = leagueInput?.value || "";
    const leagues = leaguesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setStatePatch({
      entryId: entryIdRaw ? Number(entryIdRaw) : null,
      leagueIds: leagues,
    });

    navigate(location.hash); // re-render current route
  });
}

/* -------------------- THEME -------------------- */
/* CSS expects :root[data-theme="light"] for light mode.
   Default (no attribute) = dark. */
function setTheme(mode) {
  const root = document.documentElement;
  const btn = document.getElementById("themeToggleBtn");
  if (mode === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");

  localStorage.setItem("fpl.theme", mode);
  if (btn) {
    btn.textContent = mode === "light" ? "🌞 Theme" : "🌓 Theme";
    btn.setAttribute(
      "aria-label",
      `Switch to ${mode === "light" ? "dark" : "light"} theme`
    );
    btn.title = btn.getAttribute("aria-label");
  }
}

function initTheme() {
  const saved = localStorage.getItem("fpl.theme") || "dark";
  setTheme(saved);

  const btn = document.getElementById("themeToggleBtn");
  btn?.addEventListener("click", () => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    setTheme(isLight ? "dark" : "light");
  });
}

/* -------------------- INIT -------------------- */
async function init() {
  // Prefetch bootstrap (non-fatal if it fails)
  try {
    state.bootstrap = await api.bootstrap();
  } catch {}

  bindSidebar();
  initTheme();

  // One-time global tooltip handlers (page-level instance will be refreshed in navigate)
  initTooltips(document.body);

  if (!location.hash) location.hash = "#/my-team";
  navigate(location.hash);
  window.addEventListener("hashchange", () => navigate(location.hash));
}

document.addEventListener("DOMContentLoaded", init);
