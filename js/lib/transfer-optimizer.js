// js/lib/transfer-optimizer.js
// Phase 7: Transfer Optimisation Engine
// Constrained simulation with explicit reasoning for all recommendations

import { xPWindow, estimateXMinsForPlayer, statusMultiplier, fdrWeight } from "./xp.js";
import { state } from "../state.js";

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURATION DEFAULTS
   ═══════════════════════════════════════════════════════════════════════════ */

export const OPTIMIZER_DEFAULTS = {
  hitThreshold: 4,        // Minimum xP gain required per hit (-4 penalty)
  allowHits: true,        // Whether to consider transfers that incur hits
  maxHits: 2,             // Maximum number of hits to consider (max -8 penalty)
  horizonGws: 3,          // Number of GWs to project xP over
  minXMinsForNailed: 60,  // Minimum xMins to consider "nailed"
  clubLimit: 3,           // FPL rule: max players per club
};

/* ═══════════════════════════════════════════════════════════════════════════
   EXPENDABILITY REASONS - Explicit flags for why a player is weak
   ═══════════════════════════════════════════════════════════════════════════ */

export const EXPENDABILITY_REASONS = {
  LOW_XP: { id: "low_xp", label: "Low xP", description: "Expected points below squad average" },
  POOR_FIXTURES: { id: "poor_fixtures", label: "Poor Fixtures", description: "Difficult fixtures ahead (FDR 4-5)" },
  INJURY_DOUBT: { id: "injury_doubt", label: "Injury/Doubt", description: "Status not available (d/i/n/s)" },
  LOW_MINUTES: { id: "low_minutes", label: "Low Minutes", description: "Rotation risk - low xMins projection" },
  PRICE_DROP: { id: "price_drop", label: "Price Drop Risk", description: "Negative transfer balance, likely to drop" },
  BLANK_GW: { id: "blank_gw", label: "Blank GW", description: "No fixture in upcoming gameweek(s)" },
  POOR_FORM: { id: "poor_form", label: "Poor Form", description: "Recent returns below expectations" },
  LOW_VALUE: { id: "low_value", label: "Low Value", description: "Points per million below position average" },
};

/* ═══════════════════════════════════════════════════════════════════════════
   REPLACEMENT REASONS - Explicit flags for why a player is a good fit
   ═══════════════════════════════════════════════════════════════════════════ */

export const REPLACEMENT_REASONS = {
  HIGH_XP: { id: "high_xp", label: "High xP", description: "Top expected points in price bracket" },
  GOOD_FIXTURES: { id: "good_fixtures", label: "Good Fixtures", description: "Favorable fixtures ahead (FDR 2-3)" },
  NAILED: { id: "nailed", label: "Nailed", description: "High minutes reliability (90+ xMins)" },
  IN_FORM: { id: "in_form", label: "In Form", description: "Recent strong returns" },
  VALUE_PICK: { id: "value_pick", label: "Value Pick", description: "Strong points per million" },
  PRICE_RISE: { id: "price_rise", label: "Price Rise Potential", description: "Positive transfer momentum" },
  DGW_TARGET: { id: "dgw_target", label: "DGW Target", description: "Has double gameweek fixture" },
  DIFFERENTIAL: { id: "differential", label: "Differential", description: "Low ownership for rank gains" },
};

/* ═══════════════════════════════════════════════════════════════════════════
   7.1 - IDENTIFY WEAKEST CONTRIBUTORS
   Scores each squad player and flags expendable ones with explicit reasons
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Calculate expendability score for a player over a horizon
 * Higher score = more expendable (worse)
 * Returns { score, reasons[], xpTotal, xpPerGw, xMins, details }
 */
