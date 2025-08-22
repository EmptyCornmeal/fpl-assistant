// js/state.js
const LS = {
    entryId: "fpl.entryId",
    leagueIds: "fpl.leagueIds",
    theme: "fpl.theme",
  };
  
  function readJSON(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || "") ?? fallback; }
    catch { return fallback; }
  }
  
  export const state = {
    get entryId(){ return localStorage.getItem(LS.entryId) || ""; },
    setEntryId(v){ localStorage.setItem(LS.entryId, (v||"").trim()); },
  
    get leagueIds(){ return readJSON(LS.leagueIds, []); },
    setLeagueIds(arr){ localStorage.setItem(LS.leagueIds, JSON.stringify((arr||[]).map(s=>String(s).trim()).filter(Boolean))); },
  
    get theme(){ return localStorage.getItem(LS.theme) || "dark"; },
    setTheme(v){ localStorage.setItem(LS.theme, v); document.documentElement.setAttribute("data-theme", v); },
  
    bootstrap: null,
  };
  
  // apply theme on load
  document.documentElement.setAttribute("data-theme", state.theme);
  