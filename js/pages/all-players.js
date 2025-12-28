// js/pages/all-players.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { openModal } from "../components/modal.js";
import { xPWindow, estimateXMinsForPlayer } from "../lib/xp.js";

/* ========= LocalStorage keys ========= */
const LS_AP_FILTERS = "fpl.ap.filters";
const LS_AP_SORT    = "fpl.ap.sort";
const LS_AP_CHART   = "fpl.ap.chartmode"; // "points" | "xp"

/* ========= Player Photo URL ========= */
const PLAYER_PHOTO_URL = (photoId) => {
  if (!photoId) return null;
  // FPL API may supply .jpg or .png - strip either extension
  const cleanId = String(photoId).replace(/\.(png|jpg)$/i, '').replace(/^p/, '');
  return `https://resources.premierleague.com/premierleague/photos/players/110x140/p${cleanId}.png`;
};

/* ========= Compare Selection State ========= */
let compareSelection = []; // Array of player IDs (max 2)
let selectionBar = null;

/* ========= Defaults ========= */
const DEFAULTS = {
  q: "",
  posId: "",             // "", 1=GKP, 2=DEF, 3=MID, 4=FWD
  teamIds: [],           // multi-select
  priceMin: "",
  priceMax: "",
  status: "",            // "", a, d, i, s, n
  minutesFloor: false    // require xMins >= 60
};
const DEFAULT_SORT = { key: "total_points", dir: "desc" };
const DEFAULT_CHART_MODE = "points";

/* ========= Caches ========= */
const xpCache   = new Map(); // key: `${id}|${gwList}` -> { xmins, xpNext, xpWin }
const xgiCache  = new Map(); // key: id -> { xgi90 }
const easeCache = new Map(); // key: `${teamId}|${gwList}` -> number

