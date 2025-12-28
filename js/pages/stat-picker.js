// js/pages/stat-picker.js
// Phase 2+3: Stat Picker Dashboard with Optimiser, Transfers, and Chips

import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";

/* ═══════════════════════════════════════════════════════════════════════════
   PASSWORD GATE - localStorage with 24h expiry (Phase 2 - PRESERVED)
   ═══════════════════════════════════════════════════════════════════════════ */

const GATE_KEY = "fpl.statPickerUnlocked";
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
  const bs = state.bootstrap || await api.bootstrap();
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
  try { picks = await api.entryPicks(entryId, gwForPicks); } catch {}

  const currentHistory = history?.current?.find(h => h.event === gwForPicks);
  const bank = currentHistory?.bank ?? entry.last_deadline_bank ?? 0;
  const teamValue = currentHistory?.value ?? entry.last_deadline_value ?? 1000;
  const freeTransfers = calculateFreeTransfers(history, currentGw);

  const chipsUsed = (history?.chips || []).map(c => ({ chip: c.name, gw: c.event }));
  const allChips = ["wildcard", "freehit", "bboost", "3xc"];
  const chipsAvailable = allChips.filter(chip => {
    if (chip === "wildcard") return chipsUsed.filter(c => c.chip === "wildcard").length < 2;
    return !chipsUsed.some(c => c.chip === chip);
  });

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

  const allFixtures = await api.fixtures();
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
   PHASE 3: TRANSFER ADVISOR
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

  // Find worst performers
  const sortedByXp = [...squadWithXp].sort((a, b) => a.xp - b.xp);
  const worstPlayers = sortedByXp.slice(0, 3);

  // Get potential targets
  const elements = bs.elements || [];
  const teams = bs.teams || [];
  const squadIds = new Set(squad.map(p => p.id));

  const recommendations = [];

  for (const worst of worstPlayers) {
    // Find better alternatives at same position within budget
    const budget = (worst.now_cost || 0) + bank;
    const samePos = elements.filter(p =>
      p.element_type === worst.element_type &&
      !squadIds.has(p.id) &&
      p.status === "a" &&
      p.now_cost <= budget &&
      p.minutes > 90
    );

    // Calculate xP for alternatives
    const altsWithXp = [];
    for (const alt of samePos.slice(0, 20)) {
      const xp = await calculateExpectedPoints(alt, horizon, bs);
      altsWithXp.push({
        ...alt,
        xp: xp.total,
        teamName: teams.find(t => t.id === alt.team)?.short_name || "???",
        xpGain: xp.total - worst.xp
      });
    }

    // Best alternative
    altsWithXp.sort((a, b) => b.xpGain - a.xpGain);
    const best = altsWithXp[0];

    if (best && best.xpGain > 0) {
      recommendations.push({
        out: worst,
        in: best,
        xpGain: best.xpGain,
        costChange: best.now_cost - worst.now_cost
      });
    }
  }

  // Sort by xP gain
  recommendations.sort((a, b) => b.xpGain - a.xpGain);

  // Determine action
  let action = "Hold";
  let actionDetail = "Current squad looks optimal for the horizon.";
  let transfers = [];
  let netGain = 0;
  let hitCost = 0;

  if (recommendations.length > 0) {
    const best = recommendations[0];

    if (freeTransfers >= 1 && best.xpGain > 2) {
      action = "Make 1 Transfer";
      actionDetail = `Transfer out ${best.out.web_name} for ${best.in.web_name} (+${best.xpGain.toFixed(1)} xP)`;
      transfers = [best];
      netGain = best.xpGain;
    }

    // Check if second transfer is worth a hit
    if (recommendations.length > 1 && freeTransfers < 2) {
      const second = recommendations[1];
      if (second.xpGain > 4) {
        action = "Take -4 Hit";
        actionDetail = `Two transfers gain ${(best.xpGain + second.xpGain).toFixed(1)} xP, -4 cost = +${(best.xpGain + second.xpGain - 4).toFixed(1)} net`;
        transfers = [best, second];
        netGain = best.xpGain + second.xpGain - 4;
        hitCost = 4;
      }
    }

    // Check for -8 scenario
    if (recommendations.length > 2 && freeTransfers === 1) {
      const third = recommendations[2];
      const totalGain = recommendations.slice(0, 3).reduce((s, r) => s + r.xpGain, 0);
      if (totalGain > 8) {
        action = "Take -8 Hit";
        actionDetail = `Three transfers gain ${totalGain.toFixed(1)} xP, -8 cost = +${(totalGain - 8).toFixed(1)} net`;
        transfers = recommendations.slice(0, 3);
        netGain = totalGain - 8;
        hitCost = 8;
      }
    }
  }

  return {
    action,
    actionDetail,
    transfers,
    netGain,
    hitCost,
    freeTransfers,
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
    const bs = state.bootstrap || await api.bootstrap();
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
    console.error("Dashboard error:", err);
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
  const xiRows = opt.xi.map(p => `
    <div class="sp-xi-row ${p?.status !== 'a' ? 'sp-xi-flagged' : ''}">
      <span class="sp-xi-pos">${({ 1: 'G', 2: 'D', 3: 'M', 4: 'F' })[p?.element_type] || '?'}</span>
      <span class="sp-xi-name">${p?.web_name || '?'}</span>
      <span class="sp-xi-team">${p?.teamName || ''}</span>
      <span class="sp-xi-xp">${p?.xp?.toFixed(1) || '0'}</span>
    </div>
  `).join("");

  const benchRows = opt.bench.slice(0, 4).map(p => `
    <div class="sp-bench-row">
      <span class="sp-xi-pos">${({ 1: 'G', 2: 'D', 3: 'M', 4: 'F' })[p?.element_type] || '?'}</span>
      <span class="sp-xi-name">${p?.web_name || '?'}</span>
      <span class="sp-xi-xp">${p?.xp?.toFixed(1) || '0'}</span>
    </div>
  `).join("");

  return `
    <div class="sp-card sp-card-squad">
      <div class="sp-card-header">Optimal XI <span class="sp-xp-total">${opt.totalXp.toFixed(1)} xP (${horizon}GW)</span></div>
      <div class="sp-xi-list">${xiRows}</div>
      <div class="sp-bench-header">Bench</div>
      <div class="sp-bench-list">${benchRows}</div>
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
  if (t.transfers.length > 0) {
    transferRows = t.transfers.map(tr => `
      <div class="sp-transfer-row">
        <span class="sp-tr-out">${tr.out.web_name}</span>
        <span class="sp-tr-arrow">→</span>
        <span class="sp-tr-in">${tr.in.web_name}</span>
        <span class="sp-tr-gain">+${tr.xpGain.toFixed(1)}</span>
      </div>
    `).join("");
  }

  return `
    <div class="sp-card">
      <div class="sp-card-header">Transfer Advisor</div>
      <div class="sp-action ${actionClass}">${t.action}</div>
      <div class="sp-action-detail">${t.actionDetail}</div>
      ${t.hitCost > 0 ? `<div class="sp-hit-cost">Hit cost: -${t.hitCost} pts</div>` : ''}
      ${t.netGain > 0 ? `<div class="sp-net-gain">Net gain: +${t.netGain.toFixed(1)} xP</div>` : ''}
      ${transferRows}
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
      <div class="sp-card-header">Assumptions</div>
      <ul class="sp-assumptions">
        <li>xP uses FPL's xGI + FDR</li>
        <li>Cannot predict rotation</li>
        <li>Public data only</li>
        <li>-4 hit = needs >4 xP gain</li>
      </ul>
    </div>
  `;
}