export async function calculateExpendability(player, horizonGwIds, fixturesByTeam, allPlayers) {
  const reasons = [];
  const details = {};

  // Get xP projection over horizon
  let xpTotal = 0;
  let xMins = 0;
  let fixtureCount = 0;
  let avgFdr = 0;

  try {
    const xpData = await xPWindow(player, horizonGwIds);
    xpTotal = xpData.total;

    // Get xMins estimate
    xMins = await estimateXMinsForPlayer(player);

    // Calculate fixture difficulty
    const teamFixtures = fixturesByTeam?.get(player.team) || [];
    const relevantFixtures = teamFixtures.filter(f => horizonGwIds.includes(f.gw));
    fixtureCount = relevantFixtures.length;

    if (relevantFixtures.length > 0) {
      avgFdr = relevantFixtures.reduce((sum, f) => sum + f.fdr, 0) / relevantFixtures.length;
    }
  } catch (e) {
    // Fallback for players with no data
    xpTotal = 0;
    xMins = 0;
  }

  details.xpTotal = xpTotal;
  details.xpPerGw = horizonGwIds.length ? xpTotal / horizonGwIds.length : 0;
  details.xMins = xMins;
  details.fixtureCount = fixtureCount;
  details.avgFdr = avgFdr;

  // Calculate position average xP for comparison
  const positionPlayers = allPlayers.filter(p => p.element_type === player.element_type);
  const topPositionXp = positionPlayers
    .slice()
    .sort((a, b) => parseFloat(b.form || 0) - parseFloat(a.form || 0))
    .slice(0, 20);
  const avgPositionForm = topPositionXp.reduce((sum, p) => sum + parseFloat(p.form || 0), 0) / (topPositionXp.length || 1);

  // Calculate expendability score (0-100, higher = more expendable)
  let expendabilityScore = 0;

  // 1. Low xP contribution (30 points max)
  const xpPerGw = details.xpPerGw;
  if (xpPerGw < 3) {
    expendabilityScore += 30;
    reasons.push({ ...EXPENDABILITY_REASONS.LOW_XP, value: xpPerGw.toFixed(2) });
  } else if (xpPerGw < 4) {
    expendabilityScore += 20;
    reasons.push({ ...EXPENDABILITY_REASONS.LOW_XP, value: xpPerGw.toFixed(2) });
  } else if (xpPerGw < 5) {
    expendabilityScore += 10;
  }

  // 2. Poor fixtures (20 points max)
  if (avgFdr >= 4.5) {
    expendabilityScore += 20;
    reasons.push({ ...EXPENDABILITY_REASONS.POOR_FIXTURES, value: avgFdr.toFixed(1) });
  } else if (avgFdr >= 4) {
    expendabilityScore += 15;
    reasons.push({ ...EXPENDABILITY_REASONS.POOR_FIXTURES, value: avgFdr.toFixed(1) });
  } else if (avgFdr >= 3.5) {
    expendabilityScore += 8;
  }

  // 3. Injury/doubt status (25 points max)
  if (player.status === 'i' || player.status === 'n') {
    expendabilityScore += 25;
    reasons.push({ ...EXPENDABILITY_REASONS.INJURY_DOUBT, value: player.status });
  } else if (player.status === 'd' || player.status === 's') {
    expendabilityScore += 15;
    reasons.push({ ...EXPENDABILITY_REASONS.INJURY_DOUBT, value: player.status });
  }

  // 4. Low minutes (15 points max)
  if (xMins < 30) {
    expendabilityScore += 15;
    reasons.push({ ...EXPENDABILITY_REASONS.LOW_MINUTES, value: `${Math.round(xMins)}'` });
  } else if (xMins < 60) {
    expendabilityScore += 10;
    reasons.push({ ...EXPENDABILITY_REASONS.LOW_MINUTES, value: `${Math.round(xMins)}'` });
  }

  // 5. Blank gameweek (10 points max)
  if (fixtureCount === 0) {
    expendabilityScore += 10;
    reasons.push({ ...EXPENDABILITY_REASONS.BLANK_GW, value: "No fixture" });
  } else if (fixtureCount < horizonGwIds.length) {
    expendabilityScore += 5;
  }

  // 6. Poor form (10 points max)
  const form = parseFloat(player.form || 0);
  if (form < avgPositionForm * 0.5) {
    expendabilityScore += 10;
    reasons.push({ ...EXPENDABILITY_REASONS.POOR_FORM, value: form.toFixed(1) });
  } else if (form < avgPositionForm * 0.75) {
    expendabilityScore += 5;
  }

  // 7. Price drop risk (5 points max)
  const netTransfers = (player.transfers_in_event || 0) - (player.transfers_out_event || 0);
  if (netTransfers < -50000) {
    expendabilityScore += 5;
    reasons.push({ ...EXPENDABILITY_REASONS.PRICE_DROP, value: netTransfers.toLocaleString() });
  }

  // 8. Low value (5 points max)
  const priceM = player.now_cost / 10;
  const ppm = player.total_points / priceM;
  const avgPpm = positionPlayers.reduce((sum, p) => sum + (p.total_points / (p.now_cost / 10)), 0) / (positionPlayers.length || 1);
  if (ppm < avgPpm * 0.6) {
    expendabilityScore += 5;
    reasons.push({ ...EXPENDABILITY_REASONS.LOW_VALUE, value: ppm.toFixed(1) });
  }

  return {
    score: Math.min(100, expendabilityScore),
    reasons,
    xpTotal,
    xpPerGw: details.xpPerGw,
    xMins,
    fixtureCount,
    avgFdr,
    details,
  };
}

