// js/pages/help.js
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { state } from "../state.js";

export function renderHelp(main){
  main.innerHTML = "";

  // Compact 2x2 grid layout - fits viewport without scrolling
  const page = utils.el("div", { class: "help-dashboard" });

  // TOP LEFT: Quick Start
  const quickStartCard = utils.el("div", { class: "tile help-tile" });
  quickStartCard.innerHTML = `
    <div class="tile-header">
      <span class="tile-title">🚀 Quick Start</span>
    </div>
    <div class="tile-body help-body">
      <ol class="help-list">
        <li>Enter your <strong>Entry ID</strong> in the sidebar</li>
        <li>Add <strong>League IDs</strong> (comma-separated)</li>
        <li>Navigate: Team → Players → Fixtures → Explorer</li>
        <li>Use <strong>theme toggle</strong> (top right) for light/dark</li>
      </ol>
    </div>
  `;
  page.append(quickStartCard);

  // TOP RIGHT: Pages Overview (condensed)
  const pagesCard = utils.el("div", { class: "tile help-tile" });
  pagesCard.innerHTML = `
    <div class="tile-header">
      <span class="tile-title">📄 Pages Overview</span>
    </div>
    <div class="tile-body help-body help-scroll">
      <div class="help-section">
        <strong>My Team</strong>
        <span class="help-desc">XI, bench, captain, status badges, insights</span>
      </div>
      <div class="help-section">
        <strong>Players</strong>
        <span class="help-desc">Scatter chart + table, filter by team/position/price</span>
      </div>
      <div class="help-section">
        <strong>Fixtures</strong>
        <span class="help-desc">FDR matrix, fixture swings, next 3/5/8 GWs</span>
      </div>
      <div class="help-section">
        <strong>Explorer</strong>
        <span class="help-desc">GW breakdown, top performers, team of the week</span>
      </div>
      <div class="help-section">
        <strong>League</strong>
        <span class="help-desc">Standings, charts, rank history, Top XI</span>
      </div>
      <div class="help-section">
        <strong>Stat Picker</strong>
        <span class="help-desc">Optimal XI, transfer advice, chip strategy</span>
      </div>
    </div>
  `;
  page.append(pagesCard);

  // BOTTOM LEFT: Keyboard Shortcuts + Glossary Combined
  const shortcutsCard = utils.el("div", { class: "tile help-tile" });
  shortcutsCard.innerHTML = `
    <div class="tile-header">
      <span class="tile-title">⌨️ Shortcuts & Glossary</span>
    </div>
    <div class="tile-body help-body help-scroll">
      <div class="help-grid-compact">
        <div class="help-shortcut"><kbd>1</kbd><span>My Team</span></div>
        <div class="help-shortcut"><kbd>2</kbd><span>Players</span></div>
        <div class="help-shortcut"><kbd>3</kbd><span>Fixtures</span></div>
        <div class="help-shortcut"><kbd>4</kbd><span>Explorer</span></div>
        <div class="help-shortcut"><kbd>5</kbd><span>League</span></div>
        <div class="help-shortcut"><kbd>S</kbd><span>Sidebar</span></div>
      </div>
      <div class="help-divider"></div>
      <div class="help-glossary">
        <span class="gloss-item"><strong>xP</strong> Expected Pts</span>
        <span class="gloss-item"><strong>FDR</strong> Fixture Difficulty</span>
        <span class="gloss-item"><strong>EO</strong> Effective Ownership</span>
        <span class="gloss-item"><strong>BPS</strong> Bonus Points</span>
        <span class="gloss-item"><strong>xMins</strong> Projected Minutes</span>
        <span class="gloss-item"><strong>PPM</strong> Points per Million</span>
      </div>
    </div>
  `;
  page.append(shortcutsCard);

  // BOTTOM RIGHT: Tips + Status
  const tipsCard = utils.el("div", { class: "tile help-tile" });
  tipsCard.innerHTML = `
    <div class="tile-header">
      <span class="tile-title">💡 Tips</span>
    </div>
    <div class="tile-body help-body">
      <ul class="help-tips">
        <li>If requests fail, pause ad-blocking</li>
        <li>Data updates after FPL marks GW finished</li>
        <li>Click column headers to sort tables</li>
        <li>xP/xMins computed for visible rows only</li>
      </ul>
      <div class="help-status">
        <span>Entry: <strong>${state.entryId || "—"}</strong></span>
        <span>Leagues: <strong>${Array.isArray(state.leagueIds) ? state.leagueIds.join(", ") || "—" : "—"}</strong></span>
      </div>
    </div>
  `;
  page.append(tipsCard);

  ui.mount(main, page);
}

/* ---------- tiny helpers for nicer layout ---------- */

function section(title, parts){
  const box = utils.el("div",{style:"margin:10px 0"});
  box.append(utils.el("h4",{},title));
  parts.forEach(p=>{
    if (typeof p === "string") box.append(utils.el("p",{},p));
    else box.append(p);
  });
  return box;
}
function bullet(rows){
  const ul = utils.el("ul",{class:"bullets"});
  rows.forEach(([k,v])=>{
    ul.append(utils.el("li",{},[utils.el("b",{},`${k}: `), v]));
  });
  return ul;
}
function grid(items){
  const wrap = utils.el("div",{class:"grid cols-3"});
  items.forEach(([k,v])=>{
    const cell = utils.el("div",{class:"metric"});
    cell.append(utils.el("div",{class:"label"},k), utils.el("div",{class:"value"},v));
    wrap.append(cell);
  });
  return wrap;
}
function li(text){ return utils.el("li",{},text); }
