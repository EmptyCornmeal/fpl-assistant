// js/lib/benchOptimizer.js
// Phase 8: Bench Order Optimisation + Chip Suggestions (conservative, low-noise)
// - 8.1: Display recommended bench sequence, warn if suboptimal
// - 8.2: Chip suggestions only when thresholds met (BB/TC)

import { state } from "../state.js";
import { xPForGw, estimateXMinsForPlayer, clamp } from "./xp.js";

/* ============================================================================
   CONFIGURATION - Conservative thresholds to avoid spam
   ============================================================================ */

export const CHIP_CONFIG = {
  // Bench Boost thresholds
  BB_MIN_BENCH_XP: 14,         // Minimum total bench xP to consider BB
  BB_MIN_PER_PLAYER_XP: 3,     // Each bench player should average at least this
  BB_CONFIDENCE_HIGH: 18,      // Bench xP >= this = HIGH confidence
  BB_CONFIDENCE_MEDIUM: 14,    // Bench xP >= this = MEDIUM confidence

  // Triple Captain thresholds
  TC_MIN_XP: 8,                // Captain must have >= 8 xP for the GW
  TC_MIN_XMINS: 81,            // Captain must be projected >= 81 mins (nailed)
  TC_MAX_FDR: 2,               // Fixture must be FDR 2 or easier
  TC_CONFIDENCE_HIGH: 10,      // xP >= this = HIGH confidence
  TC_CONFIDENCE_MEDIUM: 8,     // xP >= this = MEDIUM confidence

  // Bench order optimisation
  BENCH_PRIORITY_WEIGHTS: {
    xP: 0.6,                   // 60% weight on expected points
    xMins: 0.4,                // 40% weight on minutes reliability
  },
};

/* ============================================================================
   8.1: BENCH ORDER OPTIMISATION
   ============================================================================ */

/**
 * Analyze bench order and recommend optimal sequence
 * Bench positions: 12 (GKP), 13, 14, 15 (outfield auto-subs)
 *
 * @param {Object} context - Squad context from loadContext()
 * @param {number} nextGw - The gameweek to analyze
 * @returns {Promise<Object>} - { ok, currentOrder, optimalOrder, isSuboptimal, warnings }
 */