/**
 * Rank all squad players by expendability
 * Returns sorted array with most expendable first
 */
export async function rankSquadByExpendability(squad, horizonGwIds, fixturesByTeam, allPlayers, lockedPlayerIds = new Set()) {
  const results = [];

  for (const player of squad) {
    const isLocked = lockedPlayerIds.has(player.id);

    if (isLocked) {
      results.push({
        player,
        expendability: { score: 0, reasons: [{ id: "locked", label: "LOCKED", description: "User locked this player" }] },
        isLocked: true,
      });
      continue;
    }

    const expendability = await calculateExpendability(player, horizonGwIds, fixturesByTeam, allPlayers);
    results.push({
      player,
      expendability,
      isLocked: false,
    });
  }

  // Sort by expendability score (highest = most expendable first)
  results.sort((a, b) => b.expendability.score - a.expendability.score);

  return results;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7.2 - SIMULATE LEGAL REPLACEMENTS
   Find optimal transfers respecting all FPL constraints
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Get all valid replacements for a player
 * Respects: budget, position, club limit (3), no duplicates
 */
export async function findValidReplacements(
  playerOut,
  squad,
  allPlayers,
  teamsById,
  posById,
  horizonGwIds,
  bank,
  options = {}
) {
  const {
    excludeTeamIds = new Set(),
    excludePlayerIds = new Set(),
    preferNailed = false,
    maxResults = 20,
  } = options;

  const budget = bank + (playerOut.now_cost / 10);
  const positionId = playerOut.element_type;
  const squadIds = new Set(squad.map(p => p.id));

  // Calculate club counts
  const clubCounts = new Map();
  squad.forEach(p => {
    if (p.id !== playerOut.id) {
      clubCounts.set(p.team, (clubCounts.get(p.team) || 0) + 1);
    }
  });

  // Filter valid candidates
  const candidates = allPlayers.filter(p => {
    // Same position
    if (p.element_type !== positionId) return false;

    // Not already in squad
    if (squadIds.has(p.id)) return false;

    // Within budget
    if (p.now_cost / 10 > budget + 0.001) return false;

    // Not excluded player
    if (excludePlayerIds.has(p.id)) return false;

    // Not from excluded team
    if (excludeTeamIds.has(p.team)) return false;

    // Club limit (max 3 per team)
    const currentCount = clubCounts.get(p.team) || 0;
    if (currentCount >= 3) return false;

    // Prefer nailed (optional)
    if (preferNailed && (p.status === 'i' || p.status === 'n')) return false;

    return true;
  });

  // Calculate xP and reasons for each candidate
  const results = [];

  for (const candidate of candidates.slice(0, 100)) { // Limit to top 100 for performance
    try {
      const xpData = await xPWindow(candidate, horizonGwIds);
      const xMins = await estimateXMinsForPlayer(candidate);

      // Calculate replacement reasons
      const reasons = [];

      // High xP
      if (xpData.total / horizonGwIds.length > 5) {
        reasons.push({ ...REPLACEMENT_REASONS.HIGH_XP, value: (xpData.total / horizonGwIds.length).toFixed(2) });
      }

      // Nailed
      if (xMins >= 80) {
        reasons.push({ ...REPLACEMENT_REASONS.NAILED, value: `${Math.round(xMins)}'` });
      }

      // In form
      if (parseFloat(candidate.form || 0) >= 6) {
        reasons.push({ ...REPLACEMENT_REASONS.IN_FORM, value: candidate.form });
      }

      // Value pick
      const ppm = candidate.total_points / (candidate.now_cost / 10);
      if (ppm > 15) {
        reasons.push({ ...REPLACEMENT_REASONS.VALUE_PICK, value: ppm.toFixed(1) });
      }

      // Price rise potential
      const netTransfers = (candidate.transfers_in_event || 0) - (candidate.transfers_out_event || 0);
      if (netTransfers > 50000) {
        reasons.push({ ...REPLACEMENT_REASONS.PRICE_RISE, value: `+${(netTransfers / 1000).toFixed(0)}k` });
      }

      // Differential
      const ownership = parseFloat(candidate.selected_by_percent || 0);
      if (ownership < 10) {
        reasons.push({ ...REPLACEMENT_REASONS.DIFFERENTIAL, value: `${ownership.toFixed(1)}%` });
      }

      results.push({
        player: candidate,
        xpTotal: xpData.total,
        xpPerGw: xpData.total / horizonGwIds.length,
        xMins,
        price: candidate.now_cost / 10,
        team: teamsById.get(candidate.team)?.short_name || "?",
        teamId: candidate.team,
        position: posById.get(candidate.element_type) || "?",
        reasons,
        remainingBudget: budget - (candidate.now_cost / 10),
      });
    } catch (e) {
      // Skip players with calculation errors
    }
  }

  // Sort by xP (highest first)
  results.sort((a, b) => b.xpTotal - a.xpTotal);

  return results.slice(0, maxResults);
}

/**
 * Calculate net gain for a transfer
 * Returns { grossGain, hitPenalty, netGain }
 */
function calculateTransferGain(xpOut, xpIn, isHit) {
  const grossGain = xpIn - xpOut;
  const hitPenalty = isHit ? 4 : 0;
  const netGain = grossGain - hitPenalty;

  return { grossGain, hitPenalty, netGain };
}

/**
 * Simulate all transfer scenarios
 * Returns: { rollTransfer, oneTransferOptions[], hitOptions[] }
 */
export async function simulateTransferScenarios(
  squad,
  allPlayers,
  teamsById,
  posById,
  horizonGwIds,
  bank,
  freeTransfers,
  fixturesByTeam,
  options = {}
) {
  const {
    lockedPlayerIds = new Set(),
    excludeTeamIds = new Set(),
    excludePlayerIds = new Set(),
    allowHits = true,
    hitThreshold = OPTIMIZER_DEFAULTS.hitThreshold,
    maxHits = OPTIMIZER_DEFAULTS.maxHits,
  } = options;

  // Step 1: Rank squad by expendability
  const rankedSquad = await rankSquadByExpendability(
    squad,
    horizonGwIds,
    fixturesByTeam,
    allPlayers,
    lockedPlayerIds
  );

  // Filter to unlocked, expendable players
  const expendablePlayers = rankedSquad
    .filter(r => !r.isLocked && r.expendability.score > 0)
    .slice(0, 10); // Consider top 10 most expendable

  const results = {
    rankedSquad,
    rollTransfer: null,
    oneTransferOptions: [],
    hitOptions: [],
    squadXpTotal: 0,
    squadXpPerGw: 0,
  };

  // Calculate current squad total xP
  let squadXpTotal = 0;
  for (const p of squad) {
    try {
      const xpData = await xPWindow(p, horizonGwIds);
      squadXpTotal += xpData.total;
    } catch (e) {
      // Skip on error
    }
  }
  results.squadXpTotal = squadXpTotal;
  results.squadXpPerGw = squadXpTotal / horizonGwIds.length;

  // Step 2: Find best transfers for each expendable player
  const allTransferOptions = [];

  for (const { player: playerOut, expendability } of expendablePlayers) {
    const replacements = await findValidReplacements(
      playerOut,
      squad,
      allPlayers,
      teamsById,
      posById,
      horizonGwIds,
      bank,
      { excludeTeamIds, excludePlayerIds, preferNailed: true }
    );

    // Get xP of player going out
    let xpOut = 0;
    try {
      const xpData = await xPWindow(playerOut, horizonGwIds);
      xpOut = xpData.total;
    } catch (e) {
      // Use 0 on error
    }

    for (const replacement of replacements.slice(0, 5)) { // Top 5 replacements per player
      const { grossGain, hitPenalty, netGain } = calculateTransferGain(
        xpOut,
        replacement.xpTotal,
        freeTransfers === 0
      );

      allTransferOptions.push({
        out: {
          player: playerOut,
          xp: xpOut,
          xpPerGw: xpOut / horizonGwIds.length,
          price: playerOut.now_cost / 10,
          team: teamsById.get(playerOut.team)?.short_name || "?",
          expendabilityScore: expendability.score,
          expendabilityReasons: expendability.reasons,
        },
        in: {
          player: replacement.player,
          xp: replacement.xpTotal,
          xpPerGw: replacement.xpPerGw,
          price: replacement.price,
          team: replacement.team,
          reasons: replacement.reasons,
        },
        grossGain,
        hitPenalty: freeTransfers === 0 ? 4 : 0,
        netGain: freeTransfers === 0 ? grossGain - 4 : grossGain,
        remainingBank: replacement.remainingBudget,
        isHit: freeTransfers === 0,
      });
    }
  }

  // Sort all options by net gain
  allTransferOptions.sort((a, b) => b.netGain - a.netGain);

  // Step 3: Categorize results

  // Roll transfer = do nothing (baseline)
  results.rollTransfer = {
    action: "ROLL",
    description: "Save transfer for next week",
    netGain: 0,
    newFreeTransfers: Math.min(freeTransfers + 1, 2),
    squadXp: squadXpTotal,
  };

  // 1FT options (or using available free transfers)
  const ftOptions = allTransferOptions.filter(t => !t.isHit || freeTransfers > 0);
  results.oneTransferOptions = ftOptions.slice(0, 10).map(t => ({
    ...t,
    hitPenalty: 0,
    netGain: t.grossGain,
    isHit: false,
  }));

  // Hit options (only if allowed and meets threshold)
  if (allowHits && freeTransfers === 0) {
    const viableHits = allTransferOptions.filter(t => t.grossGain >= hitThreshold);
    results.hitOptions = viableHits.slice(0, 5);
  } else if (allowHits && freeTransfers === 1) {
    // Can do 2 transfers (1 FT + 1 hit)
    // This requires more complex multi-transfer simulation
    // For now, show single transfer options
    const viableHits = allTransferOptions.filter(t => t.grossGain >= hitThreshold);
    results.hitOptions = viableHits.slice(0, 5).map(t => ({
      ...t,
      hitPenalty: 4,
      netGain: t.grossGain - 4,
      isHit: true,
    }));
  }

  return results;
}

/**
 * Build fixture lookup by team
 * Returns Map<teamId, {gw, home, opp, fdr}[]>
 */
export async function buildFixturesByTeam(fixtures, horizonGwIds) {
  const byTeam = new Map();

  for (const f of fixtures) {
    if (!horizonGwIds.includes(f.event)) continue;

    // Home team entry
    if (!byTeam.has(f.team_h)) byTeam.set(f.team_h, []);
    byTeam.get(f.team_h).push({
      gw: f.event,
      home: true,
      opp: f.team_a,
      fdr: f.team_h_difficulty || 3,
    });

    // Away team entry
    if (!byTeam.has(f.team_a)) byTeam.set(f.team_a, []);
    byTeam.get(f.team_a).push({
      gw: f.event,
      home: false,
      opp: f.team_h,
      fdr: f.team_a_difficulty || 3,
    });
  }

  return byTeam;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSFER SUGGESTION FORMATTER
   Builds the output structure for UI consumption
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Format a transfer suggestion for display
 * Includes all acceptance criteria fields
 */
export function formatTransferSuggestion(transfer, bank) {
  return {
    // Core transfer info
    out: {
      id: transfer.out.player.id,
      name: transfer.out.player.web_name,
      team: transfer.out.team,
      position: transfer.out.player.element_type,
      price: transfer.out.price,
      xpTotal: transfer.out.xp,
      xpPerGw: transfer.out.xpPerGw,
    },
    in: {
      id: transfer.in.player.id,
      name: transfer.in.player.web_name,
      team: transfer.in.team,
      position: transfer.in.player.element_type,
      price: transfer.in.price,
      xpTotal: transfer.in.xp,
      xpPerGw: transfer.in.xpPerGw,
    },

    // Acceptance criteria
    projectedGain: {
      gross: transfer.grossGain,
      penalty: transfer.hitPenalty,
      net: transfer.netGain,
    },
    remainingITB: transfer.remainingBank,

    // Explicit reasoning
    whyOutExpendable: {
      score: transfer.out.expendabilityScore,
      reasons: transfer.out.expendabilityReasons.map(r => ({
        label: r.label,
        description: r.description,
        value: r.value,
      })),
    },
    whyInBestFit: {
      reasons: transfer.in.reasons.map(r => ({
        label: r.label,
        description: r.description,
        value: r.value,
      })),
    },

    isHit: transfer.isHit,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MULTI-TRANSFER OPTIMIZER
   Handles 2+ transfers with hit evaluation
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Find optimal multi-transfer sequence
 * Respects budget cascading and club limits across moves
 */
export async function optimizeMultiTransfer(
  squad,
  allPlayers,
  teamsById,
  posById,
  horizonGwIds,
  bank,
  freeTransfers,
  fixturesByTeam,
  options = {}
) {
  const {
    maxMoves = 3,
    hitThreshold = OPTIMIZER_DEFAULTS.hitThreshold,
    lockedPlayerIds = new Set(),
    excludeTeamIds = new Set(),
    excludePlayerIds = new Set(),
  } = options;

  // Start with base squad
  let currentSquad = [...squad];
  let currentBank = bank;
  let totalGain = 0;
  let totalPenalty = 0;
  const moves = [];

  for (let i = 0; i < maxMoves; i++) {
    const isHit = i >= freeTransfers;
    const minGainRequired = isHit ? hitThreshold : 0;

    // Find best single transfer
    const results = await simulateTransferScenarios(
      currentSquad,
      allPlayers,
      teamsById,
      posById,
      horizonGwIds,
      currentBank,
      Math.max(0, freeTransfers - i),
      fixturesByTeam,
      { lockedPlayerIds, excludeTeamIds, excludePlayerIds, allowHits: false }
    );

    const bestOption = results.oneTransferOptions[0];

    if (!bestOption || bestOption.grossGain < minGainRequired) {
      break; // No more profitable moves
    }

    // Apply the transfer
    const outIdx = currentSquad.findIndex(p => p.id === bestOption.out.player.id);
    if (outIdx >= 0) {
      currentSquad[outIdx] = bestOption.in.player;
      currentBank = bestOption.remainingBank;
      totalGain += bestOption.grossGain;
      if (isHit) totalPenalty += 4;

      moves.push({
        out: bestOption.out,
        in: bestOption.in,
        grossGain: bestOption.grossGain,
        isHit,
        hitPenalty: isHit ? 4 : 0,
        remainingBank: currentBank,
      });

      // Add the transferred-out player to exclusions for next iteration
      excludePlayerIds.add(bestOption.out.player.id);
    } else {
      break;
    }
  }

  return {
    moves,
    totalGrossGain: totalGain,
    totalPenalty,
    totalNetGain: totalGain - totalPenalty,
    finalBank: currentBank,
    finalSquad: currentSquad,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════════════ */

export default {
  OPTIMIZER_DEFAULTS,
  EXPENDABILITY_REASONS,
  REPLACEMENT_REASONS,
  calculateExpendability,
  rankSquadByExpendability,
  findValidReplacements,
  simulateTransferScenarios,
  buildFixturesByTeam,
  formatTransferSuggestion,
  optimizeMultiTransfer,
};
