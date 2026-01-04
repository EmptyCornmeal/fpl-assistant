// js/pages/my-team.js
import { fplClient } from "../api/fplClient.js";
import { state, validateState, setPageUpdated } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { xPWindow, estimateXMinsForPlayer } from "../lib/xp.js";
import { log } from "../logger.js";
import { hasCachedData, CacheKey } from "../api/fetchHelper.js";
import { applyImageFallback, getPlayerImage, getTeamBadgeUrl, hideOnError, PLAYER_PLACEHOLDER_SRC } from "../lib/images.js";
import { calculateLiveGwPoints, buildLiveDataMap } from "../lib/livePoints.js";

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
  const resolvedPhoto = getPlayerImage(pl?.photo);
  const photo = utils.el("img", {
    class: "player-photo",
    src: resolvedPhoto || PLAYER_PLACEHOLDER_SRC,
    alt: player.name,
    loading: "lazy"
  });
  applyImageFallback(photo, PLAYER_PLACEHOLDER_SRC);
  
  // Team badge overlay
  const teamBadgeSrc = getTeamBadgeUrl(team?.code);
  const teamBadge = teamBadgeSrc ? utils.el("img", {
    class: "player-team-badge",
    src: teamBadgeSrc,
    alt: team?.short_name || "",
    loading: "lazy"
  }) : null;
  if (teamBadge) {
    hideOnError(teamBadge);
    photoWrapper.append(photo, teamBadge);
  } else {
    photoWrapper.append(photo);
  }
  
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

