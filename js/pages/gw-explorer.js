// js/pages/gw-explorer.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { makeSelect } from "../components/select.js";

/* ---- one-time styles to prevent control overlap ---- */
function ensureGwExplorerStyles(){
  if (document.getElementById("gwx-styles")) return;
  const style = document.createElement("style");
  style.id = "gwx-styles";
  style.textContent = `
    .ap-toolbar-row{
      display:flex; flex-wrap:wrap; align-items:center; gap:12px;
    }
    .ap-toolbar-row .row-check{
      display:flex; align-items:center; gap:8px; white-space:nowrap;
    }
    /* Search input grows but won't push under checkboxes */
    .ap-toolbar-row input[type="text"],
    .ap-toolbar-row input[type="search"]{
      flex:1 1 420px; min-width:260px; max-width:640px; width:auto;
    }
    /* Keep segmented (positions) aligned on row 1 */
    .ap-toolbar-row .segmented{ margin-left:auto; }
    /* Push Apply to far right on row 2 without spacer hacks */
    .ap-toolbar-row .btn-primary{ margin-left:auto; }
  `;
  document.head.appendChild(style);
}

export async function renderGwExplorer(main){
  ensureGwExplorerStyles();

  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading GW Explorer…"));
  ui.mount(main, wrap);

  try{
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;

    const { events, elements: players, teams, element_types: positions } = bs;

    const teamById  = new Map(teams.map(t => [t.id, t]));
    const teamShort = new Map(teams.map(t => [t.id, t.short_name]));
    const posShort  = new Map(positions.map(p => [p.id, p.singular_name_short]));

    // Determine previous/current from bootstrap flags
    const prevEvent = events.find(e => e.is_previous);
    const currEvent = events.find(e => e.is_current);
    const lastFinished = prevEvent?.id || (events.filter(e=>e.data_checked).map(e=>e.id).pop() ?? null);

    // Build GW options: all finished + current (live) if not data_checked
    const finishedOpts = events
      .filter(e => e.data_checked)
      .map(e => ({ label: `GW ${e.id}`, value: e.id }));

    const includeCurrent = currEvent && !currEvent.data_checked;
    const options = includeCurrent
      ? [...finishedOpts, { label: `GW ${currEvent.id} (live)`, value: currEvent.id }]
      : finishedOpts;

    if (!options.length && currEvent) {
      options.push({ label: `GW ${currEvent.id} (live)`, value: currEvent.id });
    }
    if (!options.length){
      ui.mount(main, utils.el("div",{class:"card"},"No gameweeks available yet."));
      return;
    }

    const defaultGw = includeCurrent ? currEvent.id : (lastFinished ?? options[0].value);

    /* ===== Toolbar ===== */
    const gwSel = makeSelect({ options, value: defaultGw });

    const teamSel = makeSelect({
      options: [{label:"All teams", value:"ALL"}]
        .concat(teams.map(t => ({label:t.short_name, value:String(t.id)}))),
      value: "ALL",
      width: "150px"
    });

    const posChipsWrap = utils.el("div",{class:"segmented"});
    const posVals = ["ALL","GKP","DEF","MID","FWD"];
    let posActive = "ALL";
    posVals.forEach(v=>{
      const b = utils.el("button",{class:`seg-btn${v==="ALL"?" active":""}`,"data-val":v}, v);
      b.addEventListener("click",()=>{
        posActive = v;
        [...posChipsWrap.querySelectorAll(".seg-btn")].forEach(x=>x.classList.remove("active"));
        b.classList.add("active");
        applyFilters();
      });
      posChipsWrap.append(b);
    });

    // Search input (sizes handled by CSS above)
    const q = utils.el("input",{ placeholder:"Search player" });

    const startersOnly = utils.el("label",{class:"row-check"},[
      utils.el("input",{type:"checkbox"}), utils.el("span",{class:"tag"}," Starters only")
    ]);
    const myOnly = utils.el("label",{class:"row-check"},[
      utils.el("input",{type:"checkbox"}), utils.el("span",{class:"tag"}," My squad only")
    ]);
    const haulsOnly = utils.el("label",{class:"row-check"},[
      utils.el("input",{type:"checkbox"}), utils.el("span",{class:"tag"}," Hauls (≥10 pts)")
    ]);
    const cardsOnly = utils.el("label",{class:"row-check"},[
      utils.el("input",{type:"checkbox"}), utils.el("span",{class:"tag"}," Cards / RC only")
    ]);

    const applyBtn = utils.el("button",{class:"btn-primary"},"Apply");

    const liveChip = utils.el("span",{class:"chip chip-accent", style:"display:none"}, "LIVE — provisional");

    // Compact single-line toolbar
    const toolbar = utils.el("div",{class:"toolbar-compact"},[
      utils.el("span",{class:"chip chip-dim"},"GW:"), gwSel.el, liveChip,
      utils.el("span",{class:"chip chip-dim"},"Team:"), teamSel.el,
      posChipsWrap,
      q,
      startersOnly, myOnly, haulsOnly, cardsOnly, applyBtn
    ]);

    /* ===== Dashboard Layout ===== */
    const page = utils.el("div",{class:"gw-dashboard"});

    // Top row: Toolbar
    page.append(toolbar);

    // Middle row: GW Summary (left) + Team of the Week (right)
    const topGridCard = utils.el("div",{class:"gw-top-row"});

    // Bottom row: Player table (full width)
    const tableCard = utils.el("div",{class:"card card-flush gw-table-container"});

    page.append(topGridCard, tableCard);
    ui.mount(main, page);

    /* ===== Data state ===== */
    let baseRows = [];
    let mySet = new Set();
    let myCaptainId = null, myViceId = null;

    const isLiveGw = (gwId)=>{
      const evt = events.find(e=>e.id === +gwId);
      return !!(evt && evt.is_current && !evt.data_checked);
    };

    async function loadGw(gwId){
      tableCard.innerHTML = "";
      tableCard.append(ui.spinner("Fetching gameweek data…"));

      liveChip.style.display = isLiveGw(gwId) ? "" : "none";

      const live = await api.eventLive(+gwId);

      // Mark your squad for that GW
      mySet = new Set(); myCaptainId = null; myViceId = null;
      if (state.entryId){
        try{
          const picks = await api.entryPicks(state.entryId, +gwId);
          picks.picks.forEach(p=>{
            mySet.add(p.element);
            if (p.is_captain)     myCaptainId = p.element;
            if (p.is_vice_captain) myViceId   = p.element;
          });
        }catch{}
      }

      baseRows = live.elements.map(e=>{
        const pl = players.find(p=>p.id===e.id);
        const st = e.stats || {};
        return {
          id:e.id,
          name: pl?.web_name || `#${e.id}`,
          teamId: pl?.team ?? 0,
          team: teamShort.get(pl?.team) || "?",
          posId: pl?.element_type ?? 0,
          pos: posShort.get(pl?.element_type) || "?",
          minutes: st.minutes||0,
          pts: st.total_points||0,
          g: st.goals_scored||0,
          a: st.assists||0,
          cs: st.clean_sheets||0,
          saves: st.saves||0,
          ps: st.penalties_saved||0,
          pm: st.penalties_missed||0,
          gc: st.goals_conceded||0,
          yc: st.yellow_cards||0,
          rc: st.red_cards||0,
          bonus: st.bonus||0,
          bps: st.bps||0,
          isMine: mySet.has(e.id),
          isC: myCaptainId===e.id,
          isVC: myViceId===e.id
        };
      });

      renderAll();
    }

    /* ===== Filters ===== */
    function applyFilters(){ renderAll(); }

    function filteredRows(){
      const teamVal = teamSel.value;
      const qv = q.value.trim().toLowerCase();

      let rows = baseRows.slice();

      if (posActive !== "ALL") rows = rows.filter(r=>r.pos===posActive);
      if (teamVal !== "ALL")   rows = rows.filter(r=>String(r.teamId)===teamVal);
      if (qv)                  rows = rows.filter(r=>r.name.toLowerCase().includes(qv));

      if (startersOnly.querySelector("input").checked) rows = rows.filter(r=>r.minutes>0);
      if (myOnly.querySelector("input").checked)       rows = rows.filter(r=>r.isMine);
      if (haulsOnly.querySelector("input").checked)    rows = rows.filter(r=>r.pts>=10);
      if (cardsOnly.querySelector("input").checked)    rows = rows.filter(r=>r.yc>0 || r.rc>0);

      rows.sort((a,b)=> b.pts - a.pts);
      return rows;
    }

    /* ===== Summary (L) + Team of the Week (R) ===== */
    function renderTopGrid(rows, gwId){
      const live = isLiveGw(gwId);

      // Left: Summary
      const hauls  = rows.filter(r=>r.pts>=10).slice(0,12);
      const braces = rows.filter(r=>r.g>=2).length;
      const hatties= rows.filter(r=>r.g>=3).length;
      const reds   = rows.filter(r=>r.rc>0).length;

      const teamTotals = new Map();
      rows.forEach(r => teamTotals.set(r.team, (teamTotals.get(r.team)||0)+r.pts));
      const teamArr = [...teamTotals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);

      const posGroups = { GKP:[], DEF:[], MID:[], FWD:[] };
      rows.forEach(r => posGroups[r.pos]?.push(r.pts));
      const posAvg = Object.entries(posGroups).map(([k,v])=>[k, v.length ? +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2) : 0]);

      const left = utils.el("div",{},[
        utils.el("h3",{},`GW ${gwId} — ${live ? "Summary (live)" : "Summary"}`),
        hauls.length ? utils.el("ul",{}, hauls.map(r=>utils.el("li",{},`${r.name} (${r.team}) — ${r.pts} pts (G${r.g}, A${r.a}, BPS ${r.bps})`))) :
          utils.el("div",{class:"tag"},"No 10+ pointers in current filter."),
        utils.el("div",{class:"mt-8 legend small"},[
          utils.el("span",{class:"chip"} ,`Braces: ${braces}`),
          utils.el("span",{class:"chip"} ,`Hattricks: ${hatties}`),
          utils.el("span",{class:"chip"} ,`Red cards: ${reds}`),
          live ? utils.el("span",{class:"chip chip-accent"},"LIVE — provisional") : ""
        ]),
        utils.el("h4",{class:"mt-8"},"Team totals (top)"),
        utils.el("ul",{}, teamArr.map(([t,p])=>utils.el("li",{},`${t}: ${p} pts`))),
        utils.el("h4",{class:"mt-8"},"Avg points by position"),
        utils.el("ul",{}, posAvg.map(([k,v])=> utils.el("li",{}, `${k}: ${v}`)))
      ]);

      // Right: Team of the Week
      const totw = pickTotw(rows);
      const right = utils.el("div",{},[
        utils.el("h3",{},`Team of the Week — GW ${gwId}${live?" (live)":""}`),
        totw ? utils.el("div",{},[
          utils.el("div",{class:"chips"},[
            utils.el("span",{class:"chip"} ,`Formation: ${totw.formation}`),
            utils.el("span",{class:"chip chip-accent"} ,`Total points: ${totw.total}`)
          ]),
          ui.table([
            { header:"Name",  cell:nameCell,            sortBy:r=>r.name },
            { header:"Pos",   accessor:r=>r.pos,        sortBy:r=>r.pos },
            { header:"Team",  accessor:r=>r.team,       sortBy:r=>r.team },
            { header:"Pts",   accessor:r=>r.pts,        sortBy:r=>r.pts, tdClass:r=> r.pts>=10?"points-high":"" },
            { header:"G",     accessor:r=>r.g,          sortBy:r=>r.g },
            { header:"A",     accessor:r=>r.a,          sortBy:r=>r.a },
            { header:utils.abbr("BPS","Bonus Point System"), accessor:r=>r.bps, sortBy:r=>r.bps }
          ], totw.xi)
        ]) : utils.el("div",{class:"tag"},"Not enough players for a valid XI in current filter.")
      ]);

      topGridCard.innerHTML = "";
      topGridCard.append(utils.el("div",{class:"grid cols-2"},[left,right]));
    }

    function pickTotw(rows){
      const G = rows.filter(r=>r.pos==="GKP").sort((a,b)=>b.pts-a.pts);
      const D = rows.filter(r=>r.pos==="DEF").sort((a,b)=>b.pts-a.pts);
      const M = rows.filter(r=>r.pos==="MID").sort((a,b)=>b.pts-a.pts);
      const F = rows.filter(r=>r.pos==="FWD").sort((a,b)=>b.pts-a.pts);

      const fms = [
        { name:"3-4-3", def:3, mid:4, fwd:3 },
        { name:"3-5-2", def:3, mid:5, fwd:2 },
        { name:"4-4-2", def:4, mid:4, fwd:2 },
        { name:"4-3-3", def:4, mid:3, fwd:3 },
        { name:"5-4-1", def:5, mid:4, fwd:1 }
      ];
      let best = null;
      for (const f of fms){
        if (G.length<1 || D.length<f.def || M.length<f.mid || F.length<f.fwd) continue;
        const xi = [G[0], ...D.slice(0,f.def), ...M.slice(0,f.mid), ...F.slice(0,f.fwd)];
        const total = xi.reduce((a,b)=>a+b.pts,0);
        if (!best || total>best.total) best = { formation: f.name, xi, total };
      }
      return best;
    }

    /* ===== Table ===== */
    function nameCell(r){
      const wrap = utils.el("div",{class:"name-cell"});
      if (r.isC)      wrap.append(utils.el("span",{class:"badge c-badge"},"C"));
      else if (r.isVC)wrap.append(utils.el("span",{class:"badge vc-badge"},"VC"));
      wrap.append(
        utils.el("span",{class:"team-chip"},r.team),
        utils.el("span",{class:"nm"},r.name)
      );
      if (r.isMine) wrap.append(utils.el("span",{class:"chip chip-accent chip-dim"},"🧍 Mine"));
      return wrap;
    }

    function renderTable(rows, gwId){
      const live = isLiveGw(gwId);

      const cols = [
        {header:"Name", cell:nameCell, sortBy:r=>r.name},
        {header:"Pos", accessor:r=>r.pos, sortBy:r=>r.pos},
        {header:"Team", accessor:r=>r.team, sortBy:r=>r.team},
        {header:"Min", accessor:r=>r.minutes, sortBy:r=>r.minutes,
          tdClass:r=> r.minutes===0? "minutes-zero" : "" },
        {header:"Pts", accessor:r=>r.pts, sortBy:r=>r.pts,
          tdClass:r=> r.pts>=10? "points-high" : (r.pts<=1? "points-low" : "")},
        {header:"G", accessor:r=>r.g, sortBy:r=>r.g},
        {header:"A", accessor:r=>r.a, sortBy:r=>r.a},
        {header:utils.abbr("CS","Clean sheets"), accessor:r=>r.cs, sortBy:r=>r.cs},
        {header:"Saves", accessor:r=>r.saves, sortBy:r=>r.saves},
        {header:utils.abbr("Pens +","Penalties saved"), accessor:r=>r.ps, sortBy:r=>r.ps},
        {header:utils.abbr("Pens -","Penalties missed"), accessor:r=>r.pm, sortBy:r=>r.pm},
        {header:utils.abbr("GC","Goals conceded"), accessor:r=>r.gc, sortBy:r=>r.gc},
        {header:utils.abbr("YC","Yellow cards"), accessor:r=>r.yc, sortBy:r=>r.yc},
        {header:utils.abbr("RC","Red cards"), accessor:r=>r.rc, sortBy:r=>r.rc},
        {header:"Bonus", accessor:r=>r.bonus, sortBy:r=>r.bonus,
          tdClass:r=> r.bonus>0 ? "cell-good" : "" },
        {header:utils.abbr("BPS","Bonus Point System"), accessor:r=>r.bps, sortBy:r=>r.bps}
      ];
      const table = ui.table(cols, rows);

      tableCard.innerHTML = "";
      tableCard.append(
        utils.el("h3",{},`GW ${gwId} — Player Points${live ? " (live)" : ""}`),
        table
      );
    }

    /* ===== Render pipeline ===== */
    function renderAll(){
      const gwId = gwSel.value;
      const rows = filteredRows();
      renderTopGrid(rows, gwId);
      renderTable(rows, gwId);
    }

    // events
    applyBtn.addEventListener("click", applyFilters);
    q.addEventListener("keydown", e => { if (e.key === "Enter") applyFilters(); });
    gwSel.onChange(val => loadGw(val));
    teamSel.onChange(() => applyFilters());

    // init
    await loadGw(gwSel.value);
  }catch(e){
    ui.mount(main, ui.error("Failed to load GW Explorer", e));
  }
}
