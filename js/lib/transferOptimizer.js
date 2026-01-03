// js/lib/transferOptimizer.js
// Phase 7: Transfer Optimisation Engine
// Phase 10: Performance guardrails with memoization and dev timing
// - Constrained simulation for transfer recommendations
// - Weakest link identification with explicit reasons
// - Legal replacement simulation (budget, position, club limit, FT/hit rules)

import { state } from "../state.js";
import { xPWindow, xPWindowBatch, estimateXMinsForPlayer, statusMultiplier, clamp } from "./xp.js";
import { getJSON, setJSON } from "../storage.js";
import { memoizeAsync } from "./memoize.js";

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 10: DEV-ONLY PERFORMANCE TIMING
   ═══════════════════════════════════════════════════════════════════════════ */

const isDev = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

function perfLog(label, startTime) {
  if (isDev) {
    const elapsed = performance.now() - startTime;
    console.log(`[Perf] ${label}: ${elapsed.toFixed(1)}ms`);
  }
}

function perfStart() {
  return isDev ? performance.now() : 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 10: MEMOIZED FUNCTIONS
   ═══════════════════════════════════════════════════════════════════════════ */

// Memoize weakest link analysis per player (cache for 2 minutes)
const memoizedAnalyzeExpendability = memoizeAsync(
  async (playerId, gwIds, contextKey, bsVersion) => {
    const bs = state.bootstrap;
    const player = (bs?.elements || []).find(p => p.id === playerId);
    if (!player) return null;
    return analyzePlayerExpendabilityCore(player, gwIds, null, bs);
  },
  {
    keyFn: (playerId, gwIds, contextKey, bsVersion) =>
      `${playerId}:${gwIds.join(",")}:${contextKey}:${bsVersion}`,
    ttl: 2 * 60 * 1000, // 2 minutes
    maxSize: 200,
  }
);

// Memoize player pool building (cache for 1 minute)
const memoizedBuildPlayerPool = memoizeAsync(
  async (squadIds, excludedTeamIds, excludedPlayerIds, gwIds, bsVersion) => {
    const bs = state.bootstrap;
    return buildPlayerPoolCore(
      bs?.elements || [],
      squadIds,
      excludedTeamIds,
      excludedPlayerIds,
      gwIds,
      bs
    );
  },
  {
    keyFn: (squadIds, excludedTeamIds, excludedPlayerIds, gwIds, bsVersion) =>
      `pool:${[...squadIds].sort().join(",")}:${excludedTeamIds.join(",")}:${excludedPlayerIds.join(",")}:${gwIds.join(",")}:${bsVersion}`,
    ttl: 60 * 1000, // 1 minute
    maxSize: 10,
  }
);

// Track last optimization params to prevent unnecessary recompute
let lastOptimizationKey = null;
let lastOptimizationResult = null;

/* ═══════════════════════════════════════════════════════════════════════════
   STORAGE KEYS FOR TRANSFER OPTIMIZER
   ═══════════════════════════════════════════════════════════════════════════ */

export const TRANSFER_STORAGE_KEYS = {
  LOCKED_PLAYERS: "fpl.transfer.lockedPlayers",
  EXCLUDED_TEAMS: "fpl.transfer.excludedTeams",
  EXCLUDED_PLAYERS: "fpl.transfer.excludedPlayers",
  HIT_ENABLED: "fpl.transfer.hitEnabled",
  HIT_THRESHOLD: "fpl.transfer.hitThreshold",
  LAST_RESULT: "fpl.transfer.lastResult",
};

/* ═══════════════════════════════════════════════════════════════════════════
   DEFAULT CONFIGURATION
   ═══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_CONFIG = {
  hitEnabled: true,
  hitThreshold: 4, // Net gain must exceed this to take a hit
  hitCostPerTransfer: 4,
  maxPlayersPerClub: 3,
  minGainThreshold: 1.5, // Minimum xP gain to recommend any transfer
};

/* ═══════════════════════════════════════════════════════════════════════════
   EXPENDABILITY REASONS
   ═══════════════════════════════════════════════════════════════════════════ */

export const EXPENDABILITY_REASONS = {
  INJURED: { id: "injured", priority: 1, label: "Injured/Unavailable" },
  SUSPENDED: { id: "suspended", priority: 2, label: "Suspended" },
  POOR_FIXTURES: { id: "poor_fixtures", priority: 3, label: "Poor upcoming fixtures" },
  LOW_MINUTES: { id: "low_minutes", priority: 4, label: "Low minutes reliability" },
  DECLINING_FORM: { id: "declining_form", priority: 5, label: "Declining form" },
  LOW_XP: { id: "low_xp", priority: 6, label: "Low expected returns" },
  PRICE_DROP: { id: "price_drop", priority: 7, label: "Price drop risk" },
  BETTER_OPTIONS: { id: "better_options", priority: 8, label: "Better options available" },
  ROTATION_RISK: { id: "rotation_risk", priority: 9, label: "Rotation risk" },
  BLANKS: { id: "blanks", priority: 10, label: "Has blank gameweeks" },
};


/* ═══════════════════════════════════════════════════════════════════════════
   7.1: IDENTIFY WEAKEST CONTRIBUTORS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Analyze a squad to identify weakest contributors over a given horizon
 * Returns players ranked by expendability score with explicit reasons
 *
 * @param {Object} context - The squad context from loadContext()
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} - { weakestLinks: [...], lockedPlayers: [...] }
 */
export async function identifyWeakestLinks(context, options = {}) {
  const {
    horizonGwCount = 5,
    lockedPlayerIds = [],
    excludedTeamIds = [],
  } = options;

  const bs = context.bootstrap || state.bootstrap;
  if (!bs) {
    return { ok: false, error: "Bootstrap data not available" };
  }

  const squad = context.squad || [];
  if (squad.length === 0) {
    return { ok: false, error: "No squad data available" };
  }

  // Build GW IDs for horizon
  const events = bs.events || [];
  const nextEvent = events.find(e => e.is_next);
  const startGw = nextEvent?.id || (events.find(e => e.is_current)?.id || 1);
  const gwIds = [];
  for (let gw = startGw; gw < startGw + horizonGwCount && gw <= 38; gw++) {
    gwIds.push(gw);
  }

  const lockedSet = new Set(lockedPlayerIds);
  const weakestLinks = [];

  for (const player of squad) {
    // Skip locked players
    if (lockedSet.has(player.id)) {
      continue;
    }

    const analysis = await analyzePlayerExpendability(player, gwIds, context, bs);
    weakestLinks.push({
      player,
      ...analysis,
    });
  }

  // Sort by expendability score (highest = most expendable)
  weakestLinks.sort((a, b) => b.expendabilityScore - a.expendabilityScore);

  // Mark top N as "expendable"
  const expendableCount = Math.min(5, Math.ceil(squad.length * 0.3));
  weakestLinks.forEach((link, idx) => {
    link.isExpendable = idx < expendableCount;
    link.rank = idx + 1;
  });

  return {
    ok: true,
    weakestLinks,
    lockedPlayers: squad.filter(p => lockedSet.has(p.id)),
    horizonGwCount,
    gwIds,
    startGw,
  };
}

/**
 * Analyze a single player's expendability
 */
async function analyzePlayerExpendability(player, gwIds, context, bs) {
  const reasons = [];
  let expendabilityScore = 0;

  // Get xP over horizon
  const xpResult = await xPWindow(player, gwIds);
  const totalXp = xpResult?.total || 0;
  const avgXpPerGw = gwIds.length > 0 ? totalXp / gwIds.length : 0;

  // Get minutes estimate
  const xMins = await estimateXMinsForPlayer(player);
  const statusMult = statusMultiplier(player.status);

  // 1. Status-based penalties (injured, suspended, unavailable)
  if (player.status === "i" || player.status === "n") {
    expendabilityScore += 50;
    reasons.push({
      ...EXPENDABILITY_REASONS.INJURED,
      detail: player.news || "Unavailable",
      impact: 50,
    });
  } else if (player.status === "s") {
    expendabilityScore += 40;
    reasons.push({
      ...EXPENDABILITY_REASONS.SUSPENDED,
      detail: player.news || "Suspended",
      impact: 40,
    });
  } else if (player.status === "d") {
    const chance = player.chance_of_playing_next_round ?? 50;
    const penalty = Math.round((100 - chance) * 0.3);
    expendabilityScore += penalty;
    reasons.push({
      ...EXPENDABILITY_REASONS.INJURED,
      detail: `${chance}% chance of playing - ${player.news || "Doubtful"}`,
      impact: penalty,
    });
  }

  // 2. Low minutes reliability
  if (xMins < 45) {
    expendabilityScore += 25;
    reasons.push({
      ...EXPENDABILITY_REASONS.LOW_MINUTES,
      detail: `Averaging only ${Math.round(xMins)} mins per game`,
      impact: 25,
    });
  } else if (xMins < 60) {
    expendabilityScore += 15;
    reasons.push({
      ...EXPENDABILITY_REASONS.ROTATION_RISK,
      detail: `Rotation risk - ${Math.round(xMins)} mins average`,
      impact: 15,
    });
  }

  // 3. Low expected points
  if (avgXpPerGw < 2.5) {
    const penalty = Math.round((2.5 - avgXpPerGw) * 15);
    expendabilityScore += penalty;
    reasons.push({
      ...EXPENDABILITY_REASONS.LOW_XP,
      detail: `Only ${avgXpPerGw.toFixed(1)} xP/GW expected over next ${gwIds.length} GWs`,
      impact: penalty,
    });
  }

  // 4. Poor fixtures (average FDR > 3.5)
  const perGwData = xpResult?.perGw || [];
  if (perGwData.length > 0) {
    const avgFdr = perGwData.reduce((sum, gw) => sum + (gw.fdr || 3), 0) / perGwData.length;
    if (avgFdr > 3.5) {
      const penalty = Math.round((avgFdr - 3) * 10);
      expendabilityScore += penalty;
      reasons.push({
        ...EXPENDABILITY_REASONS.POOR_FIXTURES,
        detail: `Tough fixtures ahead (avg FDR ${avgFdr.toFixed(1)})`,
        impact: penalty,
      });
    }

    // Check for blanks
    const blanks = gwIds.filter(gw => !perGwData.find(d => d.gw === gw));
    if (blanks.length > 0) {
      expendabilityScore += blanks.length * 8;
      reasons.push({
        ...EXPENDABILITY_REASONS.BLANKS,
        detail: `Blank in GW${blanks.join(", GW")}`,
        impact: blanks.length * 8,
      });
    }
  }

  // 5. Declining form (compare recent to season average)
  const form = parseFloat(player.form) || 0;
  const ppg = parseFloat(player.points_per_game) || 0;
  if (ppg > 0 && form < ppg * 0.7) {
    const penalty = Math.round((1 - form / ppg) * 15);
    expendabilityScore += penalty;
    reasons.push({
      ...EXPENDABILITY_REASONS.DECLINING_FORM,
      detail: `Form ${form} vs season avg ${ppg.toFixed(1)}`,
      impact: penalty,
    });
  }

  // 6. Price drop risk (high transfers out)
  const netTransfers = (player.transfers_out_event || 0) - (player.transfers_in_event || 0);
  if (netTransfers > 50000) {
    expendabilityScore += 10;
    reasons.push({
      ...EXPENDABILITY_REASONS.PRICE_DROP,
      detail: `${(netTransfers / 1000).toFixed(0)}k net transfers out`,
      impact: 10,
    });
  }

  // Sort reasons by priority
  reasons.sort((a, b) => a.priority - b.priority);

  // Get primary reason (highest impact)
  const primaryReason = reasons.length > 0
    ? reasons.reduce((max, r) => r.impact > max.impact ? r : max, reasons[0])
    : null;

  return {
    expendabilityScore: Math.min(100, expendabilityScore),
    reasons,
    primaryReason,
    xpOverHorizon: totalXp,
    avgXpPerGw,
    xMins,
    statusMult,
    perGwData,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   7.2: SIMULATE LEGAL REPLACEMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Simulate all legal replacement options for transfer recommendations
 *
 * @param {Object} context - The squad context
 * @param {Object} weakestLinksResult - Result from identifyWeakestLinks
 * @param {Object} options - User controls and configuration
 * @returns {Promise<Object>} - Transfer recommendations
 */
export async function simulateReplacements(context, weakestLinksResult, options = {}) {
  const {
    lockedPlayerIds = [],
    excludedTeamIds = [],
    excludedPlayerIds = [],
    hitEnabled = true,
    hitThreshold = DEFAULT_CONFIG.hitThreshold,
    maxTransfers = 3,
    horizonGwCount = 5,
  } = options;

  const bs = context.bootstrap || state.bootstrap;
  if (!bs) {
    return { ok: false, error: "Bootstrap data not available" };
  }

  const squad = context.squad || [];
  const bank = context.bank || 0;
  const freeTransfers = context.freeTransfers || 1;

  // Get all available players
  const allPlayers = bs.elements || [];
  const teams = bs.teams || [];

  // Build club count map for constraint checking
  const clubCounts = buildClubCounts(squad);

  // Build GW IDs for horizon
  const gwIds = weakestLinksResult.gwIds;

  // Calculate xP for all players in the pool (this is expensive but necessary)
  const playerPool = await buildPlayerPool(
    allPlayers,
    squad,
    excludedTeamIds,
    excludedPlayerIds,
    gwIds,
    bs
  );

  // Generate all valid transfer scenarios
  const scenarios = [];

  // Scenario 1: Roll transfer (do nothing)
  const rollScenario = await evaluateRollScenario(context, squad, gwIds, freeTransfers);
  scenarios.push(rollScenario);

  // Scenario 2: Best single transfer (1FT or first hit)
  const singleTransferScenarios = await generateSingleTransferScenarios(
    context,
    weakestLinksResult.weakestLinks,
    playerPool,
    clubCounts,
    bank,
    gwIds,
    lockedPlayerIds
  );

  // Rank single transfer scenarios by net gain
  const rankedSingleTransfers = singleTransferScenarios
    .sort((a, b) => b.netGain - a.netGain)
    .slice(0, 10); // Top 10

  scenarios.push(...rankedSingleTransfers);

  // Scenario 3: Double/multiple transfers (if hit enabled)
  if (hitEnabled && freeTransfers < 2) {
    const multiTransferScenarios = await generateMultiTransferScenarios(
      context,
      weakestLinksResult.weakestLinks,
      playerPool,
      clubCounts,
      bank,
      gwIds,
      lockedPlayerIds,
      hitThreshold,
      Math.min(maxTransfers, 3) // Cap at 3 for performance
    );
    scenarios.push(...multiTransferScenarios);
  }

  // Determine recommendations based on FT state
  const recommendations = buildRecommendations(
    scenarios,
    freeTransfers,
    hitEnabled,
    hitThreshold
  );

  return {
    ok: true,
    recommendations,
    rollScenario,
    singleTransfers: rankedSingleTransfers,
    freeTransfers,
    bank,
    bankFormatted: `£${(bank / 10).toFixed(1)}m`,
    hitEnabled,
    hitThreshold,
    horizonGwCount,
  };
}

/**
 * Build club counts map from squad
 */
function buildClubCounts(squad) {
  const counts = new Map();
  squad.forEach(p => {
    const teamId = p.team;
    counts.set(teamId, (counts.get(teamId) || 0) + 1);
  });
  return counts;
}

/**
 * Build the pool of potential replacement players with xP calculated
 * Phase 9: Optimized with parallel xP calculation using batch processing
 */
async function buildPlayerPool(allPlayers, squad, excludedTeamIds, excludedPlayerIds, gwIds, bs) {
  const squadIds = new Set(squad.map(p => p.id));
  const excludedTeamSet = new Set(excludedTeamIds);
  const excludedPlayerSet = new Set(excludedPlayerIds);

  // Filter to available players not in squad
  const candidates = allPlayers.filter(p => {
    if (squadIds.has(p.id)) return false;
    if (excludedTeamSet.has(p.team)) return false;
    if (excludedPlayerSet.has(p.id)) return false;
    if (p.status === "u" || p.status === "n") return false; // Unavailable/not in squad
    return true;
  });

  // Calculate xP for top candidates by position (for performance, limit pool)
  // Sort by form + threat + creativity to get likely good picks
  const sortedCandidates = candidates.sort((a, b) => {
    const scoreA = (parseFloat(a.form) || 0) * 2 +
      (parseFloat(a.threat) || 0) / 100 +
      (parseFloat(a.creativity) || 0) / 100;
    const scoreB = (parseFloat(b.form) || 0) * 2 +
      (parseFloat(b.threat) || 0) / 100 +
      (parseFloat(b.creativity) || 0) / 100;
    return scoreB - scoreA;
  });

  // Take top 50 per position for xP calculation
  const byPosition = { 1: [], 2: [], 3: [], 4: [] };
  sortedCandidates.forEach(p => {
    const pos = p.element_type;
    if (byPosition[pos] && byPosition[pos].length < 50) {
      byPosition[pos].push(p);
    }
  });

  // Flatten all candidates for batch processing
  const allCandidates = [
    ...byPosition[1],
    ...byPosition[2],
    ...byPosition[3],
    ...byPosition[4],
  ];

  // Use batch xP calculation for parallel processing (major performance improvement)
  const xpResults = await xPWindowBatch(allCandidates, gwIds, {
    concurrency: 15, // Higher concurrency for faster results
  });

  // Build pool with xP data
  const poolWithXp = [];
  for (const player of allCandidates) {
    const xpResult = xpResults.get(player.id);
    if (xpResult && !xpResult.error) {
      poolWithXp.push({
        ...player,
        xpOverHorizon: xpResult.total || 0,
        avgXpPerGw: gwIds.length > 0 ? (xpResult.total || 0) / gwIds.length : 0,
        perGwData: xpResult.perGw || [],
      });
    }
  }

  return poolWithXp;
}

/**
 * Evaluate the "roll transfer" scenario (do nothing)
 */
async function evaluateRollScenario(context, squad, gwIds, freeTransfers) {
  let totalXp = 0;

  for (const player of squad) {
    try {
      const xpResult = await xPWindow(player, gwIds);
      totalXp += xpResult?.total || 0;
    } catch (e) {
      // Continue on error
    }
  }

  return {
    type: "roll",
    label: "Roll Transfer",
    description: freeTransfers >= 2
      ? `Bank ${freeTransfers} FTs for next GW`
      : "Save FT for next week",
    transfers: [],
    totalXp,
    hitCost: 0,
    netGain: 0, // Baseline
    ftAfter: Math.min(5, freeTransfers + 1), // FTs roll (max 5 with new rules)
    reason: freeTransfers >= 2
      ? "Already have multiple FTs banked"
      : "No compelling transfers available",
  };
}

/**
 * Generate single transfer scenarios
 */
async function generateSingleTransferScenarios(
  context,
  weakestLinks,
  playerPool,
  clubCounts,
  bank,
  gwIds,
  lockedPlayerIds
) {
  const scenarios = [];
  const lockedSet = new Set(lockedPlayerIds);

  // Consider top expendable players as "out" candidates
  const outCandidates = weakestLinks
    .filter(wl => !lockedSet.has(wl.player.id) && wl.isExpendable)
    .slice(0, 5);

  for (const outCandidate of outCandidates) {
    const playerOut = outCandidate.player;
    const positionId = playerOut.element_type;
    const sellPrice = playerOut.selling_price || playerOut.now_cost;
    const budget = bank + sellPrice;

    // Find valid replacements
    const validReplacements = playerPool.filter(p => {
      // Same position
      if (p.element_type !== positionId) return false;

      // Budget check
      if (p.now_cost > budget) return false;

      // Club limit check
      const currentCount = clubCounts.get(p.team) || 0;
      // If replacing from same team, limit is still 3
      // If different team, check if adding would exceed 3
      if (p.team !== playerOut.team && currentCount >= DEFAULT_CONFIG.maxPlayersPerClub) {
        return false;
      }

      return true;
    });

    // Sort by xP and take top 5
    const topReplacements = validReplacements
      .sort((a, b) => b.xpOverHorizon - a.xpOverHorizon)
      .slice(0, 5);

    for (const playerIn of topReplacements) {
      const xpGain = playerIn.xpOverHorizon - outCandidate.xpOverHorizon;
      const remainingBank = budget - playerIn.now_cost;

      scenarios.push({
        type: "single",
        label: `${playerOut.web_name} → ${playerIn.web_name}`,
        description: `Transfer out ${playerOut.web_name}, bring in ${playerIn.web_name}`,
        transfers: [{
          out: {
            player: playerOut,
            xpOverHorizon: outCandidate.xpOverHorizon,
            expendabilityScore: outCandidate.expendabilityScore,
            primaryReason: outCandidate.primaryReason,
            reasons: outCandidate.reasons,
          },
          in: {
            player: playerIn,
            xpOverHorizon: playerIn.xpOverHorizon,
            avgXpPerGw: playerIn.avgXpPerGw,
            cost: playerIn.now_cost,
            whyBest: buildWhyBest(playerIn, playerOut, xpGain, gwIds.length),
          },
          xpGain,
        }],
        totalXpGain: xpGain,
        hitCost: 0, // Assuming 1FT available
        netGain: xpGain,
        remainingBank,
        remainingBankFormatted: `£${(remainingBank / 10).toFixed(1)}m`,
      });
    }
  }

  return scenarios;
}

/**
 * Generate multi-transfer scenarios (hits)
 */
async function generateMultiTransferScenarios(
  context,
  weakestLinks,
  playerPool,
  clubCounts,
  bank,
  gwIds,
  lockedPlayerIds,
  hitThreshold,
  maxTransfers
) {
  // For performance, only consider 2-transfer hits
  // Full multi-transfer simulation would be too expensive

  const scenarios = [];
  const lockedSet = new Set(lockedPlayerIds);

  // Get top 3 expendable players
  const outCandidates = weakestLinks
    .filter(wl => !lockedSet.has(wl.player.id) && wl.isExpendable)
    .slice(0, 3);

  if (outCandidates.length < 2) {
    return scenarios;
  }

  // Try all pairs of out candidates
  for (let i = 0; i < outCandidates.length; i++) {
    for (let j = i + 1; j < outCandidates.length; j++) {
      const out1 = outCandidates[i];
      const out2 = outCandidates[j];

      const totalBudget = bank +
        (out1.player.selling_price || out1.player.now_cost) +
        (out2.player.selling_price || out2.player.now_cost);

      // Build temporary club counts after removing both
      const tempClubCounts = new Map(clubCounts);
      tempClubCounts.set(out1.player.team, (tempClubCounts.get(out1.player.team) || 1) - 1);
      tempClubCounts.set(out2.player.team, (tempClubCounts.get(out2.player.team) || 1) - 1);

      // Find best replacement for first out
      const pos1 = out1.player.element_type;
      const candidates1 = playerPool
        .filter(p => p.element_type === pos1)
        .sort((a, b) => b.xpOverHorizon - a.xpOverHorizon)
        .slice(0, 3);

      for (const in1 of candidates1) {
        const remainingBudget = totalBudget - in1.now_cost;

        // Update temp club counts for in1
        const tempClubCounts2 = new Map(tempClubCounts);
        tempClubCounts2.set(in1.team, (tempClubCounts2.get(in1.team) || 0) + 1);

        // Find best replacement for second out
        const pos2 = out2.player.element_type;
        const candidates2 = playerPool
          .filter(p => {
            if (p.element_type !== pos2) return false;
            if (p.id === in1.id) return false;
            if (p.now_cost > remainingBudget) return false;
            // Check club limit
            const count = tempClubCounts2.get(p.team) || 0;
            if (count >= DEFAULT_CONFIG.maxPlayersPerClub) return false;
            return true;
          })
          .sort((a, b) => b.xpOverHorizon - a.xpOverHorizon)
          .slice(0, 1);

        if (candidates2.length === 0) continue;

        const in2 = candidates2[0];
        const xpGain1 = in1.xpOverHorizon - out1.xpOverHorizon;
        const xpGain2 = in2.xpOverHorizon - out2.xpOverHorizon;
        const totalXpGain = xpGain1 + xpGain2;
        const hitCost = DEFAULT_CONFIG.hitCostPerTransfer; // -4 for the extra transfer
        const netGain = totalXpGain - hitCost;

        // Only include if net gain exceeds threshold
        if (netGain < hitThreshold) continue;

        const remainingBank = remainingBudget - in2.now_cost;

        scenarios.push({
          type: "hit",
          label: `Double move: ${out1.player.web_name}, ${out2.player.web_name} out`,
          description: `Take -${hitCost} hit for ${totalXpGain.toFixed(1)} xP gain`,
          transfers: [
            {
              out: {
                player: out1.player,
                xpOverHorizon: out1.xpOverHorizon,
                primaryReason: out1.primaryReason,
              },
              in: {
                player: in1,
                xpOverHorizon: in1.xpOverHorizon,
                cost: in1.now_cost,
                whyBest: buildWhyBest(in1, out1.player, xpGain1, gwIds.length),
              },
              xpGain: xpGain1,
            },
            {
              out: {
                player: out2.player,
                xpOverHorizon: out2.xpOverHorizon,
                primaryReason: out2.primaryReason,
              },
              in: {
                player: in2,
                xpOverHorizon: in2.xpOverHorizon,
                cost: in2.now_cost,
                whyBest: buildWhyBest(in2, out2.player, xpGain2, gwIds.length),
              },
              xpGain: xpGain2,
            },
          ],
          totalXpGain,
          hitCost,
          netGain,
          remainingBank,
          remainingBankFormatted: `£${(remainingBank / 10).toFixed(1)}m`,
        });
      }
    }
  }

  // Sort by net gain
  scenarios.sort((a, b) => b.netGain - a.netGain);

  return scenarios.slice(0, 5); // Top 5 hit scenarios
}

/**
 * Build explanation for why a player is the best fit
 */
function buildWhyBest(playerIn, playerOut, xpGain, horizonGws) {
  const reasons = [];

  // xP advantage
  if (xpGain > 0) {
    reasons.push(`+${xpGain.toFixed(1)} xP over ${horizonGws} GWs`);
  }

  // Form
  const form = parseFloat(playerIn.form) || 0;
  if (form >= 6) {
    reasons.push(`Excellent form (${form})`);
  } else if (form >= 4) {
    reasons.push(`Good form (${form})`);
  }

  // Minutes reliability
  if (playerIn.status === "a" && (playerIn.chance_of_playing_next_round === null || playerIn.chance_of_playing_next_round === 100)) {
    reasons.push("Nailed starter");
  }

  // Fixtures (from perGwData if available)
  if (playerIn.perGwData && playerIn.perGwData.length > 0) {
    const avgFdr = playerIn.perGwData.reduce((s, g) => s + (g.fdr || 3), 0) / playerIn.perGwData.length;
    if (avgFdr <= 2.5) {
      reasons.push(`Great fixtures (avg FDR ${avgFdr.toFixed(1)})`);
    } else if (avgFdr <= 3) {
      reasons.push(`Good fixtures (avg FDR ${avgFdr.toFixed(1)})`);
    }
  }

  // Ownership momentum
  const netTransfers = (playerIn.transfers_in_event || 0) - (playerIn.transfers_out_event || 0);
  if (netTransfers > 100000) {
    reasons.push("High transfer in demand");
  }

  // Value
  const ppm = playerIn.total_points && playerIn.now_cost
    ? playerIn.total_points / (playerIn.now_cost / 10)
    : 0;
  if (ppm > 15) {
    reasons.push("Excellent value");
  }

  return reasons.slice(0, 3).join("; ") || "Best available option by xP";
}

/**
 * Build final recommendations from all scenarios
 */
function buildRecommendations(scenarios, freeTransfers, hitEnabled, hitThreshold) {
  const recommendations = {
    best: null,
    rollOption: null,
    singleTransfers: [],
    hitOptions: [],
    action: "hold",
    actionReason: "",
  };

  // Find roll scenario
  recommendations.rollOption = scenarios.find(s => s.type === "roll");

  // Find single transfer scenarios
  recommendations.singleTransfers = scenarios
    .filter(s => s.type === "single")
    .sort((a, b) => b.netGain - a.netGain)
    .slice(0, 5);

  // Find hit scenarios
  if (hitEnabled) {
    recommendations.hitOptions = scenarios
      .filter(s => s.type === "hit" && s.netGain >= hitThreshold)
      .sort((a, b) => b.netGain - a.netGain)
      .slice(0, 3);
  }

  // Determine best recommendation
  const bestSingle = recommendations.singleTransfers[0];
  const bestHit = recommendations.hitOptions[0];

  // Decision logic
  if (freeTransfers >= 2 && (!bestSingle || bestSingle.netGain < DEFAULT_CONFIG.minGainThreshold)) {
    // If we have 2+ FTs and no compelling transfer, suggest rolling
    recommendations.best = recommendations.rollOption;
    recommendations.action = "roll";
    recommendations.actionReason = "No transfer offers compelling value. Bank your FT.";
  } else if (bestSingle && bestSingle.netGain >= DEFAULT_CONFIG.minGainThreshold) {
    // If there's a good single transfer
    if (bestHit && bestHit.netGain > bestSingle.netGain + hitThreshold) {
      // Hit is significantly better
      recommendations.best = bestHit;
      recommendations.action = "hit";
      recommendations.actionReason = `Take -${bestHit.hitCost} hit for +${bestHit.netGain.toFixed(1)} net gain`;
    } else {
      recommendations.best = bestSingle;
      recommendations.action = "transfer";
      recommendations.actionReason = `Use FT for +${bestSingle.netGain.toFixed(1)} xP gain`;
    }
  } else if (freeTransfers === 1) {
    // 1 FT but no compelling transfer - suggest rolling
    recommendations.best = recommendations.rollOption;
    recommendations.action = "roll";
    recommendations.actionReason = "Save your FT - no transfer offers enough value.";
  } else {
    // Default to roll
    recommendations.best = recommendations.rollOption;
    recommendations.action = "hold";
    recommendations.actionReason = "Current squad is optimal for the horizon.";
  }

  return recommendations;
}

/* ═══════════════════════════════════════════════════════════════════════════
   USER CONTROLS - State Management
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Load transfer optimizer settings from storage
 */
export function loadTransferSettings() {
  return {
    lockedPlayerIds: getJSON(TRANSFER_STORAGE_KEYS.LOCKED_PLAYERS, []),
    excludedTeamIds: getJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_TEAMS, []),
    excludedPlayerIds: getJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_PLAYERS, []),
    hitEnabled: getJSON(TRANSFER_STORAGE_KEYS.HIT_ENABLED, true),
    hitThreshold: getJSON(TRANSFER_STORAGE_KEYS.HIT_THRESHOLD, DEFAULT_CONFIG.hitThreshold),
  };
}

/**
 * Save transfer optimizer settings to storage
 */
export function saveTransferSettings(settings) {
  if (settings.lockedPlayerIds !== undefined) {
    setJSON(TRANSFER_STORAGE_KEYS.LOCKED_PLAYERS, settings.lockedPlayerIds);
  }
  if (settings.excludedTeamIds !== undefined) {
    setJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_TEAMS, settings.excludedTeamIds);
  }
  if (settings.excludedPlayerIds !== undefined) {
    setJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_PLAYERS, settings.excludedPlayerIds);
  }
  if (settings.hitEnabled !== undefined) {
    setJSON(TRANSFER_STORAGE_KEYS.HIT_ENABLED, settings.hitEnabled);
  }
  if (settings.hitThreshold !== undefined) {
    setJSON(TRANSFER_STORAGE_KEYS.HIT_THRESHOLD, settings.hitThreshold);
  }
}