export async function analyzeBenchOrder(context, nextGw) {
  const bench = context.bench || [];

  if (bench.length !== 4) {
    return {
      ok: false,
      error: "Invalid bench size (expected 4 players)",
      currentOrder: [],
      optimalOrder: [],
      isSuboptimal: false,
      warnings: [],
    };
  }

  // Separate GKP (always position 12) from outfield bench
  const benchGkp = bench.find(p => p.element_type === 1);
  const outfieldBench = bench.filter(p => p.element_type !== 1);

  // Calculate xP and xMins for each outfield bench player
  const outfieldWithMetrics = await Promise.all(
    outfieldBench.map(async (player) => {
      const xpResult = await xPForGw(player, nextGw);
      const xMins = await estimateXMinsForPlayer(player);

      // Composite score: blend of xP and minutes reliability
      const xpNorm = clamp(xpResult.xP / 6, 0, 1);  // Normalize xP (6 = good)
      const minsNorm = clamp(xMins / 90, 0, 1);     // Normalize minutes

      const compositeScore =
        CHIP_CONFIG.BENCH_PRIORITY_WEIGHTS.xP * xpNorm +
        CHIP_CONFIG.BENCH_PRIORITY_WEIGHTS.xMins * minsNorm;

      return {
        ...player,
        xP: xpResult.xP,
        xMins,
        compositeScore,
        xpParts: xpResult.parts,
        fdr: xpResult.fdr,
      };
    })
  );

  // Current order (as they appear in bench, positions 13, 14, 15)
  const currentOrder = outfieldWithMetrics.map((p, idx) => ({
    position: idx + 13,
    player: p,
    xP: p.xP,
    xMins: p.xMins,
  }));

  // Optimal order: sort by composite score (highest first = first sub priority)
  const sortedByScore = [...outfieldWithMetrics].sort(
    (a, b) => b.compositeScore - a.compositeScore
  );

  const optimalOrder = sortedByScore.map((p, idx) => ({
    position: idx + 13,
    player: p,
    xP: p.xP,
    xMins: p.xMins,
  }));

  // Check if current order is suboptimal
  const currentIds = currentOrder.map(o => o.player.id);
  const optimalIds = optimalOrder.map(o => o.player.id);
  const isSuboptimal = currentIds.some((id, idx) => id !== optimalIds[idx]);

  // Generate warnings if suboptimal
  const warnings = [];
  if (isSuboptimal) {
    // Find specific position mismatches
    for (let i = 0; i < 3; i++) {
      if (currentIds[i] !== optimalIds[i]) {
        const current = currentOrder[i].player;
        const optimal = optimalOrder[i].player;

        // Only warn if there's meaningful difference
        const scoreDiff = optimal.compositeScore - current.compositeScore;
        if (scoreDiff > 0.1) {
          warnings.push({
            position: i + 13,
            message: `Position ${i + 13}: ${optimal.web_name} should be ahead of ${current.web_name}`,
            reason: `${optimal.web_name} has higher priority (${optimal.xP.toFixed(1)} xP, ${Math.round(optimal.xMins)}'). ${current.web_name} (${current.xP.toFixed(1)} xP, ${Math.round(current.xMins)}')`,
            impact: scoreDiff,
          });
        }
      }
    }
  }

  // Add GKP back to results
  const gkpData = benchGkp ? {
    position: 12,
    player: benchGkp,
    xP: (await xPForGw(benchGkp, nextGw)).xP,
    xMins: await estimateXMinsForPlayer(benchGkp),
    note: "GKP bench position is fixed",
  } : null;

  return {
    ok: true,
    gkp: gkpData,
    currentOrder,
    optimalOrder,
    isSuboptimal,
    warnings,
    totalBenchXp: outfieldWithMetrics.reduce((sum, p) => sum + p.xP, 0) + (gkpData?.xP || 0),
  };
}

/* ============================================================================
   8.2: CHIP SUGGESTIONS (CONSERVATIVE)
   ============================================================================ */

/**
 * Evaluate whether to recommend a chip for the upcoming gameweek
 * Only recommends when thresholds are clearly met
 *
 * @param {Object} context - Squad context from loadContext()
 * @param {number} nextGw - The gameweek to analyze
 * @returns {Promise<Object>} - { recommendation, benchBoost, tripleCaptain }
 */
export async function evaluateChipSuggestions(context, nextGw) {
  const chipsAvailable = context.chipsAvailable || [];
  const bench = context.bench || [];
  const captain = context.captain;

  const result = {
    recommendation: "none",
    message: "No chip recommended",
    rationale: "Current squad setup does not meet chip thresholds",
    confidence: null,
    benchBoost: null,
    tripleCaptain: null,
  };

  // Evaluate Bench Boost
  if (chipsAvailable.includes("bboost")) {
    const bbResult = await evaluateBenchBoost(bench, nextGw);
    result.benchBoost = bbResult;
  }

  // Evaluate Triple Captain
  if (chipsAvailable.includes("3xc") && captain) {
    const tcResult = await evaluateTripleCaptain(captain, nextGw);
    result.tripleCaptain = tcResult;
  }

  // Determine best recommendation (only if confidence is at least MEDIUM)
  // Priority: BB if bench is stacked, otherwise TC if captain is nailed vs easy fixture
  if (result.benchBoost?.triggered && result.benchBoost.confidence !== "LOW") {
    result.recommendation = "bboost";
    result.message = "Bench Boost recommended";
    result.rationale = result.benchBoost.rationale;
    result.confidence = result.benchBoost.confidence;
  } else if (result.tripleCaptain?.triggered && result.tripleCaptain.confidence !== "LOW") {
    result.recommendation = "3xc";
    result.message = "Triple Captain recommended";
    result.rationale = result.tripleCaptain.rationale;
    result.confidence = result.tripleCaptain.confidence;
  }

  return result;
}

