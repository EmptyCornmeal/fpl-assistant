// js/pages/meta.js
// ⚡ Meta: multi-league ownership, Template XI, Template vs You, Captain EV, and EO/xP visuals.

import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { xPWindow, estimateXMinsForPlayer } from "../lib/xp.js";

// All valid FPL formations (min 3 DEF, min 2 MID, min 1 FWD)
const FORMATIONS = {
  "3-4-3": { GKP:1, DEF:3, MID:4, FWD:3 },
  "3-5-2": { GKP:1, DEF:3, MID:5, FWD:2 },
  "4-4-2": { GKP:1, DEF:4, MID:4, FWD:2 },
  "4-5-1": { GKP:1, DEF:4, MID:5, FWD:1 },
  "4-3-3": { GKP:1, DEF:4, MID:3, FWD:3 },
  "5-4-1": { GKP:1, DEF:5, MID:4, FWD:1 },
  "5-3-2": { GKP:1, DEF:5, MID:3, FWD:2 },
  "5-2-3": { GKP:1, DEF:5, MID:2, FWD:3 }
};

// Pick a sensible bench for any formation: always 1 GK, then best EO leftovers.
function pickBench(byPos, pickedSet, size = 4) {
  const bench = [];

  // 1) GK first (best remaining)
  const nextGK = byPos.GKP.find(p => !pickedSet.has(p.id));
  if (nextGK) {
    bench.push(nextGK);
    pickedSet.add(nextGK.id);
  }

  // 2) Gather all other leftovers (highest EO first)
  const leftovers = [];
  for (const pos of ["DEF","MID","FWD"]) {
    for (const p of byPos[pos]) {
      if (!pickedSet.has(p.id)) leftovers.push(p);
    }
  }

  // 3) Fill remaining bench slots
  for (const cand of leftovers) {
    if (bench.length >= size) break;
    bench.push(cand);
    pickedSet.add(cand.id);
  }

  return bench.slice(0, size);
}