/* ========= Helpers ========= */
function readLS(key, fallback){
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeLS(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function stableSort(arr, getter, dir="desc"){
  const withIndex = arr.map((v,i)=>({v,i}));
  withIndex.sort((a,b)=>{
    const av = getter(a.v), bv = getter(b.v);
    const cmp = (av>bv)-(av<bv);
    if (cmp !== 0) return dir==="desc" ? -cmp : cmp;
    return a.i - b.i;
  });
  return withIndex.map(x=>x.v);
}
function gwWindowIds(events, lastFinished, len=5){
  const nextGw = Math.max(1, (lastFinished||0) + 1);
  return events.filter(e=>e.id >= nextGw).slice(0,len).map(e=>e.id);
}
function teamFixtureForGW(fixturesByEvent, teamId, gwId, teamShortById){
  const list = fixturesByEvent.get(gwId) || [];
  for (const f of list){
    if (f.team_h === teamId) return { opp: teamShortById.get(f.team_a) || "?", home:true, fdr:f.team_h_difficulty };
    if (f.team_a === teamId) return { opp: teamShortById.get(f.team_h) || "?", home:false, fdr:f.team_a_difficulty };
  }
  return null;
}
function computeFixtureEase(fixturesByEvent, teamId, gws){
  const key = `${teamId}|${gws.join(",")}`;
  if (easeCache.has(key)) return easeCache.get(key);
  let sum = 0, cnt = 0;
  for (const gw of gws){
    const fx = fixturesByEvent.get(gw)?.find(f => f.team_h===teamId || f.team_a===teamId);
    if (fx){
      const home = fx.team_h===teamId;
      const fdr  = home ? fx.team_h_difficulty : fx.team_a_difficulty;
      const adj  = (fdr ?? 3) + (home ? 0 : 0.2);
      sum += adj; cnt++;
    }
  }
  const val = cnt ? +(sum/cnt).toFixed(2) : null; // lower = easier
  easeCache.set(key, val);
  return val;
}
const priceM = p => +(p.now_cost/10).toFixed(1);

/* ========= Compare Selection Functions ========= */
function updateSelectionBar(playerById, posShortById, teamShortById) {
  // Remove existing bar if no players selected
  if (compareSelection.length === 0) {
    if (selectionBar) {
      selectionBar.remove();
      selectionBar = null;
    }
    return;
  }

  // Create bar if it doesn't exist
  if (!selectionBar) {
    selectionBar = utils.el("div", { class: "compare-selection-bar" });
    document.body.appendChild(selectionBar);
  }

  // Update content
  selectionBar.innerHTML = "";

  const chipsWrap = utils.el("div", { class: "compare-chips" });
  compareSelection.forEach(id => {
    const p = playerById.get(id);
    if (!p) return;

    const chip = utils.el("div", { class: "compare-chip" });
    chip.innerHTML = `
      <span>${p.web_name}</span>
      <button class="remove-btn" data-id="${id}">&times;</button>
    `;
    chip.querySelector(".remove-btn").addEventListener("click", () => {
      compareSelection = compareSelection.filter(x => x !== id);
      updateSelectionBar(playerById, posShortById, teamShortById);
      updateCheckboxes();
    });
    chipsWrap.append(chip);
  });

  const compareBtn = utils.el("button", {
    class: "compare-btn",
    disabled: compareSelection.length < 2
  }, `Compare${compareSelection.length < 2 ? ` (${compareSelection.length}/2)` : ""}`);

  compareBtn.addEventListener("click", () => {
    if (compareSelection.length === 2) {
      showCompareModal(playerById, posShortById, teamShortById);
    }
  });

  const clearBtn = utils.el("button", { class: "clear-btn" }, "Clear");
  clearBtn.addEventListener("click", () => {
    compareSelection = [];
    updateSelectionBar(playerById, posShortById, teamShortById);
    updateCheckboxes();
  });

  selectionBar.append(chipsWrap, compareBtn, clearBtn);
}

function updateCheckboxes() {
  document.querySelectorAll(".player-select-checkbox").forEach(cb => {
    const id = Number(cb.dataset.playerId);
    cb.checked = compareSelection.includes(id);
    cb.disabled = !cb.checked && compareSelection.length >= 2;
  });
}

function showCompareModal(playerById, posShortById, teamShortById) {
  if (compareSelection.length !== 2) return;

  const [p1Data, p2Data] = compareSelection.map(id => playerById.get(id));
  if (!p1Data || !p2Data) return;

  const stats = [
    { label: "Total Points", key: "total_points", higher: true },
    { label: "Price", key: "now_cost", format: v => `£${(v/10).toFixed(1)}m`, higher: false },
    { label: "Form", key: "form", higher: true },
    { label: "Ownership", key: "selected_by_percent", format: v => `${(+v).toFixed(1)}%`, higher: false },
    { label: "Goals", key: "goals_scored", higher: true },
    { label: "Assists", key: "assists", higher: true },
    { label: "Clean Sheets", key: "clean_sheets", higher: true },
    { label: "Bonus", key: "bonus", higher: true },
    { label: "BPS", key: "bps", higher: true },
    { label: "ICT Index", key: "ict_index", higher: true },
  ];

  function createPlayerColumn(player, otherPlayer, isLeft) {
    const col = utils.el("div", { class: "compare-player" });

    // Header
    const header = utils.el("div", { class: "compare-player-header" });
    const photo = utils.el("img", {
      class: "compare-player-photo",
      src: PLAYER_PHOTO_URL(player.photo),
      alt: player.web_name
    });
    photo.onerror = () => {
      photo.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 110 140'%3E%3Crect fill='%23334155' width='110' height='140'/%3E%3Ctext x='55' y='80' text-anchor='middle' fill='%2394a3b8' font-size='40'%3E👤%3C/text%3E%3C/svg%3E";
    };

    const info = utils.el("div", { class: "compare-player-info" });
    info.innerHTML = `
      <h4>${player.web_name}</h4>
      <div class="sub">${teamShortById.get(player.team)} · ${posShortById.get(player.element_type)} · £${(player.now_cost/10).toFixed(1)}m</div>
    `;
    header.append(photo, info);

    // Stats
    const statsDiv = utils.el("div", { class: "compare-stats" });
    stats.forEach(stat => {
      const v1 = Number(player[stat.key]) || 0;
      const v2 = Number(otherPlayer[stat.key]) || 0;

      const isWinner = stat.higher ? (v1 > v2) : (v1 < v2);
      const isTie = v1 === v2;

      const row = utils.el("div", {
        class: `compare-stat-row ${isWinner && !isTie ? 'winner' : ''} ${!isWinner && !isTie ? 'loser' : ''}`
      });

      const displayVal = stat.format ? stat.format(player[stat.key]) : (player[stat.key] ?? 0);
      row.innerHTML = `
        <span class="label">${stat.label}</span>
        <span class="value">${displayVal}</span>
      `;
      statsDiv.append(row);
    });

    col.append(header, statsDiv);
    return col;
  }

  // Count wins
  let p1Wins = 0, p2Wins = 0;
  stats.forEach(stat => {
    const v1 = Number(p1Data[stat.key]) || 0;
    const v2 = Number(p2Data[stat.key]) || 0;
    if (stat.higher) {
      if (v1 > v2) p1Wins++;
      else if (v2 > v1) p2Wins++;
    } else {
      if (v1 < v2) p1Wins++;
      else if (v2 < v1) p2Wins++;
    }
  });

  const modalContent = utils.el("div", { class: "compare-modal" });
  modalContent.append(
    createPlayerColumn(p1Data, p2Data, true),
    createPlayerColumn(p2Data, p1Data, false)
  );

  // Verdict
  const verdict = utils.el("div", { class: "compare-verdict" });
  if (p1Wins > p2Wins) {
    verdict.innerHTML = `
      <h4>${p1Data.web_name} wins!</h4>
      <div class="sub">${p1Wins} stats better vs ${p2Wins}</div>
    `;
  } else if (p2Wins > p1Wins) {
    verdict.innerHTML = `
      <h4>${p2Data.web_name} wins!</h4>
      <div class="sub">${p2Wins} stats better vs ${p1Wins}</div>
    `;
  } else {
    verdict.innerHTML = `
      <h4>It's a tie!</h4>
      <div class="sub">Both players have ${p1Wins} better stats each</div>
    `;
    verdict.querySelector("h4").style.color = "var(--accent-light)";
  }
  modalContent.append(verdict);

  openModal(`${p1Data.web_name} vs ${p2Data.web_name}`, modalContent);
}

/* ========= Render ========= */
export async function renderAllPlayers(main){
  // Reset compare selection when entering the page
  compareSelection = [];
  if (selectionBar) {
    selectionBar.remove();
    selectionBar = null;
  }

  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading players…"));
  ui.mount(main, wrap);

  try{
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;
    const { elements: players, teams, element_types: positions, events } = bs;

    const fixturesAll = await api.fixtures();
    const fixturesByEvent = new Map();
    for (const f of fixturesAll){
      if (!fixturesByEvent.has(f.event)) fixturesByEvent.set(f.event, []);
      fixturesByEvent.get(f.event).push(f);
    }

    const lastFinished = (events.filter(e=>e.data_checked).slice(-1)[0]?.id) || 1;
    const windowGws = gwWindowIds(events, lastFinished, 5);
    const windowKey = windowGws.join(",");

    /* ---- Maps ---- */
    const posShortById  = new Map(positions.map(p=>[p.id,p.singular_name_short]));
    const teamShortById = new Map(teams.map(t=>[t.id,t.short_name]));
    const teamNameById  = new Map(teams.map(t=>[t.id,t.name]));
    const playerById    = new Map(players.map(p=>[p.id,p]));

    /* ---- Enrich base rows ---- */
    const base = players.map((p,i)=>({
      _idx: i,
      id: p.id,
      web_name: p.web_name,
      first_name: p.first_name,
      second_name: p.second_name,
      element_type: p.element_type,
      pos_name: posShortById.get(p.element_type) || "?",
      team: p.team,
      team_name: teamNameById.get(p.team) || "?",
      team_short: teamShortById.get(p.team) || "?",
      price_m: priceM(p),
      total_points: p.total_points || 0,
      form: +p.form || 0,
      selected_by_percent: +p.selected_by_percent || 0,
      status: p.status,
      now_cost: p.now_cost || 0,
      ppm: (p.total_points / (p.now_cost/10)) || 0,
      transfers_in_event: p.transfers_in_event || 0,
      transfers_out_event: p.transfers_out_event || 0,
      net_transfers: (p.transfers_in_event || 0) - (p.transfers_out_event || 0),
      cost_change_event: p.cost_change_event || 0
    }));

    /* ---- Filters / sort state ---- */
    const filters = Object.assign({}, DEFAULTS, readLS(LS_AP_FILTERS, DEFAULTS));
    const sort    = Object.assign({}, DEFAULT_SORT, readLS(LS_AP_SORT, DEFAULT_SORT));
    let chartMode = readLS(LS_AP_CHART, DEFAULT_CHART_MODE);

    /* ---- Toolbar ---- */
    const toolbar = utils.el("div",{class:"card ap-toolbar"});

    // row1
    const row1 = utils.el("div",{class:"ap-toolbar-row"});

    // Autocomplete wrapper + input
    const acWrap = utils.el("div",{
      style:"position:relative;min-width:240px;flex:1;"
    });
    const q = utils.el("input",{placeholder:"Search player", value: filters.q, style:"width:100%"});
    const acList = utils.el("div",{
      style: `
        position:absolute; top:36px; left:0; right:0;
        background:rgba(20,24,32,.98); border:1px solid rgba(255,255,255,.08);
        border-radius:10px; box-shadow:0 10px 24px rgba(0,0,0,.35);
        max-height:320px; overflow:auto; display:none; z-index:2000;
      `
    });
    acWrap.append(q, acList);

    let acItems = [];
    let acActive = -1;
    function hideAC(){ acList.style.display="none"; acList.innerHTML=""; acItems=[]; acActive=-1; }
    function buildAC(){
      const term = q.value.trim().toLowerCase();
      if (term.length < 2){ hideAC(); return; }
      const matches = players
        .filter(p => (`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase().includes(term)))
        .slice(0, 12);
      if (!matches.length){ hideAC(); return; }

      acList.innerHTML = "";
      acItems = matches.map(p=>{
        const row = utils.el("div",{
          style: `
            display:flex; align-items:center; gap:8px; padding:8px 10px; cursor:pointer;
          `
        });
        row.addEventListener("mouseenter", ()=> setActiveRow(row));
        row.addEventListener("mousedown", (e)=> e.preventDefault());
        row.addEventListener("click", ()=> selectRow(p));

        row.append(
          utils.el("span",{class:"team-chip"}, teamShortById.get(p.team) || "?"),
          utils.el("span",{style:"font-weight:600"}, p.web_name),
          utils.el("span",{class:"tag"}, posShortById.get(p.element_type) || "?"),
          utils.el("span",{class:"small", style:"margin-left:auto;opacity:.8"}, `£${(p.now_cost/10).toFixed(1)}m`)
        );
        acList.append(row);
        return row;
      });
      acActive = -1;
      acList.style.display = "block";
      styleRows();
    }
    function setActiveRow(row){
      acActive = acItems.indexOf(row);
      styleRows();
    }
    function styleRows(){
      acItems.forEach((el, i)=>{
        el.style.background = i===acActive ? "rgba(255,255,255,.08)" : "transparent";
      });
    }
    function selectRow(p){
      q.value = p.web_name;
      hideAC();
      // set position filter to that player's pos for convenience (optional)
      filters.posId = String(p.element_type);
      posButtons.forEach(b=> b.classList.remove("active"));
      const btn = posButtons[+filters.posId]; // buttons are ["All",GKP,DEF,MID,FWD]
      if (btn) btn.classList.add("active");
      update(); // apply instantly
    }

    q.addEventListener("input", buildAC);
    q.addEventListener("keydown", (e)=>{
      if (acList.style.display==="none") return;
      if (e.key==="ArrowDown"){ e.preventDefault(); acActive = Math.min(acActive+1, acItems.length-1); styleRows(); }
      else if (e.key==="ArrowUp"){ e.preventDefault(); acActive = Math.max(acActive-1, 0); styleRows(); }
      else if (e.key==="Enter"){ e.preventDefault(); if (acActive>=0) acItems[acActive].click(); else hideAC(); }
      else if (e.key==="Escape"){ hideAC(); }
    });
    document.addEventListener("click", (e)=>{
      if (!acWrap.contains(e.target)) hideAC();
    });

    const posWrap = utils.el("div",{class:"segmented"});
    const posButtons = [];
    [["","All"],["1","GKP"],["2","DEF"],["3","MID"],["4","FWD"]].forEach(([val,label], idx)=>{
      const b = utils.el("button",{class:"seg-btn"+(String(filters.posId)===val?" active":""), type:"button"}, label);
      b.addEventListener("click", ()=>{
        posButtons.forEach(x=>x.classList.remove("active"));
        b.classList.add("active");
        filters.posId = val;
      });
      posButtons.push(b);
      posWrap.append(b);
    });

    const teamBtn = utils.el("button",{class:"btn-ghost", type:"button"});
    function teamBtnLabel(){
      if (!filters.teamIds?.length) return "Teams: All";
      if (filters.teamIds.length===1) return `Team: ${teamNameById.get(+filters.teamIds[0])}`;
      return `Teams: ${filters.teamIds.length} selected`;
    }
    teamBtn.textContent = teamBtnLabel();
    teamBtn.addEventListener("click", ()=>{
      const box = utils.el("div");
      box.append(utils.el("div",{class:"mb-8"},"Pick teams:"));

      // Controls
      const controls = utils.el("div",{class:"chips", style:"margin-bottom:8px"});
      const selectAllBtn = utils.el("button",{class:"btn-ghost", type:"button"},"Select all");
      const clearAllBtn  = utils.el("button",{class:"btn-ghost", type:"button"},"Clear all");
      controls.append(selectAllBtn, clearAllBtn);
      box.append(controls);

      // Grid of checkboxes
      const grid = utils.el("div",{class:"grid cols-3"});
      const rows = [];
      teams.forEach(t=>{
        const id = `team-${t.id}`;
        const row = utils.el("label",{for:id, class:"row-check"});
        const cb = utils.el("input",{id, type:"checkbox", checked: filters.teamIds.includes(String(t.id))});
        row.append(cb, utils.el("span",{}, t.name));
        grid.append(row);
        rows.push({ t, cb });
      });
      box.append(grid);

      // Buttons
      const done = utils.el("button",{class:"btn-primary mt-8", type:"button"},"Done");

      selectAllBtn.addEventListener("click", ()=>{
        filters.teamIds = teams.map(t=> String(t.id));
        rows.forEach(({cb})=> cb.checked = true);
      });
      clearAllBtn.addEventListener("click", ()=>{
        filters.teamIds = [];
        rows.forEach(({cb})=> cb.checked = false);
      });

      rows.forEach(({t, cb})=>{
        cb.addEventListener("change", ()=>{
          const v = String(t.id);
          if (cb.checked){
            if (!filters.teamIds.includes(v)) filters.teamIds.push(v);
          } else {
            filters.teamIds = filters.teamIds.filter(x=>x!==v);
          }
        });
      });

      done.addEventListener("click", ()=>{
        teamBtn.textContent = teamBtnLabel();
        document.querySelector(".modal [data-close]")?.click();
      });

      box.append(done);
      openModal("Select Teams", box);
    });

    const priceMin = utils.el("input",{placeholder:"£ min", inputmode:"decimal", value: filters.priceMin, class:"w90"});
    const priceMax = utils.el("input",{placeholder:"£ max", inputmode:"decimal", value: filters.priceMax, class:"w90"});

    const statusSel = utils.el("select");
    statusSel.innerHTML = `
      <option value="">Status: All</option>
      <option value="a">Available</option>
      <option value="d">Doubtful</option>
      <option value="i">Injured</option>
      <option value="s">Suspended</option>
      <option value="n">Unavailable</option>
    `;
    statusSel.value = filters.status;

    const minutesChk = utils.el("label",{class:"row-check"},[
      utils.el("input",{type:"checkbox", checked: !!filters.minutesFloor}),
      utils.el("span",{},"xMins ≥ 60")
    ]);

    row1.append(acWrap, posWrap, teamBtn, priceMin, priceMax, statusSel, minutesChk);

    // row2
    const row2 = utils.el("div",{class:"ap-toolbar-row"});
    const sortSel = utils.el("select");
    sortSel.innerHTML = `
      <option value="total_points desc">Total points ↓</option>
      <option value="now_cost asc">Price ↑</option>
      <option value="now_cost desc">Price ↓</option>
      <option value="form desc">Form ↓</option>
      <option value="selected_by_percent desc">Ownership ↓</option>
      <option value="ppm desc">Value (PPM) ↓</option>
      <option value="_xp_win desc">xP (Next 5) ↓</option>
      <option value="_xp_next desc">xP (Next) ↓</option>
      <option value="_xgi90 desc">xGI/90 (L5) ↓</option>
      <option value="_ease asc">Fixture Ease (Next 5) ↑</option>
    `;
    sortSel.value = `${sort.key} ${sort.dir}`;

    const xgiToggle = utils.el("label",{class:"row-check"},[
      utils.el("input",{type:"checkbox"}), utils.el("span",{},"Add xGI/90 (L5) for visible")
    ]);
    const xpToggle = utils.el("label",{class:"row-check"},[
      utils.el("input",{type:"checkbox", checked:true}), utils.el("span",{},"Add xP (Next & Next 5) for visible")
    ]);

    const chartWrap = utils.el("div",{class:"segmented"});
    const btnChartPoints = utils.el("button",{class:"seg-btn"+(chartMode==="points"?" active":""), type:"button"},"Chart: Points");
    const btnChartXP     = utils.el("button",{class:"seg-btn"+(chartMode==="xp"?" active":""), type:"button"},"Chart: xP (Next 5)");
    btnChartPoints.addEventListener("click", ()=>{ chartMode="points"; writeLS(LS_AP_CHART, chartMode); update(); });
    btnChartXP.addEventListener("click", ()=>{ chartMode="xp"; writeLS(LS_AP_CHART, chartMode); update(); });
    chartWrap.append(btnChartPoints, btnChartXP);

    const applyBtn = utils.el("button",{class:"btn-primary"}, "Apply");

    row2.append(sortSel, xgiToggle, xpToggle, chartWrap, applyBtn);

    toolbar.append(utils.el("h3",{},"All Players — Filters, Sort & Tools"), row1, row2);

    /* ---- Card to hold chart & table ---- */
    const card = utils.el("div",{class:"card"});
    const progress = utils.el("div",{class:"progress", style:"display:none"},[
      utils.el("div",{class:"bar", style:"width:0%"})
    ]);
    card.prepend(progress);

    // Taller chart slot (double height)
    const chartSlot = utils.el("div",{id:"ap-chart-slot", style:"min-height:720px"});
    const tableSlot = utils.el("div",{id:"ap-table-slot"});
    card.append(chartSlot, tableSlot);

    /* ---- Mount ---- */
    ui.mount(main, utils.el("div",{}, [toolbar, card]));

    /* ---- Apply ---- */
    applyBtn.addEventListener("click", ()=>{
      const fNew = {
        q: q.value.trim(),
        posId: String(filters.posId || ""),
        teamIds: filters.teamIds.slice(),
        priceMin: priceMin.value.trim(),
        priceMax: priceMax.value.trim(),
        status: statusSel.value,
        minutesFloor: !!minutesChk.querySelector("input").checked
      };
      writeLS(LS_AP_FILTERS, fNew);
      const [key, dir] = sortSel.value.split(" ");
      writeLS(LS_AP_SORT, { key, dir });
      update();
    });

    // Auto run once on load
    update();

    /* ========= Update pipeline ========= */
    let chartInstance = null;

    function filteredRows(){
      const f = Object.assign({}, DEFAULTS, readLS(LS_AP_FILTERS, DEFAULTS));
      const s = Object.assign({}, DEFAULT_SORT, readLS(LS_AP_SORT, DEFAULT_SORT));

      const qv = (f.q||"").toLowerCase();
      const pid = f.posId ? +f.posId : null;
      const teamSet = new Set((f.teamIds||[]).map(x=>+x));
      const min = f.priceMin ? +f.priceMin : null;
      const max = f.priceMax ? +f.priceMax : null;
      const status = f.status || "";

      let rows = base.filter(p=>{
        if (qv && !(`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase().includes(qv))) return false;
        if (pid && p.element_type !== pid) return false;
        if (teamSet.size && !teamSet.has(p.team)) return false;
        if (min!=null && p.price_m < min) return false;
        if (max!=null && p.price_m > max) return false;
        if (status && p.status !== status) return false;
        return true;
      });

      rows = stableSort(rows, (r)=> r[s.key] ?? -Infinity, s.dir);
      return rows;
    }

    function minutesBadgeCell(p){
      const badge = utils.el("span",{class:"badge"}, "—");
      if (p._xmins != null){
        const r90 = (p._xmins||0)/90;
        badge.textContent = r90>=0.9 ? "NAILED" : (r90>=0.7 ? "RISK" : "CAMEO?");
        badge.className = "badge " + (r90>=0.9 ? "badge-green" : (r90>=0.7 ? "badge-amber" : "badge-red"));
        badge.dataset.tooltip = `Projected ${Math.round(p._xmins||0)}'`;
      } else {
        badge.dataset.tooltip = "Compute xP/xMins to see minutes";
      }
      return badge;
    }
    function eoChipsCell(p){
      const wrap = utils.el("div",{class:"eo-chips"});
      const ov = utils.el("span",{class:"chip chip-dim"}, `${(p.selected_by_percent||0).toFixed(1)}%`);
      ov.dataset.tooltip = "Overall EO (FPL selected_by_percent)";
      wrap.append(ov);
      if (state.metaEO && typeof state.metaEO.get === "function"){
        const meta = Number(state.metaEO.get(p.id) || 0);
        const el = utils.el("span",{class:"chip chip-accent"}, `${meta.toFixed(1)}%`);
        el.dataset.tooltip = "Meta EO across your scanned leagues";
        wrap.append(el);
      }
      return wrap;
    }

    // Price cell with change prediction
    function priceCellWithPrediction(p){
      const wrap = utils.el("div", { class: "price-cell" });

      // Price value
      const priceEl = utils.el("span", { class: "price-value" }, `£${p.price_m.toFixed(1)}m`);
      wrap.append(priceEl);

      // Price change indicator based on net transfers
      const net = p.net_transfers;
      const threshold = 5000; // Significant transfer threshold

      // Already changed this GW?
      if (p.cost_change_event !== 0) {
        const changeClass = p.cost_change_event > 0 ? "rise" : "fall";
        const arrow = p.cost_change_event > 0 ? "▲" : "▼";
        const changeAmount = Math.abs(p.cost_change_event / 10).toFixed(1);
        const indicator = utils.el("span", { class: `price-change-indicator ${changeClass}` });
        indicator.innerHTML = `<span class="arrow">${arrow}</span> £${changeAmount}m`;
        indicator.dataset.tooltip = `Price ${p.cost_change_event > 0 ? "rose" : "fell"} this GW`;
        wrap.append(indicator);
      } else if (Math.abs(net) > threshold) {
        // Prediction based on net transfers
        const isRising = net > threshold;
        const isFalling = net < -threshold;

        if (isRising || isFalling) {
          const predClass = isRising ? "rise" : "fall";
          const arrow = isRising ? "▲" : "▼";
          const likelihood = Math.abs(net) > 50000 ? "likely" : "possible";
          const indicator = utils.el("span", { class: `price-change-indicator ${predClass}` });
          indicator.innerHTML = `<span class="arrow">${arrow}</span> ${isRising ? "Rise" : "Fall"}`;
          indicator.dataset.tooltip = `${likelihood.charAt(0).toUpperCase() + likelihood.slice(1)} price ${isRising ? "rise" : "fall"} (Net: ${net > 0 ? '+' : ''}${(net / 1000).toFixed(1)}k)`;
          wrap.append(indicator);
        }
      }

      return wrap;
    }

    function renderTable(rows){
      // Compare checkbox cell
      const compareCell = (r) => {
        const cb = utils.el("input", {
          type: "checkbox",
          class: "player-select-checkbox",
          "data-player-id": r.id
        });
        cb.checked = compareSelection.includes(r.id);
        cb.disabled = !cb.checked && compareSelection.length >= 2;
        cb.addEventListener("change", () => {
          if (cb.checked) {
            if (compareSelection.length < 2) {
              compareSelection.push(r.id);
            }
          } else {
            compareSelection = compareSelection.filter(x => x !== r.id);
          }
          updateSelectionBar(playerById, posShortById, teamShortById);
          updateCheckboxes();
        });
        return cb;
      };

      const cols = [
        { header:"", cell:compareCell, thClass:"select-cell", tdClass:"select-cell" },
        { header:"Name", accessor:r=>r.web_name, sortBy:r=>r.web_name, cell:r=>{
            const w = utils.el("div",{class:"name-cell"});
            w.append(utils.el("span",{class:"team-chip"}, r.team_short));
            w.append(utils.el("span",{class:"nm"}, r.web_name));
            return w;
        }},
        { header:"Pos", accessor:r=>r.pos_name, sortBy:r=>r.pos_name },
        { header:"Price", accessor:r=>r.price_m, cell:r=>`£${r.price_m.toFixed(1)}m`, sortBy:r=>r.price_m },
        { header:"Total", accessor:r=>r.total_points, sortBy:r=>r.total_points },
        { header:"Form", accessor:r=>+r.form, sortBy:r=>+r.form },
        { header:"EO", cell:eoChipsCell, sortBy:r=> r.selected_by_percent },
        { header:"xMins", cell:minutesBadgeCell, sortBy:r=> r._xmins ?? 0 },
        { header:"xP (Next)", accessor:r=> r._xp_next!=null ? r._xp_next.toFixed(2) : "", sortBy:r=>r._xp_next ?? -1 },
        { header:"xP (Next 5)", accessor:r=> r._xp_win!=null ? r._xp_win.toFixed(2) : "", sortBy:r=>r._xp_win ?? -1 },
        { header:"xGI/90 (L5)", accessor:r=> r._xgi90!=null ? r._xgi90.toFixed(2) : "", sortBy:r=> r._xgi90 ?? -1 },
        { header:"Ease (Next 5)", accessor:r=> r._ease!=null ? r._ease.toFixed(2) : "", sortBy:r=> r._ease ?? 999 }
      ];
      tableSlot.append(ui.table(cols, rows));

      // Update selection bar after table renders
      updateSelectionBar(playerById, posShortById, teamShortById);
    }

    // Scatter chart (double height, no resize loop)
    async function renderChart(rows){
      const ds = rows.map(r => ({
        x: r.price_m,
        y: (chartMode === "points" ? r.total_points : r._xp_win),
        label: `${r.web_name} (${r.team_short})`,
        own: r.selected_by_percent || 0,
        pos: r.element_type
      })).filter(p => Number.isFinite(p.y));

      if (!ds.length){
        chartSlot.innerHTML = "";
        if (chartInstance) { try { chartInstance.destroy(); } catch {} chartInstance = null; }
        chartSlot.append(
          utils.el("h3",{}, chartMode==="points" ? "Price vs Total Points (filtered)" : "Price vs xP (Next 5) — filtered"),
          utils.el("div",{class:"tag"}, "No data to chart. Adjust filters or compute xP.")
        );
        return;
      }

      const xs = ds.map(p => p.x);
      const ys = ds.map(p => p.y);
      const xmin = Math.min(...xs), xmax = Math.max(...xs);
      const ymin = Math.min(...ys), ymax = Math.max(...ys);
      const rangeX = xmax - xmin;
      const rangeY = ymax - ymin;
      const padX = rangeX > 0 ? rangeX * 0.06 : 0.5;
      const padY = rangeY > 0 ? rangeY * 0.10 : 1;

      if (chartInstance) { try { chartInstance.destroy(); } catch {} chartInstance = null; }
      chartSlot.innerHTML = "";

      const slotWidth = Math.max(320, Math.floor(chartSlot.getBoundingClientRect().width || chartSlot.clientWidth || 900));
      const canvas = utils.el("canvas", {
        width: slotWidth,
        height: 680, // double height
        style: "max-width:100%;display:block"
      });

      chartSlot.append(
        utils.el("h3",{}, chartMode==="points" ? "Price vs Total Points (filtered)" : "Price vs xP (Next 5) — filtered"),
        canvas
      );

      const colors = {1:"#60a5fa", 2:"#34d399", 3:"#f472b6", 4:"#f59e0b"};
      const cfg = {
        type: "scatter",
        data: { datasets: [{
          data: ds,
          parsing: false,
          pointRadius:      ctx => Math.max(3, Math.sqrt(ctx.raw.own || 0) + 2),
          pointHoverRadius: ctx => Math.max(5, Math.sqrt(ctx.raw.own || 0) + 5),
          pointBackgroundColor: ctx => colors[ctx.raw.pos] || "#93c5fd"
        }]},
        options: {
          responsive: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: "nearest",
              intersect: true,
              callbacks: {
                label: (ctx) => {
                  const r = ctx.raw;
                  const yLab = chartMode === "points" ? `${r.y} pts` : `xP ${r.y.toFixed(2)} (Next 5)`;
                  return `${r.label}: £${r.x}m, ${yLab}, Own ${Math.round(r.own)}%`;
                }
              }
            }
          },
          scales: {
            x: { title: { text: "Price (£m)", display: true }, min: xmin - padX, max: xmax + padX, ticks: { maxTicksLimit: 10 } },
            y: { title: { text: chartMode === "points" ? "Total Points" : "xP (Next 5)", display: true }, min: ymin - padY, max: ymax + padY, ticks: { maxTicksLimit: 8 } }
          }
        }
      };
      chartInstance = await ui.chart(canvas, cfg);
    }

    async function computeEase(rows, gws){
      for (const r of rows){
        r._ease = computeFixtureEase(fixturesByEvent, r.team, gws);
      }
    }

    async function addXgi(rows){
      const want = rows.filter(r=> r._xgi90 == null);
      if (!want.length) return;
      progress.style.display = "";
      const bar = progress.querySelector(".bar");
      bar.style.width = "0%";

      const total = want.length;
      let done = 0;
      const limit = 12;
      const queue = [...want];
      const workers = new Array(limit).fill(0).map(async ()=>{
        while (queue.length){
          const r = queue.shift();
          const cached = xgiCache.get(r.id);
          if (cached){
            r._xgi90 = cached.xgi90; done++; bar.style.width = `${Math.floor(done/total*100)}%`; continue;
          }
          try{
            const sum = await api.elementSummary(r.id);
            const lastFin = lastFinished;
            const last5 = sum.history.filter(h=>h.round <= lastFin).slice(-5);
            const mins = last5.reduce((a,b)=>a+(b.minutes||0),0);
            const exgi = last5.reduce((a,b)=>a+(+b.expected_goal_involvements||0),0);
            const x90 = mins ? +(exgi/(mins/90)).toFixed(2) : 0;
            r._xgi90 = x90; xgiCache.set(r.id, { xgi90: x90 });
          }catch{ r._xgi90 = 0; }
          done++; bar.style.width = `${Math.floor(done/total*100)}%`;
          await utils.sleep(6);
        }
      });
      await Promise.all(workers);
      progress.style.display = "none";
    }

    async function addXP(rows){
      const want = rows.filter(r=> r._xp_next == null || r._xp_win == null || r._xmins == null);
      if (!want.length) return;

      progress.style.display = "";
      const bar = progress.querySelector(".bar"); bar.style.width = "0%";

      const total = want.length;
      let done = 0;
      const limit = 12;
      const queue = [...want];

      const workers = new Array(limit).fill(0).map(async ()=>{
        while (queue.length){
          const r = queue.shift();
          const pl = playerById.get(r.id);
          const key = `${r.id}|${windowKey}`;
          const hit = xpCache.get(key);
          if (hit){
            r._xmins = hit.xmins; r._xp_next = hit.xpNext; r._xp_win = hit.xpWin;
            done++; bar.style.width = `${Math.floor(done/total*100)}%`; continue;
          }
          try{
            const xmins = await estimateXMinsForPlayer(pl);
            const xpNext = (await xPWindow(pl, windowGws.slice(0,1))).total || 0;
            const xpWin  = (await xPWindow(pl, windowGws)).total || 0;
            r._xmins = xmins; r._xp_next = xpNext; r._xp_win = xpWin;
            xpCache.set(key, { xmins, xpNext, xpWin });
          }catch{ r._xmins = 0; r._xp_next = 0; r._xp_win = 0; }
          done++; bar.style.width = `${Math.floor(done/total*100)}%`;
          await utils.sleep(6);
        }
      });
      await Promise.all(workers);
      progress.style.display = "none";
    }

    async function update(){
      // clear slots
      chartSlot.innerHTML = "";
      tableSlot.innerHTML = "";

      // 1) Base filter/sort
      let rows = filteredRows();

      // 2) Ease (cheap)
      await computeEase(rows, windowGws);

      // 3) Minutes floor / xP toggles
      const needXPForChart = chartMode === "xp";
      const doXgi = (toolbar.querySelectorAll(".row-check input")[0]?.checked) || false; // row2 first toggle
      const doXP  = (toolbar.querySelectorAll(".row-check input")[1]?.checked) ?? true;  // row2 second toggle

      const minutesFloor = !!minutesChk.querySelector("input").checked;
      if (minutesFloor || doXP || needXPForChart){
        await addXP(rows);
      }
      if (minutesFloor){
        rows = rows.filter(r=> (r._xmins || 0) >= 60);
      }

      // 4) xGI if requested
      if (doXgi){
        await addXgi(rows);
      }

      // 5) Re-sort if sort depends on computed cols
      const s = Object.assign({}, DEFAULT_SORT, readLS(LS_AP_SORT, DEFAULT_SORT));
      rows = stableSort(rows, (r)=> r[s.key] ?? -Infinity, s.dir);

      // 6) Render chart & table
      await renderChart(rows);
      renderTable(rows);
    }
  }catch(e){
    ui.mount(main, ui.error("Failed to load All Players", e));
  }
}
