// js/pages/stat-picker.js
// Phase 5: Stat Picker Engine Architecture
// - Deterministic pipeline with loadContext()
// - Transparent optimizer with horizon/objective controls
// - Debuggable state with dependency tracking
// Phase 7: Transfer Optimisation (constrained simulation)
// - Weakest link identification with explicit reasons
// - Legal replacement simulation (budget, position, club limit, FT/hit rules)
// - User controls: lock players, exclude teams/players, hit settings

import { fplClient, legacyApi } from "../api/fplClient.js";
import { state, setPageUpdated } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { log } from "../logger.js";
import { STORAGE_KEYS, getJSON, setJSON } from "../storage.js";
import { getCacheAge, CacheKey, loadFromCache } from "../api/fetchHelper.js";
import { renderTransferOptimizer, wireUpTransferOptimizer } from "../components/transferOptimizerUI.js";
import { runTransferOptimization } from "../lib/transferOptimizer.js";
import { renderBenchChipAdvisor, wireUpBenchChipAdvisor } from "../components/benchChipAdvisorUI.js";

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 5: HORIZON & OBJECTIVE DEFINITIONS
   ═══════════════════════════════════════════════════════════════════════════ */

const HORIZONS = {
  THIS_GW: { id: "this_gw", label: "This GW", gwCount: 1 },
  NEXT_3: { id: "next_3", label: "Next 3", gwCount: 3 },
  NEXT_5: { id: "next_5", label: "Next 5", gwCount: 5 },
};

const OBJECTIVES = {
  MAX_POINTS: { id: "max_points", label: "Max Points", description: "Maximize expected points" },
  MIN_RISK: { id: "min_risk", label: "Min Risk", description: "Prioritize nailed starters, avoid rotation" },
  PROTECT_RANK: { id: "protect_rank", label: "Protect Rank", description: "Match effective ownership (EO)" },
  CHASE_UPSIDE: { id: "chase_upside", label: "Chase Upside", description: "Target differential picks for rank gain" },
};

const STORAGE_KEY_HORIZON = "fpl.sp.horizon";
const STORAGE_KEY_OBJECTIVE = "fpl.sp.objective";
const STORAGE_KEY_CONTEXT_CACHE = "fpl.sp.contextCache";
const STORAGE_KEY_CAPTAIN_MODE = "fpl.sp.captainMode";
const STORAGE_KEY_MANUAL_OVERRIDES = "fpl.sp.manualOverrides";

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 6: CAPTAIN MODES (Conservative vs Aggressive)
   ═══════════════════════════════════════════════════════════════════════════ */

