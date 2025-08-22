// js/pages/my-team.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { openModal } from "../components/modal.js";
import { xPWindow, estimateXMinsForPlayer } from "../lib/xp.js";

// Status mapping
const STATUS_MAP = {
  a: { label: "Available",  cls: "st-okay",  icon: "✅" },
  d: { label: "Doubtful",   cls: "st-doubt", icon: "🟡" },
  i: { label: "Injured",    cls: "st-inj",   icon: "🔴" },
  s: { label: "Suspended",  cls: "st-sus",   icon: "⛔" },
  n: { label: "Unavailable",cls: "st-out",   icon: "⛔" },
};

export async function renderMyTeam(main){
  if (!state.entryId) {
    ui.mount(main, utils.el("div",{class:"card"}, "Enter your Entry ID to see your team."));
    return;
  }

  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading team…"));
  ui.mount(main, wrap);

  // Bootstrap + core data
  const bs = state.bootstrap || await api.bootstrap();
  state.bootstrap = bs;

  const { events, elements: players, teams, element_types: positions } = bs;

  const finished = events.filter(e=>e.data_checked);
  const lastFinished = finished.length ? Math.max(...finished.map(e=>e.id)) : null;
  const nextGw = lastFinished ? lastFinished + 1 : 1;
  const winN = 5; // fixed window now (no controls)
  const windowGwIds = () => events.filter(e=>e.id>=nextGw).slice(0, winN).map(e=>e.id);

  if (!lastFinished){
    ui.mount(main, utils.el("div",{class:"card"},"No finished gameweeks yet."));
    return;
  }

  // pulls
  const [profile, hist, picksFinished, liveFinished, fixturesAll] = await Promise.all([
    api.entry(state.entryId),
    api.entryHistory(state.entryId),
    api.entryPicks(state.entryId, lastFinished),
    api.eventLive(lastFinished),
    api.fixtures()
  ]);

  // Try to get next GW picks (optional)
  let picksNext = null;
  try { picksNext = await api.entryPicks(state.entryId, nextGw); } catch {}

  // Auto mode: prefer Next if user has saved picks; otherwise Finished
  const mode = (picksNext?.picks?.length) ? "next" : "finished";

  const teamById   = new Map(teams.map(t=>[t.id, t]));
  const posById    = new Map(positions.map(p=>[p.id, p]));
  const playerById = new Map(players.map(p=>[p.id, p]));
  const teamShort  = (id)=> teamById.get(id)?.short_name || "?";
  const priceM     = (p)=> +(p.now_cost/10).toFixed(1);

  const thisGwHist = hist.current.find(h => h.event === lastFinished);
  const teamVal = thisGwHist ? (thisGwHist.value/10).toFixed(1) : "—";
  const bank = thisGwHist ? (thisGwHist.bank/10).toFixed(1) : "—";

  // Live stats map for last finished
  const liveMap = new Map(liveFinished.elements.map(e => [e.id, e.stats]));

  // Fixtures helpers
  const fixturesByEvent = new Map();
  for (const f of fixturesAll) {
    if (!fixturesByEvent.has(f.event)) fixturesByEvent.set(f.event, []);
    fixturesByEvent.get(f.event).push(f);
  }
  function teamFixtureForGW(teamId, gwId){
    const list = fixturesByEvent.get(gwId) || [];
    for (const f of list){
      if (f.team_h === teamId) {
        return { opp: teamShort(f.team_a), home:true, fdr:f.team_h_difficulty, kickoff:f.kickoff_time };
      }
      if (f.team_a === teamId) {
        return { opp: teamShort(f.team_h), home:false, fdr:f.team_a_difficulty, kickoff:f.kickoff_time };
      }
    }
    return null;
  }
  function fixturesStrip(teamId, gws){
    const strip = utils.el("div",{class:"fixtures-strip"});
    for (const gw of gws){
      const fx = teamFixtureForGW(teamId, gw);
      const cell = utils.el("span",{class:"fx"});
      if (fx){
        const cls = `fdr-${fx.fdr ?? 3}`;
        cell.classList.add(cls);
        cell.textContent = `${fx.home?"H":"A"} ${fx.opp}`;
        cell.dataset.tooltip = `GW${gw} • ${fx.home?"Home":"Away"} vs ${fx.opp} • FDR ${fx.fdr || "?"}`;
      } else {
        cell.textContent = "—";
        cell.dataset.tooltip = `GW${gw} • No fixture`;
      }
      strip.append(cell);
    }
    return strip;
  }

  // Picks set for current mode
  const picksForMode = (mode === "next" && picksNext?.picks?.length) ? picksNext : picksFinished;

  // Split starters vs bench by position index
  const starters = (picksForMode.picks || []).filter(pk => pk.position <= 11);
  const benchAll = (picksForMode.picks || []).filter(pk => pk.position > 11)
                   .sort((a,b)=> a.position - b.position);

  // Captain / VC
  let capName = "—", vcName = "—";
  for (const pk of (picksForMode.picks || [])) {
    if (pk.is_captain)     capName = playerById.get(pk.element)?.web_name || "—";
    if (pk.is_vice_captain) vcName = playerById.get(pk.element)?.web_name || "—";
  }

  async function buildRow(pk) {
    const pl   = playerById.get(pk.element);
    const team = teamById.get(pl.team);
    const pos  = posById.get(pl.element_type);

    const stats = liveMap.get(pl.id) || {};
    const xmins = await estimateXMinsForPlayer(pl).catch(()=>0);

    const overallEO = +Number(pl.selected_by_percent || 0);
    const metaEO = (state.metaEO && typeof state.metaEO.get === "function")
      ? Number(state.metaEO.get(pl.id) || 0)
      : null;

    // Momentum (heuristic)
    const momentum = Number((pl.transfers_in_event || 0) - (pl.transfers_out_event || 0));
    let momIcon = "";
    if (momentum > 10000) momIcon = "▲";
    else if (momentum < -10000) momIcon = "▼";

    // xP
    let xpNext = 0, xpWindow = 0;
    try {
      const nextOnly = [nextGw];
      xpNext   = (await xPWindow(pl, nextOnly)).total || 0;
      xpWindow = (await xPWindow(pl, windowGwIds())).total || 0;
    } catch {}

    return {
      id: pl.id,
      name: pl.web_name,
      teamId: team.id,
      team: team.short_name,
      pos: pos.singular_name_short,
      price: priceM(pl),
      priceMomentum: momIcon,
      selOverall: overallEO,
      selMeta: metaEO,
      status: pl.status,
      news: pl.news || "",
      cap: pk.is_captain ? "C" : (pk.is_vice_captain ? "VC" : ""),
      points: (mode==="finished") ? (stats.total_points ?? 0) : null,
      minutes: (mode==="finished") ? (stats.minutes ?? 0) : null,
      breakdown: stats,
      xmins,
      xpNext,
      xpWindow
    };
  }

  const rows = [];
  for (const pk of starters) rows.push(await buildRow(pk));
  const benchRows = [];
  for (const pk of benchAll) benchRows.push(await buildRow(pk));

  // Suggestions
  function captainSuggestion() {
    if (!rows.length) return null;
    const currentC = rows.find(r => r.cap==="C");
    const best = [...rows].sort((a,b)=> (b.xpNext||0) - (a.xpNext||0))[0];
    if (!currentC || !best) return null;
    const diff = (best.xpNext||0) - (currentC.xpNext||0);
    if (best.name !== currentC.name && diff > 0.6) {
      return `Consider captaining ${best.name} (xP ${best.xpNext.toFixed(2)}) over ${currentC.name} (xP ${currentC.xpNext.toFixed(2)}), +${diff.toFixed(2)}.`;
    }
    return null;
  }
  function benchSuggestion() {
    if (!rows.length || !benchRows.length) return null;
    const worstStarter = [...rows].sort((a,b)=> (a.xpNext||0) - (b.xpNext||0))[0];
    const bestBench = [...benchRows].sort((a,b)=> (b.xpNext||0) - (a.xpNext||0))[0];
    const gain = (bestBench.xpNext||0) - (worstStarter.xpNext||0);
    if (gain > 0.5) {
      return `Start ${bestBench.name} over ${worstStarter.name} (+${gain.toFixed(2)} xP next GW).`;
    }
    return null;
  }

  // ===== Header (Overview) =====
  const header = utils.el("div",{class:"grid cols-4"});
  header.append(
    ui.metric("Manager", `${profile.player_first_name} ${profile.player_last_name}`),
    ui.metric("Team", profile.name),
    ui.metric("Team Value", `£${teamVal}m`),
    ui.metric("Bank", `£${bank}m`)
  );

  const quick = utils.el("div",{class:"chips"});
  quick.append(
    utils.el("span",{class:"chip"}, `Last Finished: GW${lastFinished}`),
    utils.el("span",{class:"chip"}, `Next: GW${nextGw}`),
    utils.el("span",{class:"chip"}, `View: ${mode==="finished" ? `GW${lastFinished} (confirmed)` : `Next (GW${nextGw})`}`),
    utils.el("span",{class:"chip"}, `Captain: ${capName}`),
    utils.el("span",{class:"chip"}, `Vice: ${vcName}`)
  );

  // ===== Table helpers =====
  function minutesBadge(r){
    const b = utils.el("span",{class:"badge"},"—");
    const v = r.xmins||0; const r90 = v/90;
    b.textContent = r90>=0.9 ? "NAILED" : (r90>=0.7 ? "RISK" : "CAMEO?");
    b.className = "badge " + (r90>=0.9 ? "badge-green" : (r90>=0.7 ? "badge-amber" : "badge-red"));
    b.dataset.tooltip = `Projected ${Math.round(v)}' based on last 5 + status`;
    return b;
  }
  function eoChips(r){
    const wrap = utils.el("div",{class:"eo-chips"});
    const overall = utils.el("span",{class:"chip chip-dim"}, `${r.selOverall.toFixed(1)}%`);
    overall.dataset.tooltip = "Overall EO (FPL selected_by_percent)";
    wrap.append(overall);
    if (typeof r.selMeta === "number"){
      const meta = utils.el("span",{class:"chip chip-accent"}, `${r.selMeta.toFixed(1)}%`);
      meta.dataset.tooltip = "Meta EO across your scanned leagues (visit Meta page to refresh)";
      wrap.append(meta);
    }
    return wrap;
  }
  function statusPill(r){
    const s = STATUS_MAP[r.status] || {label: r.status.toUpperCase(), cls:"st-unk", icon:"ℹ️"};
    const pill = utils.el("span",{class:`status-pill ${s.cls}`}, `${s.icon} ${s.label}`);
    if (r.news) pill.dataset.tooltip = r.news;
    return pill;
  }

  const hdrXpWindow = `xP (Next ${winN})`;
  const hdrGwPts    = `GW${lastFinished} Pts`;

  const cols = [
    { key:"cap", header:"", cell:r=>{
        if (r.cap==="C") return utils.el("span",{class:"badge c-badge"},"C");
        if (r.cap==="VC") return utils.el("span",{class:"badge vc-badge"},"VC");
        return "";
      }},
    { key:"name", header:"Name", accessor:r=>r.name, sortBy:r=>r.name, cell:r=>{
        const wrap = utils.el("div",{class:"name-cell"});
        wrap.append(utils.el("span",{class:"team-chip"}, r.team));
        wrap.append(utils.el("span",{class:"nm"}, r.name));
        if (r.priceMomentum) {
          const mom = utils.el("span",{class:"mom"}, r.priceMomentum);
          mom.dataset.tooltip = r.priceMomentum==="▲" ? "Price momentum: net transfers in this GW are high" : "Price momentum: net transfers out this GW are high";
          wrap.append(mom);
        }
        return wrap;
      }},
    { key:"pos",   header:"Pos",  accessor:r=>r.pos, sortBy:r=>r.pos },
    { key:"team",  header:"Team", accessor:r=>r.team, sortBy:r=>r.team },
    { key:"price", header:"Price", accessor:r=>r.price, cell:r=>`£${r.price.toFixed(1)}m`, sortBy:r=>r.price },
    { key:"eo",    header:"EO", cell:eoChips, sortBy:r=> (r.selMeta ?? r.selOverall) },
    { key:"xmins", header:"xMins", cell:minutesBadge, sortBy:r=>r.xmins ?? 0 },
    { key:"xpNext", header:"xP (Next)", accessor:r=>r.xpNext||0, cell:r=> (r.xpNext||0).toFixed(2), sortBy:r=>r.xpNext||0 },
    { key:"xpWindow", header:hdrXpWindow, accessor:r=>r.xpWindow||0, cell:r=> (r.xpWindow||0).toFixed(2), sortBy:r=>r.xpWindow||0 },
    {
      key:"gwPts", header:hdrGwPts,
      accessor:r=> (mode==="finished" ? (r.points ?? 0) : null),
      cell:r=> mode==="finished" ? String(r.points ?? 0) : "—",
      sortBy:r=> (mode==="finished" ? (r.points ?? 0) : -1),
      tdClass:r=>{
        if (mode!=="finished") return "";
        if ((r.points ?? 0) >= 10) return "points-high";
        if ((r.points ?? 0) === 0) return "points-low";
        return "";
      }
    },
    {
      key:"minutes", header:"Min",
      accessor:r=> (mode==="finished" ? (r.minutes ?? 0) : null),
      cell:r=> mode==="finished" ? String(r.minutes ?? 0) : "—",
      sortBy:r=> (mode==="finished" ? (r.minutes ?? 0) : -1),
      tdClass:r=> (mode==="finished" && (r.minutes ?? 0) === 0 ? "minutes-zero" : "")
    },
    { key:"status", header:"Status", cell:statusPill, sortBy:r=> r.status || "" },
    { key:"fixtures", header:"Fixtures", cell:r=> fixturesStrip(playerById.get(r.id).team, windowGwIds()) },
    { key:"details", header:"Details", cell:r=>{
        const btn = utils.el("button",{class:"btn-ghost", type:"button"},"Breakdown");
        btn.addEventListener("click",()=>{
          const st = r.breakdown || {};
          const box = utils.el("div");
          box.append(utils.el("div",{class:"mb-8 b"}, `${r.name} (${r.team}, ${r.pos})`));
          if (mode==="finished") box.append(utils.el("div",{class:"mb-8"}, `GW points: ${st.total_points||0}`));
          const tbl = ui.table([
            {header:"G",   accessor:x=>st.goals_scored||0,        sortBy:x=>st.goals_scored||0},
            {header:"A",   accessor:x=>st.assists||0,             sortBy:x=>st.assists||0},
            {header:"CS",  accessor:x=>st.clean_sheets||0,        sortBy:x=>st.clean_sheets||0},
            {header:"Pens +", accessor:x=>st.penalties_saved||0,  sortBy:x=>st.penalties_saved||0},
            {header:"Pens -", accessor:x=>st.penalties_missed||0, sortBy:x=>st.penalties_missed||0},
            {header:"Saves", accessor:x=>st.saves||0,             sortBy:x=>st.saves||0},
            {header:"GC",  accessor:x=>st.goals_conceded||0,      sortBy:x=>st.goals_conceded||0},
            {header:"YC",  accessor:x=>st.yellow_cards||0,        sortBy:x=>st.yellow_cards||0},
            {header:"RC",  accessor:x=>st.red_cards||0,           sortBy:x=>st.red_cards||0},
            {header:"Bonus", accessor:x=>st.bonus||0,             sortBy:x=>st.bonus||0},
            {header:"BPS", accessor:x=>st.bps||0,                 sortBy:x=>st.bps||0}
          ], [{}]);
          const legend = utils.el("div",{class:"legend small mt-8"},
            "Legend: G=Goals, A=Assists, CS=Clean Sheets, GC=Goals Conceded, YC=Yellow Cards, RC=Red Cards, BPS=Bonus Point System."
          );
          box.append(tbl, legend);
          openModal(`Breakdown — ${r.name}`, box);
        });
        return btn;
      }},
  ];

  const table = ui.table(cols, rows);
  table.id = "myteam-table";

  // Bench card
  const benchCard = utils.el("div",{class:"card"});
  benchCard.append(utils.el("h3",{},"Bench"));
  if (!benchRows.length){
    benchCard.append(utils.el("div",{class:"tag"},"No bench data"));
  } else {
    const benchTbl = ui.table([
      {header:"#", accessor:(_,i)=>i+1},
      {header:"Name", accessor:r=>r.name},
      {header:"Pos", accessor:r=>r.pos},
      {header:"Team", accessor:r=>r.team},
      {header:"xP (Next)", accessor:r=>r.xpNext||0, cell:r=> (r.xpNext||0).toFixed(2), sortBy:r=>r.xpNext||0},
      {header:"xMins", cell:r=>{
        const v = r.xmins||0, r90=v/90;
        const s = utils.el("span",{class:"badge "+(r90>=0.9?"badge-green":(r90>=0.7?"badge-amber":"badge-red"))}, r90>=0.9?"NAILED":(r90>=0.7?"RISK":"CAMEO?"));
        s.dataset.tooltip = `Projected ${Math.round(v)}'`;
        return s;
      }}
    ], benchRows);
    benchCard.append(benchTbl);
  }

  // Recommendations
  const recs = utils.el("div",{class:"card"});
  recs.append(utils.el("h3",{},"Sanity checks"));
  const list = utils.el("ul",{class:"bullets"});
  const capSug = captainSuggestion();
  const bnSug = benchSuggestion();
  if (!capSug && !bnSug) {
    list.append(utils.el("li",{},"No obvious issues detected. 👍"));
  } else {
    if (capSug) list.append(utils.el("li",{}, capSug));
    if (bnSug)  list.append(utils.el("li",{}, bnSug));
  }
  recs.append(list);

  // Mount
  ui.mount(main, utils.el("div",{}, [
    utils.el("div",{class:"card"},[utils.el("h3",{},"Overview"), header, quick]),
    utils.el("div",{class:"card"},[utils.el("h3",{},`Starting XI — ${mode==="finished" ? `GW${lastFinished}` : `Next (GW${nextGw})`}`), table]),
    benchCard,
    recs
  ]));
}