export async function renderMeta(main){
  const container = utils.el("div");
  container.append(ui.spinner("Building meta…"));
  ui.mount(main, container);

  try {
    // Bootstrap (teams, positions, events)
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;
    const { elements: players, teams, element_types: positions, events } = bs;

    // Maps/helpers
    const teamShort = new Map(teams.map(t=>[t.id, t.short_name]));
    const posShort  = new Map(positions.map(p=>[p.id, p.singular_name_short]));
    const priceM    = (p)=> +(p.now_cost/10).toFixed(1);

    // GW window
    const finished     = events.filter(e=>e.data_checked);
    const lastFinished = finished.length ? Math.max(...finished.map(e=>e.id)) : 0;
    const nextGw       = Math.max(1, lastFinished + 1);
    let   gwWindowCount = 5; // default; user-adjustable
    const gwIds = ()=> events.filter(e=>e.id>=nextGw).slice(0, gwWindowCount).map(e=>e.id);

    // Controls
    container.innerHTML = "";
    const controls = utils.el("div",{class:"card"});
    const header   = utils.el("div",{class:"grid cols-4"});

    // Safe metric node for "Managers (scanned)"
    const managersCountValue = utils.el("div",{class:"metric-value"},"—");
    const managersCountMetric = utils.el("div",{class:"metric"},[
      utils.el("div",{class:"metric-label"},"Managers (scanned)"),
      managersCountValue
    ]);

    header.append(
      ui.metric("Leagues", (state.leagueIds||[]).length || "—"),
      managersCountMetric, // direct reference
      ui.metric("Last Finished GW", lastFinished || "—"),
      ui.metric("Next GW", nextGw || "—"),
    );

    // Formation segmented control
    const formationWrap = utils.el("div",{class:"segmented"});
    const formationSel  = utils.el("input",{type:"hidden", value:"3-4-3"});
    Object.keys(FORMATIONS).forEach((key, idx)=>{
      const b = utils.el("button",{class:"seg-btn"+(idx===0?" active":""), type:"button"}, key);
      b.addEventListener("click", ()=>{
        formationSel.value = key;
        [...formationWrap.querySelectorAll(".seg-btn")].forEach(btn=>btn.classList.remove("active"));
        b.classList.add("active");
        if (metaData) renderTemplateBlock();
      });
      formationWrap.append(b);
    });

    // Window select
    const winSel = utils.el("select",{class:"select"});
    winSel.innerHTML = `
      <option value="3">Window: Next 3 GWs</option>
      <option value="5" selected>Window: Next 5 GWs</option>
      <option value="8">Window: Next 8 GWs</option>
    `;
    winSel.addEventListener("change", ()=>{
      gwWindowCount = +winSel.value;
      if (metaData) {
        renderTemplateBlock();
        renderDiffsBlock();
        renderCaptainBlock();
        renderScatterBlock();
      }
    });

    // Pages per league
    const pagesSel = utils.el("select",{class:"select"});
    pagesSel.innerHTML = `
      <option value="1" selected>Managers per league: Top 50</option>
      <option value="2">Managers per league: Top 100</option>
    `;

    const rebuildBtn = utils.el("button",{class:"btn-primary", type:"button"},"Rebuild meta");
    const smallNote  = utils.el("div",{class:"tag"},"Meta uses last finished GW picks; EO is approximate across the union of your leagues.");

    controls.append(
      utils.el("h3",{},"Meta Controls"), 
      header,
      utils.el("div",{class:"meta-controls"},[
        utils.el("div",{}, [utils.el("label",{class:"lbl"},"Formation"), formationWrap]),
        utils.el("div",{}, [winSel]),
        utils.el("div",{}, [pagesSel]),
        rebuildBtn
      ]),
      smallNote
    );

    // Blocks to fill
    const kpisCard      = utils.el("div",{class:"card"});
    const templateCard  = utils.el("div",{class:"card"});
    const diffsCard     = utils.el("div",{class:"card"});
    const captainCard   = utils.el("div",{class:"card"});
    const ownershipCard = utils.el("div",{class:"card"});
    const scatterCard   = utils.el("div",{class:"card"});

    // Layout
    const gridTop    = utils.el("div",{class:"grid cols-2"});
    gridTop.append(templateCard, diffsCard);

    const gridBottom = utils.el("div",{class:"grid cols-2"});
    gridBottom.append(ownershipCard, scatterCard);

    container.append(controls, kpisCard, gridTop, captainCard, gridBottom);

    // ---- Data Build ----
    let metaData = null; // { entries, ownCount, eoList, yourXI }

    async function buildMeta(){
      kpisCard.innerHTML = "";
      kpisCard.append(ui.spinner("Scanning leagues…"));

      const leagues = (state.leagueIds||[]).slice();
      if (!leagues.length){
        kpisCard.innerHTML = "";
        kpisCard.append(
          utils.el("h3",{},"No leagues added"),
          utils.el("div",{},"Add Classic League IDs in the left sidebar.")
        );
        return;
      }

      // 1) Collect entries across pages
      let pages = +pagesSel.value; // 1 or 2
      const entriesSet = new Set();
      for (const lid of leagues){
        for (let p=1; p<=pages; p++){
          try {
            const data = await api.leagueClassic(lid, p);
            for (const r of (data?.standings?.results||[])) entriesSet.add(r.entry);
          } catch {}
          await utils.sleep(80);
        }
      }
      const entries = Array.from(entriesSet);

      // Update metric via direct node
      managersCountValue.textContent = entries.length;

      // 2) Build ownership by scanning last finished GW picks
      const ownCount = new Map(); // elementId -> count
      const progress = utils.el("div",{class:"progress"},[
        utils.el("div",{class:"bar", style:"width:0%"})
      ]);
      kpisCard.innerHTML = "";
      kpisCard.append(
        utils.el("h3",{},"Meta Summary"),
        utils.el("div",{class:"grid cols-4"},[
          ui.metric("Managers scanned", entries.length.toString()),
          ui.metric("Leagues", leagues.length.toString()),
          ui.metric("Window (GWs)", gwWindowCount.toString()),
          ui.metric("Formation", formationSel.value)
        ]),
        progress
      );
      let done=0;
      for (const entry of entries){
        try{
          const picks = await api.entryPicks(entry, Math.max(1,lastFinished));
          for (const p of (picks.picks||[])) ownCount.set(p.element, (ownCount.get(p.element)||0)+1);
        }catch{}
        done++;
        progress.querySelector(".bar").style.width = `${Math.round((done/entries.length)*100)}%`;
        if ((done % 8)===0) await utils.sleep(50);
      }

      // 3) EO list
      const total = entries.length || 1;
      const eoList = players.map(p=>({
        id: p.id,
        name: p.web_name,
        teamId: p.team,
        team: teamShort.get(p.team) || "?",
        posId: p.element_type,
        pos: posShort.get(p.element_type) || "?",
        price: priceM(p),
        eo: (100*(ownCount.get(p.id)||0)/total)
      })).sort((a,b)=> b.eo - a.eo);

      // 4) Your XI (last finished)
      const byId = new Map(players.map(p=>[p.id,p]));
      let yourXI = [];
      if (state.entryId){
        try {
          const you = await api.entryPicks(state.entryId, Math.max(1,lastFinished));
          yourXI = you.picks
            .filter(pk => pk.multiplier > 0) // starters (position 1..11)
            .sort((a,b)=>a.position-b.position)
            .map(pk=>{
              const pl = byId.get(pk.element);
              return {
                id: pl.id,
                name: pl.web_name,
                teamId: pl.team,
                team: teamShort.get(pl.team) || "?",
                posId: pl.element_type,
                pos: posShort.get(pl.element_type) || "?",
                price: priceM(pl),
                isC: !!pk.is_captain,
                isVC: !!pk.is_vice_captain
              };
            });
        } catch {}
      }

      metaData = { entries, ownCount, eoList, yourXI };
      await Promise.all([
        renderTemplateBlock(),
        renderDiffsBlock(),
        renderCaptainBlock(),
        renderOwnershipBlock(),
        renderScatterBlock()
      ]);
    }

    // ------- Template XI -------
    async function renderTemplateBlock(){
      templateCard.innerHTML = "";
      templateCard.append(ui.spinner("Assembling Template XI…"));

      const { eoList } = metaData;
      const formation = formationSel.value;

      // Split by position
      const byPos = { GKP:[], DEF:[], MID:[], FWD:[] };
      for (const e of eoList){
        if (byPos[e.pos]) byPos[e.pos].push(e);
      }

      // Build XI by formation (highest EO per position)
      const xi = [];
      const picked = new Set();

      const want = FORMATIONS[formation];
      const takeTop = (arr, n) => arr.slice(0, n);

      for (const [posKey, count] of Object.entries(want)) {
        if (posKey === "GKP" || posKey === "DEF" || posKey === "MID" || posKey === "FWD") {
          const chosen = takeTop(byPos[posKey], count);
          xi.push(...chosen);
          chosen.forEach(p => picked.add(p.id));
        }
      }

      // Bench: 1 GK + 3 best leftovers by EO (any position)
      const bench = pickBench(byPos, picked, 4);

      // xP window for XI (and per player)
      const gwIdsArr = gwIds();
      const byId = new Map(state.bootstrap.elements.map(p=>[p.id,p]));
      let teamXP = 0;
      for (const r of xi){
        try{
          const pl = byId.get(r.id);
          r._xmins = await estimateXMinsForPlayer(pl);
          const res = await xPWindow(pl, gwIdsArr);
          r._xp = res.total;
        }catch{ r._xmins = 0; r._xp = 0; }
        await utils.sleep(15);
        teamXP += r._xp || 0;
      }

      templateCard.innerHTML = "";
      templateCard.append(
        utils.el("h3",{},`Template XI — ${formation}`),
        utils.el("div",{class:"grid cols-2"},[
          ui.metric(`Template XI xP (next ${gwIdsArr.length})`, teamXP.toFixed(1)),
          ui.metric("Bench strength (EO avg)", (bench.reduce((a,b)=>a+b.eo,0)/Math.max(1,bench.length)).toFixed(1)+"%"),
        ])
      );

      const cols = [
        { header:"#", accessor:(_,i)=>i+1, sortBy:(_,i)=>i },
        { header:"Name", accessor:r=>r.name, sortBy:r=>r.name },
        { header:"Pos", accessor:r=>r.pos, sortBy:r=>r.pos },
        { header:"Team", accessor:r=>r.team, sortBy:r=>r.team },
        { header:"Price", accessor:r=>r.price, cell:r=>`£${r.price.toFixed(1)}m`, sortBy:r=>r.price },
        { header:"EO", accessor:r=>r.eo, cell:r=>`${r.eo.toFixed(1)}%`, sortBy:r=>r.eo },
        { header:"xMins", cell:r=>{
            const v = r._xmins||0; const r90=v/90;
            const s = utils.el("span",{class:"badge "+(r90>=0.9?"badge-green":(r90>=0.7?"badge-amber":"badge-red"))}, r90>=0.9?"NAILED":(r90>=0.7?"RISK":"CAMEO?"));
            s.dataset.tooltip = `Projected ${Math.round(v)}'`;
            return s;
        }, sortBy:r=>r._xmins||0 },
        { header:`xP (next ${gwIdsArr.length})`, accessor:r=>r._xp||0, cell:r=>(r._xp||0).toFixed(2), sortBy:r=>r._xp||0 }
      ];
      templateCard.append(ui.table(cols, xi));

      if (bench.length){
        const benchCols = [
          { header:"#", accessor:(_,i)=>i+1 },
          { header:"Name", accessor:r=>r.name },
          { header:"Pos", accessor:r=>r.pos },
          { header:"Team", accessor:r=>r.team },
          { header:"EO", accessor:r=>r.eo, cell:r=>`${r.eo.toFixed(1)}%` },
          { header:"Price", accessor:r=>r.price, cell:r=>`£${r.price.toFixed(1)}m` },
        ];
        templateCard.append(utils.el("h4",{},"Bench"), ui.table(benchCols, bench));
      }
    }

    // ------- Diffs: Template vs You -------
    async function renderDiffsBlock(){
      diffsCard.innerHTML = "";
      diffsCard.append(ui.spinner("Comparing with your XI…"));

      const { eoList, yourXI } = metaData;
      const byId = new Map(eoList.map(e=>[e.id, e]));
      const yourIds = new Set((yourXI||[]).map(x=>x.id));

      // Template XI ids (recompute same way)
      const formation = formationSel.value;
      const want = FORMATIONS[formation];
      const byPos = { GKP:[], DEF:[], MID:[], FWD:[] };
      for (const e of eoList){ if (byPos[e.pos]) byPos[e.pos].push(e); }
      const xiIds = [
        ...byPos.GKP.slice(0,want.GKP),
        ...byPos.DEF.slice(0,want.DEF),
        ...byPos.MID.slice(0,want.MID),
        ...byPos.FWD.slice(0,want.FWD),
      ].map(x=>x.id);
      const tplSet = new Set(xiIds);

      const missing = xiIds
        .filter(id=>!yourIds.has(id))
        .map(id=>byId.get(id));

      const diffs = (yourXI||[])
        .filter(x=>!tplSet.has(x.id))
        .map(x=>({
          id: x.id, name: x.name, team: x.team, pos: x.pos, price: x.price,
          eo: byId.get(x.id)?.eo || 0
        }));

      // Compute xP window for those lists (kept small)
      const windowIds = gwIds();
      const fullPlayersMap = new Map(state.bootstrap.elements.map(p=>[p.id,p]));
      for (const list of [missing, diffs]){
        for (const r of list){
          try{
            const pl = fullPlayersMap.get(r.id);
            const res = await xPWindow(pl, windowIds);
            r._xp = res.total;
          }catch{ r._xp = 0; }
          await utils.sleep(20);
        }
      }

      diffsCard.innerHTML = "";
      diffsCard.append(utils.el("h3",{},"Template vs You (priority targets & differentials)"));

      const left = ui.table([
        { header:"#", accessor:(_,i)=>i+1 },
        { header:"High-EO You’re Missing", accessor:r=>r.name, sortBy:r=>r.name },
        { header:"Pos", accessor:r=>r.pos },
        { header:"Team", accessor:r=>r.team },
        { header:"EO", accessor:r=>r.eo, cell:r=>`${r.eo.toFixed(1)}%`, sortBy:r=>r.eo },
        { header:`xP (next ${windowIds.length})`, accessor:r=>r._xp, cell:r=>r._xp.toFixed(2), sortBy:r=>r._xp }
      ], missing.slice(0,12));

      const right = ui.table([
        { header:"#", accessor:(_,i)=>i+1 },
        { header:"Your Differentials", accessor:r=>r.name, sortBy:r=>r.name },
        { header:"Pos", accessor:r=>r.pos },
        { header:"Team", accessor:r=>r.team },
        { header:"EO", accessor:r=>r.eo, cell:r=>`${r.eo.toFixed(1)}%`, sortBy:r=>r.eo },
        { header:`xP (next ${windowIds.length})`, accessor:r=>r._xp, cell:r=>r._xp.toFixed(2), sortBy:r=>r._xp }
      ], diffs.slice(0,12));

      const grid = utils.el("div",{class:"grid cols-2"});
      grid.append(
        utils.el("div",{},[utils.el("h4",{},"Targets to cover"), left]),
        utils.el("div",{},[utils.el("h4",{},"Your differentials"), right])
      );
      diffsCard.append(grid);
    }

    // ------- Captaincy EV -------
    async function renderCaptainBlock(){
      captainCard.innerHTML = "";
      captainCard.append(ui.spinner("Computing captaincy edges…"));

      const { yourXI, eoList } = metaData;
      if (!yourXI?.length){
        captainCard.innerHTML="";
        captainCard.append(
          utils.el("h3",{},"Captaincy EV"),
          utils.el("div",{class:"tag"},"Set your Entry ID to compute squad-based captaincy edges.")
        );
        return;
      }

      // Field captain: highest EO player overall (proxy)
      const field = eoList[0];

      // Your top 5 captain options by xP next GW
      const nextOnly = [gwIds()[0]];
      const fullPlayersMap = new Map(state.bootstrap.elements.map(p=>[p.id,p]));
      const yourWithXp = [];
      for (const r of yourXI){
        try {
          const pl = fullPlayersMap.get(r.id);
          const xw = await xPWindow(pl, nextOnly);
          yourWithXp.push({ ...r, xp: xw.total, eo: (eoList.find(e=>e.id===r.id)?.eo || 0) });
        } catch {
          yourWithXp.push({ ...r, xp: 0, eo: 0 });
        }
        await utils.sleep(15);
      }
      yourWithXp.sort((a,b)=> b.xp - a.xp);
      const top5 = yourWithXp.slice(0,5);

      // Field EV
      let fieldXP = 0;
      try { fieldXP = (await xPWindow(fullPlayersMap.get(field.id), nextOnly)).total; } catch {}
      const fieldEO = field.eo/100;

      const rows = top5.map(c=>{
        const yourEV = 2 * (c.xp||0);
        const fieldEV = 2 * fieldXP;
        const edge = (yourEV - fieldEV) * (1 - fieldEO);
        return {
          name: c.name, team: c.team, pos: c.pos, xp: c.xp||0, yourEV, fieldEV, edge,
          eo: c.eo
        };
      }).sort((a,b)=> b.edge - a.edge);

      captainCard.innerHTML = "";
      captainCard.append(
        utils.el("h3",{},"Captaincy — Your Edge vs Field"),
        utils.el("div",{class:"grid cols-3"},[
          ui.metric("Field Captain (proxy)", `${field.name} (${field.team})`),
          ui.metric("Field EO (approx)", `${field.eo.toFixed(1)}%`),
          ui.metric("Field EV (2×xP)", (2*fieldXP).toFixed(2)),
        ])
      );

      const cols = [
        { header:"#", accessor:(_,i)=>i+1 },
        { header:"Your pick", accessor:r=>r.name },
        { header:"Team", accessor:r=>r.team },
        { header:"Pos", accessor:r=>r.pos },
        { header:"xP (next GW)", accessor:r=>r.xp, cell:r=>r.xp.toFixed(2), sortBy:r=>r.xp },
        { header:"Your EV (2×xP)", accessor:r=>r.yourEV, cell:r=>r.yourEV.toFixed(2), sortBy:r=>r.yourEV },
        { header:"Field EV", accessor:r=>r.fieldEV, cell:r=>r.fieldEV.toFixed(2), sortBy:r=>r.fieldEV },
        { header:"Edge vs Field", accessor:r=>r.edge, cell:r=> (r.edge>=0?"+":"")+r.edge.toFixed(2), sortBy:r=>r.edge },
        { header:"Your EO", accessor:r=>r.eo, cell:r=> `${r.eo.toFixed(1)}%` }
      ];
      captainCard.append(ui.table(cols, rows));
    }

    // ------- Ownership Top20 -------
    async function renderOwnershipBlock(){
      ownershipCard.innerHTML = "";
      ownershipCard.append(ui.spinner("Rendering meta ownership…"));
      const { eoList } = metaData;
      const top = eoList.slice(0,20);
      const canvas = utils.el("canvas");
      ownershipCard.innerHTML = "";
      ownershipCard.append(utils.el("h3",{},"Top 20 by Meta Ownership"), canvas);
      const cfg = {
        type: "bar",
        data: {
          labels: top.map(r=> `${r.name} (${r.team})`),
          datasets: [{ data: top.map(r=> +r.eo.toFixed(2)) }]
        },
        options: {
          indexAxis: "y",
          plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(ctx)=> `${ctx.raw}%` } } },
          scales: { x:{ ticks:{ callback:v=> `${v}%` }, title:{ display:true, text:"Ownership %" }} }
        }
      };
      await ui.chart(canvas, cfg);
    }

    // ------- EO vs xP Scatter (top 60 by EO) -------
    async function renderScatterBlock(){
      scatterCard.innerHTML = "";
      scatterCard.append(ui.spinner("Computing EO vs xP scatter…"));
      const { eoList } = metaData;
      const pool = eoList.slice(0,60); // limit compute
      const gwIdsArr = gwIds();
      const byId = new Map(state.bootstrap.elements.map(p=>[p.id,p]));
      const ds = [];
      for (const r of pool){
        try{
          const xp = await xPWindow(byId.get(r.id), gwIdsArr);
          ds.push({
            x: r.eo, y: xp.total, label: `${r.name} (${r.team})`,
            pos: r.posId
          });
        }catch{
          ds.push({ x: r.eo, y: 0, label: `${r.name} (${r.team})`, pos: r.posId });
        }
        await utils.sleep(12);
      }
      const colors = {1:"#60a5fa", 2:"#34d399", 3:"#f472b6", 4:"#f59e0b"};

      scatterCard.innerHTML = "";
      const canvas = utils.el("canvas");
      scatterCard.append(utils.el("h3",{},"EO vs xP (next window)"), canvas);
      const cfg = {
        type:"scatter",
        data:{ datasets:[{
          data: ds,
          parsing:false,
          pointRadius: (ctx)=> 3 + Math.sqrt(ctx.raw.x||0)/2, // bigger by EO
          pointHoverRadius:(ctx)=> 6 + Math.sqrt(ctx.raw.x||0)/2,
          pointBackgroundColor:(ctx)=> colors[ctx.raw.pos] || "#93c5fd"
        }]},
        options:{
          animation:false,
          plugins:{ legend:{display:false}, tooltip:{ callbacks:{
            label:(ctx)=> `${ctx.raw.label}: EO ${ctx.raw.x.toFixed(1)}%, xP ${ctx.raw.y.toFixed(2)}`
          } } },
          scales:{
            x:{ title:{display:true, text:"Meta Ownership %"}, min:0, max:100 },
            y:{ title:{display:true, text:`xP (next ${gwIdsArr.length})`}, suggestedMin:0 }
          }
        }
      };
      await ui.chart(canvas, cfg);
    }

    // Kickoff: initial build + button re-run
    rebuildBtn.addEventListener("click", buildMeta);
    await buildMeta();

  } catch (e){
    ui.mount(main, ui.error("Meta failed", e));
  }
}