const CAPTAIN_MODES = {
  CONSERVATIVE: {
    id: "conservative",
    label: "Conservative",
    description: "Prefer nailed starters with high floor",
    icon: "🛡️"
  },
  AGGRESSIVE: {
    id: "aggressive",
    label: "Aggressive",
    description: "Target highest ceiling, accept variance",
    icon: "🚀"
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 6: VERDICT LABELS FOR SQUAD RANKING
   ═══════════════════════════════════════════════════════════════════════════ */

const VERDICTS = {
  LOCK: { id: "lock", label: "LOCK", class: "sp-verdict-lock", description: "Guaranteed starter, high confidence" },
  START: { id: "start", label: "START", class: "sp-verdict-start", description: "Recommended for XI" },
  BENCH: { id: "bench", label: "BENCH", class: "sp-verdict-bench", description: "Optimal as bench cover" },
  SELL_WATCH: { id: "sell_watch", label: "SELL WATCH", class: "sp-verdict-sell-watch", description: "Consider replacing soon" },
  SELL: { id: "sell", label: "SELL", class: "sp-verdict-sell", description: "Priority to transfer out" },
};

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 5: DEPENDENCY DEFINITIONS
   ═══════════════════════════════════════════════════════════════════════════ */

const DEPENDENCIES = {
  BOOTSTRAP: { id: "bootstrap", label: "Game Data", required: true, retryable: true },
  GW_STATE: { id: "gw_state", label: "GW & Deadline", required: true, retryable: true },
  SQUAD: { id: "squad", label: "Squad (15 players)", required: true, retryable: true },
  FT_ITB: { id: "ft_itb", label: "FT + Bank + Value", required: true, retryable: true },
  CHIPS: { id: "chips", label: "Chip Availability", required: true, retryable: true },
  FIXTURES: { id: "fixtures", label: "Fixtures List", required: true, retryable: true },
  PREDICTIONS: { id: "predictions", label: "xP Predictions", required: false, retryable: true },
};

const DEPENDENCY_STATUS = {
  PENDING: "pending",
  LOADING: "loading",
  SUCCESS: "success",
  FAILED: "failed",
  CACHED: "cached",
};

/* ═══════════════════════════════════════════════════════════════════════════
   FIX: NORMALISE FIXTURES SHAPE (Option A)
   fplClient.fixtures() may return an object wrapper instead of an array.
   This ensures downstream code always receives an array.
   ═══════════════════════════════════════════════════════════════════════════ */

function toArrayFixtures(x) {
  if (Array.isArray(x)) return x;
  if (!x) return [];
  if (Array.isArray(x.fixtures)) return x.fixtures;
  if (Array.isArray(x.data)) return x.data;
  if (Array.isArray(x.results)) return x.results;
  return [];
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 11: UNIFIED TRANSFER RECOMMENDATION HELPERS
   Both GW Snapshot and sidebar now use the same canonical source
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Extract transfer info from canonical result for snapshot display
 * Returns { out, in, gain } or null if no transfer recommended
 */
function extractSnapshotTransfer(canonicalResult) {
  if (!canonicalResult?.ok || !canonicalResult.recommendations) return null;

  const rec = canonicalResult.recommendations;
  const action = rec.action;

  // Only show transfer if action is "transfer" or "hit"
  if (action !== "transfer" && action !== "hit") return null;

  const best = rec.best;
  if (!best || !best.transfers || best.transfers.length === 0) return null;

  const firstTransfer = best.transfers[0];
  if (!firstTransfer) return null;

  return {
    out: firstTransfer.out?.player?.web_name || "?",
    in: firstTransfer.in?.player?.web_name || "?",
    gain: firstTransfer.xpGain || best.netGain || 0,
    action: action === "hit" ? "hit" : "free"
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PASSWORD GATE - localStorage with 24h expiry (Phase 2 - PRESERVED)
   ═══════════════════════════════════════════════════════════════════════════ */

const GATE_KEY = STORAGE_KEYS.STAT_PICKER_UNLOCKED;
const GATE_EXPIRY_MS = 24 * 60 * 60 * 1000;
const GATE_PASSWORD = "fpl2025";

function isUnlocked() {
  try {
    const data = localStorage.getItem(GATE_KEY);
    if (!data) return false;
    const { timestamp } = JSON.parse(data);
    if (Date.now() - timestamp > GATE_EXPIRY_MS) {
      localStorage.removeItem(GATE_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function unlock() {
  localStorage.setItem(GATE_KEY, JSON.stringify({ timestamp: Date.now() }));
}

function lock() {
  localStorage.removeItem(GATE_KEY);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHIP NAME MAPPING
   ═══════════════════════════════════════════════════════════════════════════ */

const CHIP_NAMES = {
  wildcard: "Wildcard",
  freehit: "Free Hit",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
};

function formatChipName(chip) {
  return CHIP_NAMES[chip] || chip;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 5.1: LOAD CONTEXT - Bootstrap Pipeline with Dependency Tracking
   Returns { ok, context, failures: [], dependencyStatus: {} }
   ═══════════════════════════════════════════════════════════════════════════ */

async function loadContext(options = {}) {
  const { forceRefresh = false, retryDependency = null } = options;

  const dependencyStatus = {};
  const failures = [];
  let context = {};

  // Initialize all dependencies as pending
  Object.values(DEPENDENCIES).forEach(dep => {
    dependencyStatus[dep.id] = { status: DEPENDENCY_STATUS.PENDING, error: null, fromCache: false };
  });

  // Helper to update dependency status
  const setDepStatus = (depId, status, error = null, fromCache = false) => {
    dependencyStatus[depId] = { status, error, fromCache };
  };

  // If retrying a specific dependency, only reload that one
  const shouldLoad = (depId) => !retryDependency || retryDependency === depId;

  try {
    // 1. BOOTSTRAP - Game data (elements, teams, events)
    if (shouldLoad(DEPENDENCIES.BOOTSTRAP.id)) {
      setDepStatus(DEPENDENCIES.BOOTSTRAP.id, DEPENDENCY_STATUS.LOADING);
      try {
        const bsResult = forceRefresh
          ? await fplClient.bootstrap(true)
          : await fplClient.bootstrap();

        if (bsResult.ok) {
          context.bootstrap = bsResult.data;
          state.bootstrap = bsResult.data;
          setDepStatus(DEPENDENCIES.BOOTSTRAP.id, DEPENDENCY_STATUS.SUCCESS, null, bsResult.fromCache);
        } else {
          // Try cache fallback
          const cached = loadFromCache(CacheKey.BOOTSTRAP);
          if (cached) {
            context.bootstrap = cached.data;
            state.bootstrap = cached.data;
            setDepStatus(DEPENDENCIES.BOOTSTRAP.id, DEPENDENCY_STATUS.CACHED, bsResult.message, true);
          } else {
            throw new Error(bsResult.message || "Failed to load game data");
          }
        }
      } catch (err) {
        setDepStatus(DEPENDENCIES.BOOTSTRAP.id, DEPENDENCY_STATUS.FAILED, err.message);
        failures.push({ dependency: DEPENDENCIES.BOOTSTRAP, error: err.message });
      }
    } else if (state.bootstrap) {
      context.bootstrap = state.bootstrap;
      setDepStatus(DEPENDENCIES.BOOTSTRAP.id, DEPENDENCY_STATUS.SUCCESS);
    }

    const bs = context.bootstrap;
    if (!bs) {
      return { ok: false, context: null, failures, dependencyStatus };
    }

    // 2. GW STATE - Current GW, deadline, live status
    if (shouldLoad(DEPENDENCIES.GW_STATE.id)) {
      setDepStatus(DEPENDENCIES.GW_STATE.id, DEPENDENCY_STATUS.LOADING);
      try {
        const events = bs.events || [];
        const currentEvent = events.find(e => e.is_current);
        const nextEvent = events.find(e => e.is_next);
        const lastFinished = events.filter(e => e.data_checked).slice(-1)[0];

        context.currentGw = currentEvent?.id || lastFinished?.id || 1;
        context.nextGw = nextEvent?.id || context.currentGw + 1;
        context.isLive = currentEvent && !currentEvent.data_checked;
        context.deadline = nextEvent?.deadline_time || currentEvent?.deadline_time;
        context.gwForPicks = context.isLive ? context.currentGw : (lastFinished?.id || 1);

        setDepStatus(DEPENDENCIES.GW_STATE.id, DEPENDENCY_STATUS.SUCCESS);
      } catch (err) {
        setDepStatus(DEPENDENCIES.GW_STATE.id, DEPENDENCY_STATUS.FAILED, err.message);
        failures.push({ dependency: DEPENDENCIES.GW_STATE, error: err.message });
      }
    }

    // Check entry ID early
    const entryId = state.entryId;
    if (!entryId) {
      return {
        ok: false,
        context: null,
        failures: [{ dependency: { id: "entry_id", label: "Entry ID" }, error: "No Entry ID configured" }],
        dependencyStatus,
        needsEntryId: true
      };
    }
    context.entryId = entryId;

    // 3. SQUAD - 15-man squad with picks + player metadata
    if (shouldLoad(DEPENDENCIES.SQUAD.id)) {
      setDepStatus(DEPENDENCIES.SQUAD.id, DEPENDENCY_STATUS.LOADING);
      try {
        const [entryResult, picksResult] = await Promise.all([
          fplClient.entry(entryId),
          fplClient.entryPicks(entryId, context.gwForPicks)
        ]);

        if (!entryResult.ok && !entryResult.fromCache) {
          throw new Error(entryResult.message || "Failed to load entry");
        }

        const entry = entryResult.data;
        context.entry = entry;
        context.entryName = entry?.name;
        context.playerName = entry ? `${entry.player_first_name} ${entry.player_last_name}` : "Unknown";
        context.overallRank = entry?.summary_overall_rank;
        context.overallPoints = entry?.summary_overall_points;

        if (!picksResult.ok && !picksResult.fromCache) {
          throw new Error(picksResult.message || "Failed to load picks");
        }

        const picks = picksResult.data;
        const elements = bs.elements || [];
        const teams = bs.teams || [];
        const positions = bs.element_types || [];

        context.squad = [];
        context.xi = [];
        context.bench = [];
        context.captain = null;
        context.viceCaptain = null;

        if (picks?.picks) {
          context.squad = picks.picks.map((pick, idx) => {
            const player = elements.find(p => p.id === pick.element);
            const team = teams.find(t => t.id === player?.team);
            const pos = positions.find(p => p.id === player?.element_type);

            const isBench = idx >= 11;
            const isCaptain = pick.is_captain;
            const isVice = pick.is_vice_captain;

            const playerData = {
              ...player,
              pickPosition: pick.position,
              multiplier: pick.multiplier,
              isCaptain,
              isVice,
              isBench,
              teamName: team?.short_name || "???",
              teamCode: team?.code,
              positionName: pos?.singular_name_short || "?",
            };

            if (isCaptain) context.captain = playerData;
            if (isVice) context.viceCaptain = playerData;
            if (isBench) context.bench.push(playerData);
            else context.xi.push(playerData);

            return playerData;
          });
        }

        context.flaggedPlayers = context.squad
          .filter(p => p.status !== "a")
          .map(p => ({ ...p, flagReason: getFlagReason(p) }));

        setDepStatus(DEPENDENCIES.SQUAD.id, DEPENDENCY_STATUS.SUCCESS, null, picksResult.fromCache);
      } catch (err) {
        setDepStatus(DEPENDENCIES.SQUAD.id, DEPENDENCY_STATUS.FAILED, err.message);
        failures.push({ dependency: DEPENDENCIES.SQUAD, error: err.message });
      }
    }

    // 4. FT + ITB + TEAM VALUE
    if (shouldLoad(DEPENDENCIES.FT_ITB.id)) {
      setDepStatus(DEPENDENCIES.FT_ITB.id, DEPENDENCY_STATUS.LOADING);
      try {
        const historyResult = await fplClient.entryHistory(entryId);

        if (!historyResult.ok && !historyResult.fromCache) {
          throw new Error(historyResult.message || "Failed to load history");
        }

        const history = historyResult.data;
        const entry = context.entry;
        const currentHistory = history?.current?.find(h => h.event === context.gwForPicks);

        context.bank = currentHistory?.bank ?? entry?.last_deadline_bank ?? 0;
        context.teamValue = currentHistory?.value ?? entry?.last_deadline_value ?? 1000;
        context.freeTransfers = calculateFreeTransfers(history, context.currentGw);
        context.history = history;

        context.bankFormatted = `£${(context.bank / 10).toFixed(1)}m`;
        context.teamValueFormatted = `£${(context.teamValue / 10).toFixed(1)}m`;
        context.totalValue = context.bank + context.teamValue;
        context.totalValueFormatted = `£${(context.totalValue / 10).toFixed(1)}m`;

        context.gwRank = currentHistory?.rank;
        context.gwPoints = currentHistory?.points;

        setDepStatus(DEPENDENCIES.FT_ITB.id, DEPENDENCY_STATUS.SUCCESS, null, historyResult.fromCache);
      } catch (err) {
        setDepStatus(DEPENDENCIES.FT_ITB.id, DEPENDENCY_STATUS.FAILED, err.message);
        failures.push({ dependency: DEPENDENCIES.FT_ITB, error: err.message });
      }
    }

    // 5. CHIP AVAILABILITY
    if (shouldLoad(DEPENDENCIES.CHIPS.id)) {
      setDepStatus(DEPENDENCIES.CHIPS.id, DEPENDENCY_STATUS.LOADING);
      try {
        const history = context.history;
        const rawChipsUsed = history?.chips || [];
        context.chipsUsed = rawChipsUsed.map(c => ({ chip: c.name, gw: c.event }));

        const wildcardsUsed = context.chipsUsed.filter(c => c.chip === "wildcard").length;
        context.chipsAvailable = [];
        if (wildcardsUsed < 2) context.chipsAvailable.push("wildcard");
        if (!context.chipsUsed.some(c => c.chip === "freehit")) context.chipsAvailable.push("freehit");
        if (!context.chipsUsed.some(c => c.chip === "bboost")) context.chipsAvailable.push("bboost");
        if (!context.chipsUsed.some(c => c.chip === "3xc")) context.chipsAvailable.push("3xc");

        setDepStatus(DEPENDENCIES.CHIPS.id, DEPENDENCY_STATUS.SUCCESS);
      } catch (err) {
        setDepStatus(DEPENDENCIES.CHIPS.id, DEPENDENCY_STATUS.FAILED, err.message);
        failures.push({ dependency: DEPENDENCIES.CHIPS, error: err.message });
      }
    }

    // 6. FIXTURES LIST
    if (shouldLoad(DEPENDENCIES.FIXTURES.id)) {
      setDepStatus(DEPENDENCIES.FIXTURES.id, DEPENDENCY_STATUS.LOADING);
      try {
        const fixturesResult = await fplClient.fixtures();

        if (!fixturesResult.ok && !fixturesResult.fromCache) {
          throw new Error(fixturesResult.message || "Failed to load fixtures");
        }

        context.allFixtures = toArrayFixtures(fixturesResult.data);

        // Build fixture matrix for user's teams
        const userTeamIds = [...new Set((context.squad || []).map(p => p.team))];
        context.fixtureMatrix = await buildFixtureMatrix(userTeamIds, context.nextGw, context.allFixtures, bs);

        setDepStatus(DEPENDENCIES.FIXTURES.id, DEPENDENCY_STATUS.SUCCESS, null, fixturesResult.fromCache);
      } catch (err) {
        setDepStatus(DEPENDENCIES.FIXTURES.id, DEPENDENCY_STATUS.FAILED, err.message);
        failures.push({ dependency: DEPENDENCIES.FIXTURES, error: err.message });
      }
    }

    // 7. PREDICTIONS (xP) - Optional, can degrade gracefully
    if (shouldLoad(DEPENDENCIES.PREDICTIONS.id)) {
      setDepStatus(DEPENDENCIES.PREDICTIONS.id, DEPENDENCY_STATUS.LOADING);
      try {
        // Pre-calculate xP for squad (will be recalculated with horizon in optimiser)
        context.predictionsAvailable = true;
        context.predictionsError = null;
        setDepStatus(DEPENDENCIES.PREDICTIONS.id, DEPENDENCY_STATUS.SUCCESS);
      } catch (err) {
        context.predictionsAvailable = false;
        context.predictionsError = err.message;
        setDepStatus(DEPENDENCIES.PREDICTIONS.id, DEPENDENCY_STATUS.FAILED, err.message);
        // Don't add to failures since predictions are optional
      }
    }

    // Cache the context for fallback
    try {
      const cacheableContext = {
        ...context,
        bootstrap: undefined, // Don't cache bootstrap (too large, cached separately)
        cachedAt: Date.now()
      };
      setJSON(STORAGE_KEY_CONTEXT_CACHE, cacheableContext);
    } catch (e) {
      log.warn("Failed to cache context", e);
    }

    // Determine overall success
    const requiredFailures = failures.filter(f => f.dependency.required);
    const ok = requiredFailures.length === 0 && context.squad && context.squad.length > 0;

    return { ok, context, failures, dependencyStatus };

  } catch (err) {
    log.error("loadContext error", err);
    return {
      ok: false,
      context: null,
      failures: [{ dependency: { id: "unknown", label: "Unknown" }, error: err.message }],
      dependencyStatus
    };
  }
}

/**
 * Load context from cache (for degraded mode fallback)
 */
function loadCachedContext() {
  try {
    const cached = getJSON(STORAGE_KEY_CONTEXT_CACHE);
    if (cached && cached.cachedAt) {
      const age = Date.now() - cached.cachedAt;
      if (age < 24 * 60 * 60 * 1000) { // 24 hours
        return {
          ok: true,
          context: cached,
          fromCache: true,
          cacheAge: age
        };
      }
    }
  } catch (e) {
    log.warn("Failed to load cached context", e);
  }
  return { ok: false, context: null, fromCache: false };
}

/* ═══════════════════════════════════════════════════════════════════════════
   CURRENT STATE ENGINE (Phase 2 - PRESERVED)
   ═══════════════════════════════════════════════════════════════════════════ */

async function buildCurrentState() {
  const bs = state.bootstrap || (await legacyApi.bootstrap());
  if (!bs) throw new Error("Bootstrap data not available");

  const entryId = state.entryId;
  if (!entryId) {
    return {
      error: "NO_ENTRY_ID",
      message: "Set your Entry ID in the sidebar to see your team state.",
    };
  }

  const [entry, history, fixturesRaw] = await Promise.all([
    fplClient.entry(entryId).catch(() => null),
    fplClient.entryHistory(entryId).catch(() => null),
    fplClient.fixtures().catch(() => []),
  ]);

  const fixtures = toArrayFixtures(fixturesRaw);

  if (!entry) {
    return {
      error: "ENTRY_NOT_FOUND",
      message: `Entry ${entryId} not found. Check your Entry ID.`,
    };
  }

  const events = bs.events || [];
  const currentEvent = events.find((e) => e.is_current);
  const nextEvent = events.find((e) => e.is_next);
  const lastFinished = events.filter((e) => e.data_checked).slice(-1)[0];

  const currentGw = currentEvent?.id || lastFinished?.id || 1;
  const nextGw = nextEvent?.id || currentGw + 1;
  const isLive = currentEvent && !currentEvent.data_checked;

  const gwForPicks = isLive ? currentGw : lastFinished?.id || 1;
  let picks = null;
  try {
    picks = await legacyApi.entryPicks(entryId, gwForPicks);
  } catch {}

  const currentHistory = history?.current?.find((h) => h.event === gwForPicks);
  const bank = currentHistory?.bank ?? entry.last_deadline_bank ?? 0;
  const teamValue = currentHistory?.value ?? entry.last_deadline_value ?? 1000;
  const freeTransfers = calculateFreeTransfers(history, currentGw);

  // CHIPS: Strictly derive from entry history - no defaults, no guessing
  const rawChipsUsed = history?.chips || [];
  const chipsUsed = rawChipsUsed.map((c) => ({ chip: c.name, gw: c.event }));

  // Count wildcards used (max 2 per season)
  const wildcardsUsed = chipsUsed.filter((c) => c.chip === "wildcard").length;

  // Build available chips list - only if NOT in used list
  const chipsAvailable = [];
  if (wildcardsUsed < 2) chipsAvailable.push("wildcard");
  if (!chipsUsed.some((c) => c.chip === "freehit")) chipsAvailable.push("freehit");
  if (!chipsUsed.some((c) => c.chip === "bboost")) chipsAvailable.push("bboost");
  if (!chipsUsed.some((c) => c.chip === "3xc")) chipsAvailable.push("3xc");

  let squad = [],
    captain = null,
    viceCaptain = null,
    bench = [];

  if (picks?.picks) {
    const elements = bs.elements || [];
    const teams = bs.teams || [];
    const positions = bs.element_types || [];

    squad = picks.picks.map((pick, idx) => {
      const player = elements.find((p) => p.id === pick.element);
      const team = teams.find((t) => t.id === player?.team);
      const pos = positions.find((p) => p.id === player?.element_type);

      const isBench = idx >= 11;
      const isCaptain = pick.is_captain;
      const isVice = pick.is_vice_captain;

      const playerData = {
        ...player,
        pickPosition: pick.position,
        multiplier: pick.multiplier,
        isCaptain,
        isVice,
        isBench,
        teamName: team?.short_name || "???",
        positionName: pos?.singular_name_short || "?",
      };

      if (isCaptain) captain = playerData;
      if (isVice) viceCaptain = playerData;
      if (isBench) bench.push(playerData);
      return playerData;
    });
  }

  const xi = squad.filter((p) => !p.isBench);
  const flaggedPlayers = squad
    .filter((p) => p.status !== "a")
    .map((p) => ({ ...p, flagReason: getFlagReason(p) }));
  const userTeamIds = [...new Set(squad.map((p) => p.team))];
  const fixtureMatrix = await buildFixtureMatrix(userTeamIds, nextGw, fixtures, bs);

  return {
    entryId,
    entryName: entry.name,
    playerName: `${entry.player_first_name} ${entry.player_last_name}`,
    currentGw,
    nextGw,
    isLive,
    freeTransfers,
    bank,
    bankFormatted: `£${(bank / 10).toFixed(1)}m`,
    teamValue,
    teamValueFormatted: `£${(teamValue / 10).toFixed(1)}m`,
    totalValue: bank + teamValue,
    totalValueFormatted: `£${((bank + teamValue) / 10).toFixed(1)}m`,
    chipsAvailable,
    chipsUsed,
    squad,
    xi,
    bench,
    captain,
    viceCaptain,
    flaggedPlayers,
    fixtureMatrix,
    overallRank: entry.summary_overall_rank,
    overallPoints: entry.summary_overall_points,
    gwRank: currentHistory?.rank,
    gwPoints: currentHistory?.points,
  };
}

function calculateFreeTransfers(history, currentGw) {
  if (!history?.current) return 1;
  let ft = 1;
  const lastGw = history.current.find((h) => h.event === currentGw - 1);
  if (lastGw) ft = Math.min(5, 1 + (lastGw.event_transfers === 0 ? 1 : 0));
  return ft;
}

function getFlagReason(player) {
  const statusMap = {
    d: "Doubtful",
    i: "Injured",
    s: "Suspended",
    u: "Unavailable",
    n: "Not in squad",
  };
  let reason = statusMap[player.status] || "Unknown";
  if (player.news) reason += ` - ${player.news}`;
  if (player.chance_of_playing_next_round != null)
    reason += ` (${player.chance_of_playing_next_round}%)`;
  return reason;
}

async function buildFixtureMatrix(teamIds, startGw, allFixtures, bs) {
  const teams = bs.teams || [];
  const horizons = [3, 6, 8];
  const matrix = {};

  // Defensive: ensure array even if someone passes wrapper/null
  allFixtures = toArrayFixtures(allFixtures);

  for (const teamId of teamIds) {
    const team = teams.find((t) => t.id === teamId);
    matrix[teamId] = { teamId, teamName: team?.short_name || "???", horizons: {} };

    for (const h of horizons) {
      const gwRange = [];
      for (let gw = startGw; gw < startGw + h && gw <= 38; gw++) gwRange.push(gw);

      const fixtures = [];
      for (const gw of gwRange) {
        const gwFx = allFixtures.filter((f) => f.event === gw);
        const teamFx = gwFx.filter((f) => f.team_h === teamId || f.team_a === teamId);

        for (const fx of teamFx) {
          const isHome = fx.team_h === teamId;
          const oppId = isHome ? fx.team_a : fx.team_h;
          const opp = teams.find((t) => t.id === oppId);
          const fdr = isHome ? fx.team_h_difficulty : fx.team_a_difficulty;
          fixtures.push({ gw, opponent: opp?.short_name || "???", isHome, fdr });
        }
      }

      const avgFdr = fixtures.length
        ? (fixtures.reduce((s, f) => s + f.fdr, 0) / fixtures.length).toFixed(1)
        : null;
      matrix[teamId].horizons[h] = { fixtures, avgFdr, label: `Next ${h}` };
    }
  }
  return matrix;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORING MODEL (Phase 2 - PRESERVED)
   ═══════════════════════════════════════════════════════════════════════════ */

async function calculateExpectedPoints(player, horizon, bs) {
  const startGw = (bs.events || []).find((e) => e.is_next)?.id || 1;
  const gwIds = [];
  for (let gw = startGw; gw < startGw + horizon && gw <= 38; gw++) gwIds.push(gw);

  const allFixtures = await legacyApi.fixtures();
  const teams = bs.teams || [];

  const playerFixtures = [];
  for (const gw of gwIds) {
    const gwFx = allFixtures.filter((f) => f.event === gw);
    const teamFx = gwFx.filter((f) => f.team_h === player.team || f.team_a === player.team);
    for (const fx of teamFx) {
      const isHome = fx.team_h === player.team;
      const oppId = isHome ? fx.team_a : fx.team_h;
      const opp = teams.find((t) => t.id === oppId);
      const fdr = isHome ? fx.team_h_difficulty : fx.team_a_difficulty;
      playerFixtures.push({ gw, isHome, fdr, opponent: opp?.short_name || "???" });
    }
  }

  if (playerFixtures.length === 0) {
    return {
      total: 0,
      perGw: [],
      explanation: "No fixtures (blank GWs)",
      components: { appearance: 0, attack: 0, cleanSheet: 0, bonus: 0 },
    };
  }

  const minutesReliability = calculateMinutesReliability(player);
  const xMins = (minutesReliability.score / 100) * 90;
  const xgi90 = player.expected_goal_involvements
    ? parseFloat(player.expected_goal_involvements) / Math.max(player.minutes / 90, 1)
    : estimateXgi90(player);

  const posId = player.element_type;
  const csPoints = posId <= 2 ? 4 : posId === 3 ? 1 : 0;
  const goalPoints = posId <= 2 ? 6 : posId === 3 ? 5 : 4;

  let totalXp = 0,
    totalApp = 0,
    totalAtk = 0,
    totalCS = 0,
    totalBonus = 0;
  const perGw = [];

  for (const fx of playerFixtures) {
    const appXp = xMins >= 60 ? 2 : xMins > 0 ? 1 : 0;
    const fdrMult = ({ 1: 1.15, 2: 1.1, 3: 1.0, 4: 0.9, 5: 0.8 })[fx.fdr] || 1;
    const homeMult = fx.isHome ? 1.05 : 0.95;
    const atkXp = xgi90 * (xMins / 90) * goalPoints * fdrMult * homeMult;

    const csProb = getCSProb(fx.fdr, fx.isHome);
    const csXp = csProb * csPoints * (xMins >= 60 ? 1 : 0);

    const bps90 = player.minutes > 0 ? parseFloat(player.bps || 0) / (player.minutes / 90) : 0;
    const bonusXp = Math.min(0.8, bps90 / 30) * (xMins / 90);

    const gwXp = appXp + atkXp + csXp + bonusXp;
    totalXp += gwXp;
    totalApp += appXp;
    totalAtk += atkXp;
    totalCS += csXp;
    totalBonus += bonusXp;
    perGw.push({ gw: fx.gw, opponent: fx.opponent, isHome: fx.isHome, fdr: fx.fdr, xp: gwXp.toFixed(1) });
  }

  return {
    total: parseFloat(totalXp.toFixed(1)),
    perGw,
    minutesReliability,
    components: { appearance: totalApp, attack: totalAtk, cleanSheet: totalCS, bonus: totalBonus },
    explanation: buildExplanation(player, minutesReliability, xgi90, playerFixtures, totalXp),
  };
}

function estimateXgi90(player) {
  const threat = parseFloat(player.threat || 0);
  const creativity = parseFloat(player.creativity || 0);
  const mins = Math.max(player.minutes || 1, 1);
  return threat / (mins / 90) / 500 + creativity / (mins / 90) / 1000;
}

function getCSProb(fdr, isHome) {
  let prob = ({ 1: 0.4, 2: 0.35, 3: 0.25, 4: 0.15, 5: 0.08 })[fdr] || 0.2;
  prob += isHome ? 0.03 : -0.03;
  return Math.max(0.02, Math.min(0.6, prob));
}

function buildExplanation(player, mins, xgi90, fixtures, totalXp) {
  const pos = ({ 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" })[player.element_type] || "?";
  const avgFdr = fixtures.length
    ? (fixtures.reduce((s, f) => s + f.fdr, 0) / fixtures.length).toFixed(1)
    : "N/A";
  return `${player.web_name} (${pos}) | Mins: ${mins.score}/100 | xGI90: ${xgi90.toFixed(
    2
  )} | Avg FDR: ${avgFdr} | xP: ${totalXp.toFixed(1)}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MINUTES RELIABILITY (Phase 2 - PRESERVED)
   ═══════════════════════════════════════════════════════════════════════════ */

function calculateMinutesReliability(player) {
  let score = 100;
  const details = [];

  const statusPenalty = { a: 0, d: 25, i: 60, s: 40, u: 70, n: 80 };
  const penalty = statusPenalty[player.status] || 0;
  if (penalty > 0) {
    score -= penalty;
    details.push(player.status === "d" ? "Doubtful" : player.status === "i" ? "Injured" : "Unavailable");
  }

  if (player.chance_of_playing_next_round != null && player.chance_of_playing_next_round < 100) {
    score -= (100 - player.chance_of_playing_next_round) * 0.5;
    details.push(`${player.chance_of_playing_next_round}% chance`);
  }

  const gp = Math.max(1, Math.round((player.minutes || 0) / 90));
  const avgMins = gp > 0 ? (player.minutes || 0) / gp : 0;
  if (avgMins < 45) {
    score -= 20;
    details.push("Low mins");
  } else if (avgMins < 60) {
    score -= 10;
    details.push("Rotation risk");
  }

  if (player.news) {
    const nl = player.news.toLowerCase();
    if (nl.includes("knock") || nl.includes("minor")) {
      score -= 10;
      details.push("Minor concern");
    }
    if (nl.includes("rest") || nl.includes("rotation")) {
      score -= 15;
      details.push("Rotation");
    }
    if (nl.includes("returned") || nl.includes("back in training")) {
      score += 5;
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const reason = score >= 90 ? "Nailed" : score >= 70 ? "Likely starter" : score >= 50 ? "Risk" : score >= 25 ? "Major doubt" : "Unlikely";

  return { score, reason, details };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 3 + 6: XI & CAPTAIN OPTIMISER (Enhanced with manual overrides & explanations)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Calculate adjusted xP (adjXP = expectedPoints * minutesProbability)
 * and assign verdict labels for each player
 */
function calculateAdjustedXpAndVerdict(player, horizonGwCount) {
  const minutesProb = (player.xpData?.minutesReliability?.score || 100) / 100;
  const rawXp = player.rawXp || player.xp || 0;
  const adjXp = rawXp * minutesProb;

  // Determine verdict based on adjusted xP and context
  let verdict = VERDICTS.START;
  const avgAdjXpPerGw = adjXp / horizonGwCount;
  const minsScore = player.xpData?.minutesReliability?.score || 100;

  if (minsScore >= 95 && avgAdjXpPerGw >= 3.5) {
    verdict = VERDICTS.LOCK;
  } else if (avgAdjXpPerGw >= 2.5 || (minsScore >= 85 && avgAdjXpPerGw >= 2)) {
    verdict = VERDICTS.START;
  } else if (avgAdjXpPerGw >= 1.5 || minsScore >= 70) {
    verdict = VERDICTS.BENCH;
  } else if (avgAdjXpPerGw >= 0.8 || minsScore >= 40) {
    verdict = VERDICTS.SELL_WATCH;
  } else {
    verdict = VERDICTS.SELL;
  }

  // Override verdict based on status flags
  if (player.status === 'i' || player.status === 's') {
    verdict = VERDICTS.SELL;
  } else if (player.status === 'd' && minsScore < 50) {
    verdict = VERDICTS.SELL_WATCH;
  }

  return { adjXp, verdict };
}

/**
 * Generate explanation for why a player is benched
 */
function getBenchingReason(player, xiPlayers, objectiveConfig) {
  const reasons = [];
  const minsScore = player.xpData?.minutesReliability?.score || 0;
  const posType = player.element_type;
  const posName = ({ 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" })[posType] || "?";

  // Check if it's a formation constraint
  const xiByPos = { 1: 0, 2: 0, 3: 0, 4: 0 };
  xiPlayers.forEach(p => xiByPos[p.element_type]++);

  // Formation limits
  const maxByPos = { 1: 1, 2: 5, 3: 5, 4: 3 };
  const minByPos = { 1: 1, 2: 3, 3: 2, 4: 1 };

  if (posType === 1 && xiByPos[1] >= 1) {
    reasons.push("Formation: only 1 GKP allowed");
  } else if (xiByPos[posType] >= maxByPos[posType]) {
    reasons.push(`Formation: max ${maxByPos[posType]} ${posName}s reached`);
  }

  // Low minutes probability
  if (minsScore < 70) {
    reasons.push(`Low mins: ${minsScore}% reliability`);
  }

  // Compare to XI players of same position
  const xiSamePos = xiPlayers.filter(p => p.element_type === posType);
  if (xiSamePos.length > 0) {
    const worstXiXp = Math.min(...xiSamePos.map(p => p.xp));
    if (player.xp < worstXiXp) {
      const diff = (worstXiXp - player.xp).toFixed(1);
      reasons.push(`Opportunity cost: -${diff} xP vs worst XI ${posName}`);
    }
  }

  // Fixture difficulty
  if (player.xpData?.perGw && player.xpData.perGw.length > 0) {
    const avgFdr = player.xpData.perGw.reduce((s, f) => s + f.fdr, 0) / player.xpData.perGw.length;
    if (avgFdr > 3.5) {
      reasons.push(`Poor fixtures: avg FDR ${avgFdr.toFixed(1)}`);
    }
  }

  // Status flags
  if (player.status === 'd') reasons.push("Doubtful status");
  if (player.status === 'i') reasons.push("Injured");
  if (player.status === 's') reasons.push("Suspended");

  return reasons.length > 0 ? reasons[0] : "Lower xP than alternatives";
}

/**
 * Optimise XI with support for manual overrides
 * Returns { xi, bench, totalXp, captainCandidates, benchReasons, overrideDelta }
 */
function optimiseXI(squadWithXp, objective = null, manualOverrides = null) {
  const overrides = manualOverrides || { pinnedToXI: [], pinnedToBench: [] };
  const pinnedXISet = new Set(overrides.pinnedToXI || []);
  const pinnedBenchSet = new Set(overrides.pinnedToBench || []);

  // First, calculate without overrides for baseline comparison
  const baselineResult = optimiseXIInternal(squadWithXp, objective, null);

  // Then calculate with overrides
  const overriddenResult = optimiseXIInternal(squadWithXp, objective, overrides);

  // Calculate delta if there are overrides
  let overrideDelta = 0;
  let hasOverrides = pinnedXISet.size > 0 || pinnedBenchSet.size > 0;
  if (hasOverrides) {
    overrideDelta = baselineResult.totalXp - overriddenResult.totalXp;
  }

  return {
    ...overriddenResult,
    baselineTotalXp: baselineResult.totalXp,
    overrideDelta,
    hasOverrides,
  };
}

/**
 * Internal XI optimization logic
 */
function optimiseXIInternal(squadWithXp, objective = null, overrides = null) {
  const pinnedXISet = new Set(overrides?.pinnedToXI || []);
  const pinnedBenchSet = new Set(overrides?.pinnedToBench || []);

  // Enforce FPL formation rules: 1 GKP, 3-5 DEF, 2-5 MID, 1-3 FWD
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  squadWithXp.forEach((p) => byPos[p.element_type]?.push(p));

  // Sort each position by xP descending (already adjusted for objective)
  Object.values(byPos).forEach((arr) => arr.sort((a, b) => b.xp - a.xp));

  // Handle pinned players
  const forcedXI = squadWithXp.filter(p => pinnedXISet.has(p.id));
  const forcedBench = squadWithXp.filter(p => pinnedBenchSet.has(p.id));
  const freePool = squadWithXp.filter(p => !pinnedXISet.has(p.id) && !pinnedBenchSet.has(p.id));

  // Count forced XI by position
  const forcedByPos = { 1: 0, 2: 0, 3: 0, 4: 0 };
  forcedXI.forEach(p => forcedByPos[p.element_type]++);

  // Determine best formation by trying valid combos
  const formations = [
    [3, 4, 3],
    [3, 5, 2],
    [4, 4, 2],
    [4, 3, 3],
    [4, 5, 1],
    [5, 4, 1],
    [5, 3, 2],
    [5, 2, 3],
  ];

  let bestXI = null;
  let bestXp = -1;
  let bestFormation = null;

  for (const [dCount, mCount, fCount] of formations) {
    const neededByPos = {
      1: 1 - forcedByPos[1],
      2: dCount - forcedByPos[2],
      3: mCount - forcedByPos[3],
      4: fCount - forcedByPos[4],
    };

    // Skip if we can't satisfy formation with available free players
    const freeByPos = { 1: [], 2: [], 3: [], 4: [] };
    freePool.forEach(p => {
      if (!pinnedBenchSet.has(p.id)) {
        freeByPos[p.element_type]?.push(p);
      }
    });

    // Sort free pool by xP
    Object.values(freeByPos).forEach(arr => arr.sort((a, b) => b.xp - a.xp));

    // Check if formation is possible
    let valid = true;
    for (const pos of [1, 2, 3, 4]) {
      if (neededByPos[pos] < 0 || freeByPos[pos].length < neededByPos[pos]) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    const testXI = [
      ...forcedXI,
      ...freeByPos[1].slice(0, Math.max(0, neededByPos[1])),
      ...freeByPos[2].slice(0, Math.max(0, neededByPos[2])),
      ...freeByPos[3].slice(0, Math.max(0, neededByPos[3])),
      ...freeByPos[4].slice(0, Math.max(0, neededByPos[4])),
    ];

    const totalXp = testXI.reduce((s, p) => s + (p?.xp || 0), 0);
    if (totalXp > bestXp) {
      bestXp = totalXp;
      bestXI = testXI;
      bestFormation = [1, dCount, mCount, fCount];
    }
  }

  // Build bench from remaining (forced bench + leftover free pool)
  const xiIds = new Set((bestXI || []).map((p) => p?.id));
  const benchPlayers = [
    ...forcedBench,
    ...squadWithXp.filter((p) => !xiIds.has(p.id) && !pinnedBenchSet.has(p.id))
  ].sort((a, b) => b.xp - a.xp);

  // Generate benching reasons for all bench players
  const benchReasons = {};
  benchPlayers.forEach(p => {
    benchReasons[p.id] = getBenchingReason(p, bestXI || [], objective);
  });

  // Rank captain candidates (top 5 by xP in XI)
  const captainCandidates = [...(bestXI || [])].filter((p) => p).sort((a, b) => b.xp - a.xp).slice(0, 5);

  return {
    xi: bestXI || [],
    bench: benchPlayers,
    totalXp: bestXp,
    formation: bestFormation,
    benchReasons,
    captainCandidates,
    recommendedCaptain: captainCandidates[0],
    recommendedVice: captainCandidates[1],
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 3: TRANSFER ADVISOR (Fixed heuristics per user requirements)
   - -4 hit requires > +6 xP net gain (not +4)
   - -8 hit requires > +12 xP net gain (not +8)
   - Penalize destabilizing transfers (nailed→fringe, GK swaps, injury→injury)
   - Always compare against "Do Nothing" baseline
   ═══════════════════════════════════════════════════════════════════════════ */

async function getTransferRecommendations(currentState, horizon, bs, objective = null) {
  const squad = currentState.squad || [];
  const freeTransfers = currentState.freeTransfers || 1;
  const bank = currentState.bank || 0;
  const objectiveId = objective?.id;

  // Calculate xP for all squad
  const squadWithXp = [];
  for (const p of squad) {
    const xp = await calculateExpectedPoints(p, horizon, bs);
    squadWithXp.push({ ...p, xp: xp.total, xpData: xp });
  }

  // Find worst performers (exclude GKs unless severe issue)
  const sortedByXp = [...squadWithXp].sort((a, b) => a.xp - b.xp);

  // Get potential targets
  const elements = bs.elements || [];
  const teams = bs.teams || [];
  const squadIds = new Set(squad.map((p) => p.id));
  const squadTeams = squad.map((p) => p.team);

  const recommendations = [];

  // Only consider bottom performers with actual issues
  const candidates = sortedByXp
    .filter((p) => {
      if (p.element_type === 1 && p.status === "a") return false; // Skip GKs unless injured/suspended
      if (p.xp > horizon * 3) return false; // Skip decent xP
      return true;
    })
    .slice(0, 4);

  for (const outPlayer of candidates) {
    const budget = (outPlayer.now_cost || 0) + bank;
    const outMinsReliability = outPlayer.xpData?.minutesReliability?.score || 100;

    // Find alternatives at same position
    const alternatives = elements.filter(
      (p) =>
        p.element_type === outPlayer.element_type &&
        !squadIds.has(p.id) &&
        p.status === "a" &&
        p.now_cost <= budget &&
        p.minutes > 180 // At least 2 full games
    );

    // Calculate xP for alternatives with sanity checks
    const altsWithXp = [];
    for (const alt of alternatives.slice(0, 15)) {
      const xp = await calculateExpectedPoints(alt, horizon, bs);
      const inMinsReliability = xp.minutesReliability?.score || 0;
      let xpGain = xp.total - outPlayer.xp;

      // SANITY PENALTIES:
      if (outMinsReliability > 80 && inMinsReliability < 60) xpGain -= 2; // nailed -> fringe
      if (outPlayer.element_type === 1) xpGain -= 1.5; // GK transfers
      if (alt.chance_of_playing_next_round != null && alt.chance_of_playing_next_round < 75) xpGain -= 2; // injury risk
      const sameTeamCount = squadTeams.filter((t) => t === alt.team).length;
      if (sameTeamCount >= 2) xpGain -= 0.5; // concentration risk

      const teamName = teams.find((t) => t.id === alt.team)?.short_name || "???";

      // Build why-out and why-in explanations
      const whyOut = [];
      if (outPlayer.status !== "a") whyOut.push(getFlagReason(outPlayer));
      if (outMinsReliability < 70) whyOut.push("rotation risk");
      if (outPlayer.xp < horizon * 2) whyOut.push(`low xP (${outPlayer.xp.toFixed(1)})`);

      const whyIn = [];
      if (xp.total > outPlayer.xp) whyIn.push(`+${(xp.total - outPlayer.xp).toFixed(1)} xP`);
      if (inMinsReliability > 80) whyIn.push("nailed");
      if (alt.form > 5) whyIn.push(`form: ${alt.form}`);

      altsWithXp.push({
        ...alt,
        xp: xp.total,
        xpData: xp,
        teamName,
        xpGain,
        rawXpGain: xp.total - outPlayer.xp,
        whyOut: whyOut.join(", ") || "underperforming",
        whyIn: whyIn.join(", ") || "better option",
        breakEvenGw: xpGain > 0 ? Math.ceil(4 / xpGain) : "N/A",
      });
    }

    // Best alternative (after penalties)
    altsWithXp.sort((a, b) => b.xpGain - a.xpGain);
    const best = altsWithXp[0];

    // Only recommend if gain is meaningful (>1.5 xP after penalties)
    if (best && best.xpGain > 1.5) {
      recommendations.push({
        out: outPlayer,
        in: best,
        xpGain: best.xpGain,
        rawXpGain: best.rawXpGain,
        costChange: best.now_cost - outPlayer.now_cost,
        whyOut: best.whyOut,
        whyIn: best.whyIn,
        breakEvenGw: best.breakEvenGw,
      });
    }
  }

  // Sort by xP gain (after penalties)
  recommendations.sort((a, b) => b.xpGain - a.xpGain);

  // CONSERVATIVE HIT LOGIC:
  let action = "Hold";
  let actionDetail = "Do nothing. Current squad is optimal or no transfers clear the threshold.";
  let transfers = [];
  let netGain = 0;
  let hitCost = 0;

  if (recommendations.length > 0) {
    const best = recommendations[0];

    // Use free transfer if meaningful gain
    if (freeTransfers >= 1 && best.xpGain > 2) {
      action = "Make 1 Free Transfer";
      actionDetail = `${best.out.web_name} → ${best.in.web_name} (+${best.xpGain.toFixed(1)} xP). Why: ${best.whyOut} → ${best.whyIn}`;
      transfers = [best];
      netGain = best.xpGain;
    }

    // -4 hit: only if combined gain > 6 (so net after hit > 2)
    if (freeTransfers === 1 && recommendations.length > 1) {
      const second = recommendations[1];
      const totalGain = best.xpGain + second.xpGain;
      if (totalGain > 6) {
        action = "Consider -4 Hit";
        actionDetail = `2 transfers: ${best.out.web_name}→${best.in.web_name}, ${second.out.web_name}→${second.in.web_name}. Gain: ${totalGain.toFixed(1)} xP − 4 = +${(totalGain - 4).toFixed(1)} net`;
        transfers = [best, second];
        netGain = totalGain - 4;
        hitCost = 4;
      }
    }

    // -8 hit: only if combined gain > 12 (so net after hit > 4)
    if (freeTransfers === 1 && recommendations.length > 2) {
      const totalGain = recommendations.slice(0, 3).reduce((s, r) => s + r.xpGain, 0);
      if (totalGain > 12) {
        action = "Consider -8 Hit";
        const names = recommendations.slice(0, 3).map((r) => `${r.out.web_name}→${r.in.web_name}`).join(", ");
        actionDetail = `3 transfers: ${names}. Gain: ${totalGain.toFixed(1)} xP − 8 = +${(totalGain - 8).toFixed(1)} net`;
        transfers = recommendations.slice(0, 3);
        netGain = totalGain - 8;
        hitCost = 8;
      }
    }
  }

  // Always include "Do Nothing" baseline
  const doNothingXp = squadWithXp.filter((p) => !p.isBench).reduce((s, p) => s + p.xp, 0);

  return {
    action,
    actionDetail,
    transfers,
    netGain,
    hitCost,
    freeTransfers,
    doNothingXp,
    allRecommendations: recommendations.slice(0, 5),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 3: CHIP RECOMMENDATION ENGINE
   ═══════════════════════════════════════════════════════════════════════════ */

async function getChipRecommendation(currentState, horizon, bs, squadWithXp, optimised) {
  const available = currentState.chipsAvailable || [];
  if (available.length === 0) return { chip: null, reason: "No chips remaining" };

  const recommendations = [];

  // BENCH BOOST check
  if (available.includes("bboost")) {
    const benchXp = optimised.bench.reduce((s, p) => s + (p?.xp || 0), 0);
    const avgBenchMins =
      optimised.bench.reduce((s, p) => s + (p?.xpData?.minutesReliability?.score || 0), 0) /
      Math.max(optimised.bench.length, 1);

    if (benchXp > 12 && avgBenchMins > 70) {
      recommendations.push({
        chip: "bboost",
        name: "Bench Boost",
        reason: `Strong bench (${benchXp.toFixed(1)} xP) with high minutes certainty (${avgBenchMins.toFixed(0)}%)`,
        expectedGain: benchXp,
        confidence: avgBenchMins > 80 ? "High" : "Medium",
      });
    }
  }

  // TRIPLE CAPTAIN check
  if (available.includes("3xc")) {
    const captain = optimised.recommendedCaptain;
    if (captain && captain.xp > 8) {
      const minsScore = captain.xpData?.minutesReliability?.score || 0;
      if (minsScore > 85) {
        recommendations.push({
          chip: "3xc",
          name: "Triple Captain",
          reason: `${captain.web_name} has high ceiling (${captain.xp.toFixed(1)} xP) and is nailed (${minsScore}%)`,
          expectedGain: captain.xp,
          confidence: minsScore > 90 ? "High" : "Medium",
        });
      }
    }
  }

  // FREE HIT check
  if (available.includes("freehit")) {
    const flaggedCount = currentState.flaggedPlayers?.length || 0;
    if (flaggedCount >= 3) {
      recommendations.push({
        chip: "freehit",
        name: "Free Hit",
        reason: `${flaggedCount} flagged players - squad misaligned for this GW`,
        expectedGain: flaggedCount * 3,
        confidence: "Medium",
      });
    }
  }

  // WILDCARD check
  if (available.includes("wildcard")) {
    const lowXpCount = squadWithXp.filter((p) => p.xp < 3).length;
    if (lowXpCount >= 5) {
      recommendations.push({
        chip: "wildcard",
        name: "Wildcard",
        reason: `${lowXpCount} underperforming assets - structural rebuild needed`,
        expectedGain: lowXpCount * 2,
        confidence: "Medium",
      });
    }
  }

  recommendations.sort((a, b) => b.expectedGain - a.expectedGain);
  if (recommendations.length === 0) return { chip: null, reason: "No chip recommended this GW. Save for better opportunity." };
  return recommendations[0];
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD UI RENDERING (Phase 3 - NEW LAYOUT)
   ═══════════════════════════════════════════════════════════════════════════ */

export async function renderStatPicker(main) {
  main.innerHTML = "";
  const page = utils.el("div", { class: "sp-dashboard" });
  main.appendChild(page);

  if (!isUnlocked()) {
    renderPasswordGate(page);
    return;
  }

  renderDashboard(page);
}

function isDevMode() {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.FPL_DEV_MODE === true;
}

function renderPasswordGate(container) {
  const devModeHtml = isDevMode()
    ? `
    <div class="sp-gate-dev">
      <button id="gateDevBtn" class="sp-btn-link">Dev Unlock</button>
    </div>
  `
    : "";

  container.innerHTML = `
    <div class="sp-gate">
      <div class="sp-gate-card">
        <div class="sp-gate-icon">🔒</div>
        <h2>Stat Picker</h2>
        <p>Enter password to access.</p>
        <div class="sp-gate-form">
          <input type="password" id="gatePassword" placeholder="Password" autocomplete="off" />
          <button id="gateUnlockBtn" class="btn-primary">Unlock</button>
        </div>
        <p id="gateCapsHint" class="sp-gate-caps" style="display:none;">⚠️ Caps Lock is on</p>
        <p id="gateError" class="sp-gate-error" style="display:none;">Incorrect password</p>
        ${devModeHtml}
      </div>
    </div>
  `;

  const input = container.querySelector("#gatePassword");
  const btn = container.querySelector("#gateUnlockBtn");
  const error = container.querySelector("#gateError");
  const capsHint = container.querySelector("#gateCapsHint");
  const devBtn = container.querySelector("#gateDevBtn");

  const tryUnlock = () => {
    const inputValue = input.value.trim().toLowerCase();
    const password = GATE_PASSWORD.toLowerCase();

    if (inputValue === password) {
      unlock();
      container.innerHTML = "";
      renderDashboard(container);
    } else {
      error.style.display = "block";
      capsHint.style.display = "none";
      input.value = "";
      input.focus();
    }
  };

  const checkCapsLock = (e) => {
    if (e.getModifierState && e.getModifierState("CapsLock")) capsHint.style.display = "block";
    else capsHint.style.display = "none";
  };

  btn.onclick = tryUnlock;
  input.onkeydown = (e) => {
    checkCapsLock(e);
    if (e.key === "Enter") tryUnlock();
  };
  input.onkeyup = checkCapsLock;

  if (devBtn) {
    devBtn.onclick = () => {
      unlock();
      container.innerHTML = "";
      renderDashboard(container);
    };
  }

  input.focus();
}

/**
 * Get saved horizon from localStorage or default
 */
function getSavedHorizon() {
  const saved = getJSON(STORAGE_KEY_HORIZON);
  return saved || HORIZONS.NEXT_3.id;
}

/**
 * Get saved objective from localStorage or default
 */
function getSavedObjective() {
  const saved = getJSON(STORAGE_KEY_OBJECTIVE);
  return saved || OBJECTIVES.MAX_POINTS.id;
}

/**
 * Format timestamp as HH:MM:SS
 */
function formatTime(date) {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Get saved captain mode from localStorage or default
 */
function getSavedCaptainMode() {
  const saved = getJSON(STORAGE_KEY_CAPTAIN_MODE);
  return saved || CAPTAIN_MODES.CONSERVATIVE.id;
}

/**
 * Get saved manual overrides from localStorage or default
 */
function getSavedManualOverrides() {
  const saved = getJSON(STORAGE_KEY_MANUAL_OVERRIDES);
  return saved || { pinnedToXI: [], pinnedToBench: [] };
}

/**
 * Main dashboard state - tracks loaded context, current settings, and recalc time
 */
let dashboardState = {
  context: null,
  dependencyStatus: {},
  horizon: null,
  objective: null,
  captainMode: null,
  manualOverrides: { pinnedToXI: [], pinnedToBench: [] },
  lastRecalculated: null,
  optimisedData: null,
};

async function renderDashboard(container) {
  // Load saved preferences
  const savedHorizon = getSavedHorizon();
  const savedObjective = getSavedObjective();
  const savedCaptainMode = getSavedCaptainMode();
  const savedManualOverrides = getSavedManualOverrides();

  dashboardState.horizon = savedHorizon;
  dashboardState.objective = savedObjective;
  dashboardState.captainMode = savedCaptainMode;
  dashboardState.manualOverrides = savedManualOverrides;

  container.innerHTML = `
    <div class="sp-header">
      <div class="sp-header-left">
        <h1>Stat Picker</h1>
        <span class="sp-tagline">FPL Decision Engine</span>
      </div>
      <div class="sp-header-right">
        <div class="sp-control-group">
          <label class="sp-control-label">Horizon</label>
          <select id="horizonSel" class="sp-select">
            ${Object.values(HORIZONS).map(h => `<option value="${h.id}" ${h.id === savedHorizon ? "selected" : ""}>${h.label}</option>`).join("")}
          </select>
        </div>
        <div class="sp-control-group">
          <label class="sp-control-label">Objective</label>
          <select id="objectiveSel" class="sp-select sp-select-wide">
            ${Object.values(OBJECTIVES).map(o => `<option value="${o.id}" ${o.id === savedObjective ? "selected" : ""} title="${o.description}">${o.label}</option>`).join("")}
          </select>
        </div>
        <button id="refreshBtn" class="sp-btn" title="Refresh all data">Refresh</button>
        <button id="lockBtn" class="sp-btn sp-btn-danger" title="Lock stat picker">Lock</button>
      </div>
    </div>
    <div id="spSnapshotCard" class="sp-snapshot-container"></div>
    <div id="spRecalcBanner" class="sp-recalc-banner" style="display:none;"></div>
    <div class="sp-grid" id="spContent">
      <div class="sp-loading">
        <div class="sp-loading-spinner"></div>
        <div class="sp-loading-text">Loading context...</div>
      </div>
    </div>
  `;

  container.querySelector("#lockBtn").onclick = () => {
    lock();
    container.innerHTML = "";
    renderPasswordGate(container);
  };

  const horizonSel = container.querySelector("#horizonSel");
  const objectiveSel = container.querySelector("#objectiveSel");
  const recalcBanner = container.querySelector("#spRecalcBanner");
  const content = container.querySelector("#spContent");

  // Initial load with context pipeline
  const initialLoad = async () => {
    content.innerHTML = `
      <div class="sp-loading">
        <div class="sp-loading-spinner"></div>
        <div class="sp-loading-text">Loading context...</div>
        <div id="depChecklist" class="sp-dep-checklist"></div>
      </div>
    `;

    const depChecklist = content.querySelector("#depChecklist");

    // Render initial dependency checklist
    renderDependencyChecklist(depChecklist, {}, true);

    // Load context
    const result = await loadContext({ forceRefresh: false });

    dashboardState.context = result.context;
    dashboardState.dependencyStatus = result.dependencyStatus;

    if (result.ok) {
      await renderOptimisedDashboard(content, recalcBanner);
    } else if (result.needsEntryId) {
      renderNoEntryId(content);
    } else {
      // Degraded mode - show dependency checklist with retry options
      renderDegradedMode(content, result, container);
    }
  };

  // Recompute when horizon/objective changes
  const recompute = async () => {
    const newHorizon = horizonSel.value;
    const newObjective = objectiveSel.value;

    // Save preferences
    setJSON(STORAGE_KEY_HORIZON, newHorizon);
    setJSON(STORAGE_KEY_OBJECTIVE, newObjective);

    dashboardState.horizon = newHorizon;
    dashboardState.objective = newObjective;

    // Show recalculating state
    content.classList.add("sp-recalculating");

    // Recompute with new settings
    await renderOptimisedDashboard(content, recalcBanner);

    content.classList.remove("sp-recalculating");
  };

  // Full refresh
  const fullRefresh = async () => {
    content.innerHTML = `
      <div class="sp-loading">
        <div class="sp-loading-spinner"></div>
        <div class="sp-loading-text">Refreshing data...</div>
      </div>
    `;
    recalcBanner.style.display = "none";

    const result = await loadContext({ forceRefresh: true });
    dashboardState.context = result.context;
    dashboardState.dependencyStatus = result.dependencyStatus;

    if (result.ok) {
      await renderOptimisedDashboard(content, recalcBanner);
    } else if (result.needsEntryId) {
      renderNoEntryId(content);
    } else {
      renderDegradedMode(content, result, container);
    }
  };

  container.querySelector("#refreshBtn").onclick = fullRefresh;
  horizonSel.onchange = recompute;
  objectiveSel.onchange = recompute;

  await initialLoad();
}

/**
 * Render dependency checklist showing status of each data source
 */
function renderDependencyChecklist(container, status, isLoading = false) {
  const deps = Object.values(DEPENDENCIES);

  const rows = deps.map(dep => {
    const depStatus = status[dep.id] || { status: DEPENDENCY_STATUS.PENDING };
    const statusClass = `sp-dep-${depStatus.status}`;
    const statusIcon = getStatusIcon(depStatus.status);
    const optional = !dep.required ? '<span class="sp-dep-optional">(optional)</span>' : "";
    const errorBadge = depStatus.error
      ? `<button class="sp-dep-error" type="button" data-tooltip="${depStatus.error}" aria-label="${dep.label} error: ${depStatus.error}">!</button>`
      : "";

    return `
      <div class="sp-dep-row ${statusClass}">
        <span class="sp-dep-icon">${statusIcon}</span>
        <span class="sp-dep-label">${dep.label} ${optional}</span>
        ${depStatus.fromCache ? '<span class="sp-dep-cache">cached</span>' : ""}
        ${errorBadge}
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="sp-dep-checklist-inner">
      ${rows}
    </div>
  `;
}

function getStatusIcon(status) {
  switch (status) {
    case DEPENDENCY_STATUS.SUCCESS: return "✓";
    case DEPENDENCY_STATUS.CACHED: return "◎";
    case DEPENDENCY_STATUS.FAILED: return "✗";
    case DEPENDENCY_STATUS.LOADING: return "◌";
    default: return "○";
  }
}

/**
 * Render the no entry ID state
 */
function renderNoEntryId(container) {
  container.innerHTML = `
    <div class="sp-error-full">
      <h3>No Entry ID</h3>
      <p>Set your FPL Entry ID in the sidebar to see your team state.</p>
    </div>
  `;
}

/**
 * Render degraded mode with dependency failures and retry options
 */
function renderDegradedMode(container, result, parentContainer) {
  const { failures, dependencyStatus, context } = result;
  const uniqueFailures = Array.from(new Map(
    failures.map(f => [f.dependency.id, f])
  ).values());

  // Check if we can fallback to cached context
  const cachedResult = loadCachedContext();

  let cacheInfo = "";
  if (cachedResult.ok) {
    const cacheAgeMin = Math.round(cachedResult.cacheAge / 60000);
    cacheInfo = `
      <div class="sp-cache-fallback">
        <div class="sp-cache-fallback-header">
          <span class="sp-cache-icon">💾</span>
          <span>Cached context available (${cacheAgeMin}m old)</span>
        </div>
        <button id="useCacheBtn" class="sp-btn sp-btn-primary">Use Cached Data</button>
      </div>
    `;
  }

  const failureRows = uniqueFailures.map(f => `
    <div class="sp-failure-row">
      <span class="sp-failure-label">${f.dependency.label}</span>
      <span class="sp-failure-error">${f.error}</span>
      ${f.dependency.retryable ? `<button class="sp-btn sp-btn-small sp-retry-btn" data-dep="${f.dependency.id}">Retry</button>` : ""}
    </div>
  `).join("");

  container.innerHTML = `
    <div class="sp-degraded-mode">
      <div class="sp-degraded-header">
        <span class="sp-degraded-icon">⚠️</span>
        <h3>Some data could not be loaded</h3>
      </div>

      <div class="sp-dep-status-panel">
        <h4>Dependency Status</h4>
        <div id="depStatusList" class="sp-dep-checklist"></div>
      </div>

      <div class="sp-failures-panel">
        <h4>Failures</h4>
        ${failureRows}
      </div>

      ${cacheInfo}

      <div class="sp-degraded-actions">
        <button id="retryAllBtn" class="sp-btn sp-btn-primary">Retry All</button>
      </div>

      ${context && context.squad && context.squad.length > 0 ? `
        <div class="sp-partial-data">
          <h4>Partial Data Available</h4>
          <p>Squad loaded with ${context.squad.length} players. Some features may be limited.</p>
          ${!context.predictionsAvailable ? '<p class="sp-warning-text">⚠️ Predictions unavailable - showing squad and fixtures only.</p>' : ""}
          <button id="continuePartialBtn" class="sp-btn">Continue with Partial Data</button>
        </div>
      ` : ""}
    </div>
  `;

  // Render dependency checklist
  const depStatusList = container.querySelector("#depStatusList");
  renderDependencyChecklist(depStatusList, dependencyStatus);

  // Wire up retry buttons
  container.querySelectorAll(".sp-retry-btn").forEach(btn => {
    btn.onclick = async () => {
      const depId = btn.dataset.dep;
      btn.disabled = true;
      btn.textContent = "Retrying...";

      const retryResult = await loadContext({ retryDependency: depId });

      if (retryResult.ok) {
        dashboardState.context = retryResult.context;
        dashboardState.dependencyStatus = retryResult.dependencyStatus;
        const recalcBanner = parentContainer.querySelector("#spRecalcBanner");
        await renderOptimisedDashboard(container, recalcBanner);
      } else {
        // Update the degraded mode view
        renderDegradedMode(container, retryResult, parentContainer);
      }
    };
  });

  // Retry all button
  const retryAllBtn = container.querySelector("#retryAllBtn");
  if (retryAllBtn) {
    retryAllBtn.onclick = async () => {
      const retryResult = await loadContext({ forceRefresh: true });
      dashboardState.context = retryResult.context;
      dashboardState.dependencyStatus = retryResult.dependencyStatus;

      if (retryResult.ok) {
        const recalcBanner = parentContainer.querySelector("#spRecalcBanner");
        await renderOptimisedDashboard(container, recalcBanner);
      } else {
        renderDegradedMode(container, retryResult, parentContainer);
      }
    };
  }

  // Use cache button
  const useCacheBtn = container.querySelector("#useCacheBtn");
  if (useCacheBtn && cachedResult.ok) {
    useCacheBtn.onclick = async () => {
      // Merge cached context with bootstrap
      const bs = state.bootstrap || (await legacyApi.bootstrap());
      dashboardState.context = { ...cachedResult.context, bootstrap: bs };
      const recalcBanner = parentContainer.querySelector("#spRecalcBanner");
      await renderOptimisedDashboard(container, recalcBanner);
    };
  }

  // Continue with partial data
  const continuePartialBtn = container.querySelector("#continuePartialBtn");
  if (continuePartialBtn && context) {
    continuePartialBtn.onclick = async () => {
      const recalcBanner = parentContainer.querySelector("#spRecalcBanner");
      await renderOptimisedDashboard(container, recalcBanner);
    };
  }
}

/**
 * Render the optimised dashboard with current horizon/objective settings
 * This is the main render function for the Phase 5 + 6 architecture
 */
async function renderOptimisedDashboard(container, recalcBanner) {
  try {
    const context = dashboardState.context;
    if (!context || !context.squad || context.squad.length === 0) {
      container.innerHTML = `<div class="sp-error-full"><h3>No Data</h3><p>Failed to load squad data. Try refreshing.</p></div>`;
      return;
    }

    const bs = context.bootstrap || state.bootstrap;
    if (!bs) {
      container.innerHTML = `<div class="sp-error-full"><h3>No Bootstrap</h3><p>Failed to load game data. Try refreshing.</p></div>`;
      return;
    }

    // Get horizon settings
    const horizonId = dashboardState.horizon || HORIZONS.NEXT_3.id;
    const horizonConfig = Object.values(HORIZONS).find(h => h.id === horizonId) || HORIZONS.NEXT_3;
    const horizonGwCount = horizonConfig.gwCount;

    // Get objective settings
    const objectiveId = dashboardState.objective || OBJECTIVES.MAX_POINTS.id;
    const objectiveConfig = Object.values(OBJECTIVES).find(o => o.id === objectiveId) || OBJECTIVES.MAX_POINTS;

    // Get captain mode settings
    const captainModeId = dashboardState.captainMode || CAPTAIN_MODES.CONSERVATIVE.id;
    const captainModeConfig = Object.values(CAPTAIN_MODES).find(m => m.id === captainModeId) || CAPTAIN_MODES.CONSERVATIVE;

    // Get manual overrides
    const manualOverrides = dashboardState.manualOverrides || { pinnedToXI: [], pinnedToBench: [] };

    // Check if predictions are available
    const predictionsAvailable = context.predictionsAvailable !== false;

    // Calculate xP for all squad members (respecting objective)
    const squadWithXp = [];
    for (const p of context.squad) {
      if (predictionsAvailable) {
        const xp = await calculateExpectedPoints(p, horizonGwCount, bs);
        // Apply objective modifiers
        const adjustedXp = applyObjectiveModifiers(xp, p, objectiveConfig);
        // Calculate adjusted xP and verdict
        const { adjXp, verdict } = calculateAdjustedXpAndVerdict({ ...p, xp: adjustedXp.total, xpData: adjustedXp, rawXp: xp.total }, horizonGwCount);
        squadWithXp.push({ ...p, xp: adjustedXp.total, xpData: adjustedXp, rawXp: xp.total, adjXp, verdict });
      } else {
        // Fallback: use points from bootstrap
        squadWithXp.push({ ...p, xp: 0, xpData: null, rawXp: 0, adjXp: 0, verdict: VERDICTS.START });
      }
    }

    // Optimise XI with objective and manual overrides
    const optimised = optimiseXI(squadWithXp, objectiveConfig, manualOverrides);

    // Get transfer recommendations using SINGLE canonical source
    // Phase 11: Unified recommendation system - both snapshot and sidebar use same result
    let canonicalTransferResult = null;
    let transferOptimizerHtml = "";
    if (predictionsAvailable) {
      try {
        // Single canonical source for all transfer recommendations
        canonicalTransferResult = await runTransferOptimization(context, { horizonGwCount });

        // Render the transfer optimizer UI using the canonical result
        transferOptimizerHtml = await renderTransferOptimizer(context, { horizonGwCount });

        // Debug logging for recommendation verification
        if (window.__DEBUG_RECS__) {
          const snapshotTransfer = extractSnapshotTransfer(canonicalTransferResult);
          const sidebarTransfer = canonicalTransferResult?.recommendations?.best?.transfers?.[0];
          console.log("[DEBUG_RECS] Canonical Transfer Recommendation:", {
            computedAt: new Date().toISOString(),
            horizon: horizonGwCount,
            objective: objectiveConfig?.id,
            snapshotTransfer: snapshotTransfer ? `${snapshotTransfer.out} → ${snapshotTransfer.in}` : "None",
            sidebarTransfer: sidebarTransfer ? `${sidebarTransfer.out?.player?.web_name} → ${sidebarTransfer.in?.player?.web_name}` : "None",
            action: canonicalTransferResult?.recommendations?.action,
            isUnified: true
          });
        }
      } catch (e) {
        log.warn("Transfer Optimizer failed", e);
        canonicalTransferResult = null;
        transferOptimizerHtml = "";
      }
    }

    // Get chip recommendation (only if predictions available)
    let chipRec = null;
    if (predictionsAvailable) {
      chipRec = await getChipRecommendation(context, horizonGwCount, bs, squadWithXp, optimised);
    }

    // Phase 8: Bench Order + Chip Suggestions (conservative)
    let benchChipAdvisorHtml = "";
    if (predictionsAvailable) {
      try {
        benchChipAdvisorHtml = await renderBenchChipAdvisor(context);
      } catch (e) {
        log.warn("Bench/Chip Advisor failed", e);
        benchChipAdvisorHtml = "";
      }
    }

    // Calculate captain candidates with mode-specific scoring
    const captainData = calculateCaptainCandidates(optimised.xi, captainModeConfig, objectiveConfig);

    // Update recalculation timestamp
    dashboardState.lastRecalculated = new Date();
    // Phase 11: Store canonical transfer result for unified recommendation access
    dashboardState.optimisedData = {
      squadWithXp,
      optimised,
      canonicalTransferResult, // Single source of truth for transfers
      chipRec,
      captainData,
      horizonGwCount // Store horizon for display
    };

    // Render snapshot card (6.1)
    const snapshotContainer = document.getElementById("spSnapshotCard");
    if (snapshotContainer && predictionsAvailable) {
      snapshotContainer.innerHTML = renderGameweekSnapshot(context, optimised, captainData, chipRec, dashboardState);
    }

    // Show recalc banner
    if (recalcBanner) {
      recalcBanner.innerHTML = `
        <span class="sp-recalc-icon">✓</span>
        <span class="sp-recalc-text">Recalculated at ${formatTime(dashboardState.lastRecalculated)}</span>
        <span class="sp-recalc-settings">${horizonConfig.label} · ${objectiveConfig.label}</span>
      `;
      recalcBanner.style.display = "flex";
    }

    // Build the dashboard
    const predictionsWarning = !predictionsAvailable ? `
      <div class="sp-predictions-warning">
        <span class="sp-warning-icon">⚠️</span>
        <span>Predictions unavailable - showing squad and fixtures only</span>
      </div>
    ` : "";

    container.innerHTML = `
      ${predictionsWarning}
      <div class="sp-col sp-col-left">
        ${renderStatePanel(context)}
        ${renderFlagsPanel(context)}
        ${benchChipAdvisorHtml || (chipRec ? renderChipPanel(chipRec, context) : renderChipPanelUnavailable())}
      </div>
      <div class="sp-col sp-col-center">
        ${renderSquadRankingPanel(squadWithXp, optimised, horizonGwCount, objectiveConfig, manualOverrides, context)}
        ${renderCaptainDecisionPanel(captainData, optimised, captainModeConfig, objectiveConfig)}
      </div>
      <div class="sp-col sp-col-right">
        ${transferOptimizerHtml || (transfers ? renderTransferPanel(transfers) : renderTransferPanelUnavailable())}
        ${renderFixturesPanel(context, horizonGwCount)}
        ${renderAssumptionsPanel(objectiveConfig)}
      </div>
    `;

    // Wire up interactive elements
    wireUpSquadInteractions(container, squadWithXp, horizonGwCount, objectiveConfig);
    wireUpCaptainModeToggle(container);
    wireUpSnapshotRefresh();

    // Phase 7: Wire up Transfer Optimizer interactions
    if (transferOptimizerHtml) {
      const refreshTransferOptimizer = async () => {
        const recalcBanner = document.getElementById('spRecalcBanner');
        await renderOptimisedDashboard(container, recalcBanner);
      };
      wireUpTransferOptimizer(container, context, refreshTransferOptimizer);
    }

    // Phase 8: Wire up Bench/Chip Advisor interactions
    if (benchChipAdvisorHtml) {
      wireUpBenchChipAdvisor(container);
    }

    // Update page timestamp
    setPageUpdated("stat-picker");

  } catch (err) {
    log.error("Stat Picker: Dashboard error", err);
    container.innerHTML = `<div class="sp-error-full"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 6.1: GAMEWEEK SNAPSHOT CARD
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Generate headline stance based on current state
 * Phase 11: Uses canonical transfer result for unified recommendations
 */
function generateHeadlineStance(context, optimised, captainData, chipRec, dashboardState) {
  const flaggedCount = context.flaggedPlayers?.length || 0;
  const freeTransfers = context.freeTransfers || 0;
  const overrideDelta = optimised.overrideDelta || 0;

  // Phase 11: Extract transfer from canonical result (same source as sidebar)
  const canonicalResult = dashboardState.optimisedData?.canonicalTransferResult;
  const snapshotTransfer = extractSnapshotTransfer(canonicalResult);
  const horizonLabel = dashboardState.optimisedData?.horizonGwCount
    ? `Next ${dashboardState.optimisedData.horizonGwCount}`
    : "";

  // Priority order for headline
  if (flaggedCount >= 3) {
    return { text: "Squad in crisis - consider Free Hit or multiple transfers", severity: "danger" };
  }
  if (chipRec?.chip === "bboost" && chipRec.confidence === "High") {
    return { text: `Strong Bench Boost opportunity (+${chipRec.expectedGain.toFixed(1)} xP)`, severity: "success" };
  }
  if (chipRec?.chip === "3xc" && chipRec.confidence === "High") {
    return { text: `Triple Captain ${captainData.recommended?.web_name || ""} looks promising`, severity: "success" };
  }
  if (flaggedCount > 0 && freeTransfers === 0) {
    return { text: `${flaggedCount} flagged but 0 FT - monitor news closely`, severity: "warning" };
  }
  // Phase 11: Use unified canonical transfer for snapshot headline
  if (snapshotTransfer) {
    const hitLabel = snapshotTransfer.action === "hit" ? " (hit)" : "";
    return {
      text: `Transfer recommended${hitLabel}: ${snapshotTransfer.out} → ${snapshotTransfer.in}`,
      severity: "info",
      horizonLabel // For display if needed
    };
  }
  if (overrideDelta > 2) {
    return { text: `Manual overrides costing -${overrideDelta.toFixed(1)} xP vs optimal`, severity: "warning" };
  }
  if (flaggedCount === 0 && freeTransfers >= 1) {
    return { text: "Squad looks good - hold transfers or bank for future GWs", severity: "success" };
  }
  return { text: "Review squad and make decisions before deadline", severity: "neutral" };
}

/**
 * Render the Gameweek Snapshot card (6.1)
 */
function renderGameweekSnapshot(context, optimised, captainData, chipRec, dashboardState) {
  const xiXp = optimised.totalXp || 0;
  const benchXp = optimised.bench.reduce((s, p) => s + (p?.xp || 0), 0);

  // Captain gain calculation
  const recCaptain = captainData.recommended;
  const safeCaptain = captainData.candidates.find(c =>
    (c.xpData?.minutesReliability?.score || 0) >= 90
  ) || captainData.candidates[0];
  const captainGain = recCaptain && safeCaptain && recCaptain.id !== safeCaptain.id
    ? (recCaptain.xp - safeCaptain.xp).toFixed(1)
    : "0.0";

  // Chips display
  const chipsAvail = (context.chipsAvailable || []).map(formatChipName).join(", ") || "None";

  // Headline stance - Phase 11: Now uses dashboardState for unified canonical transfer
  const headline = generateHeadlineStance(context, optimised, captainData, chipRec, dashboardState);

  // Last updated time
  const lastUpdated = dashboardState.lastRecalculated
    ? formatTime(dashboardState.lastRecalculated)
    : "Never";

  // Override warning
  const overrideWarning = optimised.hasOverrides && optimised.overrideDelta > 0
    ? `<div class="sp-snap-override-warn">Manual overrides: -${optimised.overrideDelta.toFixed(1)} xP vs optimal</div>`
    : "";

  return `
    <div class="sp-snapshot-card">
      <div class="sp-snap-header">
        <div class="sp-snap-title">GW${context.nextGw || context.currentGw} Snapshot</div>
        <div class="sp-snap-actions">
          <span class="sp-snap-updated">Updated ${lastUpdated}</span>
          <button id="snapRefreshBtn" class="sp-btn sp-btn-small" title="Refresh data">Refresh</button>
        </div>
      </div>
      <div class="sp-snap-metrics">
        <div class="sp-snap-metric">
          <span class="sp-snap-metric-val">${xiXp.toFixed(1)}</span>
          <span class="sp-snap-metric-lbl">XI xP</span>
        </div>
        <div class="sp-snap-metric">
          <span class="sp-snap-metric-val">${benchXp.toFixed(1)}</span>
          <span class="sp-snap-metric-lbl">Bench xP</span>
        </div>
        <div class="sp-snap-metric ${parseFloat(captainGain) > 0 ? 'sp-snap-metric-gain' : ''}">
          <span class="sp-snap-metric-val">${parseFloat(captainGain) > 0 ? '+' : ''}${captainGain}</span>
          <span class="sp-snap-metric-lbl">C Gain</span>
        </div>
        <div class="sp-snap-metric">
          <span class="sp-snap-metric-val">${context.freeTransfers}</span>
          <span class="sp-snap-metric-lbl">FT</span>
        </div>
        <div class="sp-snap-metric">
          <span class="sp-snap-metric-val">${context.bankFormatted}</span>
          <span class="sp-snap-metric-lbl">ITB</span>
        </div>
      </div>
      <div class="sp-snap-chips">
        <span class="sp-snap-chips-lbl">Chips:</span>
        <span class="sp-snap-chips-val">${chipsAvail}</span>
      </div>
      ${overrideWarning}
      <div class="sp-snap-headline sp-snap-headline-${headline.severity}">
        ${headline.text}
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 6.2: SQUAD RANKING PANEL WITH MANUAL OVERRIDES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build fixture strip for a player
 */
function buildFixtureStrip(player, context, horizonGwCount) {
  if (!player.xpData?.perGw || player.xpData.perGw.length === 0) {
    return '<span class="sp-fx-strip-empty">-</span>';
  }
  return player.xpData.perGw.slice(0, Math.min(horizonGwCount, 5)).map(f =>
    `<span class="sp-fdr sp-fdr-${f.fdr}" title="GW${f.gw}: ${f.isHome ? '' : '@'}${f.opponent}">${f.opponent.slice(0, 3)}</span>`
  ).join('');
}

/**
 * Render the Squad Ranking panel (6.2)
 */
function renderSquadRankingPanel(squadWithXp, optimised, horizonGwCount, objectiveConfig, manualOverrides, context) {
  const pinnedXISet = new Set(manualOverrides.pinnedToXI || []);
  const pinnedBenchSet = new Set(manualOverrides.pinnedToBench || []);
  const xiIds = new Set(optimised.xi.map(p => p?.id));

  // Sort all players by adjusted xP
  const sorted = [...squadWithXp].sort((a, b) => (b.adjXp || b.xp) - (a.adjXp || a.xp));

  // Build player rows
  const playerRows = sorted.map((p, idx) => {
    const isInXI = xiIds.has(p.id);
    const isPinnedXI = pinnedXISet.has(p.id);
    const isPinnedBench = pinnedBenchSet.has(p.id);
    const minsScore = p.xpData?.minutesReliability?.score || 0;
    const posName = ({ 1: "G", 2: "D", 3: "M", 4: "F" })[p.element_type] || "?";

    // Determine risk indicator
    let riskClass = "sp-risk-ok";
    let riskLabel = "";
    if (p.status === 'i' || p.status === 's') {
      riskClass = "sp-risk-high";
      riskLabel = p.status === 'i' ? "INJ" : "SUS";
    } else if (p.status === 'd' || minsScore < 50) {
      riskClass = "sp-risk-med";
      riskLabel = p.status === 'd' ? "?" : "ROT";
    } else if (minsScore < 70) {
      riskClass = "sp-risk-low";
      riskLabel = "~";
    }

    // Get benching reason if benched
    const benchReason = !isInXI && optimised.benchReasons?.[p.id]
      ? optimised.benchReasons[p.id]
      : "";

    // Build fixture strip
    const fixtureStrip = buildFixtureStrip(p, context, horizonGwCount);

    return `
      <div class="sp-rank-row ${isInXI ? 'sp-rank-row-xi' : 'sp-rank-row-bench'} ${isPinnedXI || isPinnedBench ? 'sp-rank-row-pinned' : ''}"
           data-player-id="${p.id}">
        <span class="sp-rank-num">${idx + 1}</span>
        <span class="sp-rank-pos ${posName.toLowerCase()}">${posName}</span>
        <span class="sp-rank-name" title="${p.first_name} ${p.second_name}">
          ${p.web_name}
          ${isPinnedXI ? '<span class="sp-pin-badge" title="Pinned to XI">📌</span>' : ''}
          ${isPinnedBench ? '<span class="sp-pin-badge" title="Pinned to Bench">🪑</span>' : ''}
        </span>
        <span class="sp-rank-team">${p.teamName || ''}</span>
        <span class="sp-rank-fixtures">${fixtureStrip}</span>
        <span class="sp-rank-xp" title="Raw xP: ${(p.rawXp || 0).toFixed(1)}">${(p.xp || 0).toFixed(1)}</span>
        <span class="sp-rank-adjxp" title="xP × mins probability">${(p.adjXp || 0).toFixed(1)}</span>
        <span class="sp-rank-mins ${minsScore < 70 ? 'sp-mins-warn' : ''}">${minsScore}%</span>
        <span class="sp-rank-risk ${riskClass}" title="${riskLabel}">${riskLabel || '✓'}</span>
        <span class="sp-rank-verdict ${p.verdict?.class || ''}" title="${p.verdict?.description || ''}">${p.verdict?.label || 'START'}</span>
        <span class="sp-rank-actions">
          <button class="sp-pin-btn ${isPinnedXI ? 'active' : ''}" data-action="pin-xi" data-player-id="${p.id}" title="Pin to XI">XI</button>
          <button class="sp-pin-btn ${isPinnedBench ? 'active' : ''}" data-action="pin-bench" data-player-id="${p.id}" title="Pin to Bench">B</button>
        </span>
      </div>
      ${benchReason && !isInXI ? `<div class="sp-rank-bench-reason" title="Why benched">${benchReason}</div>` : ''}
    `;
  }).join('');

  // Override delta warning
  const deltaWarning = optimised.hasOverrides && optimised.overrideDelta !== 0
    ? `<div class="sp-rank-delta ${optimised.overrideDelta > 0 ? 'sp-rank-delta-neg' : 'sp-rank-delta-pos'}">
         Override delta: ${optimised.overrideDelta > 0 ? '-' : '+'}${Math.abs(optimised.overrideDelta).toFixed(1)} xP vs optimal
       </div>`
    : '';

  // Formation display
  const formation = optimised.formation
    ? `${optimised.formation[1]}-${optimised.formation[2]}-${optimised.formation[3]}`
    : '?-?-?';

  return `
    <div class="sp-card sp-card-squad sp-card-ranking">
      <div class="sp-card-header">
        Squad Ranking
        <span class="sp-xp-total">${optimised.totalXp.toFixed(1)} xP</span>
        <span class="sp-formation">${formation}</span>
        ${optimised.hasOverrides ? '<button id="clearOverridesBtn" class="sp-btn sp-btn-small sp-btn-link">Clear Pins</button>' : ''}
      </div>
      ${deltaWarning}
      <div class="sp-rank-header">
        <span class="sp-rank-num">#</span>
        <span class="sp-rank-pos">Pos</span>
        <span class="sp-rank-name">Player</span>
        <span class="sp-rank-team">Team</span>
        <span class="sp-rank-fixtures">Fixtures</span>
        <span class="sp-rank-xp">xP</span>
        <span class="sp-rank-adjxp">Adj</span>
        <span class="sp-rank-mins">Mins</span>
        <span class="sp-rank-risk">Risk</span>
        <span class="sp-rank-verdict">Verdict</span>
        <span class="sp-rank-actions">Pin</span>
      </div>
      <div class="sp-rank-list">
        ${playerRows}
      </div>
      <div class="sp-rank-legend">
        <span class="sp-legend-item"><span class="sp-rank-row-xi-dot"></span> In XI</span>
        <span class="sp-legend-item"><span class="sp-rank-row-bench-dot"></span> Bench</span>
        <span class="sp-legend-item"><span class="sp-verdict-lock">LOCK</span> Nailed starter</span>
        <span class="sp-legend-item"><span class="sp-verdict-sell">SELL</span> Transfer out</span>
      </div>
    </div>
  `;
}

/**
 * Wire up squad interactions (pin buttons, clear overrides)
 */
function wireUpSquadInteractions(container, squadWithXp, horizonGwCount, objectiveConfig) {
  // Pin buttons
  container.querySelectorAll('.sp-pin-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const playerId = parseInt(btn.dataset.playerId);
      const action = btn.dataset.action;

      const overrides = dashboardState.manualOverrides;

      if (action === 'pin-xi') {
        // Toggle pin to XI
        const idx = overrides.pinnedToXI.indexOf(playerId);
        if (idx >= 0) {
          overrides.pinnedToXI.splice(idx, 1);
        } else {
          overrides.pinnedToXI.push(playerId);
          // Remove from bench if was pinned there
          const benchIdx = overrides.pinnedToBench.indexOf(playerId);
          if (benchIdx >= 0) overrides.pinnedToBench.splice(benchIdx, 1);
        }
      } else if (action === 'pin-bench') {
        // Toggle pin to bench
        const idx = overrides.pinnedToBench.indexOf(playerId);
        if (idx >= 0) {
          overrides.pinnedToBench.splice(idx, 1);
        } else {
          overrides.pinnedToBench.push(playerId);
          // Remove from XI if was pinned there
          const xiIdx = overrides.pinnedToXI.indexOf(playerId);
          if (xiIdx >= 0) overrides.pinnedToXI.splice(xiIdx, 1);
        }
      }

      // Save to localStorage
      setJSON(STORAGE_KEY_MANUAL_OVERRIDES, overrides);
      dashboardState.manualOverrides = overrides;

      // Re-render
      const content = document.getElementById('spContent');
      const recalcBanner = document.getElementById('spRecalcBanner');
      if (content) {
        await renderOptimisedDashboard(content, recalcBanner);
      }
    };
  });

  // Clear overrides button
  const clearBtn = container.querySelector('#clearOverridesBtn');
  if (clearBtn) {
    clearBtn.onclick = async () => {
      dashboardState.manualOverrides = { pinnedToXI: [], pinnedToBench: [] };
      setJSON(STORAGE_KEY_MANUAL_OVERRIDES, dashboardState.manualOverrides);

      const content = document.getElementById('spContent');
      const recalcBanner = document.getElementById('spRecalcBanner');
      if (content) {
        await renderOptimisedDashboard(content, recalcBanner);
      }
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 6.4: CAPTAIN DECISION COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Calculate captain candidates with mode-specific scoring
 */
function calculateCaptainCandidates(xiPlayers, captainMode, objectiveConfig) {
  const candidates = xiPlayers.filter(p => p).map(p => {
    const minsScore = p.xpData?.minutesReliability?.score || 0;
    const ownership = parseFloat(p.selected_by_percent) || 0;
    const rawXp = p.rawXp || p.xp || 0;

    // Calculate mode-specific score
    let modeScore = rawXp;
    let modeExplanation = "";

    if (captainMode.id === CAPTAIN_MODES.CONSERVATIVE.id) {
      // Conservative: heavily weight minutes certainty
      const minsWeight = minsScore >= 95 ? 1.2 : minsScore >= 85 ? 1.0 : minsScore >= 70 ? 0.8 : 0.5;
      modeScore = rawXp * minsWeight;
      modeExplanation = minsScore >= 95
        ? "Nailed starter, safe pick"
        : minsScore >= 85
          ? "Likely to play, moderate risk"
          : "Rotation concern, risky choice";
    } else if (captainMode.id === CAPTAIN_MODES.AGGRESSIVE.id) {
      // Aggressive: boost high ceiling, accept variance
      const ceilingBoost = rawXp > 6 ? 1.15 : rawXp > 4 ? 1.05 : 1.0;
      const diffBoost = ownership < 15 ? 1.1 : 1.0;
      modeScore = rawXp * ceilingBoost * diffBoost;
      modeExplanation = ownership < 15
        ? `Differential pick (${ownership.toFixed(1)}% owned)`
        : rawXp > 6
          ? "High ceiling, premium pick"
          : "Standard option";
    }

    // Calculate confidence score (0-100)
    let confidence = 50;
    confidence += Math.min(25, rawXp * 3); // Up to +25 for xP
    confidence += Math.min(25, minsScore / 4); // Up to +25 for mins reliability
    if (captainMode.id === CAPTAIN_MODES.CONSERVATIVE.id && minsScore >= 90) {
      confidence += 10;
    }
    if (captainMode.id === CAPTAIN_MODES.AGGRESSIVE.id && rawXp > 6) {
      confidence += 10;
    }
    confidence = Math.min(100, Math.round(confidence));

    return {
      ...p,
      modeScore,
      modeExplanation,
      confidence,
      ownership,
    };
  });

  // Sort by mode score
  candidates.sort((a, b) => b.modeScore - a.modeScore);

  return {
    candidates: candidates.slice(0, 5),
    recommended: candidates[0],
    vice: candidates[1],
    mode: captainMode,
  };
}

/**
 * Render Captain Decision Panel (6.4)
 */
function renderCaptainDecisionPanel(captainData, optimised, captainModeConfig, objectiveConfig) {
  const modeId = captainModeConfig.id;
  const otherMode = modeId === CAPTAIN_MODES.CONSERVATIVE.id
    ? CAPTAIN_MODES.AGGRESSIVE
    : CAPTAIN_MODES.CONSERVATIVE;

  const candidateRows = captainData.candidates.map((p, i) => {
    const minsScore = p.xpData?.minutesReliability?.score || 0;
    const isRec = i === 0;
    const isVice = i === 1;

    // Fixture info
    const nextFx = p.xpData?.perGw?.[0];
    const fxInfo = nextFx
      ? `${nextFx.isHome ? '' : '@'}${nextFx.opponent} (FDR${nextFx.fdr})`
      : '-';

    return `
      <div class="sp-cap-row ${isRec ? 'sp-cap-best' : ''}" data-player-id="${p.id}">
        <span class="sp-cap-rank">${isRec ? 'C' : isVice ? 'VC' : i + 1}</span>
        <span class="sp-cap-name">${p.web_name || '?'}</span>
        <span class="sp-cap-xp">${(p.xp || 0).toFixed(1)}</span>
        <span class="sp-cap-fixture" title="Next fixture">${fxInfo}</span>
        <span class="sp-cap-mins ${minsScore < 80 ? 'sp-mins-warn' : ''}">${minsScore}%</span>
        <span class="sp-cap-eo" title="Effective ownership">${(p.ownership || 0).toFixed(1)}%</span>
        <span class="sp-cap-conf" title="Confidence score">
          <span class="sp-conf-bar" style="width: ${p.confidence}%"></span>
          <span class="sp-conf-val">${p.confidence}</span>
        </span>
      </div>
      ${isRec ? `<div class="sp-cap-explanation">${p.modeExplanation}</div>` : ''}
    `;
  }).join('');

  return `
    <div class="sp-card sp-card-captain">
      <div class="sp-card-header">
        Captain Decision
        <div class="sp-cap-mode-toggle">
          <button class="sp-cap-mode-btn ${modeId === CAPTAIN_MODES.CONSERVATIVE.id ? 'active' : ''}"
                  data-mode="${CAPTAIN_MODES.CONSERVATIVE.id}"
                  title="${CAPTAIN_MODES.CONSERVATIVE.description}">
            ${CAPTAIN_MODES.CONSERVATIVE.icon} ${CAPTAIN_MODES.CONSERVATIVE.label}
          </button>
          <button class="sp-cap-mode-btn ${modeId === CAPTAIN_MODES.AGGRESSIVE.id ? 'active' : ''}"
                  data-mode="${CAPTAIN_MODES.AGGRESSIVE.id}"
                  title="${CAPTAIN_MODES.AGGRESSIVE.description}">
            ${CAPTAIN_MODES.AGGRESSIVE.icon} ${CAPTAIN_MODES.AGGRESSIVE.label}
          </button>
        </div>
      </div>
      <div class="sp-cap-rec-summary">
        <span class="sp-cap-rec-label">Recommended:</span>
        <span class="sp-cap-rec-name">${captainData.recommended?.web_name || '?'}</span>
        <span class="sp-cap-rec-conf">(${captainData.recommended?.confidence || 0}% confidence)</span>
      </div>
      <div class="sp-cap-header">
        <span class="sp-cap-rank">#</span>
        <span class="sp-cap-name">Player</span>
        <span class="sp-cap-xp">xP</span>
        <span class="sp-cap-fixture">Fixture</span>
        <span class="sp-cap-mins">Mins</span>
        <span class="sp-cap-eo">EO</span>
        <span class="sp-cap-conf">Conf</span>
      </div>
      <div class="sp-cap-list">
        ${candidateRows}
      </div>
      <div class="sp-cap-mode-hint">
        <strong>${captainModeConfig.icon} ${captainModeConfig.label}:</strong> ${captainModeConfig.description}
      </div>
    </div>
  `;
}

/**
 * Wire up captain mode toggle
 */
function wireUpCaptainModeToggle(container) {
  container.querySelectorAll('.sp-cap-mode-btn').forEach(btn => {
    btn.onclick = async () => {
      const newMode = btn.dataset.mode;
      dashboardState.captainMode = newMode;
      setJSON(STORAGE_KEY_CAPTAIN_MODE, newMode);

      const content = document.getElementById('spContent');
      const recalcBanner = document.getElementById('spRecalcBanner');
      if (content) {
        await renderOptimisedDashboard(content, recalcBanner);
      }
    };
  });
}

/**
 * Wire up snapshot card refresh button
 */
function wireUpSnapshotRefresh() {
  const refreshBtn = document.getElementById('snapRefreshBtn');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing...';

      // Force refresh context
      const result = await loadContext({ forceRefresh: true });
      dashboardState.context = result.context;
      dashboardState.dependencyStatus = result.dependencyStatus;

      const content = document.getElementById('spContent');
      const recalcBanner = document.getElementById('spRecalcBanner');
      if (result.ok && content) {
        await renderOptimisedDashboard(content, recalcBanner);
      }

      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    };
  }
}

/**
 * Apply objective-specific modifiers to xP calculations
 */
function applyObjectiveModifiers(xpData, player, objective) {
  const modifiedXp = { ...xpData };
  const minsScore = xpData.minutesReliability?.score || 100;

  switch (objective.id) {
    case OBJECTIVES.MIN_RISK.id:
      // Prioritize nailed starters - boost high minutes reliability, penalize low
      if (minsScore >= 90) {
        modifiedXp.total = xpData.total * 1.15; // 15% boost for nailed players
      } else if (minsScore < 70) {
        modifiedXp.total = xpData.total * 0.7; // 30% penalty for rotation risks
      } else if (minsScore < 80) {
        modifiedXp.total = xpData.total * 0.85; // 15% penalty for minor risks
      }
      modifiedXp.objectiveNote = `Min Risk: ${minsScore >= 90 ? "+15%" : minsScore < 70 ? "-30%" : minsScore < 80 ? "-15%" : "0%"}`;
      break;

    case OBJECTIVES.PROTECT_RANK.id:
      // Match effective ownership - boost high ownership players
      const ownership = parseFloat(player.selected_by_percent) || 0;
      if (ownership > 30) {
        modifiedXp.total = xpData.total * 1.1; // Small boost for highly owned
      } else if (ownership < 5) {
        modifiedXp.total = xpData.total * 0.9; // Small penalty for differentials
      }
      modifiedXp.objectiveNote = `EO: ${ownership.toFixed(1)}% owned`;
      break;

    case OBJECTIVES.CHASE_UPSIDE.id:
      // Target differentials - boost low ownership, penalize high ownership
      const ownPct = parseFloat(player.selected_by_percent) || 0;
      if (ownPct < 10) {
        modifiedXp.total = xpData.total * 1.2; // 20% boost for differentials
      } else if (ownPct > 30) {
        modifiedXp.total = xpData.total * 0.85; // 15% penalty for template
      }
      // Also boost high-upside (high variance) players
      const form = parseFloat(player.form) || 0;
      if (form > 6) {
        modifiedXp.total = xpData.total * 1.1; // Boost hot form
      }
      modifiedXp.objectiveNote = `Diff: ${ownPct.toFixed(1)}% owned, form ${form}`;
      break;

    case OBJECTIVES.MAX_POINTS.id:
    default:
      // No modifications for max points
      modifiedXp.objectiveNote = "Max xP";
      break;
  }

  return modifiedXp;
}

/**
 * Render chip panel when predictions unavailable
 */
function renderChipPanelUnavailable() {
  return `
    <div class="sp-card">
      <div class="sp-card-header">Chip Advice</div>
      <div class="sp-unavailable">
        <span class="sp-unavailable-icon">⚠️</span>
        <span>Predictions unavailable</span>
      </div>
    </div>
  `;
}

/**
 * Render transfer panel when predictions unavailable
 */
function renderTransferPanelUnavailable() {
  return `
    <div class="sp-card sp-card-transfers">
      <div class="sp-card-header">Transfer Advisor</div>
      <div class="sp-unavailable">
        <span class="sp-unavailable-icon">⚠️</span>
        <span>Predictions unavailable - cannot calculate transfer recommendations</span>
      </div>
    </div>
  `;
}

// Keep legacy function for backward compatibility
async function renderDashboardContent(container, horizon) {
  try {
    const bs = state.bootstrap || (await legacyApi.bootstrap());
    const currentState = await buildCurrentState();

    if (currentState.error) {
      container.innerHTML = `<div class="sp-error-full"><h3>${currentState.error}</h3><p>${currentState.message}</p></div>`;
      return;
    }

    // Calculate xP for all squad members
    const squadWithXp = [];
    for (const p of currentState.squad) {
      const xp = await calculateExpectedPoints(p, horizon, bs);
      squadWithXp.push({ ...p, xp: xp.total, xpData: xp });
    }

    const optimised = optimiseXI(squadWithXp);
    const transfers = await getTransferRecommendations(currentState, horizon, bs);
    const chipRec = await getChipRecommendation(currentState, horizon, bs, squadWithXp, optimised);

    container.innerHTML = `
      <div class="sp-col sp-col-left">
        ${renderStatePanel(currentState)}
        ${renderFlagsPanel(currentState)}
        ${renderChipPanel(chipRec, currentState)}
      </div>
      <div class="sp-col sp-col-center">
        ${renderSquadPanel(optimised, horizon)}
        ${renderCaptainPanel(optimised)}
      </div>
      <div class="sp-col sp-col-right">
        ${renderTransferPanel(transfers)}
        ${renderFixturesPanel(currentState, horizon)}
        ${renderAssumptionsPanel()}
      </div>
    `;
  } catch (err) {
    log.error("Stat Picker: Dashboard error", err);
    container.innerHTML = `<div class="sp-error-full"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function renderStatePanel(s) {
  const chipsAvail = s.chipsAvailable.map(formatChipName).join(", ") || "None";
  const chipsUsed = s.chipsUsed.map((c) => `${formatChipName(c.chip)} (GW${c.gw})`).join(", ") || "None";

  return `
    <div class="sp-card">
      <div class="sp-card-header">Current State</div>
      <div class="sp-state-compact">
        <div class="sp-stat"><span class="sp-stat-val">${s.currentGw}${s.isLive ? "*" : ""}</span><span class="sp-stat-lbl">GW</span></div>
        <div class="sp-stat"><span class="sp-stat-val">${s.freeTransfers}</span><span class="sp-stat-lbl">FT</span></div>
        <div class="sp-stat"><span class="sp-stat-val">${s.bankFormatted}</span><span class="sp-stat-lbl">Bank</span></div>
        <div class="sp-stat"><span class="sp-stat-val">${s.teamValueFormatted}</span><span class="sp-stat-lbl">Value</span></div>
      </div>
      <div class="sp-state-row"><span>Team</span><span>${s.entryName}</span></div>
      <div class="sp-state-row"><span>Rank</span><span>${s.overallRank?.toLocaleString() || "N/A"}</span></div>
      <div class="sp-state-row"><span>Points</span><span>${s.overallPoints?.toLocaleString() || "N/A"}</span></div>
      <div class="sp-state-row"><span>Chips</span><span class="sp-chips-avail">${chipsAvail}</span></div>
      <div class="sp-state-row sp-muted"><span>Used</span><span>${chipsUsed}</span></div>
    </div>
  `;
}

function renderFlagsPanel(s) {
  if (!s.flaggedPlayers || s.flaggedPlayers.length === 0) {
    return `<div class="sp-card sp-card-ok"><div class="sp-card-header">Flags</div><div class="sp-ok-msg">All players available</div></div>`;
  }

  const rows = s.flaggedPlayers
    .map(
      (p) => `
    <div class="sp-flag-row">
      <span class="sp-flag-name">${p.web_name}</span>
      <span class="sp-flag-status" data-status="${p.status}">${p.status.toUpperCase()}</span>
      <span class="sp-flag-chance">${p.chance_of_playing_next_round ?? "?"}%</span>
    </div>
  `
    )
    .join("");

  return `
    <div class="sp-card sp-card-warn">
      <div class="sp-card-header">Flags (${s.flaggedPlayers.length})</div>
      ${rows}
    </div>
  `;
}

function renderChipPanel(rec, s) {
  if (!rec.chip) {
    return `
      <div class="sp-card">
        <div class="sp-card-header">Chip Advice</div>
        <div class="sp-chip-none">${rec.reason}</div>
      </div>
    `;
  }

  return `
    <div class="sp-card sp-card-chip">
      <div class="sp-card-header">Chip Advice</div>
      <div class="sp-chip-rec">
        <span class="sp-chip-name">${rec.name}</span>
        <span class="sp-chip-conf sp-conf-${rec.confidence.toLowerCase()}">${rec.confidence}</span>
      </div>
      <div class="sp-chip-reason">${rec.reason}</div>
      <div class="sp-chip-gain">+${rec.expectedGain.toFixed(1)} xP potential</div>
    </div>
  `;
}

function renderSquadPanel(opt, horizon, objective = null) {
  const buildBreakdown = (p) => {
    if (!p?.xpData?.components) return "";
    const c = p.xpData.components;
    const parts = [];
    if (c.appearance > 0) parts.push(`App:${c.appearance.toFixed(1)}`);
    if (c.attack > 0) parts.push(`Atk:${c.attack.toFixed(1)}`);
    if (c.cleanSheet > 0) parts.push(`CS:${c.cleanSheet.toFixed(1)}`);
    if (c.bonus > 0) parts.push(`Bns:${c.bonus.toFixed(1)}`);
    if (p.xpData?.objectiveNote) parts.push(`[${p.xpData.objectiveNote}]`);
    return parts.join(" ");
  };

  const whyPicked = (p) => {
    if (!p) return "";
    const reasons = [];
    const mins = p.xpData?.minutesReliability?.score || 0;
    const posType = p.element_type;
    const objectiveId = objective?.id;

    // Objective-specific reasons first
    if (objectiveId === OBJECTIVES.MIN_RISK.id) {
      if (mins >= 90) reasons.push("nailed");
      else if (mins >= 70) reasons.push("likely starter");
      else reasons.push("rotation risk");
    } else if (objectiveId === OBJECTIVES.PROTECT_RANK.id) {
      const own = parseFloat(p.selected_by_percent) || 0;
      if (own > 20) reasons.push(`${own.toFixed(0)}% owned`);
    } else if (objectiveId === OBJECTIVES.CHASE_UPSIDE.id) {
      const own = parseFloat(p.selected_by_percent) || 0;
      if (own < 10) reasons.push("differential");
      const form = parseFloat(p.form) || 0;
      if (form > 5) reasons.push(`form:${form}`);
    } else {
      // Default (Max Points)
      if (mins >= 90) reasons.push("nailed");
      else if (mins >= 70) reasons.push("likely starter");
      else if (mins >= 50) reasons.push("rotation risk");
    }

    if (posType === 1 || posType === 2) {
      if (p.xpData?.components?.cleanSheet > 1) reasons.push("CS potential");
    }
    if (posType === 3 || posType === 4) {
      if (p.xpData?.components?.attack > 2) reasons.push("attacking returns");
    }

    if (p.xpData?.components?.bonus > 0.5) reasons.push("BPS");

    return reasons.slice(0, 2).join(", ");
  };

  const xiRows = opt.xi
    .map(
      (p) => `
    <div class="sp-xi-row ${p?.status !== "a" ? "sp-xi-flagged" : ""}" data-tooltip="${buildBreakdown(p)}">
      <span class="sp-xi-pos">${({ 1: "G", 2: "D", 3: "M", 4: "F" })[p?.element_type] || "?"}</span>
      <span class="sp-xi-name">${p?.web_name || "?"}</span>
      <span class="sp-xi-team">${p?.teamName || ""}</span>
      <span class="sp-xi-xp">${p?.xp?.toFixed(1) || "0"}</span>
      <span class="sp-xi-why">${whyPicked(p)}</span>
    </div>
  `
    )
    .join("");

  const benchRows = opt.bench
    .slice(0, 4)
    .map(
      (p, i) => `
    <div class="sp-bench-row" data-tooltip="${buildBreakdown(p)}">
      <span class="sp-bench-order">${i + 1}</span>
      <span class="sp-xi-pos">${({ 1: "G", 2: "D", 3: "M", 4: "F" })[p?.element_type] || "?"}</span>
      <span class="sp-xi-name">${p?.web_name || "?"}</span>
      <span class="sp-xi-xp">${p?.xp?.toFixed(1) || "0"}</span>
    </div>
  `
    )
    .join("");

  return `
    <div class="sp-card sp-card-squad">
      <div class="sp-card-header">Optimal XI <span class="sp-xp-total">${opt.totalXp.toFixed(1)} xP (${horizon}GW)</span></div>
      <div class="sp-xi-list">${xiRows}</div>
      <div class="sp-bench-header">Bench (ordered by xP)</div>
      <div class="sp-bench-list">${benchRows}</div>
      <div class="sp-scoring-note">xP = Appearance + Attack + CS + Bonus. Hover for breakdown.</div>
    </div>
  `;
}

function renderCaptainPanel(opt, objective = null) {
  const objectiveId = objective?.id;

  const getCaptainNote = (p) => {
    if (!p) return "";
    if (objectiveId === OBJECTIVES.MIN_RISK.id) {
      const mins = p.xpData?.minutesReliability?.score || 0;
      return mins >= 90 ? "safe pick" : mins >= 70 ? "some risk" : "risky";
    } else if (objectiveId === OBJECTIVES.PROTECT_RANK.id) {
      const own = parseFloat(p.selected_by_percent) || 0;
      return own > 15 ? "template" : "differential";
    } else if (objectiveId === OBJECTIVES.CHASE_UPSIDE.id) {
      const own = parseFloat(p.selected_by_percent) || 0;
      return own < 10 ? "diff pick" : own > 25 ? "template" : "";
    }
    return "";
  };

  const rows = opt.captainCandidates
    .slice(0, 5)
    .map(
      (p, i) => `
    <div class="sp-cap-row ${i === 0 ? "sp-cap-best" : ""}">
      <span class="sp-cap-rank">${i === 0 ? "C" : i === 1 ? "VC" : i + 1}</span>
      <span class="sp-cap-name">${p?.web_name || "?"}</span>
      <span class="sp-cap-xp">${p?.xp?.toFixed(1) || "0"}</span>
      <span class="sp-cap-mins">${p?.xpData?.minutesReliability?.score || "?"}%</span>
      ${getCaptainNote(p) ? `<span class="sp-cap-note">${getCaptainNote(p)}</span>` : ""}
    </div>
  `
    )
    .join("");

  const objectiveHint = objective ? `<span class="sp-obj-hint">${objective.label}</span>` : "";

  return `
    <div class="sp-card">
      <div class="sp-card-header">Captain Picks ${objectiveHint}</div>
      <div class="sp-cap-list">${rows}</div>
    </div>
  `;
}

function renderTransferPanel(t) {
  const actionClass = t.action === "Hold" ? "" : t.hitCost > 0 ? "sp-action-hit" : "sp-action-go";

  let transferRows = "";
  let noTransferExplanation = "";

  if (t.transfers.length > 0) {
    transferRows = t.transfers
      .map(
        (tr) => `
      <div class="sp-transfer-row">
        <div class="sp-tr-players">
          <span class="sp-tr-out">${tr.out.web_name}</span>
          <span class="sp-tr-arrow">→</span>
          <span class="sp-tr-in">${tr.in.web_name}</span>
          <span class="sp-tr-gain">+${tr.xpGain.toFixed(1)}</span>
        </div>
        <div class="sp-tr-why">
          <span class="sp-tr-why-out">OUT: ${tr.whyOut || "underperforming"}</span>
          <span class="sp-tr-why-in">IN: ${tr.whyIn || "better option"}</span>
        </div>
      </div>
    `
      )
      .join("");
  } else if (t.action === "Hold") {
    const reasons = [];

    if (t.allRecommendations && t.allRecommendations.length === 0) reasons.push("All squad players have adequate expected returns");

    if (t.allRecommendations && t.allRecommendations.length > 0) {
      const bestGain = t.allRecommendations[0]?.xpGain || 0;
      if (bestGain < 2) reasons.push(`Best available gain (+${bestGain.toFixed(1)} xP) doesn't clear the +2.0 threshold`);
      if (t.hitCost > 0 && bestGain < 6) reasons.push(`Hit penalty (-${t.hitCost}) outweighs potential gains`);
    }

    if (t.freeTransfers === 0) reasons.push("No free transfers available — any move costs -4 points");
    else if (t.freeTransfers > 1) reasons.push(`${t.freeTransfers} FTs rolling — consider saving for a future double move`);

    if (reasons.length === 0) reasons.push("Current squad is optimal for the projected period");

    noTransferExplanation = `
      <div class="sp-no-transfers">
        <div class="sp-no-transfers-icon">✓</div>
        <div class="sp-no-transfers-title">No transfers recommended</div>
        <div class="sp-no-transfers-reason">
          ${reasons.map((r) => `<div>• ${r}</div>`).join("")}
        </div>
      </div>
    `;
  }

  let hitWarning = "";
  if (t.hitCost > 0) {
    hitWarning = `
      <div class="sp-hit-warning">
        <span>⚠️ Taking a</span>
        <span class="sp-hit-warning-value">-${t.hitCost}</span>
        <span>hit | Net expected: +${t.netGain.toFixed(1)} xP</span>
      </div>
    `;
  }

  return `
    <div class="sp-card sp-card-transfers">
      <div class="sp-card-header">Transfer Advisor</div>
      <div class="sp-action ${actionClass}">${t.action}</div>
      <div class="sp-action-detail">${t.actionDetail}</div>
      ${hitWarning}
      ${t.netGain > 0 && t.hitCost === 0 ? `<div class="sp-net-gain">Net gain: +${t.netGain.toFixed(1)} xP</div>` : ""}
      ${transferRows}
      ${noTransferExplanation}
      <div class="sp-baseline">Do Nothing baseline: ${t.doNothingXp?.toFixed(1) || "?"} xP</div>
    </div>
  `;
}

function renderFixturesPanel(s, horizon) {
  const matrix = s.fixtureMatrix || {};
  const teamIds = Object.keys(matrix);

  if (teamIds.length === 0) {
    return `<div class="sp-card"><div class="sp-card-header">Fixtures</div><div class="sp-no-data">No data</div></div>`;
  }

  const rows = teamIds
    .map((tid) => {
      const team = matrix[tid];
      const hData = team.horizons[horizon];
      if (!hData) return "";

      const cells = hData.fixtures
        .slice(0, Math.min(horizon, 6))
        .map((f) => `<span class="sp-fdr sp-fdr-${f.fdr}" title="GW${f.gw}: ${f.isHome ? "" : "@"}${f.opponent}">${f.opponent.slice(0, 3)}</span>`)
        .join("");

      return `<div class="sp-fx-row"><span class="sp-fx-team">${team.teamName}</span><span class="sp-fx-cells">${cells}</span><span class="sp-fx-avg">${hData.avgFdr}</span></div>`;
    })
    .join("");

  return `
    <div class="sp-card">
      <div class="sp-card-header">Fixtures (${horizon}GW)</div>
      <div class="sp-fx-grid">${rows}</div>
    </div>
  `;
}

function renderAssumptionsPanel(objective = null) {
  const objectiveId = objective?.id;

  let objectiveExplanation = "";
  if (objectiveId === OBJECTIVES.MIN_RISK.id) {
    objectiveExplanation = `<li><strong>Min Risk Mode:</strong> Nailed players (+15%), rotation risks (-30%), minor doubts (-15%)</li>`;
  } else if (objectiveId === OBJECTIVES.PROTECT_RANK.id) {
    objectiveExplanation = `<li><strong>Protect Rank Mode:</strong> High ownership (&gt;30%) boosted (+10%), differentials (&lt;5%) reduced (-10%)</li>`;
  } else if (objectiveId === OBJECTIVES.CHASE_UPSIDE.id) {
    objectiveExplanation = `<li><strong>Chase Upside Mode:</strong> Differentials (&lt;10%) boosted (+20%), template (&gt;30%) reduced (-15%), hot form boosted</li>`;
  } else {
    objectiveExplanation = `<li><strong>Max Points Mode:</strong> Pure xP optimization with no ownership adjustments</li>`;
  }

  return `
    <div class="sp-card sp-card-small">
      <div class="sp-card-header">Model & Assumptions</div>
      <ul class="sp-assumptions">
        ${objectiveExplanation}
        <li><strong>xP Components:</strong> Appearance (2pts 60+min, 1pt &lt;60min) + Attack (xGI × pos multiplier) + Clean Sheet (FDR-adjusted) + Bonus (BPS/30)</li>
        <li><strong>FDR Weights:</strong> FDR1: +15%, FDR2: +10%, FDR3: baseline, FDR4: -10%, FDR5: -20%</li>
        <li><strong>Hit Thresholds:</strong> -4 needs &gt;+6 xP, -8 needs &gt;+12 xP (with uncertainty buffer)</li>
        <li><strong>Caveats:</strong> Cannot predict rotation, manager decisions, or late injuries. Public xGI only.</li>
      </ul>
      <div class="sp-scoring-link"><a href="https://www.premierleague.com/news/2174909" target="_blank">FPL Scoring Rules →</a></div>
    </div>
  `;
}
