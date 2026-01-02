// js/pages/stat-picker.js
// Phase 2+3: Stat Picker Dashboard with Optimiser, Transfers, and Chips

import { fplClient, legacyApi } from "../api/fplClient.js";
import { state, setPageUpdated } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { log } from "../logger.js";
import { STORAGE_KEYS } from "../storage.js";
import { getCacheAge, CacheKey } from "../api/fetchHelper.js";

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
  } catch { return false; }
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
  "3xc": "Triple Captain"
};

function formatChipName(chip) {
  return CHIP_NAMES[chip] || chip;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CURRENT STATE ENGINE (Phase 2 - PRESERVED)
   ═══════════════════════════════════════════════════════════════════════════ */

async function buildCurrentState() {
  const bs = state.bootstrap || await legacyApi.bootstrap();
  if (!bs) throw new Error("Bootstrap data not available");

  const entryId = state.entryId;
  if (!entryId) {
    return { error: "NO_ENTRY_ID", message: "Set your Entry ID in the sidebar to see your team state." };
  }

  const [entry, history, fixtures] = await Promise.all([
    api.entry(entryId).catch(() => null),
    api.entryHistory(entryId).catch(() => null),
    api.fixtures().catch(() => [])
  ]);

  if (!entry) {
    return { error: "ENTRY_NOT_FOUND", message: `Entry ${entryId} not found. Check your Entry ID.` };
  }

  const events = bs.events || [];
  const currentEvent = events.find(e => e.is_current);
  const nextEvent = events.find(e => e.is_next);
  const lastFinished = events.filter(e => e.data_checked).slice(-1)[0];

  const currentGw = currentEvent?.id || lastFinished?.id || 1;
  const nextGw = nextEvent?.id || currentGw + 1;
  const isLive = currentEvent && !currentEvent.data_checked;

  const gwForPicks = isLive ? currentGw : (lastFinished?.id || 1);
  let picks = null;
  try { picks = await legacyApi.entryPicks(entryId, gwForPicks); } catch {}

  const currentHistory = history?.current?.find(h => h.event === gwForPicks);
  const bank = currentHistory?.bank ?? entry.last_deadline_bank ?? 0;
  const teamValue = currentHistory?.value ?? entry.last_deadline_value ?? 1000;
  const freeTransfers = calculateFreeTransfers(history, currentGw);

  // CHIPS: Strictly derive from entry history - no defaults, no guessing
  const rawChipsUsed = history?.chips || [];
  const chipsUsed = rawChipsUsed.map(c => ({ chip: c.name, gw: c.event }));

  // Count wildcards used (max 2 per season)
  const wildcardsUsed = chipsUsed.filter(c => c.chip === "wildcard").length;

  // Build available chips list - only if NOT in used list
  const chipsAvailable = [];
  if (wildcardsUsed < 2) chipsAvailable.push("wildcard");
  if (!chipsUsed.some(c => c.chip === "freehit")) chipsAvailable.push("freehit");
  if (!chipsUsed.some(c => c.chip === "bboost")) chipsAvailable.push("bboost");
  if (!chipsUsed.some(c => c.chip === "3xc")) chipsAvailable.push("3xc");

  let squad = [], captain = null, viceCaptain = null, bench = [];

  if (picks?.picks) {
    const elements = bs.elements || [];
    const teams = bs.teams || [];
    const positions = bs.element_types || [];

    squad = picks.picks.map((pick, idx) => {
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
        isCaptain, isVice, isBench,
        teamName: team?.short_name || "???",
        positionName: pos?.singular_name_short || "?",
      };

      if (isCaptain) captain = playerData;
      if (isVice) viceCaptain = playerData;
      if (isBench) bench.push(playerData);
      return playerData;
    });
  }

  const xi = squad.filter(p => !p.isBench);
  const flaggedPlayers = squad.filter(p => p.status !== "a").map(p => ({ ...p, flagReason: getFlagReason(p) }));
  const userTeamIds = [...new Set(squad.map(p => p.team))];
  const fixtureMatrix = await buildFixtureMatrix(userTeamIds, nextGw, fixtures, bs);

  return {
    entryId, entryName: entry.name,
    playerName: `${entry.player_first_name} ${entry.player_last_name}`,
    currentGw, nextGw, isLive, freeTransfers,
    bank, bankFormatted: `£${(bank / 10).toFixed(1)}m`,
    teamValue, teamValueFormatted: `£${(teamValue / 10).toFixed(1)}m`,
    totalValue: bank + teamValue,
    totalValueFormatted: `£${((bank + teamValue) / 10).toFixed(1)}m`,
    chipsAvailable, chipsUsed, squad, xi, bench, captain, viceCaptain,
    flaggedPlayers, fixtureMatrix,
    overallRank: entry.summary_overall_rank,
    overallPoints: entry.summary_overall_points,
    gwRank: currentHistory?.rank,
    gwPoints: currentHistory?.points,
  };
}