/**
 * Evaluate Bench Boost viability
 */
async function evaluateBenchBoost(bench, nextGw) {
  if (bench.length !== 4) {
    return {
      triggered: false,
      totalXp: 0,
      confidence: null,
      rationale: "Invalid bench configuration",
      players: [],
    };
  }

  // Calculate xP for each bench player
  const benchWithXp = await Promise.all(
    bench.map(async (player) => {
      const xpResult = await xPForGw(player, nextGw);
      const xMins = await estimateXMinsForPlayer(player);
      return {
        player,
        xP: xpResult.xP,
        xMins,
        fdr: xpResult.fdr,
        hasFixture: xpResult.xP > 0,
      };
    })
  );

  const totalXp = benchWithXp.reduce((sum, p) => sum + p.xP, 0);
  const avgXp = totalXp / 4;
  const allHaveFixtures = benchWithXp.every(p => p.hasFixture);
  const allMeetMinimum = benchWithXp.every(p => p.xP >= CHIP_CONFIG.BB_MIN_PER_PLAYER_XP);

  // Determine if BB is triggered
  const triggered =
    totalXp >= CHIP_CONFIG.BB_MIN_BENCH_XP &&
    allHaveFixtures &&
    allMeetMinimum;

  // Determine confidence level
  let confidence = null;
  if (triggered) {
    if (totalXp >= CHIP_CONFIG.BB_CONFIDENCE_HIGH) {
      confidence = "HIGH";
    } else if (totalXp >= CHIP_CONFIG.BB_CONFIDENCE_MEDIUM) {
      confidence = "MEDIUM";
    } else {
      confidence = "LOW";
    }
  }

  // Build rationale
  let rationale = "";
  if (triggered) {
    const topPlayer = benchWithXp.reduce((max, p) => p.xP > max.xP ? p : max, benchWithXp[0]);
    rationale = `Bench total: ${totalXp.toFixed(1)} xP. ` +
      `All 4 players have fixtures with avg ${avgXp.toFixed(1)} xP each. ` +
      `Best: ${topPlayer.player.web_name} (${topPlayer.xP.toFixed(1)} xP vs FDR ${topPlayer.fdr || "?"}).`;
  } else {
    const issues = [];
    if (totalXp < CHIP_CONFIG.BB_MIN_BENCH_XP) {
      issues.push(`bench total ${totalXp.toFixed(1)} xP < ${CHIP_CONFIG.BB_MIN_BENCH_XP} threshold`);
    }
    if (!allHaveFixtures) {
      const blanks = benchWithXp.filter(p => !p.hasFixture);
      issues.push(`${blanks.length} player(s) have blank GW`);
    }
    if (!allMeetMinimum) {
      const weak = benchWithXp.filter(p => p.xP < CHIP_CONFIG.BB_MIN_PER_PLAYER_XP);
      issues.push(`${weak.map(p => p.player.web_name).join(", ")} below minimum threshold`);
    }
    rationale = `BB not recommended: ${issues.join("; ")}.`;
  }

  return {
    triggered,
    totalXp,
    avgXp,
    confidence,
    rationale,
    threshold: CHIP_CONFIG.BB_MIN_BENCH_XP,
    players: benchWithXp.map(p => ({
      name: p.player.web_name,
      xP: p.xP,
      xMins: p.xMins,
      fdr: p.fdr,
      meetsMinimum: p.xP >= CHIP_CONFIG.BB_MIN_PER_PLAYER_XP,
    })),
  };
}

/**
 * Evaluate Triple Captain viability
 */
