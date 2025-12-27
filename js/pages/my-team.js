// js/pages/my-team.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { openModal } from "../components/modal.js";
import { xPWindow, estimateXMinsForPlayer } from "../lib/xp.js";

/* ───────────────── constants ───────────────── */
const STATUS_MAP = {
  a: { label: "Available",  cls: "st-okay",  icon: "✅" },
  d: { label: "Doubtful",   cls: "st-doubt", icon: "🟡" },
  i: { label: "Injured",    cls: "st-inj",   icon: "🔴" },
  s: { label: "Suspended",  cls: "st-sus",   icon: "⛔" },
  n: { label: "Unavailable",cls: "st-out",   icon: "⛔" },
};
const POS_ORDER = { GKP: 1, DEF: 2, MID: 3, FWD: 4 };
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

// FPL photo URL template
const PLAYER_PHOTO_URL = (photoId) => 
  `https://resources.premierleague.com/premierleague/photos/players/110x140/p${photoId?.replace('.png', '')}.png`;

// Team badge URL
const TEAM_BADGE_URL = (teamCode) =>
  `https://resources.premierleague.com/premierleague/badges/70/t${teamCode}.png`;

const posKey = p => POS_ORDER[p] ?? 99;

// Haul threshold
const HAUL_THRESHOLD = 15;

// Track if we've shown confetti this session to avoid spam
let confettiShownForPlayers = new Set();

/* ───────────────── Skeleton Loading ───────────────── */
function renderSkeletonLoading() {
  const wrap = utils.el("div", { class: "my-team-page" });

  // Header skeleton
  const headerSkeleton = utils.el("div", { class: "skeleton skeleton-header" });
  wrap.append(headerSkeleton);

  // Stats grid skeleton
  const statsWrap = utils.el("div", { class: "card" });
  const statsGrid = utils.el("div", { class: "skeleton-grid cols-6" });
  for (let i = 0; i < 6; i++) {
    statsGrid.append(utils.el("div", { class: "skeleton skeleton-stat" }));
  }
  statsWrap.append(statsGrid);
  wrap.append(statsWrap);

  // Pitch skeleton
  const pitchSkeleton = utils.el("div", { class: "card" });
  pitchSkeleton.append(utils.el("div", { class: "skeleton skeleton-pitch" }));
  wrap.append(pitchSkeleton);

  // Insights skeleton
  const insightsSkeleton = utils.el("div", { class: "skeleton skeleton-insights" });
  wrap.append(insightsSkeleton);

  return wrap;
}

/* ───────────────── Sparkline Mini-Chart ───────────────── */
function createSparkline(data, label = "") {
  if (!data || data.length === 0) return null;

  const container = utils.el("div", { class: "sparkline-container" });

  const width = 50;
  const height = 20;
  const padding = 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Generate points
  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1 || 1)) * (width - 2 * padding);
    const y = height - padding - ((val - min) / range) * (height - 2 * padding);
    return { x, y, val };
  });

  // Build path
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

  // Area path (for subtle fill)
  const areaPath = linePath + ` L${points[points.length - 1].x},${height - padding} L${points[0].x},${height - padding} Z`;

  // Determine trend
  const trend = data[data.length - 1] > data[0] ? "up" : (data[data.length - 1] < data[0] ? "down" : "neutral");
  container.classList.add(`sparkline-trend-${trend}`);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "sparkline-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");

  // Gradient definition
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  gradient.setAttribute("id", "sparklineGradient");
  gradient.setAttribute("x1", "0%");
  gradient.setAttribute("y1", "0%");
  gradient.setAttribute("x2", "0%");
  gradient.setAttribute("y2", "100%");

  const stop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stop1.setAttribute("offset", "0%");
  stop1.setAttribute("style", "stop-color:currentColor;stop-opacity:0.3");

  const stop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stop2.setAttribute("offset", "100%");
  stop2.setAttribute("style", "stop-color:currentColor;stop-opacity:0");

  gradient.append(stop1, stop2);
  defs.append(gradient);
  svg.append(defs);

  // Area
  const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
  area.setAttribute("class", "sparkline-area");
  area.setAttribute("d", areaPath);
  svg.append(area);

  // Line
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("class", "sparkline-line");
  line.setAttribute("d", linePath);
  svg.append(line);

  // Last point dot
  const lastPoint = points[points.length - 1];
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("class", "sparkline-dot");
  dot.setAttribute("cx", lastPoint.x);
  dot.setAttribute("cy", lastPoint.y);
  dot.setAttribute("r", "2");
  svg.append(dot);

  container.append(svg);

  // Value label
  if (label) {
    const valueEl = utils.el("span", { class: "sparkline-value" }, label);
    container.append(valueEl);
  }

  // Tooltip
  container.dataset.tooltip = `Last ${data.length} GWs: ${data.join(", ")}`;

  return container;
}