function calculateFreeTransfers(history, currentGw) {
  if (!history?.current) return 1;
  let ft = 1;
  const lastGw = history.current.find(h => h.event === currentGw - 1);
  if (lastGw) ft = Math.min(5, 1 + (lastGw.event_transfers === 0 ? 1 : 0));
  return ft;
}

function getFlagReason(player) {
  const statusMap = { d: "Doubtful", i: "Injured", s: "Suspended", u: "Unavailable", n: "Not in squad" };
  let reason = statusMap[player.status] || "Unknown";
  if (player.news) reason += ` - ${player.news}`;
  if (player.chance_of_playing_next_round != null) reason += ` (${player.chance_of_playing_next_round}%)`;
  return reason;
}

async function buildFixtureMatrix(teamIds, startGw, allFixtures, bs) {
  const teams = bs.teams || [];
  const horizons = [3, 6, 8];
  const matrix = {};

  for (const teamId of teamIds) {
    const team = teams.find(t => t.id === teamId);
    matrix[teamId] = { teamId, teamName: team?.short_name || "???", horizons: {} };

    for (const h of horizons) {
      const gwRange = [];
      for (let gw = startGw; gw < startGw + h && gw <= 38; gw++) gwRange.push(gw);

      const fixtures = [];
      for (const gw of gwRange) {
        const gwFx = allFixtures.filter(f => f.event === gw);
        const teamFx = gwFx.filter(f => f.team_h === teamId || f.team_a === teamId);

        for (const fx of teamFx) {
          const isHome = fx.team_h === teamId;
          const oppId = isHome ? fx.team_a : fx.team_h;
          const opp = teams.find(t => t.id === oppId);
          const fdr = isHome ? fx.team_h_difficulty : fx.team_a_difficulty;
          fixtures.push({ gw, opponent: opp?.short_name || "???", isHome, fdr });
        }
      }

      const avgFdr = fixtures.length ? (fixtures.reduce((s, f) => s + f.fdr, 0) / fixtures.length).toFixed(1) : null;
      matrix[teamId].horizons[h] = { fixtures, avgFdr, label: `Next ${h}` };
    }
  }
  return matrix;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORING MODEL (Phase 2 - PRESERVED)
   ═══════════════════════════════════════════════════════════════════════════ */

async function calculateExpectedPoints(player, horizon, bs) {
  const startGw = (bs.events || []).find(e => e.is_next)?.id || 1;
  const gwIds = [];
  for (let gw = startGw; gw < startGw + horizon && gw <= 38; gw++) gwIds.push(gw);

  const allFixtures = await legacyApi.fixtures();
  const teams = bs.teams || [];

  const playerFixtures = [];
  for (const gw of gwIds) {
    const gwFx = allFixtures.filter(f => f.event === gw);
    const teamFx = gwFx.filter(f => f.team_h === player.team || f.team_a === player.team);
    for (const fx of teamFx) {
      const isHome = fx.team_h === player.team;
      const oppId = isHome ? fx.team_a : fx.team_h;
      const opp = teams.find(t => t.id === oppId);
      const fdr = isHome ? fx.team_h_difficulty : fx.team_a_difficulty;
      playerFixtures.push({ gw, isHome, fdr, opponent: opp?.short_name || "???" });
    }
  }

  if (playerFixtures.length === 0) {
    return { total: 0, perGw: [], explanation: "No fixtures (blank GWs)", components: { appearance: 0, attack: 0, cleanSheet: 0, bonus: 0 } };
  }

  const minutesReliability = calculateMinutesReliability(player);
  const xMins = (minutesReliability.score / 100) * 90;
  const xgi90 = player.expected_goal_involvements
    ? parseFloat(player.expected_goal_involvements) / Math.max(player.minutes / 90, 1)
    : estimateXgi90(player);

  const posId = player.element_type;
  const csPoints = posId <= 2 ? 4 : posId === 3 ? 1 : 0;
  const goalPoints = posId <= 2 ? 6 : posId === 3 ? 5 : 4;

  let totalXp = 0, totalApp = 0, totalAtk = 0, totalCS = 0, totalBonus = 0;
  const perGw = [];

  for (const fx of playerFixtures) {
    const appXp = xMins >= 60 ? 2 : xMins > 0 ? 1 : 0;
    const fdrMult = ({ 1: 1.15, 2: 1.10, 3: 1.00, 4: 0.90, 5: 0.80 })[fx.fdr] || 1;
    const homeMult = fx.isHome ? 1.05 : 0.95;
    const atkXp = xgi90 * (xMins / 90) * goalPoints * fdrMult * homeMult;

    const csProb = getCSProb(fx.fdr, fx.isHome);
    const csXp = csProb * csPoints * (xMins >= 60 ? 1 : 0);

    const bps90 = player.minutes > 0 ? (parseFloat(player.bps || 0) / (player.minutes / 90)) : 0;
    const bonusXp = Math.min(0.8, bps90 / 30) * (xMins / 90);

    const gwXp = appXp + atkXp + csXp + bonusXp;
    totalXp += gwXp; totalApp += appXp; totalAtk += atkXp; totalCS += csXp; totalBonus += bonusXp;
    perGw.push({ gw: fx.gw, opponent: fx.opponent, isHome: fx.isHome, fdr: fx.fdr, xp: gwXp.toFixed(1) });
  }

  return {
    total: parseFloat(totalXp.toFixed(1)), perGw, minutesReliability,
    components: { appearance: totalApp, attack: totalAtk, cleanSheet: totalCS, bonus: totalBonus },
    explanation: buildExplanation(player, minutesReliability, xgi90, playerFixtures, totalXp)
  };
}

function estimateXgi90(player) {
  const threat = parseFloat(player.threat || 0);
  const creativity = parseFloat(player.creativity || 0);
  const mins = Math.max(player.minutes || 1, 1);
  return (threat / (mins / 90) / 500) + (creativity / (mins / 90) / 1000);
}

function getCSProb(fdr, isHome) {
  let prob = ({ 1: 0.40, 2: 0.35, 3: 0.25, 4: 0.15, 5: 0.08 })[fdr] || 0.20;
  prob += isHome ? 0.03 : -0.03;
  return Math.max(0.02, Math.min(0.60, prob));
}

function buildExplanation(player, mins, xgi90, fixtures, totalXp) {
  const pos = ({ 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" })[player.element_type] || "?";
  const avgFdr = fixtures.length ? (fixtures.reduce((s, f) => s + f.fdr, 0) / fixtures.length).toFixed(1) : "N/A";
  return `${player.web_name} (${pos}) | Mins: ${mins.score}/100 | xGI90: ${xgi90.toFixed(2)} | Avg FDR: ${avgFdr} | xP: ${totalXp.toFixed(1)}`;
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
  if (avgMins < 45) { score -= 20; details.push("Low mins"); }
  else if (avgMins < 60) { score -= 10; details.push("Rotation risk"); }

  if (player.news) {
    const nl = player.news.toLowerCase();
    if (nl.includes("knock") || nl.includes("minor")) { score -= 10; details.push("Minor concern"); }
    if (nl.includes("rest") || nl.includes("rotation")) { score -= 15; details.push("Rotation"); }
    if (nl.includes("returned") || nl.includes("back in training")) { score += 5; }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const reason = score >= 90 ? "Nailed" : score >= 70 ? "Likely starter" : score >= 50 ? "Risk" : score >= 25 ? "Major doubt" : "Unlikely";

  return { score, reason, details };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 3: XI & CAPTAIN OPTIMISER
   ═══════════════════════════════════════════════════════════════════════════ */

function optimiseXI(squadWithXp) {
  // Enforce FPL formation rules: 1 GKP, 3-5 DEF, 2-5 MID, 1-3 FWD
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  squadWithXp.forEach(p => byPos[p.element_type]?.push(p));

  // Sort each position by xP descending
  Object.values(byPos).forEach(arr => arr.sort((a, b) => b.xp - a.xp));

  // Start with minimum formation: 1-3-4-3 = 11
  const xi = [];
  const bench = [];

  // GKP: take best 1, bench 1
  xi.push(byPos[1][0]);
  if (byPos[1][1]) bench.push(byPos[1][1]);

  // Determine best formation by trying valid combos
  const formations = [
    [3, 4, 3], [3, 5, 2], [4, 4, 2], [4, 3, 3], [4, 5, 1], [5, 4, 1], [5, 3, 2], [5, 2, 3]
  ];

  let bestXI = null;
  let bestXp = -1;

  for (const [dCount, mCount, fCount] of formations) {
    if (byPos[2].length < dCount || byPos[3].length < mCount || byPos[4].length < fCount) continue;

    const testXI = [
      byPos[1][0],
      ...byPos[2].slice(0, dCount),
      ...byPos[3].slice(0, mCount),
      ...byPos[4].slice(0, fCount)
    ];

    const totalXp = testXI.reduce((s, p) => s + (p?.xp || 0), 0);
    if (totalXp > bestXp) {
      bestXp = totalXp;
      bestXI = testXI;
    }
  }

  // Build bench from remaining
  const xiIds = new Set((bestXI || []).map(p => p?.id));
  const benchPlayers = squadWithXp.filter(p => !xiIds.has(p.id)).sort((a, b) => b.xp - a.xp);

  // Rank captain candidates (top 5 by xP in XI)
  const captainCandidates = [...(bestXI || [])].filter(p => p).sort((a, b) => b.xp - a.xp).slice(0, 5);

  return {
    xi: bestXI || [],
    bench: benchPlayers,
    totalXp: bestXp,
    captainCandidates,
    recommendedCaptain: captainCandidates[0],
    recommendedVice: captainCandidates[1]
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 3: TRANSFER ADVISOR (Fixed heuristics per user requirements)
   - -4 hit requires > +6 xP net gain (not +4)
   - -8 hit requires > +12 xP net gain (not +8)
   - Penalize destabilizing transfers (nailed→fringe, GK swaps, injury→injury)
   - Always compare against "Do Nothing" baseline
   ═══════════════════════════════════════════════════════════════════════════ */

async function getTransferRecommendations(currentState, horizon, bs) {
  const squad = currentState.squad || [];
  const freeTransfers = currentState.freeTransfers || 1;
  const bank = currentState.bank || 0;

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
  const squadIds = new Set(squad.map(p => p.id));
  const squadTeams = squad.map(p => p.team);

  const recommendations = [];

  // Only consider bottom performers with actual issues
  const candidates = sortedByXp.filter(p => {
    // Skip GKs unless injured or suspended
    if (p.element_type === 1 && p.status === "a") return false;
    // Skip players with decent xP (>3 per GW average)
    if (p.xp > horizon * 3) return false;
    return true;
  }).slice(0, 4);

  for (const outPlayer of candidates) {
    const budget = (outPlayer.now_cost || 0) + bank;
    const outMinsReliability = outPlayer.xpData?.minutesReliability?.score || 100;

    // Find alternatives at same position
    const alternatives = elements.filter(p =>
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
      // 1. Penalize downgrading from nailed starter to fringe player
      if (outMinsReliability > 80 && inMinsReliability < 60) {
        xpGain -= 2; // Heavy penalty for destabilizing
      }

      // 2. Penalize GK transfers (usually not worth it)
      if (outPlayer.element_type === 1) {
        xpGain -= 1.5;
      }

      // 3. Penalize bringing in another injury risk
      if (alt.chance_of_playing_next_round != null && alt.chance_of_playing_next_round < 75) {
        xpGain -= 2;
      }

      // 4. Penalize having 3+ from same team
      const sameTeamCount = squadTeams.filter(t => t === alt.team).length;
      if (sameTeamCount >= 2) {
        xpGain -= 0.5; // Slight penalty for concentration risk
      }

      const teamName = teams.find(t => t.id === alt.team)?.short_name || "???";

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
        breakEvenGw: xpGain > 0 ? Math.ceil(4 / xpGain) : "N/A"
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
        breakEvenGw: best.breakEvenGw
      });
    }
  }

  // Sort by xP gain (after penalties)
  recommendations.sort((a, b) => b.xpGain - a.xpGain);

  // CONSERVATIVE HIT LOGIC:
  // -4 hit: requires > +6 xP total gain (margin of 2 pts for uncertainty)
  // -8 hit: requires > +12 xP total gain (margin of 4 pts for uncertainty)
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
        const names = recommendations.slice(0, 3).map(r => `${r.out.web_name}→${r.in.web_name}`).join(", ");
        actionDetail = `3 transfers: ${names}. Gain: ${totalGain.toFixed(1)} xP − 8 = +${(totalGain - 8).toFixed(1)} net`;
        transfers = recommendations.slice(0, 3);
        netGain = totalGain - 8;
        hitCost = 8;
      }
    }
  }

  // Always include "Do Nothing" baseline
  const doNothingXp = squadWithXp.filter(p => !p.isBench).reduce((s, p) => s + p.xp, 0);

  return {
    action,
    actionDetail,
    transfers,
    netGain,
    hitCost,
    freeTransfers,
    doNothingXp,
    allRecommendations: recommendations.slice(0, 5)
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 3: CHIP RECOMMENDATION ENGINE
   ═══════════════════════════════════════════════════════════════════════════ */

async function getChipRecommendation(currentState, horizon, bs, squadWithXp, optimised) {
  const available = currentState.chipsAvailable || [];
  if (available.length === 0) {
    return { chip: null, reason: "No chips remaining" };
  }

  const recommendations = [];

  // BENCH BOOST check
  if (available.includes("bboost")) {
    const benchXp = optimised.bench.reduce((s, p) => s + (p?.xp || 0), 0);
    const avgBenchMins = optimised.bench.reduce((s, p) => s + (p?.xpData?.minutesReliability?.score || 0), 0) / Math.max(optimised.bench.length, 1);

    if (benchXp > 12 && avgBenchMins > 70) {
      recommendations.push({
        chip: "bboost",
        name: "Bench Boost",
        reason: `Strong bench (${benchXp.toFixed(1)} xP) with high minutes certainty (${avgBenchMins.toFixed(0)}%)`,
        expectedGain: benchXp,
        confidence: avgBenchMins > 80 ? "High" : "Medium"
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
          expectedGain: captain.xp, // Extra captain points
          confidence: minsScore > 90 ? "High" : "Medium"
        });
      }
    }
  }

  // FREE HIT check (when many flagged or bad fixtures)
  if (available.includes("freehit")) {
    const flaggedCount = currentState.flaggedPlayers?.length || 0;
    if (flaggedCount >= 3) {
      recommendations.push({
        chip: "freehit",
        name: "Free Hit",
        reason: `${flaggedCount} flagged players - squad misaligned for this GW`,
        expectedGain: flaggedCount * 3, // Rough estimate
        confidence: "Medium"
      });
    }
  }

  // WILDCARD check (structural issues)
  if (available.includes("wildcard")) {
    const lowXpCount = squadWithXp.filter(p => p.xp < 3).length;
    if (lowXpCount >= 5) {
      recommendations.push({
        chip: "wildcard",
        name: "Wildcard",
        reason: `${lowXpCount} underperforming assets - structural rebuild needed`,
        expectedGain: lowXpCount * 2,
        confidence: "Medium"
      });
    }
  }

  // Sort by expected gain
  recommendations.sort((a, b) => b.expectedGain - a.expectedGain);

  if (recommendations.length === 0) {
    return { chip: null, reason: "No chip recommended this GW. Save for better opportunity." };
  }

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

function renderPasswordGate(container) {
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
        <p id="gateError" class="sp-gate-error" style="display:none;">Incorrect</p>
      </div>
    </div>
  `;

  const input = container.querySelector("#gatePassword");
  const btn = container.querySelector("#gateUnlockBtn");
  const error = container.querySelector("#gateError");

  const tryUnlock = () => {
    if (input.value === GATE_PASSWORD) {
      unlock();
      container.innerHTML = "";
      renderDashboard(container);
    } else {
      error.style.display = "block";
      input.value = "";
    }
  };

  btn.onclick = tryUnlock;
  input.onkeydown = e => e.key === "Enter" && tryUnlock();
  input.focus();
}

async function renderDashboard(container) {
  container.innerHTML = `
    <div class="sp-header">
      <div class="sp-header-left">
        <h1>Stat Picker</h1>
        <span class="sp-tagline">FPL Decision Engine</span>
      </div>
      <div class="sp-header-right">
        <select id="horizonSel" class="sp-select">
          <option value="3">3 GW</option>
          <option value="6" selected>6 GW</option>
          <option value="8">8 GW</option>
        </select>
        <button id="refreshBtn" class="sp-btn">Refresh</button>
        <button id="lockBtn" class="sp-btn sp-btn-danger">Lock</button>
      </div>
    </div>
    <div class="sp-grid" id="spContent">
      <div class="sp-loading">Loading...</div>
    </div>
  `;

  container.querySelector("#lockBtn").onclick = () => {
    lock();
    container.innerHTML = "";
    renderPasswordGate(container);
  };

  const horizonSel = container.querySelector("#horizonSel");
  const content = container.querySelector("#spContent");

  const load = async () => {
    content.innerHTML = '<div class="sp-loading">Loading...</div>';
    const horizon = parseInt(horizonSel.value);
    await renderDashboardContent(content, horizon);
  };

  container.querySelector("#refreshBtn").onclick = load;
  horizonSel.onchange = load;

  await load();
}

async function renderDashboardContent(container, horizon) {
  try {
    const bs = state.bootstrap || await legacyApi.bootstrap();
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

    // Optimise XI
    const optimised = optimiseXI(squadWithXp);

    // Get transfer recommendations
    const transfers = await getTransferRecommendations(currentState, horizon, bs);

    // Get chip recommendation
    const chipRec = await getChipRecommendation(currentState, horizon, bs, squadWithXp, optimised);

    // Render dashboard grid
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
  const chipsUsed = s.chipsUsed.map(c => `${formatChipName(c.chip)} (GW${c.gw})`).join(", ") || "None";

  return `
    <div class="sp-card">
      <div class="sp-card-header">Current State</div>
      <div class="sp-state-compact">
        <div class="sp-stat"><span class="sp-stat-val">${s.currentGw}${s.isLive ? '*' : ''}</span><span class="sp-stat-lbl">GW</span></div>
        <div class="sp-stat"><span class="sp-stat-val">${s.freeTransfers}</span><span class="sp-stat-lbl">FT</span></div>
        <div class="sp-stat"><span class="sp-stat-val">${s.bankFormatted}</span><span class="sp-stat-lbl">Bank</span></div>
        <div class="sp-stat"><span class="sp-stat-val">${s.teamValueFormatted}</span><span class="sp-stat-lbl">Value</span></div>
      </div>
      <div class="sp-state-row"><span>Team</span><span>${s.entryName}</span></div>
      <div class="sp-state-row"><span>Rank</span><span>${s.overallRank?.toLocaleString() || 'N/A'}</span></div>
      <div class="sp-state-row"><span>Points</span><span>${s.overallPoints?.toLocaleString() || 'N/A'}</span></div>
      <div class="sp-state-row"><span>Chips</span><span class="sp-chips-avail">${chipsAvail}</span></div>
      <div class="sp-state-row sp-muted"><span>Used</span><span>${chipsUsed}</span></div>
    </div>
  `;
}

function renderFlagsPanel(s) {
  if (!s.flaggedPlayers || s.flaggedPlayers.length === 0) {
    return `<div class="sp-card sp-card-ok"><div class="sp-card-header">Flags</div><div class="sp-ok-msg">All players available</div></div>`;
  }

  const rows = s.flaggedPlayers.map(p => `
    <div class="sp-flag-row">
      <span class="sp-flag-name">${p.web_name}</span>
      <span class="sp-flag-status" data-status="${p.status}">${p.status.toUpperCase()}</span>
      <span class="sp-flag-chance">${p.chance_of_playing_next_round ?? '?'}%</span>
    </div>
  `).join("");

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

function renderSquadPanel(opt, horizon) {
  // Build xP breakdown for each player (explainability)
  const buildBreakdown = (p) => {
    if (!p?.xpData?.components) return '';
    const c = p.xpData.components;
    const parts = [];
    if (c.appearance > 0) parts.push(`App:${c.appearance.toFixed(1)}`);
    if (c.attack > 0) parts.push(`Atk:${c.attack.toFixed(1)}`);
    if (c.cleanSheet > 0) parts.push(`CS:${c.cleanSheet.toFixed(1)}`);
    if (c.bonus > 0) parts.push(`Bns:${c.bonus.toFixed(1)}`);
    return parts.join(' ');
  };

  // Why picked explanation based on FPL scoring rules
  const whyPicked = (p) => {
    if (!p) return '';
    const reasons = [];
    const mins = p.xpData?.minutesReliability?.score || 0;
    const posType = p.element_type;

    // Minutes likelihood
    if (mins >= 90) reasons.push('nailed');
    else if (mins >= 70) reasons.push('likely starter');
    else if (mins >= 50) reasons.push('rotation risk');

    // Position-specific value
    if (posType === 1 || posType === 2) {
      if (p.xpData?.components?.cleanSheet > 1) reasons.push('CS potential');
    }
    if (posType === 3 || posType === 4) {
      if (p.xpData?.components?.attack > 2) reasons.push('attacking returns');
    }

    // Bonus potential
    if (p.xpData?.components?.bonus > 0.5) reasons.push('BPS');

    return reasons.slice(0, 2).join(', ');
  };

  const xiRows = opt.xi.map(p => `
    <div class="sp-xi-row ${p?.status !== 'a' ? 'sp-xi-flagged' : ''}" data-tooltip="${buildBreakdown(p)}">
      <span class="sp-xi-pos">${({ 1: 'G', 2: 'D', 3: 'M', 4: 'F' })[p?.element_type] || '?'}</span>
      <span class="sp-xi-name">${p?.web_name || '?'}</span>
      <span class="sp-xi-team">${p?.teamName || ''}</span>
      <span class="sp-xi-xp">${p?.xp?.toFixed(1) || '0'}</span>
      <span class="sp-xi-why">${whyPicked(p)}</span>
    </div>
  `).join("");

  const benchRows = opt.bench.slice(0, 4).map((p, i) => `
    <div class="sp-bench-row" data-tooltip="${buildBreakdown(p)}">
      <span class="sp-bench-order">${i + 1}</span>
      <span class="sp-xi-pos">${({ 1: 'G', 2: 'D', 3: 'M', 4: 'F' })[p?.element_type] || '?'}</span>
      <span class="sp-xi-name">${p?.web_name || '?'}</span>
      <span class="sp-xi-xp">${p?.xp?.toFixed(1) || '0'}</span>
    </div>
  `).join("");

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

function renderCaptainPanel(opt) {
  const rows = opt.captainCandidates.slice(0, 5).map((p, i) => `
    <div class="sp-cap-row ${i === 0 ? 'sp-cap-best' : ''}">
      <span class="sp-cap-rank">${i === 0 ? 'C' : i === 1 ? 'VC' : i + 1}</span>
      <span class="sp-cap-name">${p?.web_name || '?'}</span>
      <span class="sp-cap-xp">${p?.xp?.toFixed(1) || '0'}</span>
      <span class="sp-cap-mins">${p?.xpData?.minutesReliability?.score || '?'}%</span>
    </div>
  `).join("");

  return `
    <div class="sp-card">
      <div class="sp-card-header">Captain Picks</div>
      <div class="sp-cap-list">${rows}</div>
    </div>
  `;
}

function renderTransferPanel(t) {
  const actionClass = t.action === "Hold" ? "" : t.hitCost > 0 ? "sp-action-hit" : "sp-action-go";

  let transferRows = "";
  let noTransferExplanation = "";

  if (t.transfers.length > 0) {
    transferRows = t.transfers.map(tr => `
      <div class="sp-transfer-row">
        <div class="sp-tr-players">
          <span class="sp-tr-out">${tr.out.web_name}</span>
          <span class="sp-tr-arrow">→</span>
          <span class="sp-tr-in">${tr.in.web_name}</span>
          <span class="sp-tr-gain">+${tr.xpGain.toFixed(1)}</span>
        </div>
        <div class="sp-tr-why">
          <span class="sp-tr-why-out">OUT: ${tr.whyOut || 'underperforming'}</span>
          <span class="sp-tr-why-in">IN: ${tr.whyIn || 'better option'}</span>
        </div>
      </div>
    `).join("");
  } else if (t.action === "Hold") {
    // Explain why no transfers are recommended
    const reasons = [];

    // Check if all players are performing well
    if (t.allRecommendations && t.allRecommendations.length === 0) {
      reasons.push("All squad players have adequate expected returns");
    }

    // Check if recommendations exist but don't clear thresholds
    if (t.allRecommendations && t.allRecommendations.length > 0) {
      const bestGain = t.allRecommendations[0]?.xpGain || 0;
      if (bestGain < 2) {
        reasons.push(`Best available gain (+${bestGain.toFixed(1)} xP) doesn't clear the +2.0 threshold`);
      }
      if (t.hitCost > 0 && bestGain < 6) {
        reasons.push(`Hit penalty (-${t.hitCost}) outweighs potential gains`);
      }
    }

    // Free transfers context
    if (t.freeTransfers === 0) {
      reasons.push("No free transfers available — any move costs -4 points");
    } else if (t.freeTransfers > 1) {
      reasons.push(`${t.freeTransfers} FTs rolling — consider saving for a future double move`);
    }

    // Default reason if none identified
    if (reasons.length === 0) {
      reasons.push("Current squad is optimal for the projected period");
    }

    noTransferExplanation = `
      <div class="sp-no-transfers">
        <div class="sp-no-transfers-icon">✓</div>
        <div class="sp-no-transfers-title">No transfers recommended</div>
        <div class="sp-no-transfers-reason">
          ${reasons.map(r => `<div>• ${r}</div>`).join("")}
        </div>
      </div>
    `;
  }

  // Hit warning for risky moves
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
      ${t.netGain > 0 && t.hitCost === 0 ? `<div class="sp-net-gain">Net gain: +${t.netGain.toFixed(1)} xP</div>` : ''}
      ${transferRows}
      ${noTransferExplanation}
      <div class="sp-baseline">Do Nothing baseline: ${t.doNothingXp?.toFixed(1) || '?'} xP</div>
    </div>
  `;
}

function renderFixturesPanel(s, horizon) {
  const matrix = s.fixtureMatrix || {};
  const teamIds = Object.keys(matrix);

  if (teamIds.length === 0) {
    return `<div class="sp-card"><div class="sp-card-header">Fixtures</div><div class="sp-no-data">No data</div></div>`;
  }

  const rows = teamIds.map(tid => {
    const team = matrix[tid];
    const hData = team.horizons[horizon];
    if (!hData) return "";

    const cells = hData.fixtures.slice(0, Math.min(horizon, 6)).map(f => {
      return `<span class="sp-fdr sp-fdr-${f.fdr}" title="GW${f.gw}: ${f.isHome ? '' : '@'}${f.opponent}">${f.opponent.slice(0, 3)}</span>`;
    }).join("");

    return `<div class="sp-fx-row"><span class="sp-fx-team">${team.teamName}</span><span class="sp-fx-cells">${cells}</span><span class="sp-fx-avg">${hData.avgFdr}</span></div>`;
  }).join("");

  return `
    <div class="sp-card">
      <div class="sp-card-header">Fixtures (${horizon}GW)</div>
      <div class="sp-fx-grid">${rows}</div>
    </div>
  `;
}

function renderAssumptionsPanel() {
  return `
    <div class="sp-card sp-card-small">
      <div class="sp-card-header">Model & Assumptions</div>
      <ul class="sp-assumptions">
        <li><strong>xP Components:</strong> Appearance (2pts 60+min, 1pt &lt;60min) + Attack (xGI × pos multiplier) + Clean Sheet (FDR-adjusted) + Bonus (BPS/30)</li>
        <li><strong>FDR Weights:</strong> FDR1: +15%, FDR2: +10%, FDR3: baseline, FDR4: -10%, FDR5: -20%</li>
        <li><strong>Hit Thresholds:</strong> -4 needs &gt;+6 xP, -8 needs &gt;+12 xP (with uncertainty buffer)</li>
        <li><strong>Caveats:</strong> Cannot predict rotation, manager decisions, or late injuries. Public xGI only.</li>
      </ul>
      <div class="sp-scoring-link"><a href="https://www.premierleague.com/news/2174909" target="_blank">FPL Scoring Rules →</a></div>
    </div>
  `;
}