async function evaluateTripleCaptain(captain, nextGw) {
  const xpResult = await xPForGw(captain, nextGw);
  const xMins = await estimateXMinsForPlayer(captain);
  const xP = xpResult.xP;
  const fdr = xpResult.fdr || 3;
  const home = xpResult.home;

  // Check all conditions
  const meetsXpThreshold = xP >= CHIP_CONFIG.TC_MIN_XP;
  const meetsMinutesThreshold = xMins >= CHIP_CONFIG.TC_MIN_XMINS;
  const meetsFdrThreshold = fdr <= CHIP_CONFIG.TC_MAX_FDR;
  const hasFixture = xP > 0;

  // TC is triggered only if ALL conditions met
  const triggered =
    hasFixture &&
    meetsXpThreshold &&
    meetsMinutesThreshold &&
    meetsFdrThreshold;

  // Determine confidence level
  let confidence = null;
  if (triggered) {
    if (xP >= CHIP_CONFIG.TC_CONFIDENCE_HIGH && xMins >= 85 && fdr <= 2) {
      confidence = "HIGH";
    } else if (xP >= CHIP_CONFIG.TC_CONFIDENCE_MEDIUM) {
      confidence = "MEDIUM";
    } else {
      confidence = "LOW";
    }
  }

  // Build rationale
  let rationale = "";
  if (triggered) {
    const homeAway = home ? "home" : "away";
    rationale = `${captain.web_name}: ${xP.toFixed(1)} xP, ` +
      `nailed (${Math.round(xMins)}' projected), ` +
      `${homeAway} vs FDR ${fdr} fixture. ` +
      `Strong floor + ceiling for triple points.`;
  } else {
    const issues = [];
    if (!hasFixture) {
      issues.push("blank gameweek");
    }
    if (!meetsXpThreshold) {
      issues.push(`xP ${xP.toFixed(1)} < ${CHIP_CONFIG.TC_MIN_XP} threshold`);
    }
    if (!meetsMinutesThreshold) {
      issues.push(`projected ${Math.round(xMins)}' < ${CHIP_CONFIG.TC_MIN_XMINS}' (rotation risk)`);
    }
    if (!meetsFdrThreshold) {
      issues.push(`FDR ${fdr} > ${CHIP_CONFIG.TC_MAX_FDR} (tough fixture)`);
    }
    rationale = `TC not recommended for ${captain.web_name}: ${issues.join("; ")}.`;
  }

  return {
    triggered,
    captain: {
      name: captain.web_name,
      team: captain.teamName,
      position: captain.positionName,
    },
    xP,
    xMins,
    fdr,
    home,
    confidence,
    rationale,
    thresholds: {
      xP: CHIP_CONFIG.TC_MIN_XP,
      xMins: CHIP_CONFIG.TC_MIN_XMINS,
      fdr: CHIP_CONFIG.TC_MAX_FDR,
    },
    conditions: {
      meetsXpThreshold,
      meetsMinutesThreshold,
      meetsFdrThreshold,
      hasFixture,
    },
  };
}

/* ============================================================================
   MAIN ENTRY POINT
   ============================================================================ */

/**
 * Run the complete Bench + Chip analysis pipeline
 *
 * @param {Object} context - Squad context from loadContext()
 * @returns {Promise<Object>} - Complete analysis
 */
export async function runBenchChipAnalysis(context) {
  const nextGw = context.nextGw;

  // Run both analyses in parallel
  const [benchResult, chipResult] = await Promise.all([
    analyzeBenchOrder(context, nextGw),
    evaluateChipSuggestions(context, nextGw),
  ]);

  return {
    ok: benchResult.ok,
    nextGw,
    benchOrder: benchResult,
    chipSuggestion: chipResult,
    hasWarnings: benchResult.warnings?.length > 0,
    hasChipRecommendation: chipResult.recommendation !== "none",
  };
}

export default {
  analyzeBenchOrder,
  evaluateChipSuggestions,
  runBenchChipAnalysis,
  CHIP_CONFIG,
};