/* ───────────────── Pitch Visualization ───────────────── */
function renderPitchVisualization(starters, benchRows, captain, viceCaptain, playerById, teamById, onPlayerClick) {
  const pitch = utils.el("div", { class: "pitch-container" });
  
  // Pitch grass background
  const grass = utils.el("div", { class: "pitch-grass" });
  
  // Sort starters by position
  const gk = starters.filter(r => r.pos === "GKP");
  const def = starters.filter(r => r.pos === "DEF");
  const mid = starters.filter(r => r.pos === "MID");
  const fwd = starters.filter(r => r.pos === "FWD");

  // Detect formation
  const formation = `${def.length}-${mid.length}-${fwd.length}`;
  
  // Formation label
  const formationBadge = utils.el("div", { class: "pitch-formation" }, formation);
  grass.append(formationBadge);

  // Create rows
  const createRow = (players, rowClass) => {
    const row = utils.el("div", { class: `pitch-row ${rowClass}` });
    players.forEach(p => {
      const card = createPlayerCard(p, captain, viceCaptain, playerById, teamById, onPlayerClick);
      row.append(card);
    });
    return row;
  };

  grass.append(createRow(fwd, "pitch-row-fwd"));
  grass.append(createRow(mid, "pitch-row-mid"));
  grass.append(createRow(def, "pitch-row-def"));
  grass.append(createRow(gk, "pitch-row-gk"));

  pitch.append(grass);

  // Bench
  if (benchRows.length > 0) {
    const benchSection = utils.el("div", { class: "bench-section" });
    const benchLabel = utils.el("div", { class: "bench-label" }, "BENCH");
    const benchRow = utils.el("div", { class: "bench-row" });
    
    benchRows.forEach((p, idx) => {
      const card = createPlayerCard(p, captain, viceCaptain, playerById, teamById, onPlayerClick, idx + 1);
      benchRow.append(card);
    });
    
    benchSection.append(benchLabel, benchRow);
    pitch.append(benchSection);
  }

  return pitch;
}