/**
 * Lock a player (exempt from transfer out suggestions)
 */
export function lockPlayer(playerId) {
  const locked = getJSON(TRANSFER_STORAGE_KEYS.LOCKED_PLAYERS, []);
  if (!locked.includes(playerId)) {
    locked.push(playerId);
    setJSON(TRANSFER_STORAGE_KEYS.LOCKED_PLAYERS, locked);
  }
  return locked;
}

/**
 * Unlock a player
 */
export function unlockPlayer(playerId) {
  const locked = getJSON(TRANSFER_STORAGE_KEYS.LOCKED_PLAYERS, []);
  const updated = locked.filter(id => id !== playerId);
  setJSON(TRANSFER_STORAGE_KEYS.LOCKED_PLAYERS, updated);
  return updated;
}

/**
 * Exclude a team from transfer targets
 */
export function excludeTeam(teamId) {
  const excluded = getJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_TEAMS, []);
  if (!excluded.includes(teamId)) {
    excluded.push(teamId);
    setJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_TEAMS, excluded);
  }
  return excluded;
}

/**
 * Include a team back into transfer targets
 */
export function includeTeam(teamId) {
  const excluded = getJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_TEAMS, []);
  const updated = excluded.filter(id => id !== teamId);
  setJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_TEAMS, updated);
  return updated;
}

