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

// Position sort order
const POS_ORDER = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };
const posKey = p => POS_ORDER[p] ?? 99;

// Pretty labels for explain identifiers
const STAT_LABEL = {
  minutes: "Minutes",
  goals_scored: "Goals",
  assists: "Assists",
  clean_sheets: "Clean Sheets",
  goals_conceded: "Goals Conceded",
  own_goals: "Own Goals",
  penalties_saved: "Pens Saved",
  penalties_missed: "Pens Missed",
  yellow_cards: "Yellow Cards",
  red_cards: "Red Cards",
  saves: "Saves",
  bonus: "Bonus",
  bps: "BPS",
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

  // Determine GW context robustly mid-GW
  const prevEvent = events.find(e => e.is_previous);
  const currEvent = events.find(e => e.is_current);
  const nextEvent = events.find(e => e.is_next);

  const prevGw = prevEvent?.id ?? null;
  const currGw = currEvent?.id ?? (prevGw ? prevGw + 1 : null);
  const nextGw = nextEvent?.id ?? (currGw ? currGw + 1 : null);

  const finished = events.filter(e=>e.data_checked);
  const lastFinished = finished.length ? Math.max(...finished.map(e=>e.id)) : null;

  if (!prevGw && !lastFinished){
    ui.mount(main, utils.el("div",{class:"card"},"No finished gameweeks yet."));
    return;
  }

  // xP window
  const winN = 5;
  const windowGwIds = () => events
    .filter(e => nextGw != null && e.id >= nextGw)
    .slice(0, winN)
    .map(e => e.id);

  // Core pulls
  const [profile, hist, fixturesAll] = await Promise.all([
    api.entry(state.entryId),
    api.entryHistory(state.entryId),
    api.fixtures()
  ]);

  // Map fixtures by event + by id (for modal labels)
  const fixturesByEvent = new Map();
  const fixturesById = new Map();
  for (const f of fixturesAll) {
    if (!fixturesByEvent.has(f.event)) fixturesByEvent.set(f.event, []);
    fixturesByEvent.get(f.event).push(f);
    fixturesById.set(f.id, f);
  }
  const teamById   = new Map(teams.map(t=>[t.id, t]));
  const posById    = new Map(positions.map(p=>[p.id, p]));
  const playerById = new Map(players.map(p=>[p.id, p]));
  const teamShort  = (id)=> teamById.get(id)?.short_name || "?";
  const priceM     = (p)=> +(p.now_cost/10).toFixed(1);

  // Picks & Live (prev/current/next)
  const [
    picksPrev, livePrev,
    picksCurr, liveCurr,
    picksNext
  ] = await Promise.all([
    prevGw ? api.entryPicks(state.entryId, prevGw) : Promise.resolve(null),
    prevGw ? api.eventLive(prevGw)                : Promise.resolve({ elements: [] }),
    currGw ? api.entryPicks(state.entryId, currGw) : Promise.resolve(null),
    currGw ? api.eventLive(currGw)                 : Promise.resolve({ elements: [] }),
    nextGw ? api.entryPicks(state.entryId, nextGw).catch(()=>null) : Promise.resolve(null)
  ]);

  // Roster order: current > previous > next
  const roster =
    (picksCurr?.picks?.length ? { src: "current", gw: currGw, data: picksCurr } :
    (picksPrev?.picks?.length ? { src: "previous", gw: prevGw, data: picksPrev } :
    (picksNext?.picks?.length ? { src: "next", gw: nextGw, data: picksNext } :
      { src: "previous", gw: prevGw ?? lastFinished, data: picksPrev })));

  // Finance snapshot (from last finished)
  const histRow = hist.current.find(h => h.event === (lastFinished ?? prevGw ?? roster.gw));
  const teamVal = histRow ? (histRow.value/10).toFixed(1) : "—";
  const bank    = histRow ? (histRow.bank/10).toFixed(1)  : "—";

  // Live maps (keep element object for explain + stats)
  const toMap = (arr) => new Map((arr || []).map(e => [e.id, e]));
  const livePrevMap = toMap(livePrev?.elements || []);
  const liveCurrMap = toMap(liveCurr?.elements || []);

  function teamFixtureForGW(teamId, gwId){
    const list = fixturesByEvent.get(gwId) || [];
    for (const f of list){
      if (f.team_h === teamId) return { opp: teamShort(f.team_a), home:true, fdr:f.team_h_difficulty, kickoff:f.kickoff_time };
      if (f.team_a === teamId) return { opp: teamShort(f.team_h), home:false, fdr:f.team_a_difficulty, kickoff:f.kickoff_time };
    }
    return null;
  }
  function fixturesStrip(teamId, gws){
    // show first 4, then +N (tooltip lists full window)
    const strip = utils.el("div",{class:"fixtures-strip"});
    const fxList = gws.map(gw => ({ gw, fx: teamFixtureForGW(teamId, gw) }));
    const shown = fxList.slice(0, 4);
    const rest  = fxList.slice(4);
    for (const { gw, fx } of shown){
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
    if (rest.length){
      const more = utils.el("span",{class:"fx fx-more"}, `+${rest.length}`);
      more.dataset.tooltip = rest.map(({gw,fx}) =>
        fx ? `GW${gw}: ${fx.home?"H":"A"} ${fx.opp} (FDR ${fx.fdr||"?"})` : `GW${gw}: —`
      ).join("\n");
      strip.append(more);
    }
    return strip;
  }

  // Split starters vs bench from chosen roster
  const picksForMode = roster.data || { picks: [] };
  const starters = (picksForMode.picks || []).filter(pk => pk.position <= 11);
  const benchAll = (picksForMode.picks || []).filter(pk => pk.position > 11)
                   .sort((a,b)=> a.position - b.position);

  // Captain / VC
  let capName = "—", vcName = "—";
  for (const pk of (picksForMode.picks || [])) {
    if (pk.is_captain)      capName = playerById.get(pk.element)?.web_name || "—";
    if (pk.is_vice_captain) vcName  = playerById.get(pk.element)?.web_name || "—";
  }

  async function buildRow(pk, benchIndex=null) {
    const pl   = playerById.get(pk.element);
    const team = teamById.get(pl.team);
    const pos  = posById.get(pl.element_type);

    const prevE = livePrevMap.get(pl.id) || {};
    const currE = liveCurrMap.get(pl.id) || {};

    const prevStats   = prevE.stats || {};
    const currStats   = currE.stats || {};
    const prevExplain = Array.isArray(prevE.explain) ? prevE.explain : [];
    const currExplain = Array.isArray(currE.explain) ? currE.explain : [];

    const xmins = await estimateXMinsForPlayer(pl).catch(()=>0);

    const overallEO = +Number(pl.selected_by_percent || 0);
    const metaEO = (state.metaEO && typeof state.metaEO.get === "function")
      ? Number(state.metaEO.get(pl.id) || 0)
      : null;

    // Momentum icon
    const momentum = Number((pl.transfers_in_event || 0) - (pl.transfers_out_event || 0));
    const priceMomentum = momentum > 10000 ? "▲" : (momentum < -10000 ? "▼" : "");

    // xP
    let xpNext = 0, xpWindow = 0;
    try {
      if (nextGw) {
        xpNext   = (await xPWindow(pl, [nextGw])).total || 0;
        xpWindow = (await xPWindow(pl, windowGwIds())).total || 0;
      }
    } catch {}

    return {
      id: pl.id,
      name: pl.web_name,
      teamId: team.id,
      team: team.short_name,
      pos: pos.singular_name_short,
      posKey: posKey(pos.singular_name_short),
      price: priceM(pl),
      priceMomentum,
      selOverall: overallEO,
      selMeta: metaEO,
      status: pl.status,
      news: pl.news || "",
      cap: pk.is_captain ? "C" : (pk.is_vice_captain ? "VC" : ""),
      benchNo: benchIndex != null ? benchIndex + 1 : null,

      prevPoints:  (prevStats.total_points ?? null),
      prevMinutes: (prevStats.minutes ?? null),
      currPoints:  (currStats.total_points ?? null),
      currMinutes: (currStats.minutes ?? null),

      prevExplain, currExplain,
      xmins, xpNext, xpWindow,
    };
  }

  const rows = [];
  for (const pk of starters) rows.push(await buildRow(pk));
  const benchRows = [];
  for (let i=0;i<benchAll.length;i++) benchRows.push(await buildRow(benchAll[i], i));

  // ===== Suggestions & Health =====
  function captainSuggestion() {
    if (!rows.length) return null;
    const currentC = rows.find(r => r.cap==="C");
    const best = [...rows].sort((a,b)=> (b.xpNext||0) - (a.xpNext||0))[0];
    if (!currentC || !best) return null;
    const diff = (best.xpNext||0) - (currentC.xpNext||0);
    if (best.name !== currentC.name && diff > 0.6) {
      return `Consider captaining ${best.name} (xP ${best.xpNext.toFixed(2)}) over ${currentC.name} (xP ${(currentC.xpNext||0).toFixed(2)}), +${diff.toFixed(2)}.`;
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
  function healthIssues(list){
    return list.filter(r => (r.status && r.status !== "a") || (r.news && r.news.length));
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
    utils.el("span",{class:"chip"}, `Last Finished: GW${prevGw ?? lastFinished ?? "—"}`),
    utils.el("span",{class:"chip"}, `Current: GW${currGw ?? "—"}`),
    utils.el("span",{class:"chip"}, `Next: GW${nextGw ?? "—"}`),
    utils.el("span",{class:"chip"}, `Roster: ${roster.src === "current"
      ? `GW${roster.gw} (current)`
      : roster.src === "previous"
        ? `GW${roster.gw} (previous)`
        : `GW${roster.gw} (next)`}`),
    utils.el("span",{class:"chip"}, `Captain: ${capName}`),
    utils.el("span",{class:"chip"}, `Vice: ${vcName}`)
  );

  // ===== Cells & columns =====
  function compactGwCell(pts, mins){
    const v = (pts==null && mins==null) ? "—" : `${pts ?? 0} · ${mins ?? 0}′`;
    return utils.el("span",{class:"cell-compact"}, v);
  }
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
    overall.dataset.tooltip = "Overall EO";
    wrap.append(overall);
    if (typeof r.selMeta === "number"){
      const meta = utils.el("span",{class:"chip chip-accent"}, `${r.selMeta.toFixed(1)}%`);
      meta.dataset.tooltip = "Meta EO (your leagues)";
      wrap.append(meta);
    }
    return wrap;
  }
  function statusPill(r){
    const s = STATUS_MAP[r.status] || {label: r.status?.toUpperCase?.() || "?", cls:"st-unk", icon:"ℹ️"};
    const pill = utils.el("span",{class:`status-pill ${s.cls}`}, `${s.icon} ${s.label}`);
    if (r.news) pill.dataset.tooltip = r.news;
    return pill;
  }

  const hdrPrev = `GW${prevGw ?? (lastFinished ?? "?")}`;
  const hdrCurr = `GW${currGw ?? "?"} (live)`;
  const hdrXpNext  = nextGw ? `xP → GW${nextGw}` : "xP → Next";
  const hdrXpWin   = `xP → Next ${winN}`;

  function makeColumns({ forBench=false } = {}) {
    const cols = [];

    // Leading indicator
    if (!forBench) {
      cols.push({
        key:"cap", header:"", cell:r=>{
          if (r.cap==="C") return utils.el("span",{class:"badge c-badge"},"C");
          if (r.cap==="VC") return utils.el("span",{class:"badge vc-badge"},"VC");
          return "";
        }
      });
    } else {
      cols.push({ key:"bench", header:"#", accessor:r=>r.benchNo ?? "", sortBy:r=>r.benchNo ?? 99 });
    }

    // Name (team chip inside)
    cols.push({
      key:"name", header:"Name", accessor:r=>r.name, sortBy:r=>r.name, cell:r=>{
        const wrap = utils.el("div",{class:"name-cell"});
        wrap.append(utils.el("span",{class:"team-chip"}, r.team));
        wrap.append(utils.el("span",{class:"nm"}, r.name));
        if (r.priceMomentum) {
          const mom = utils.el("span",{class:"mom"}, r.priceMomentum);
          mom.dataset.tooltip = r.priceMomentum==="▲" ? "High net transfers in" : "High net transfers out";
          wrap.append(mom);
        }
        return wrap;
      }
    });

    cols.push({ key:"pos", header:"Pos", accessor:r=>r.pos, sortBy:r=>r.posKey });
    cols.push({ key:"price", header:"Price", accessor:r=>r.price, cell:r=>`£${r.price.toFixed(1)}m`, sortBy:r=>r.price });

    // Compact GW cells: points · minutes
    cols.push({
      key:"gwPrev", header:hdrPrev, cell:r=>compactGwCell(r.prevPoints, r.prevMinutes),
      sortBy:r=> (r.prevPoints ?? -1) * 1000 + (r.prevMinutes ?? -1)
    });
    cols.push({
      key:"gwCurr", header:hdrCurr, cell:r=>compactGwCell(r.currPoints, r.currMinutes),
      sortBy:r=> (r.currPoints ?? -1) * 1000 + (r.currMinutes ?? -1)
    });

    // xP & availability
    cols.push({ key:"xpNext",   header:hdrXpNext,  accessor:r=>r.xpNext||0,   cell:r=> (r.xpNext||0).toFixed(2),   sortBy:r=>r.xpNext||0 });
    cols.push({ key:"xpWindow", header:hdrXpWin,   accessor:r=>r.xpWindow||0, cell:r=> (r.xpWindow||0).toFixed(2), sortBy:r=>r.xpWindow||0 });
    cols.push({ key:"xmins", header:"xMins", cell:minutesBadge, sortBy:r=>r.xmins ?? 0 });
    cols.push({ key:"eo", header:"EO", cell:eoChips, sortBy:r=> (r.selMeta ?? r.selOverall) });

    cols.push({ key:"status", header:"Status", cell:statusPill, sortBy:r=> r.status || "" });
    cols.push({ key:"fixtures", header:"Fixtures", cell:r=> fixturesStrip(playerById.get(r.id).team, windowGwIds()) });

    cols.push({ key:"details", header:"Details", cell:r=>{
      const btn = utils.el("button",{class:"btn-ghost", type:"button"},"Breakdown");
      btn.addEventListener("click",()=>{
        openModal(`Breakdown — ${r.name}`, renderBreakdown(r));
      });
      return btn;
    }});

    return cols;
  }
// --- Drop these into js/pages/my-team.js (replace the old versions) ---

function renderBreakdown(r){
  const box = utils.el("div");
  box.append(utils.el("div",{class:"mb-6 b"}, `${r.name} (${r.team}, ${r.pos})`));

  // Previous GW (final)
  if (typeof r.prevPoints === "number" || (r.prevExplain && r.prevExplain.length)){
    box.append(gwCard({
      title: `Previous GW (final)`,
      gwId:   (typeof window !== 'undefined' && window.__GW_PREV__) || null, // optional marker, harmless if missing
      isLive: false,
      points: r.prevPoints ?? 0,
      minutes:r.prevMinutes ?? 0,
      explain:r.prevExplain,
      teamId: r.teamId
    }));
  }

  // Current GW (live)
  if (typeof r.currPoints === "number" || (r.currExplain && r.currExplain.length)){
    box.append(gwCard({
      title: `Current GW (live)`,
      gwId:   (typeof window !== 'undefined' && window.__GW_CURR__) || null,
      isLive: true,
      points: r.currPoints ?? 0,
      minutes:r.currMinutes ?? 0,
      explain:r.currExplain,
      teamId: r.teamId
    }));
  }

  return box;
}

// ⬇️ Add/replace in js/pages/my-team.js

function ensureBreakdownStyles(){
  if (document.getElementById("bd-styles")) return;
  const css = `
  .bd-wrap { display:flex; flex-direction:column; gap:14px; }
  .bd-title { font-weight:600; margin-bottom:2px; }
  .bd-divider { height:4px; }
  .bd-card { padding:12px 14px; border:1px solid rgba(255,255,255,.08);
             border-radius:12px; background:rgba(255,255,255,.02); }
  .bd-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
  .bd-sub { opacity:.85; font-weight:600; margin:4px 0 8px; }
  .bd-meta .chip { margin-left:6px; }
  .bd-fixture { margin:6px 0 10px; }
  .fx-badge { font-weight:700; }
  .bd-chip-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  @media (min-width: 860px){ .bd-chip-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
  .stat-chip { display:flex; align-items:center; justify-content:space-between;
               border-radius:999px; padding:.45rem .65rem; background:rgba(255,255,255,.06); }
  .stat-chip .badge { margin-left:8px; }
  .bd-subtotal { margin-top:6px; font-size:.9rem; opacity:.8; }
  `;
  const style = document.createElement("style");
  style.id = "bd-styles";
  style.textContent = css;
  document.head.appendChild(style);
}

function renderBreakdown(r){
  ensureBreakdownStyles();
  const box = utils.el("div",{class:"bd-wrap"});
  box.append(utils.el("div",{class:"bd-title"}, `${r.name} (${r.team}, ${r.pos})`));

  // Previous GW (final)
  const hasPrev = (typeof r.prevPoints === "number") || (r.prevExplain && r.prevExplain.length);
  if (hasPrev){
    box.append(gwCard({
      title: `Previous GW (final)`,
      points: r.prevPoints ?? 0,
      minutes:r.prevMinutes ?? 0,
      explain:r.prevExplain,
      teamId: r.teamId
    }));
  }

  // Separator between GWs
  const hasCurr = (typeof r.currPoints === "number") || (r.currExplain && r.currExplain.length);
  if (hasPrev && hasCurr) box.append(utils.el("div",{class:"bd-divider"}));

  // Current GW (live)
  if (hasCurr){
    box.append(gwCard({
      title: `Current GW (live)`,
      points: r.currPoints ?? 0,
      minutes:r.currMinutes ?? 0,
      explain:r.currExplain,
      teamId: r.teamId
    }));
  }

  return box;
}

/** Per-GW card with header chips + per-fixture stat chips */
function gwCard({ title, points, minutes, explain, teamId }){
  const card = utils.el("div",{class:"bd-card"});

  // Header
  const head = utils.el("div",{class:"bd-header"});
  head.append(
    utils.el("div",{class:"b"}, title),
    (() => {
      const meta = utils.el("div",{class:"bd-meta chips"});
      meta.append(
        utils.el("span",{class:"chip chip-accent"}, `${points} pts`),
        utils.el("span",{class:"chip chip-dim"}, `${minutes}′`)
      );
      return meta;
    })()
  );
  card.append(head);

  if (!explain || !explain.length){
    card.append(utils.el("div",{class:"muted"},"No breakdown available yet."));
    return card;
  }

  let gwSum = 0;

  for (const chunk of explain){
    // One block per fixture
    const block = utils.el("div",{class:"bd-fixture"});

    // Fixture label (H/A OPP · score if known)
    const fx = (typeof fixturesById !== "undefined") ? fixturesById.get(chunk.fixture) : null;
    let label = `Fixture ${chunk.fixture}`;
    if (fx){
      const isHome = (fx.team_h === teamId);
      const oppId  = isHome ? fx.team_a : fx.team_h;
      const opp    = (typeof teamShort === "function") ? teamShort(oppId) : "—";
      const scoreKnown = Number.isFinite(fx.team_h_score) && Number.isFinite(fx.team_a_score);
      const score = scoreKnown ? `${fx.team_h_score}–${fx.team_a_score}` : "";
      label = `${isHome ? "H" : "A"} ${opp}${score ? ` · ${score}` : ""}`;
    }
    block.append(utils.el("div",{class:"bd-sub"}, [
      utils.el("span",{class:"chip fx-badge"}, label)
    ]));

    // Stat chips grid
    const chips = utils.el("div",{class:"bd-chip-grid"});
    let localSum = 0;

    for (const s of (chunk.stats || [])){
      const pts = Number(s.points || 0);
      localSum += pts; gwSum += pts;
      const label = (STAT_LABEL[s.identifier] || s.identifier);
      const value = (s.value ?? "—");
      const chip = utils.el("div",{class:"stat-chip"});
      chip.append(
        utils.el("span",{}, `${label} ${value !== "" ? value : ""}`),
        utils.el("span",{class:"badge pts-badge"}, (pts>0?`+${pts}`:`${pts}`))
      );
      chips.append(chip);
    }

    block.append(chips);
    block.append(utils.el("div",{class:"bd-subtotal"}, `Fixture subtotal: ${localSum} pts`));
    card.append(block);
  }

  card.append(utils.el("div",{class:"bd-subtotal"}, `GW subtotal: ${gwSum} pts`));
  return card;
}

/* If you previously kept a separate renderExplainSection helper, remove it.
   gwCard now handles fixtures/stat chips internally. */


  // Tables
  const startersTable = ui.table(makeColumns(), rows);
  startersTable.id = "myteam-table";

  const benchCard = utils.el("div",{class:"card"});
  benchCard.append(utils.el("h3",{},"Bench"));
  const benchTable = benchRows.length
    ? ui.table(makeColumns({ forBench:true }), benchRows)
    : utils.el("div",{class:"tag"},"No bench data");
  benchCard.append(benchTable);

  // Bottom: Sanity + Health Centre
  const bottomGrid = utils.el("div",{class:"grid cols-2 gap-16"});

  // Sanity
  const recs = utils.el("div",{class:"card"});
  recs.append(utils.el("h3",{},"Sanity checks"));
  const list = utils.el("ul",{class:"bullets"});
  const capSug = captainSuggestion();
  const bnSug = benchSuggestion();
  if (!capSug && !bnSug) list.append(utils.el("li",{},"No obvious issues detected. 👍"));
  else {
    if (capSug) list.append(utils.el("li",{}, capSug));
    if (bnSug)  list.append(utils.el("li",{}, bnSug));
  }
  recs.append(list);

  // Health Centre
  const health = utils.el("div",{class:"card"});
  health.append(utils.el("h3",{},"Health Centre"));
  const issues = healthIssues([...rows, ...benchRows]);
  if (!issues.length) {
    health.append(utils.el("div",{class:"tag"},"All players available."));
  } else {
    const hl = utils.el("ul",{class:"bullets"});
    for (const r of issues){
      const chance = players.find(p=>p.id===r.id)?.chance_of_playing_next_round;
      const bits = [];
      bits.push(`${r.name} (${r.team}, ${r.pos})`);
      if (chance != null) bits.push(`Chance: ${chance}%`);
      if (r.status && STATUS_MAP[r.status]) bits.push(STATUS_MAP[r.status].label);
      if (r.news) bits.push(`“${r.news}”`);
      hl.append(utils.el("li",{}, bits.join(" — ")));
    }
    health.append(hl);
  }

  bottomGrid.append(recs, health);

  // Mount
  const titleRoster =
    roster.src === "current"  ? `GW${roster.gw} (current)` :
    roster.src === "previous" ? `GW${roster.gw} (previous)` :
                                `GW${roster.gw} (next)`;

  ui.mount(main, utils.el("div",{}, [
    utils.el("div",{class:"card"},[utils.el("h3",{},"Overview"), header, quick]),
    utils.el("div",{class:"card"},[utils.el("h3",{},`Starting XI — ${titleRoster}`), startersTable]),
    benchCard,
    bottomGrid
  ]));
}