function createPlayerCard(player, captain, viceCaptain, playerById, teamById, onPlayerClick, benchPos = null) {
  const pl = playerById.get(player.id);
  const team = teamById.get(player.teamId);

  // Check for haul
  const pts = player.currPoints ?? player.prevPoints ?? 0;
  const isHaul = pts >= HAUL_THRESHOLD;

  // Trigger confetti for hauls (only once per player per session)
  if (isHaul && !benchPos && !confettiShownForPlayers.has(player.id)) {
    confettiShownForPlayers.add(player.id);
    // Delay confetti to let the card render first
    setTimeout(() => {
      if (window.createConfetti) window.createConfetti(30);
    }, 500);
  }

  const card = utils.el("div", {
    class: `player-card-pitch ${benchPos ? 'bench-card' : ''} ${player.status !== 'a' ? 'player-flagged' : ''} ${isHaul ? 'player-haul' : ''}`
  });

  // Haul badge
  if (isHaul) {
    const haulBadge = utils.el("div", { class: "haul-badge" }, `${pts}pts HAUL`);
    card.append(haulBadge);
  }

  // Captain/VC badge
  if (player.cap === "C") {
    const capBadge = utils.el("div", { class: "player-captain-badge" }, "C");
    card.append(capBadge);
  } else if (player.cap === "VC") {
    const vcBadge = utils.el("div", { class: "player-vc-badge" }, "V");
    card.append(vcBadge);
  }

  // Bench position
  if (benchPos) {
    const benchBadge = utils.el("div", { class: "bench-pos-badge" }, String(benchPos));
    card.append(benchBadge);
  }

  // Player photo
  const photoWrapper = utils.el("div", { class: "player-photo-wrapper" });
  const photo = utils.el("img", { 
    class: "player-photo",
    src: PLAYER_PHOTO_URL(pl?.photo),
    alt: player.name,
    loading: "lazy"
  });
  photo.onerror = () => {
    photo.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 110 140'%3E%3Crect fill='%23334155' width='110' height='140'/%3E%3Ctext x='55' y='80' text-anchor='middle' fill='%2394a3b8' font-size='40'%3E👤%3C/text%3E%3C/svg%3E";
  };
  
  // Team badge overlay
  const teamBadge = utils.el("img", {
    class: "player-team-badge",
    src: TEAM_BADGE_URL(team?.code),
    alt: team?.short_name || "",
    loading: "lazy"
  });
  teamBadge.onerror = () => { teamBadge.style.display = "none"; };
  
  photoWrapper.append(photo, teamBadge);
  
  // Info section
  const info = utils.el("div", { class: "player-info" });
  
  // Name
  const name = utils.el("div", { class: "player-name" }, player.name);
  
  // Points row
  const pointsRow = utils.el("div", { class: "player-points-row" });

  // Current/Live points (pts already defined above for haul check)
  const ptsClass = pts >= 10 ? "pts-high" : (pts <= 1 ? "pts-low" : "");
  const ptsEl = utils.el("div", { class: `player-pts ${ptsClass}` }, String(pts));
  
  // xP next
  const xpEl = utils.el("div", { class: "player-xp" }, `xP: ${(player.xpNext || 0).toFixed(1)}`);
  
  pointsRow.append(ptsEl, xpEl);
  
  // Minutes badge
  const xmins = player.xmins || 0;
  const r90 = xmins / 90;
  const minsText = r90 >= 0.9 ? "NAILED" : (r90 >= 0.7 ? "RISK" : "CAMEO");
  const minsClass = r90 >= 0.9 ? "mins-nailed" : (r90 >= 0.7 ? "mins-risk" : "mins-cameo");
  const minsBadge = utils.el("div", { class: `player-mins-badge ${minsClass}` }, minsText);
  minsBadge.title = `Projected ${Math.round(xmins)}'`;

  // Status indicator (if not available)
  if (player.status !== 'a') {
    const statusInfo = STATUS_MAP[player.status] || { icon: "❓", label: "Unknown" };
    const statusBadge = utils.el("div", { class: "player-status-badge" }, statusInfo.icon);
    statusBadge.title = `${statusInfo.label}${player.news ? ': ' + player.news : ''}`;
    card.append(statusBadge);
  }

  info.append(name, pointsRow, minsBadge);
  card.append(photoWrapper, info);

  // Click handler
  card.addEventListener("click", () => {
    if (onPlayerClick) onPlayerClick(player);
  });

  return card;
}