/**
 * Exclude a specific player from transfer targets
 */
export function excludePlayer(playerId) {
  const excluded = getJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_PLAYERS, []);
  if (!excluded.includes(playerId)) {
    excluded.push(playerId);
    setJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_PLAYERS, excluded);
  }
  return excluded;
}

/**
 * Include a player back into transfer targets
 */
export function includePlayer(playerId) {
  const excluded = getJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_PLAYERS, []);
  const updated = excluded.filter(id => id !== playerId);
  setJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_PLAYERS, updated);
  return updated;
}

/**
 * Set hit allowance toggle
 */
export function setHitEnabled(enabled) {
  setJSON(TRANSFER_STORAGE_KEYS.HIT_ENABLED, enabled);
  return enabled;
}

/**
 * Set hit threshold (minimum net gain to recommend a hit)
 */
export function setHitThreshold(threshold) {
  const clamped = clamp(threshold, 0, 20);
  setJSON(TRANSFER_STORAGE_KEYS.HIT_THRESHOLD, clamped);
  return clamped;
}

/**
 * Reset all transfer settings to defaults
 */
export function resetTransferSettings() {
  setJSON(TRANSFER_STORAGE_KEYS.LOCKED_PLAYERS, []);
  setJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_TEAMS, []);
  setJSON(TRANSFER_STORAGE_KEYS.EXCLUDED_PLAYERS, []);
  setJSON(TRANSFER_STORAGE_KEYS.HIT_ENABLED, true);
  setJSON(TRANSFER_STORAGE_KEYS.HIT_THRESHOLD, DEFAULT_CONFIG.hitThreshold);
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN ENTRY POINT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Run the complete transfer optimization pipeline
 * Phase 10: With smart recompute detection and perf timing
 *
 * @param {Object} context - The squad context from loadContext()
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} - Complete transfer analysis
 */