/* ───────────────── Empty State SVG Illustrations ───────────────── */
const EMPTY_TEAM_SVG = `
<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="60" cy="60" r="50" stroke="currentColor" stroke-width="2" stroke-dasharray="8 4" opacity="0.4"/>
  <circle cx="60" cy="60" r="35" fill="currentColor" opacity="0.1"/>
  <path d="M60 25L75 45L95 50L80 70L82 90L60 80L38 90L40 70L25 50L45 45L60 25Z" fill="currentColor" opacity="0.3"/>
  <circle cx="60" cy="55" r="12" stroke="currentColor" stroke-width="2" fill="none"/>
  <path d="M48 75C48 68 53 63 60 63C67 63 72 68 72 75" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>
  <circle cx="85" cy="30" r="8" fill="currentColor" opacity="0.2"/>
  <path d="M82 27L88 33M88 27L82 33" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

/* ───────────────── page ───────────────── */
export async function renderMyTeam(main, options = {}){
  const { preferCache = false } = options;
  // Validate state - require entryId
  const validation = validateState({ requireEntryId: true });
  if (!validation.ok) {
    log.info("My Team: Setup required - missing entryId");
    const setupPrompt = ui.setupPrompt({
      missing: validation.missing,
      context: "to view your team",
      onSave: ({ entryId, leagueIds }) => {
        state.entryId = entryId;
        if (leagueIds.length > 0) {
          state.leagueIds = leagueIds;
        }
        log.info("Setup complete - reloading page");
        renderMyTeam(main);
      },
      onSkip: () => {
        location.hash = "#/";
      }
    });
    ui.mount(main, setupPrompt);
    return;
  }

  // Show loading state
  ui.mount(main, ui.loadingWithTimeout("Loading your team..."));

  // Fetch bootstrap data
  const bootstrapResult = state.bootstrap && !preferCache
    ? { ok: true, data: state.bootstrap, fromCache: false, cacheAge: 0 }
    : await fplClient.bootstrap({ preferCache });

  const hasTeamCache =
    fplClient.hasBootstrapCache() &&
    hasCachedData(CacheKey.ENTRY, state.entryId) &&
    hasCachedData(CacheKey.ENTRY_HISTORY, state.entryId);
  const cacheAge = hasTeamCache ? fplClient.getBootstrapCacheAge() : null;

  // Handle complete failure with degraded state options
  if (!bootstrapResult.ok) {
    log.error("My Team: Bootstrap fetch failed", bootstrapResult.message);

    const degradedCard = ui.degradedCard({
      title: "Failed to Load Team Data",
      errorType: bootstrapResult.errorType,
      message: bootstrapResult.message,
      cacheAge: hasTeamCache ? cacheAge : null,
      onRetry: async () => {
        await renderMyTeam(main);
      },
      onUseCached: hasTeamCache ? async () => {
        await renderMyTeam(main, { preferCache: true });
      } : null,
    });

    ui.mount(main, degradedCard);
    return;
  }

  // Render with data
  await renderMyTeamWithData(main, bootstrapResult, { preferCache });
}

/**
 * Render my team page with bootstrap data
 */
async function renderMyTeamWithData(main, bootstrapResult, options = {}) {
  const { preferCache = false } = options;
  const bs = bootstrapResult.data;
  state.bootstrap = bs;

  // Track cache state
  let usingCache = bootstrapResult.fromCache;
  let maxCacheAge = bootstrapResult.cacheAge || 0;

  try {
    // Bootstrap + core data
    const bs = state.bootstrap || bootstrapResult.data;
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

    // Core pulls using new API with standardized results
    const [profileResult, histResult, fixturesResult] = await Promise.all([
      fplClient.entry(state.entryId, { preferCache }),
      fplClient.entryHistory(state.entryId, { preferCache }),
      fplClient.fixtures(null, { preferCache })
    ]);

    // Check for failures
    if (!profileResult.ok || !histResult.ok) {
      throw new Error(profileResult.message || histResult.message || "Failed to load team data");
    }

    // Track cache usage
    if (profileResult.fromCache) { usingCache = true; maxCacheAge = Math.max(maxCacheAge, profileResult.cacheAge); }
    if (histResult.fromCache) { usingCache = true; maxCacheAge = Math.max(maxCacheAge, histResult.cacheAge); }
    if (fixturesResult.fromCache) { usingCache = true; maxCacheAge = Math.max(maxCacheAge, fixturesResult.cacheAge); }

    const profile = profileResult.data;
    const hist = histResult.data;
    const fixturesAll = fixturesResult.ok ? fixturesResult.data : [];

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

    // Picks & live using new API
    const [picksPrevResult, livePrevResult, picksUpcResult] = await Promise.all([
      prevGw ? fplClient.entryPicks(state.entryId, prevGw, { preferCache }) : Promise.resolve({ ok: true, data: null }),
      prevGw ? fplClient.eventLive(prevGw, { preferCache }) : Promise.resolve({ ok: true, data: { elements: [] } }),
      upcGw  ? fplClient.entryPicks(state.entryId, upcGw, { preferCache }) : Promise.resolve({ ok: true, data: null }),
    ]);

    const picksPrev = picksPrevResult.ok ? picksPrevResult.data : null;
    const livePrev = livePrevResult.ok ? livePrevResult.data : { elements: [] };
    const picksUpc = picksUpcResult.ok ? picksUpcResult.data : null;

    // Track cache usage
    if (picksPrevResult.fromCache) { usingCache = true; maxCacheAge = Math.max(maxCacheAge, picksPrevResult.cacheAge); }

    // Live map (if any)
    const liveResult = liveGw ? await fplClient.eventLive(liveGw, { preferCache }) : { ok: true, data: { elements: [] } };
    const liveMap = liveGw && liveResult.ok ? toMap(liveResult.data.elements || []) : new Map();

    // Roster preference: UPCOMING > PREVIOUS
    const roster =
      (picksUpc?.picks?.length ? { src: "upcoming", gw: upcGw, data: picksUpc } :
       picksPrev?.picks?.length ? { src: "previous", gw: prevGw, data: picksPrev } :
                                  { src: "previous", gw: prevGw, data: picksPrev });

    // Finance snapshot - prefer picks entry_history for accurate live data
    const picksEntryHist = roster.data?.entry_history;
    const histRow = hist.current.find(h => h.event === (lastFinished || prevGw || roster.gw));

    // For finance data, prefer picks entry_history, fallback to hist row
    const teamVal = picksEntryHist ? (picksEntryHist.value/10).toFixed(1) : histRow ? (histRow.value/10).toFixed(1) : "—";
    const bank    = picksEntryHist ? (picksEntryHist.bank/10).toFixed(1) : histRow ? (histRow.bank/10).toFixed(1)  : "—";
    const totalVal = picksEntryHist ? ((picksEntryHist.value + picksEntryHist.bank)/10).toFixed(1) :
                     histRow ? ((histRow.value + histRow.bank)/10).toFixed(1) : "—";

    const overallRank = picksEntryHist?.overall_rank ?? histRow?.overall_rank ?? profile?.summary_overall_rank ?? "—";
    const gwRank = picksEntryHist?.rank ?? histRow?.rank ?? "—";
    const totalPoints = picksEntryHist?.total_points ?? histRow?.total_points ?? profile?.summary_overall_points ?? "—";

    const livePrevMap = toMap(livePrev?.elements || []);

    // Calculate LIVE GW points from picks + eventLive data (includes captain multipliers and chips)
    // This ensures we show real-time points during live GWs, not stale saved values
    let gwPoints = "—";
    let activeChip = null;

    if (liveGw && liveResult.ok && roster.data?.picks) {
      // Live GW: Calculate from current live data
      const liveDataMap = buildLiveDataMap(liveResult.data);
      const liveCalc = calculateLiveGwPoints(roster.data, liveDataMap);
      gwPoints = liveCalc.total;
      activeChip = liveCalc.chip;
    } else if (prevGw && livePrev?.elements?.length && picksPrev?.picks) {
      // Previous GW finished: Calculate from that GW's live data (final points)
      const prevDataMap = buildLiveDataMap(livePrev);
      const prevCalc = calculateLiveGwPoints(picksPrev, prevDataMap);
      gwPoints = prevCalc.total;
      activeChip = prevCalc.chip;
    } else {
      // Fallback to saved points if live calculation not possible
      gwPoints = picksEntryHist?.points ?? histRow?.points ?? "—";
    }

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

    // Row builder - optimized to not make API calls during initial render
    function buildRowSync(pk, benchIndex=null) {
      const pl   = playerById.get(pk.element);
      const team = teamById.get(pl.team);
      const pos  = posById.get(pl.element_type);

      const prevE = livePrevMap.get(pl.id) || {};
      const liveE = liveMap.get(pl.id)     || {};

      const prevStats   = prevE.stats || {};
      const currStats   = liveGw ? (liveE.stats || {}) : {};
      const prevExplain = Array.isArray(prevE.explain) ? prevE.explain : [];
      const currExplain = liveGw && Array.isArray(liveE.explain) ? liveE.explain : [];

      const overallEO = +Number(pl.selected_by_percent || 0);
      const metaEO = (state.metaEO && typeof state.metaEO.get === "function")
        ? Number(state.metaEO.get(pl.id) || 0)
        : null;

      // Momentum icon
      const momentum = Number((pl.transfers_in_event || 0) - (pl.transfers_out_event || 0));
      const priceMomentum = momentum > 10000 ? "▲" : (momentum < -10000 ? "▼" : "");

      // Use form from bootstrap (already available, no API call needed)
      // pl.form is a string like "5.0" representing average points over last 5
      const formValue = parseFloat(pl.form || "0");

      // Estimate xMins from status and minutes_percent (no API call)
      const minutesPercent = pl.minutes ? (pl.minutes / (lastFinished * 90)) : 0;
      const statusMultiplier = pl.status === 'a' ? 1 : (pl.status === 'd' ? 0.5 : 0);
      const xmins = Math.round(90 * Math.min(1, minutesPercent) * statusMultiplier);

      // Calculate multiplier for this pick (captain, triple captain, bench boost)
      const isBenchBoost = activeChip === 'bboost';
      const isTripleCaptain = activeChip === '3xc';
      let pickMultiplier = 1;
      if (benchIndex !== null) {
        // Bench player - only counts with bench boost
        pickMultiplier = isBenchBoost ? 1 : 0;
      } else if (pk.is_captain) {
        pickMultiplier = isTripleCaptain ? 3 : 2;
      }

      // Base points from live data
      const prevBasePoints = prevStats.total_points ?? null;
      const currBasePoints = liveGw ? (currStats.total_points ?? null) : null;

      // Multiplied points for display (includes captain/chip bonuses)
      const prevPoints = prevBasePoints !== null ? prevBasePoints * pickMultiplier : null;
      const currPoints = currBasePoints !== null ? currBasePoints * pickMultiplier : null;

      return {
        id: pl.id,
        name: pl.web_name,
        photo: pl.photo,
        teamId: team.id,
        teamCode: team.code,
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
        multiplier: pickMultiplier,

        prevPoints,
        prevMinutes: (prevStats.minutes ?? null),
        currPoints,
        currMinutes: (liveGw ? (currStats.minutes ?? null) : null),

        prevExplain, currExplain,
        xmins,
        xpNext: 0,  // Will be calculated lazily
        xpWindow: 0,
        formData: [], // Will be loaded lazily
        form: formValue,
        player: pl, // Keep reference for lazy loading
      };
    }

    // Build rows synchronously (fast)
    const rows = starters.map(pk => buildRowSync(pk));
    const benchRows = benchAll.map((pk, i) => buildRowSync(pk, i));

    // Lazy load xP and form data in background (don't block render)
    async function enrichRowsAsync() {
      const allRows = [...rows, ...benchRows];
      // Process in parallel batches of 4 to avoid overwhelming API
      const batchSize = 4;
      for (let i = 0; i < allRows.length; i += batchSize) {
        const batch = allRows.slice(i, i + batchSize);
        await Promise.all(batch.map(async (r) => {
          try {
            // xP calculations
            if (upcGw) {
              r.xpNext = (await xPWindow(r.player, [upcGw])).total || 0;
              r.xpWindow = (await xPWindow(r.player, windowGwIds())).total || 0;
            }
            // Element summary for form sparkline
            const summaryResult = await fplClient.elementSummary(r.id);
            const summary = summaryResult.ok ? summaryResult.data : null;
            if (summary?.history) {
              r.formData = summary.history
                .filter(h => h.round <= lastFinished)
                .slice(-5)
                .map(h => h.total_points);
            }
            r.xmins = await estimateXMinsForPlayer(r.player).catch(() => r.xmins);
          } catch {}
        }));
      }
    }

    // Async enrichment is started later with .then() to update xP tile

    // Player click handler → go to canonical player page
    const handlePlayerClick = (player) => {
      location.hash = `#/player/${player.id}`;
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

    /* ───────────────── Mount UI (FM26 Dashboard Layout) ───────────────── */
    const page = utils.el("div", { class: "dashboard" });

    // ═══════════════════════════════════════════════════════
    // HEADER ROW
    // ═══════════════════════════════════════════════════════
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

    // Stats grid - compact inline
    const statsGrid = utils.el("div", { class: "team-stats-grid" });
    statsGrid.innerHTML = `
      <div class="stat-item">
        <div class="stat-value">${totalPoints}</div>
        <div class="stat-label">Total Pts</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${typeof overallRank === 'number' ? (overallRank > 999999 ? (overallRank/1000000).toFixed(1) + 'M' : overallRank > 999 ? (overallRank/1000).toFixed(0) + 'K' : overallRank) : overallRank}</div>
        <div class="stat-label">Rank</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${gwPoints}</div>
        <div class="stat-label">GW Pts</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">£${totalVal}m</div>
        <div class="stat-label">Value</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">£${bank}m</div>
        <div class="stat-label">Bank</div>
      </div>
      <div class="stat-item captain-stat">
        <div class="stat-value">${capName}</div>
        <div class="stat-label">Captain</div>
      </div>
    `;

    headerCard.append(headerTop, statsGrid);
    page.append(headerCard);

    // ═══════════════════════════════════════════════════════
    // MAIN CONTENT (Left: Pitch, Right: Tiles)
    // ═══════════════════════════════════════════════════════
    const mainContent = utils.el("div", { class: "dashboard-main" });

    // LEFT: Pitch visualization
    const leftCol = utils.el("div", { class: "dashboard-left" });
    const pitchTile = utils.el("div", { class: "tile tile-flush" });
    const pitchHeader = utils.el("div", { class: "tile-header" });
    pitchHeader.innerHTML = `<span class="tile-title">Starting XI</span>`;
    const pitchBody = utils.el("div", { class: "tile-body" });
    const pitch = renderPitchVisualization(rows, benchRows, capId, vcId, playerById, teamById, handlePlayerClick);
    pitchBody.append(pitch);
    pitchTile.append(pitchHeader, pitchBody);
    leftCol.append(pitchTile);

    // RIGHT: Info tiles grid
    const rightCol = utils.el("div", { class: "dashboard-right" });

    // Insights tile
    const insightsTile = utils.el("div", { class: "tile tile-wide" });
    const insightsHeader = utils.el("div", { class: "tile-header" });
    insightsHeader.innerHTML = `<span class="tile-title">💡 Insights</span>`;
    const insightsBody = utils.el("div", { class: "tile-body" });
    const insightsList = utils.el("div", { class: "insights-list" });

    const capSug = captainSuggestion();
    const bnSug = benchSuggestion();
    const issues = healthIssues([...rows, ...benchRows]);

    if (!capSug && !bnSug && !issues.length) {
      insightsList.innerHTML = `
        <div class="insight-item insight-good">
          <span class="insight-icon">✅</span>
          <span class="insight-text">Team looks good!</span>
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
        // Show each flagged player with their specific issue
        issues.forEach(player => {
          const statusInfo = STATUS_MAP[player.status] || { label: 'Unknown', icon: '❓' };
          const chance = player.chanceOfPlaying ?? player._raw?.chance_of_playing_next_round ?? null;
          const news = player.news || player._raw?.news || '';
          const item = utils.el("div", { class: "insight-item insight-warning insight-player" });
          item.innerHTML = `
            <span class="insight-icon">${statusInfo.icon || '⚠️'}</span>
            <div class="insight-player-details">
              <span class="insight-player-name">${player.name}</span>
              <span class="insight-player-status">${statusInfo.label}${chance !== null ? ` (${chance}%)` : ''}</span>
              ${news ? `<span class="insight-player-news">${news}</span>` : ''}
            </div>
          `;
          insightsList.append(item);
        });
      }
    }
    insightsBody.append(insightsList);
    insightsTile.append(insightsHeader, insightsBody);
    rightCol.append(insightsTile);

    // Fixtures tile
    const fixturesTile = utils.el("div", { class: "tile tile-wide" });
    const fixturesHeader = utils.el("div", { class: "tile-header" });
    fixturesHeader.innerHTML = `<span class="tile-title">📅 Fixtures (Next 4 GWs)</span>`;
    const fixturesBody = utils.el("div", { class: "tile-body" });
    const fixturesGrid = utils.el("div", { class: "fixtures-preview-grid" });
    const uniqueTeams = [...new Set(rows.map(r => r.teamId))];

    for (const teamId of uniqueTeams) {
      const team = teamById.get(teamId);
      const teamRow = utils.el("div", { class: "fixture-team-row" });
      const badgeSrc = getTeamBadgeUrl(team?.code);
      if (badgeSrc) {
        const badge = utils.el("img", {
          class: "fixture-team-badge",
          src: badgeSrc,
          alt: team?.short_name || "",
          loading: "lazy"
        });
        hideOnError(badge);
        teamRow.append(badge);
      }

      teamRow.append(utils.el("span", { class: "fixture-team-name" }, team?.short_name || "?"));
      teamRow.append(fixturesStrip(teamId, windowGwIds()));
      fixturesGrid.append(teamRow);
    }
    fixturesBody.append(fixturesGrid);
    fixturesTile.append(fixturesHeader, fixturesBody);
    rightCol.append(fixturesTile);

    // Quick stats tiles row
    // Top Performer: Use currPoints if live GW, otherwise prevPoints
    const pointsKey = liveGw ? 'currPoints' : 'prevPoints';
    const displayGw = liveGw || prevGw || roster.gw;
    const sortedByPoints = [...rows].sort((a,b) => ((b[pointsKey]||0) - (a[pointsKey]||0)));
    const topPerformerPts = sortedByPoints.length ? (sortedByPoints[0][pointsKey] || 0) : 0;
    const topPerformers = sortedByPoints.filter(p => (p[pointsKey] || 0) === topPerformerPts && p.name);
    const topPerformerNames = topPerformers.map(p => p.name);
    const topPerformerLabel = topPerformerNames.length
      ? topPerformerNames.join(", ")
      : "—";
    const topPerformerSuffix = topPerformerNames.length > 1 ? " (tie)" : "";

    const quickStatsTile1 = utils.el("div", { class: "tile tile-compact tile-clickable", role: "group", "aria-label": "Top performer" });
    quickStatsTile1.innerHTML = `
      <div class="tile-header">
        <span class="tile-title">Top Performer</span>
        <span class="tile-gw-badge" data-tooltip="Your highest scorer from ${liveGw ? 'current live' : 'last completed'} gameweek">GW${displayGw}${liveGw ? ' (live)' : ''}</span>
      </div>
      <div class="tile-body">
        <div class="metric-stack">
          <div class="metric-value text-brand">${topPerformerLabel}</div>
          <div class="metric-label">${topPerformerPts} pts${topPerformerSuffix}</div>
        </div>
      </div>
    `;

    // Team xP: Calculate sync estimate using form data (already in bootstrap)
    // Simple sync estimate: sum of (form * 1.1) for starters as proxy for xP
    const syncXpEstimate = rows.reduce((sum, r) => {
      // Use form (last 5 avg) as base, add small fixture adjustment
      const formVal = r.form || 0;
      return sum + (formVal * 1.1);
    }, 0);

    const quickStatsTile2 = utils.el("div", { class: "tile tile-compact tile-clickable", role: "group", "aria-label": "Team expected points" });
    quickStatsTile2.id = "team-xp-tile";
    quickStatsTile2.innerHTML = `
      <div class="tile-header">
        <span class="tile-title" data-tooltip="Expected Points projection for next GW based on form, fixtures, and minutes reliability">Team xP</span>
        <span class="tile-gw-badge">GW${upcGw}</span>
      </div>
      <div class="tile-body">
        <div class="metric-stack">
          <div class="metric-value text-accent" id="team-xp-value">${syncXpEstimate.toFixed(1)}</div>
          <div class="metric-label" id="team-xp-label">estimated pts</div>
        </div>
      </div>
    `;
    rightCol.append(quickStatsTile1, quickStatsTile2);

    // Update xP tile when async enrichment completes
    enrichRowsAsync().then(() => {
      const xpValue = document.getElementById("team-xp-value");
      const xpLabel = document.getElementById("team-xp-label");
      if (xpValue && xpLabel) {
        const totalXp = rows.reduce((sum, r) => sum + (r.xpNext || 0), 0);
        if (totalXp > 0) {
          xpValue.textContent = totalXp.toFixed(1);
          xpLabel.textContent = "projected pts";
        }
      }
    });

    mainContent.append(leftCol, rightCol);
    page.append(mainContent);

    // Mount with cached banner if using cached data
    ui.mountWithCache(main, page, {
      fromCache: usingCache,
      cacheAge: maxCacheAge,
      onRefresh: () => renderMyTeam(main),
    });

    setPageUpdated("my-team");

  } catch (e) {
    log.error("My Team: Failed to load", e);

    // Check if cached data is available for degraded state
    const hasCache =
      fplClient.hasBootstrapCache() &&
      hasCachedData(CacheKey.ENTRY, state.entryId) &&
      hasCachedData(CacheKey.ENTRY_HISTORY, state.entryId);
    const cacheAge = hasCache ? fplClient.getBootstrapCacheAge() : null;

    if (hasCache) {
      // Show degraded card with cache option
      const degradedCard = ui.degradedCard({
        title: "Failed to Load Team Data",
        message: e.message || "There was a problem fetching your team data.",
        cacheAge,
        onRetry: async () => {
          await renderMyTeam(main);
        },
        onUseCached: async () => {
          await renderMyTeam(main, { preferCache: true });
        },
      });
      ui.mount(main, degradedCard);
    } else {
      // No cache available - show standard error
      const errorCard = ui.errorCard({
        title: "Failed to load My Team",
        message: "There was a problem fetching your team data. This could be a network issue or the FPL API may be temporarily unavailable.",
        error: e,
        onRetry: async () => {
          await renderMyTeam(main);
        }
      });
      ui.mount(main, errorCard);
    }
  }
}