/* ───────────────── page ───────────────── */
export async function renderMyTeam(main){
  if (!state.entryId) {
    const emptyState = utils.el("div", { class: "card empty-state" });
    emptyState.innerHTML = `
      <div class="empty-icon">🏟️</div>
      <h3>Welcome to FPL Dashboard</h3>
      <p>Enter your FPL Entry ID in the sidebar to view your team.</p>
      <p class="small">You can find it in your FPL team URL: fantasy.premierleague.com/entry/<strong>1234567</strong>/history</p>
    `;
    ui.mount(main, emptyState);
    return;
  }

  // Show skeleton loading instead of spinner
  ui.mount(main, renderSkeletonLoading());

  try {
    // Bootstrap + core data
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;
    const { events, elements: players, teams, element_types: positions } = bs;

    // Derive timeline using data_checked as source of truth
    const finished = events.filter(e => e.data_checked).map(e => e.id);
    const lastFinished = finished.length ? Math.max(...finished) : 0;
    const maxGw = Math.max(...events.map(e => e.id));

    // Upcoming GW = lastFinished + 1 (clamped to season)
    const upcomingGw = Math.min(lastFinished + 1, maxGw);

    // Live GW (only if truly live and not data_checked yet)
    const liveEventObj = events.find(e => e.is_current && !e.data_checked) || null;
    const liveGw = liveEventObj?.id ?? null;

    const prevGw = lastFinished || null;
    const upcGw  = upcomingGw || null;

    // xP window starts at upcoming GW
    const winN = 5;
    const windowGwIds = () => events
      .filter(e => upcGw != null && e.id >= upcGw)
      .slice(0, winN)
      .map(e => e.id);

    // Core pulls
    const [profile, hist, fixturesAll] = await Promise.all([
      api.entry(state.entryId),
      api.entryHistory(state.entryId),
      api.fixtures()
    ]);

    // Maps
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

    // Picks & live
    const [picksPrev, livePrev, picksUpc] = await Promise.all([
      prevGw ? api.entryPicks(state.entryId, prevGw) : Promise.resolve(null),
      prevGw ? api.eventLive(prevGw) : Promise.resolve({ elements: [] }),
      upcGw  ? api.entryPicks(state.entryId, upcGw).catch(()=>null) : Promise.resolve(null),
    ]);

    // Live map (if any)
    const liveMap = liveGw ? toMap((await api.eventLive(liveGw)).elements || []) : new Map();

    // Roster preference: UPCOMING > PREVIOUS
    const roster =
      (picksUpc?.picks?.length ? { src: "upcoming", gw: upcGw, data: picksUpc } :
       picksPrev?.picks?.length ? { src: "previous", gw: prevGw, data: picksPrev } :
                                  { src: "previous", gw: prevGw, data: picksPrev });

    // Finance snapshot
    const histRow = hist.current.find(h => h.event === (lastFinished || prevGw || roster.gw));
    const teamVal = histRow ? (histRow.value/10).toFixed(1) : "—";
    const bank    = histRow ? (histRow.bank/10).toFixed(1)  : "—";
    const totalVal = histRow ? ((histRow.value + histRow.bank)/10).toFixed(1) : "—";
    const overallRank = histRow?.overall_rank ?? profile?.summary_overall_rank ?? "—";
    const gwRank = histRow?.rank ?? "—";
    const gwPoints = histRow?.points ?? "—";
    const totalPoints = histRow?.total_points ?? profile?.summary_overall_points ?? "—";

    const livePrevMap = toMap(livePrev?.elements || []);

    function toMap(arr){ return new Map((arr || []).map(e => [e.id, e])); }

    // Helpers
    function teamFixtureForGW(teamId, gwId){
      const list = fixturesByEvent.get(gwId) || [];
      for (const f of list){
        if (f.team_h === teamId) return { opp: teamShort(f.team_a), home:true, fdr:f.team_h_difficulty, kickoff:f.kickoff_time };
        if (f.team_a === teamId) return { opp: teamShort(f.team_h), home:false, fdr:f.team_a_difficulty, kickoff:f.kickoff_time };
      }
      return null;
    }

    function fixturesStrip(teamId, gws){
      const strip = utils.el("div",{class:"fixtures-strip"});
      const fxList = gws.map(gw => ({ gw, fx: teamFixtureForGW(teamId, gw) }));
      const shown = fxList.slice(0, 4);
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
      return strip;
    }

    // Split starters vs bench from chosen roster
    const picksForMode = roster.data || { picks: [] };
    const starters = (picksForMode.picks || []).filter(pk => pk.position <= 11);
    const benchAll = (picksForMode.picks || []).filter(pk => pk.position > 11)
                     .sort((a,b)=> a.position - b.position);

    // Captain / VC
    let capName = "—", vcName = "—", capId = null, vcId = null;
    for (const pk of (picksForMode.picks || [])) {
      if (pk.is_captain) { 
        capName = playerById.get(pk.element)?.web_name || "—";
        capId = pk.element;
      }
      if (pk.is_vice_captain) {
        vcName = playerById.get(pk.element)?.web_name || "—";
        vcId = pk.element;
      }
    }

    // Row builder
    async function buildRow(pk, benchIndex=null) {
      const pl   = playerById.get(pk.element);
      const team = teamById.get(pl.team);
      const pos  = posById.get(pl.element_type);

      const prevE = livePrevMap.get(pl.id) || {};
      const liveE = liveMap.get(pl.id)     || {};

      const prevStats   = prevE.stats || {};
      const currStats   = liveGw ? (liveE.stats || {}) : {};
      const prevExplain = Array.isArray(prevE.explain) ? prevE.explain : [];
      const currExplain = liveGw && Array.isArray(liveE.explain) ? liveE.explain : [];

      const xmins = await estimateXMinsForPlayer(pl).catch(()=>0);

      const overallEO = +Number(pl.selected_by_percent || 0);
      const metaEO = (state.metaEO && typeof state.metaEO.get === "function")
        ? Number(state.metaEO.get(pl.id) || 0)
        : null;

      // Momentum icon
      const momentum = Number((pl.transfers_in_event || 0) - (pl.transfers_out_event || 0));
      const priceMomentum = momentum > 10000 ? "▲" : (momentum < -10000 ? "▼" : "");

      // xP from upcoming
      let xpNext = 0, xpWindow = 0;
      try {
        if (upcGw) {
          xpNext   = (await xPWindow(pl, [upcGw])).total || 0;
          xpWindow = (await xPWindow(pl, windowGwIds())).total || 0;
        }
      } catch {}

      // Get form data (last 5 GW points) from player summary
      let formData = [];
      try {
        const summary = await api.elementSummary(pl.id);
        if (summary?.history) {
          // Get last 5 finished gameweeks
          const recentHistory = summary.history
            .filter(h => h.round <= lastFinished)
            .slice(-5);
          formData = recentHistory.map(h => h.total_points);
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
        currPoints:  (liveGw ? (currStats.total_points ?? null) : null),
        currMinutes: (liveGw ? (currStats.minutes ?? null) : null),

        prevExplain, currExplain,
        xmins, xpNext, xpWindow,
        formData,
      };
    }

    // Build rows
    const rows = [];
    for (const pk of starters) rows.push(await buildRow(pk));
    const benchRows = [];
    for (let i=0;i<benchAll.length;i++) benchRows.push(await buildRow(benchAll[i], i));

    // Player click handler for modal
    const handlePlayerClick = (player) => {
      openModal(`${player.name} — Breakdown`, renderBreakdown(player));
    };

    /* ───────────────── UI helpers ───────────────── */
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

    /* ─────────────── breakdown modal helpers ─────────────── */
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

    function gwCard({ title, points, minutes, explain, teamId }){
      const card = utils.el("div",{class:"bd-card"});

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
        const block = utils.el("div",{class:"bd-fixture"});

        const fx = fixturesById.get(chunk.fixture) || null;
        let label = `Fixture ${chunk.fixture}`;
        if (fx){
          const isHome = (fx.team_h === teamId);
          const oppId  = isHome ? fx.team_a : fx.team_h;
          const opp    = teamShort(oppId);
          const scoreKnown = Number.isFinite(fx.team_h_score) && Number.isFinite(fx.team_a_score);
          const score = scoreKnown ? `${fx.team_h_score}–${fx.team_a_score}` : "";
          label = `${isHome ? "H" : "A"} ${opp}${score ? ` · ${score}` : ""}`;
        }
        block.append(utils.el("div",{class:"bd-sub"}, [
          utils.el("span",{class:"chip fx-badge"}, label)
        ]));

        const chips = utils.el("div",{class:"bd-chip-grid"});
        let localSum = 0;

        for (const s of (chunk.stats || [])){
          const pts = Number(s.points || 0);
          localSum += pts; gwSum += pts;
          const labelTxt = (STAT_LABEL[s.identifier] || s.identifier);
          const value = (s.value ?? "—");
          const chip = utils.el("div",{class:"stat-chip"});
          chip.append(
            utils.el("span",{}, `${labelTxt}${value !== "" ? ` ${value}` : ""}`),
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

    function renderBreakdown(r){
      ensureBreakdownStyles();
      const box = utils.el("div",{class:"bd-wrap"});

      // Header with name and sparkline
      const headerRow = utils.el("div", { style: "display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:8px;" });
      headerRow.append(utils.el("div",{class:"bd-title"}, `${r.name} (${r.team}, ${r.pos})`));

      // Add sparkline if form data exists
      if (r.formData && r.formData.length > 0) {
        const avgForm = (r.formData.reduce((a, b) => a + b, 0) / r.formData.length).toFixed(1);
        const sparkline = createSparkline(r.formData, `Avg: ${avgForm}`);
        if (sparkline) {
          sparkline.dataset.tooltip = `Last ${r.formData.length} GW points: ${r.formData.join(", ")}`;
          headerRow.append(sparkline);
        }
      }

      box.append(headerRow);

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

      const hasCurr = (typeof r.currPoints === "number") || (r.currExplain && r.currExplain.length);
      if (hasPrev && hasCurr) box.append(utils.el("div",{class:"bd-divider"}));

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

    /* ───────────────── Suggestions ───────────────── */
    function captainSuggestion() {
      if (!rows.length) return null;
      const currentC = rows.find(r => r.cap==="C");
      const best = [...rows].sort((a,b)=> (b.xpNext||0) - (a.xpNext||0))[0];
      if (!currentC || !best) return null;
      const diff = (best.xpNext||0) - (currentC.xpNext||0);
      if (best.name !== currentC.name && diff > 0.6) {
        return {
          type: "captain",
          message: `Consider captaining ${best.name} (xP ${best.xpNext.toFixed(2)}) over ${currentC.name} (xP ${(currentC.xpNext||0).toFixed(2)})`,
          gain: `+${diff.toFixed(2)} xP`
        };
      }
      return null;
    }

    function benchSuggestion() {
      if (!rows.length || !benchRows.length) return null;
      const worstStarter = [...rows].sort((a,b)=> (a.xpNext||0) - (b.xpNext||0))[0];
      const bestBench = [...benchRows].sort((a,b)=> (b.xpNext||0) - (a.xpNext||0))[0];
      const gain = (bestBench.xpNext||0) - (worstStarter.xpNext||0);
      if (gain > 0.5) {
        return {
          type: "bench",
          message: `Start ${bestBench.name} over ${worstStarter.name}`,
          gain: `+${gain.toFixed(2)} xP`
        };
      }
      return null;
    }

    function healthIssues(list){
      return list.filter(r => (r.status && r.status !== "a") || (r.news && r.news.length));
    }

    /* ───────────────── Mount UI ───────────────── */
    const page = utils.el("div", { class: "my-team-page" });

    // Header card with stats
    const headerCard = utils.el("div", { class: "card team-header-card" });
    
    const headerTop = utils.el("div", { class: "team-header-top" });
    const managerInfo = utils.el("div", { class: "manager-info" });
    managerInfo.innerHTML = `
      <h2 class="team-name">${profile.name}</h2>
      <div class="manager-name">${profile.player_first_name} ${profile.player_last_name}</div>
    `;
    
    const gwBadge = utils.el("div", { class: "gw-status-badge" });
    if (liveGw) {
      gwBadge.innerHTML = `<span class="live-dot"></span> GW${liveGw} LIVE`;
      gwBadge.classList.add("is-live");
    } else {
      gwBadge.textContent = `GW${prevGw || roster.gw}`;
    }
    
    headerTop.append(managerInfo, gwBadge);

    // Stats grid
    const statsGrid = utils.el("div", { class: "team-stats-grid" });
    statsGrid.innerHTML = `
      <div class="stat-item">
        <div class="stat-value">${totalPoints}</div>
        <div class="stat-label">Total Points</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${typeof overallRank === 'number' ? overallRank.toLocaleString() : overallRank}</div>
        <div class="stat-label">Overall Rank</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${gwPoints}</div>
        <div class="stat-label">GW Points</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">£${totalVal}m</div>
        <div class="stat-label">Squad Value</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">£${bank}m</div>
        <div class="stat-label">In Bank</div>
      </div>
      <div class="stat-item captain-stat">
        <div class="stat-value">${capName}</div>
        <div class="stat-label">Captain</div>
      </div>
    `;

    headerCard.append(headerTop, statsGrid);
    page.append(headerCard);

    // Pitch visualization
    const pitchCard = utils.el("div", { class: "card pitch-card" });
    const pitchTitle = utils.el("div", { class: "pitch-title" });
    pitchTitle.innerHTML = `
      <h3>Starting XI</h3>
      <div class="pitch-subtitle">Click a player for detailed breakdown</div>
    `;
    const pitch = renderPitchVisualization(rows, benchRows, capId, vcId, playerById, teamById, handlePlayerClick);
    pitchCard.append(pitchTitle, pitch);
    page.append(pitchCard);

    // Insights panel
    const insightsCard = utils.el("div", { class: "card insights-card" });
    const insightsTitle = utils.el("h3", {}, "💡 Smart Insights");
    const insightsList = utils.el("div", { class: "insights-list" });

    const capSug = captainSuggestion();
    const bnSug = benchSuggestion();
    const issues = healthIssues([...rows, ...benchRows]);

    if (!capSug && !bnSug && !issues.length) {
      insightsList.innerHTML = `
        <div class="insight-item insight-good">
          <span class="insight-icon">✅</span>
          <span class="insight-text">Your team looks good! No obvious issues detected.</span>
        </div>
      `;
    } else {
      if (capSug) {
        const item = utils.el("div", { class: "insight-item insight-captain" });
        item.innerHTML = `
          <span class="insight-icon">👑</span>
          <span class="insight-text">${capSug.message}</span>
          <span class="insight-gain">${capSug.gain}</span>
        `;
        insightsList.append(item);
      }
      if (bnSug) {
        const item = utils.el("div", { class: "insight-item insight-bench" });
        item.innerHTML = `
          <span class="insight-icon">🔄</span>
          <span class="insight-text">${bnSug.message}</span>
          <span class="insight-gain">${bnSug.gain}</span>
        `;
        insightsList.append(item);
      }
      if (issues.length) {
        const item = utils.el("div", { class: "insight-item insight-warning" });
        const playerList = issues.map(r => {
          const chance = players.find(p=>p.id===r.id)?.chance_of_playing_next_round;
          return `${r.name} (${STATUS_MAP[r.status]?.label || r.status}${chance != null ? `, ${chance}%` : ''})`;
        }).join(", ");
        item.innerHTML = `
          <span class="insight-icon">⚠️</span>
          <span class="insight-text">Flagged: ${playerList}</span>
        `;
        insightsList.append(item);
      }
    }

    insightsCard.append(insightsTitle, insightsList);
    page.append(insightsCard);

    // Fixtures preview
    const fixturesCard = utils.el("div", { class: "card fixtures-preview-card" });
    fixturesCard.innerHTML = `<h3>📅 Upcoming Fixtures</h3>`;
    
    const fixturesGrid = utils.el("div", { class: "fixtures-preview-grid" });
    const uniqueTeams = [...new Set(rows.map(r => r.teamId))];
    
    for (const teamId of uniqueTeams) {
      const team = teamById.get(teamId);
      const teamRow = utils.el("div", { class: "fixture-team-row" });
      teamRow.innerHTML = `
        <img class="fixture-team-badge" src="${TEAM_BADGE_URL(team?.code)}" alt="${team?.short_name}" onerror="this.style.display='none'">
        <span class="fixture-team-name">${team?.short_name || '?'}</span>
      `;
      teamRow.append(fixturesStrip(teamId, windowGwIds()));
      fixturesGrid.append(teamRow);
    }
    
    fixturesCard.append(fixturesGrid);
    page.append(fixturesCard);

    ui.mount(main, page);

  } catch (e) {
    ui.mount(main, ui.error("Failed to load My Team", e));
  }
}