export async function runTransferOptimization(context, options = {}) {
  const totalStart = perfStart();

  const settings = loadTransferSettings();
  const mergedOptions = { ...settings, ...options };

  // Phase 10: Generate optimization key to detect if recompute is needed
  const optimizationKey = generateOptimizationKey(context, mergedOptions);
  if (optimizationKey === lastOptimizationKey && lastOptimizationResult) {
    if (isDev) console.log("[Perf] Returning cached optimization result");
    return lastOptimizationResult;
  }

  // Step 1: Identify weakest links
  const step1Start = perfStart();
  const weakestLinksResult = await identifyWeakestLinks(context, mergedOptions);
  perfLog("Step 1: Identify weakest links", step1Start);

  if (!weakestLinksResult.ok) {
    return { ok: false, error: weakestLinksResult.error };
  }

  // Step 2: Simulate replacements
  const step2Start = perfStart();
  const replacementsResult = await simulateReplacements(
    context,
    weakestLinksResult,
    mergedOptions
  );
  perfLog("Step 2: Simulate replacements", step2Start);

  if (!replacementsResult.ok) {
    return { ok: false, error: replacementsResult.error };
  }

  // Combine results
  const result = {
    ok: true,
    weakestLinks: weakestLinksResult.weakestLinks,
    lockedPlayers: weakestLinksResult.lockedPlayers,
    recommendations: replacementsResult.recommendations,
    rollScenario: replacementsResult.rollScenario,
    singleTransfers: replacementsResult.singleTransfers,
    freeTransfers: replacementsResult.freeTransfers,
    bank: replacementsResult.bank,
    bankFormatted: replacementsResult.bankFormatted,
    horizonGwCount: mergedOptions.horizonGwCount || 5,
    gwIds: weakestLinksResult.gwIds,
    settings: mergedOptions,
  };

  // Cache for smart recompute detection
  lastOptimizationKey = optimizationKey;
  lastOptimizationResult = result;

  perfLog("Total optimization time", totalStart);

  return result;
}

/**
 * Phase 10: Generate key for smart recompute detection
 * Only recompute if horizon, objective, locked players, or settings change
 */
function generateOptimizationKey(context, options) {
  const squad = context.squad || [];
  const squadIds = squad.map(p => p.id).sort().join(",");
  const bsTimestamp = state.bootstrap?.timestamp || 0;

  return [
    squadIds,
    context.freeTransfers,
    context.bank,
    options.horizonGwCount,
    options.hitEnabled,
    options.hitThreshold,
    (options.lockedPlayerIds || []).sort().join(","),
    (options.excludedTeamIds || []).sort().join(","),
    bsTimestamp,
  ].join("|");
}

export default {
  identifyWeakestLinks,
  simulateReplacements,
  runTransferOptimization,
  loadTransferSettings,
  saveTransferSettings,
  lockPlayer,
  unlockPlayer,
  excludeTeam,
  includeTeam,
  excludePlayer,
  includePlayer,
  setHitEnabled,
  setHitThreshold,
  resetTransferSettings,
  TRANSFER_STORAGE_KEYS,
  EXPENDABILITY_REASONS,
};
