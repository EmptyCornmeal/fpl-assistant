// js/pages/gw-explorer.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { makeSelect } from "../components/select.js";

export async function renderGwExplorer(main){
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

    const finished = events.filter(e => e.data_checked);
    if (!finished.length){
      ui.mount(main, utils.el("div",{class:"card"},"No finished GWs yet."));
      return;
    }
    const lastFinished = Math.max(...finished.map(e=>e.id));

    /* ===== Toolbar (two rows; no clipping) ===== */
    const gwSel = makeSelect({
      options: finished.map(e => ({ label: `GW ${e.id}`, value: e.id })),
      value: lastFinished
    });
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

    const q = utils.el("input",{placeholder:"Search player", style:"min-width:260px;max-width:100%"});

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

    const toolbar = utils.el("div",{class:"card"},[
      utils.el("h3",{},"GW Explorer — Filters & Tools"),
      // row 1
      utils.el("div",{class:"ap-toolbar-row"},[
        utils.el("span",{class:"chip chip-dim"},"Gameweek:"), gwSel.el,
        utils.el("span",{class:"chip chip-dim"},"Team:"),     teamSel.el,
        utils.el("span",{class:"chip chip-dim"},"Position:"), posChipsWrap
      ]),
      // row 2
      utils.el("div",{class:"ap-toolbar-row"},[
        q, startersOnly, myOnly, haulsOnly, cardsOnly,
        utils.el("span",{style:"flex:1"},""),
        applyBtn
      ])
    ]);

    /* ===== Cards ===== */
    const topGridCard = utils.el("div",{class:"card"});   // GW Summary (L) + Team of the Week (R)
    const tableCard   = utils.el("div",{class:"card"});   // Player table

    const page = utils.el("div",{},[toolbar, topGridCard, tableCard]);
    ui.mount(main, page);

    /* ===== Data state ===== */
    let baseRows = [];
    let mySet = new Set();
    let myCaptainId = null, myViceId = null;

    async function loadGw(gwId){
      // Load GW live points
      tableCard.innerHTML = "";
      tableCard.append(ui.spinner("Fetching gameweek data…"));

      const live = await api.eventLive(+gwId);

      // If we have a manager entry, mark your players for that GW
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
    function applyFilters(){
      renderAll();
    }

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

      // sort default by points desc
      rows.sort((a,b)=> b.pts - a.pts);
      return rows; // no cap — load all
    }

    /* ===== Summary (L) + Team of the Week (R) ===== */
    function renderTopGrid(rows, gwId){
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
        utils.el("h3",{},`GW ${gwId} — Summary`),
        hauls.length ? utils.el("ul",{}, hauls.map(r=>utils.el("li",{},`${r.name} (${r.team}) — ${r.pts} pts (G${r.g}, A${r.a}, BPS ${r.bps})`))) :
          utils.el("div",{class:"tag"},"No 10+ pointers in current filter."),
        utils.el("div",{class:"mt-8 legend small"},[
          utils.el("span",{class:"chip"} ,`Braces: ${braces}`),
          utils.el("span",{class:"chip"} ,`Hattricks: ${hatties}`),
          utils.el("span",{class:"chip"} ,`Red cards: ${reds}`)
        ]),
        utils.el("h4",{class:"mt-8"},"Team totals (top)"),
        utils.el("ul",{}, teamArr.map(([t,p])=>utils.el("li",{},`${t}: ${p} pts`))),
        utils.el("h4",{class:"mt-8"},"Avg points by position"),
        utils.el("ul",{}, posAvg.map(([k,v])=> utils.el("li",{}, `${k}: ${v}`)))
      ]);

      // Right: Team of the Week (auto-valid)
      const totw = pickTotw(rows);
      const right = utils.el("div",{},[
        utils.el("h3",{},`Team of the Week — GW ${gwId}`),
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
      tableCard.append(utils.el("h3",{},`GW ${gwId} — Player Points`), table);
    }

    /* ===== Render pipeline ===== */
    function renderAll(){
      const gwId = gwSel.value;
      const rows = filteredRows();
      renderTopGrid(rows, gwId);   // top two-column card
      renderTable(rows, gwId);     // then full table
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
