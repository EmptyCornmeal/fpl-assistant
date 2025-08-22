import { api } from "./api.js";
import { state } from "./state.js";
import { utils } from "./utils.js";
import { renderMyTeam } from "./pages/my-team.js";
import { renderAllPlayers } from "./pages/all-players.js";
import { renderGwExplorer } from "./pages/gw-explorer.js";
import { renderPlanner } from "./pages/planner.js";
import { renderMiniLeague } from "./pages/mini-league.js";
import { renderHelp } from "./pages/help.js";
import { renderFixtures } from "./pages/fixtures.js";
import { initTooltips } from "./components/tooltip.js";

const routes = {
  "/my-team": renderMyTeam,
  "/all-players": renderAllPlayers,
  "/fixtures": renderFixtures,
  "/gw-explorer": renderGwExplorer,
  "/planner": renderPlanner,
  "/mini-league": renderMiniLeague,
  "/help": renderHelp,
};

async function init(){
  const entryInput = document.getElementById("entryIdInput");
  const leagueInput = document.getElementById("leagueIdInput");
  const saveBtn = document.getElementById("saveIdsBtn");
  const themeBtn = document.getElementById("themeToggleBtn");

  entryInput.value = state.entryId;
  leagueInput.value = state.leagueIds.join(", ");
  saveBtn.addEventListener("click", ()=>{
    state.setEntryId(entryInput.value);
    const ids = leagueInput.value.split(",").map(s=>s.trim()).filter(Boolean);
    state.setLeagueIds(ids);
    location.reload();
  });

  themeBtn.addEventListener("click", ()=>{
    const next = (state.theme === "dark" ? "light" : "dark");
    state.setTheme(next);
  });

  try{
    const bs = await api.bootstrap();
    state.bootstrap = bs;
    document.getElementById("teamsCount").textContent = bs.teams.length;
    document.getElementById("playersCount").textContent = bs.elements.length;
    const finished = bs.events.filter(e=>e.data_checked);
    document.getElementById("lastFinishedGw").textContent = finished.length? Math.max(...finished.map(e=>e.id)) : "—";
  }catch(e){ console.error(e); }

  const main = document.getElementById("app");
  function render(){
    const hash = location.hash || "#/my-team";
    const path = hash.replace("#","");
    const handler = routes[path] || renderMyTeam;
    handler(main);
    initTooltips(main); // hover glossary
  }
  window.addEventListener("hashchange", render);
  render();
}

document.addEventListener("DOMContentLoaded", init);
