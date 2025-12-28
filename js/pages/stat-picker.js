// js/pages/stat-picker.js
// Phase 2: Stat Picker with password gate, CurrentState engine, and explainable scoring

import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";

/* ═══════════════════════════════════════════════════════════════════════════
   PASSWORD GATE - localStorage with 24h expiry
   ═══════════════════════════════════════════════════════════════════════════ */

const GATE_KEY = "fpl.statPickerUnlocked";
const GATE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const GATE_PASSWORD = "fpl2025"; // Simple password for demo purposes

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
   CURRENT STATE ENGINE - Single source of truth from FPL APIs
   ═══════════════════════════════════════════════════════════════════════════ */

async function buildCurrentState() {
  const bs = state.bootstrap || await api.bootstrap();
  if (!bs) throw new Error("Bootstrap data not available");

  const entryId = state.entryId;
  if (!entryId) {
    return { error: "NO_ENTRY_ID", message: "Set your Entry ID in the sidebar to see your team state." };
  }

  // Fetch all required data
  const [entry, history, fixtures] = await Promise.all([
    api.entry(entryId).catch(() => null),
    api.entryHistory(entryId).catch(() => null),
    api.fixtures().catch(() => [])
  ]);

  if (!entry) {
    return { error: "ENTRY_NOT_FOUND", message: `Entry ${entryId} not found. Check your Entry ID.` };
  }

  // Determine current and next GW
  const events = bs.events || [];
  const currentEvent = events.find(e => e.is_current);
  const nextEvent = events.find(e => e.is_next);
  const lastFinished = events.filter(e => e.data_checked).slice(-1)[0];

  const currentGw = currentEvent?.id || lastFinished?.id || 1;
  const nextGw = nextEvent?.id || currentGw + 1;
  const isLive = currentEvent && !currentEvent.data_checked;

  // Get latest picks
  const gwForPicks = isLive ? currentGw : (lastFinished?.id || 1);
  let picks = null;
  try {
    picks = await api.entryPicks(entryId, gwForPicks);
  } catch {
    // May fail if no picks yet
  }

  // Extract team value, bank, transfers from history
  const currentHistory = history?.current?.find(h => h.event === gwForPicks);
  const previousHistory = history?.current?.find(h => h.event === gwForPicks - 1);

  const bank = currentHistory?.bank ?? entry.last_deadline_bank ?? 0;
  const teamValue = currentHistory?.value ?? entry.last_deadline_value ?? 1000;
  const freeTransfers = calculateFreeTransfers(history, currentGw);

  // Chips
  const chipsUsed = (history?.chips || []).map(c => ({ chip: c.name, gw: c.event }));
  const allChips = ["wildcard", "freehit", "bboost", "3xc"];
  const chipsAvailable = allChips.filter(chip => {
    // Wildcard can be used twice (before and after certain GW)
    if (chip === "wildcard") {
      const wcUsages = chipsUsed.filter(c => c.chip === "wildcard").length;
      return wcUsages < 2;
    }
    return !chipsUsed.some(c => c.chip === chip);
  });

  // Build squad from picks
  let squad = [];
  let captain = null;
  let viceCaptain = null;
  let bench = [];

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

  const xi = squad.filter(p => !p.isBench);

  // Flagged players (not available or doubtful)
  const flaggedPlayers = squad
    .filter(p => p.status !== "a")
    .map(p => ({
      ...p,
      flagReason: getFlagReason(p),
    }));

  // Build fixture matrix for user's teams
  const userTeamIds = [...new Set(squad.map(p => p.team))];
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

  // Start with 1 FT, max 5 (changed from 2 in 2024/25)
  let ft = 1;

  // Look at transfer history to calculate rollover
  const lastGw = history.current.find(h => h.event === currentGw - 1);
  if (lastGw) {
    // If they made 0 transfers last GW, they banked one
    // But we don't have direct access to this, so estimate
    ft = Math.min(5, 1 + (lastGw.event_transfers === 0 ? 1 : 0));
  }

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

  let reason = statusMap[player.status] || "Unknown status";
  if (player.news) {
    reason += ` - ${player.news}`;
  }
  if (player.chance_of_playing_next_round != null) {
    reason += ` (${player.chance_of_playing_next_round}% chance)`;
  }

  return reason;
}

async function buildFixtureMatrix(teamIds, startGw, allFixtures, bs) {
  const teams = bs.teams || [];
  const horizons = [3, 6, 8];
  const matrix = {};

  for (const teamId of teamIds) {
    const team = teams.find(t => t.id === teamId);
    matrix[teamId] = {
      teamId,
      teamName: team?.short_name || "???",
      horizons: {},
    };

    for (const h of horizons) {
      const gwRange = [];
      for (let gw = startGw; gw < startGw + h && gw <= 38; gw++) {
        gwRange.push(gw);
      }

      const fixtures = [];
      for (const gw of gwRange) {
        const gwFixtures = allFixtures.filter(f => f.event === gw);
        const teamFx = gwFixtures.filter(f => f.team_h === teamId || f.team_a === teamId);

        for (const fx of teamFx) {
          const isHome = fx.team_h === teamId;
          const oppId = isHome ? fx.team_a : fx.team_h;
          const opp = teams.find(t => t.id === oppId);
          const fdr = isHome ? fx.team_h_difficulty : fx.team_a_difficulty;

          fixtures.push({
            gw,
            opponent: opp?.short_name || "???",
            isHome,
            fdr,
          });
        }
      }

      // Calculate average FDR
      const avgFdr = fixtures.length
        ? (fixtures.reduce((sum, f) => sum + f.fdr, 0) / fixtures.length).toFixed(2)
        : null;

      matrix[teamId].horizons[h] = {
        fixtures,
        avgFdr,
        label: `Next ${h}`,
      };
    }
  }

  return matrix;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCORING MODEL - Explainable Expected Points
   ═══════════════════════════════════════════════════════════════════════════ */

async function calculateExpectedPoints(player, horizon, bs) {
  const startGw = (bs.events || []).find(e => e.is_next)?.id || 1;
  const gwIds = [];
  for (let gw = startGw; gw < startGw + horizon && gw <= 38; gw++) {
    gwIds.push(gw);
  }

  const allFixtures = await api.fixtures();
  const teams = bs.teams || [];

  // Get player's fixtures for horizon
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
    return {
      total: 0,
      perGw: [],
      explanation: "No fixtures in selected horizon (blank gameweeks).",
      components: { appearance: 0, attack: 0, cleanSheet: 0, bonus: 0 },
    };
  }

  // Calculate minutes reliability
  const minutesReliability = calculateMinutesReliability(player);
  const xMins = (minutesReliability.score / 100) * 90;

  // Get xGI data
  const xgi90 = player.expected_goal_involvements
    ? parseFloat(player.expected_goal_involvements) / Math.max(player.minutes / 90, 1)
    : estimateXgi90FromThreatCreativity(player);

  // Position-based scoring
  const posId = player.element_type; // 1=GKP, 2=DEF, 3=MID, 4=FWD
  const csPoints = posId === 1 || posId === 2 ? 4 : posId === 3 ? 1 : 0;
  const goalPoints = posId === 1 || posId === 2 ? 6 : posId === 3 ? 5 : 4;

  let totalXp = 0;
  let totalAppearance = 0;
  let totalAttack = 0;
  let totalCS = 0;
  let totalBonus = 0;
  const perGw = [];

  for (const fx of playerFixtures) {
    // Appearance points (2 for 60+, 1 for 1-59)
    const appearanceXp = xMins >= 60 ? 2 : xMins > 0 ? 1 : 0;

    // Attack points from xGI
    const fdrMult = getFdrMultiplier(fx.fdr);
    const homeMult = fx.isHome ? 1.05 : 0.95;
    const attackXp = xgi90 * (xMins / 90) * goalPoints * fdrMult * homeMult;

    // Clean sheet probability
    const csProb = getCleanSheetProb(fx.fdr, fx.isHome);
    const csXp = csProb * csPoints * (xMins >= 60 ? 1 : 0);

    // Bonus estimate (from BPS if available)
    const bps = parseFloat(player.bps || 0);
    const bps90 = player.minutes > 0 ? bps / (player.minutes / 90) : 0;
    const bonusXp = Math.min(0.8, bps90 / 30) * (xMins / 90);

    const gwXp = appearanceXp + attackXp + csXp + bonusXp;

    totalXp += gwXp;
    totalAppearance += appearanceXp;
    totalAttack += attackXp;
    totalCS += csXp;
    totalBonus += bonusXp;

    perGw.push({
      gw: fx.gw,
      opponent: fx.opponent,
      isHome: fx.isHome,
      fdr: fx.fdr,
      xp: gwXp.toFixed(1),
      breakdown: {
        appearance: appearanceXp.toFixed(1),
        attack: attackXp.toFixed(1),
        cs: csXp.toFixed(1),
        bonus: bonusXp.toFixed(1),
      },
    });
  }

  // Build explanation
  const explanation = buildXpExplanation(player, minutesReliability, xgi90, playerFixtures, totalXp);

  return {
    total: parseFloat(totalXp.toFixed(1)),
    perGw,
    explanation,
    components: {
      appearance: parseFloat(totalAppearance.toFixed(1)),
      attack: parseFloat(totalAttack.toFixed(1)),
      cleanSheet: parseFloat(totalCS.toFixed(1)),
      bonus: parseFloat(totalBonus.toFixed(1)),
    },
    minutesReliability,
  };
}

function estimateXgi90FromThreatCreativity(player) {
  // Fallback: use threat + creativity to estimate xGI
  const threat = parseFloat(player.threat || 0);
  const creativity = parseFloat(player.creativity || 0);
  const mins = Math.max(player.minutes || 1, 1);

  // Normalize to per-90
  const threat90 = threat / (mins / 90);
  const creativity90 = creativity / (mins / 90);

  // Rough conversion: threat/500 + creativity/1000 approximates xGI
  return (threat90 / 500) + (creativity90 / 1000);
}

function getFdrMultiplier(fdr) {
  // Easier fixtures = more attacking returns expected
  const map = { 1: 1.15, 2: 1.10, 3: 1.00, 4: 0.90, 5: 0.80 };
  return map[fdr] || 1.00;
}

function getCleanSheetProb(fdr, isHome) {
  // Base probability by FDR
  const baseProb = { 1: 0.40, 2: 0.35, 3: 0.25, 4: 0.15, 5: 0.08 };
  let prob = baseProb[fdr] || 0.20;

  // Home advantage
  prob += isHome ? 0.03 : -0.03;

  return Math.max(0.02, Math.min(0.60, prob));
}

function buildXpExplanation(player, minutesReliability, xgi90, fixtures, totalXp) {
  const posNames = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
  const pos = posNames[player.element_type] || "?";

  const avgFdr = fixtures.length
    ? (fixtures.reduce((s, f) => s + f.fdr, 0) / fixtures.length).toFixed(1)
    : "N/A";

  const homeCount = fixtures.filter(f => f.isHome).length;
  const awayCount = fixtures.length - homeCount;

  const parts = [
    `**${player.web_name}** (${pos}, £${(player.now_cost / 10).toFixed(1)}m)`,
    ``,
    `**Minutes Reliability:** ${minutesReliability.score}/100 - ${minutesReliability.reason}`,
    ``,
    `**xGI per 90:** ${xgi90.toFixed(3)} ${xgi90 < 0.1 ? "(low threat)" : xgi90 > 0.4 ? "(high threat)" : "(moderate)"}`,
    ``,
    `**Fixtures (${fixtures.length} GWs):** Avg FDR ${avgFdr}, ${homeCount}H/${awayCount}A`,
    fixtures.map(f => `  GW${f.gw}: ${f.isHome ? "" : "@"}${f.opponent} (FDR ${f.fdr})`).join("\n"),
    ``,
    `**Total xP:** ${totalXp.toFixed(1)} pts over ${fixtures.length} GWs`,
  ];

  return parts.join("\n");
}

/* ═══════════════════════════════════════════════════════════════════════════
   MINUTES RELIABILITY SCORE (0-100)
   ═══════════════════════════════════════════════════════════════════════════ */

function calculateMinutesReliability(player) {
  let score = 100;
  const reasons = [];

  // 1. Status check (biggest factor)
  const statusPenalty = {
    a: 0,      // Available
    d: 25,     // Doubtful
    i: 60,     // Injured
    s: 40,     // Suspended
    u: 70,     // Unavailable
    n: 80,     // Not in squad
  };

  const penalty = statusPenalty[player.status] || 0;
  if (penalty > 0) {
    score -= penalty;
    reasons.push(`Status: ${player.status === "d" ? "Doubtful" : player.status === "i" ? "Injured" : player.status === "s" ? "Suspended" : "Unavailable"}`);
  }

  // 2. Chance of playing (if available)
  if (player.chance_of_playing_next_round != null && player.chance_of_playing_next_round < 100) {
    const chancePenalty = (100 - player.chance_of_playing_next_round) * 0.5;
    score -= chancePenalty;
    reasons.push(`${player.chance_of_playing_next_round}% chance to play`);
  }

  // 3. Recent minutes trend
  const recentMins = player.minutes || 0;
  const gamesPlayed = getEstimatedGamesPlayed(player);
  const avgMins = gamesPlayed > 0 ? recentMins / gamesPlayed : 0;

  if (avgMins < 45) {
    score -= 20;
    reasons.push(`Low avg mins: ${avgMins.toFixed(0)}'`);
  } else if (avgMins < 60) {
    score -= 10;
    reasons.push(`Rotation risk: ${avgMins.toFixed(0)}' avg`);
  } else if (avgMins >= 85) {
    reasons.push(`Nailed: ${avgMins.toFixed(0)}' avg`);
  }

  // 4. News heuristics
  if (player.news) {
    const newsLower = player.news.toLowerCase();
    if (newsLower.includes("knock") || newsLower.includes("minor")) {
      score -= 10;
      reasons.push("Minor concern in news");
    }
    if (newsLower.includes("rest") || newsLower.includes("rotation")) {
      score -= 15;
      reasons.push("Rotation mentioned");
    }
    if (newsLower.includes("back in training") || newsLower.includes("returned")) {
      score += 5;
      reasons.push("Returned to training");
    }
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Build summary reason
  let summaryReason;
  if (score >= 90) {
    summaryReason = "Nailed starter";
  } else if (score >= 70) {
    summaryReason = "Likely to start";
  } else if (score >= 50) {
    summaryReason = "Rotation/injury risk";
  } else if (score >= 25) {
    summaryReason = "Major doubt";
  } else {
    summaryReason = "Unlikely to play";
  }

  return {
    score,
    reason: summaryReason,
    details: reasons,
  };
}

function getEstimatedGamesPlayed(player) {
  // Estimate from bootstrap - no direct field, use form calculation
  // Form is last 5 GWs average, so we can approximate
  const form = parseFloat(player.form || 0);
  const totalPts = player.total_points || 0;

  if (form > 0 && totalPts > 0) {
    // Very rough: total_pts / (form * some factor)
    return Math.max(1, Math.round(totalPts / (form * 1.2)));
  }

  // Fallback: estimate from minutes assuming 90 per game
  return Math.max(1, Math.round((player.minutes || 0) / 90));
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOP TARGETS BY POSITION
   ═══════════════════════════════════════════════════════════════════════════ */

async function getTopTargets(horizon, bs, currentState) {
  const elements = bs.elements || [];
  const teams = bs.teams || [];
  const positions = bs.element_types || [];

  // Get IDs of players already in squad
  const squadIds = new Set((currentState?.squad || []).map(p => p.id));

  // Filter available players not in squad
  const available = elements.filter(p =>
    p.status === "a" && !squadIds.has(p.id) && p.minutes > 90
  );

  // Calculate xP for each
  const withXp = [];
  for (const player of available.slice(0, 100)) { // Limit for performance
    const xp = await calculateExpectedPoints(player, horizon, bs);
    withXp.push({
      ...player,
      xp: xp.total,
      xpExplanation: xp.explanation,
      minutesReliability: xp.minutesReliability,
      teamName: teams.find(t => t.id === player.team)?.short_name || "???",
      posName: positions.find(p => p.id === player.element_type)?.singular_name_short || "?",
    });
  }

  // Sort by xP and group by position
  const byPosition = {
    1: [], // GKP
    2: [], // DEF
    3: [], // MID
    4: [], // FWD
  };

  for (const p of withXp) {
    if (byPosition[p.element_type]) {
      byPosition[p.element_type].push(p);
    }
  }

  // Sort each position by xP and take top 5
  for (const posId of Object.keys(byPosition)) {
    byPosition[posId].sort((a, b) => b.xp - a.xp);
    byPosition[posId] = byPosition[posId].slice(0, 5);
  }

  return byPosition;
}

/* ═══════════════════════════════════════════════════════════════════════════
   UI RENDERING
   ═══════════════════════════════════════════════════════════════════════════ */

export async function renderStatPicker(main) {
  main.innerHTML = "";

  const page = utils.el("div", { class: "stat-picker-page" });
  main.appendChild(page);

  // Check if unlocked
  if (!isUnlocked()) {
    renderPasswordGate(page);
    return;
  }

  // Render unlocked state
  renderUnlockedUI(page);
}

function renderPasswordGate(container) {
  const gate = utils.el("div", { class: "stat-picker-gate" });

  gate.innerHTML = `
    <div class="gate-card">
      <div class="gate-icon">🔒</div>
      <h2>Stat Picker</h2>
      <p class="gate-desc">Enter password to access the Stat Picker tools.</p>
      <div class="gate-form">
        <input type="password" id="gatePassword" placeholder="Password" autocomplete="off" />
        <button id="gateUnlockBtn" class="btn-primary">Unlock</button>
      </div>
      <p id="gateError" class="gate-error" style="display:none;">Incorrect password</p>
      <p class="gate-hint">Access expires after 24 hours.</p>
    </div>
  `;

  container.appendChild(gate);

  // Bind events
  const input = gate.querySelector("#gatePassword");
  const btn = gate.querySelector("#gateUnlockBtn");
  const error = gate.querySelector("#gateError");

  const tryUnlock = () => {
    if (input.value === GATE_PASSWORD) {
      unlock();
      container.innerHTML = "";
      renderUnlockedUI(container);
    } else {
      error.style.display = "block";
      input.value = "";
      input.focus();
    }
  };

  btn.addEventListener("click", tryUnlock);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryUnlock();
  });

  input.focus();
}

async function renderUnlockedUI(container) {
  // Header with lock button
  const header = utils.el("div", { class: "stat-picker-header" });
  header.innerHTML = `
    <div class="sp-title">
      <h1>Stat Picker</h1>
      <span class="sp-subtitle">Explainable FPL Decision Engine</span>
    </div>
    <div class="sp-controls">
      <select id="horizonSelect" class="select">
        <option value="3">Next 3 GWs</option>
        <option value="6" selected>Next 6 GWs</option>
        <option value="8">Next 8 GWs</option>
      </select>
      <button id="refreshBtn" class="btn-secondary">Refresh</button>
      <button id="lockBtn" class="btn-danger-outline">Lock</button>
    </div>
  `;
  container.appendChild(header);

  // Main content area
  const content = utils.el("div", { class: "stat-picker-content" });
  content.innerHTML = `<div class="loading-spinner"></div><p style="text-align:center;color:var(--muted);">Loading your FPL state...</p>`;
  container.appendChild(content);

  // Bind controls
  const lockBtn = header.querySelector("#lockBtn");
  lockBtn.addEventListener("click", () => {
    lock();
    container.innerHTML = "";
    renderPasswordGate(container);
  });

  const refreshBtn = header.querySelector("#refreshBtn");
  const horizonSelect = header.querySelector("#horizonSelect");

  const loadData = async () => {
    const horizon = parseInt(horizonSelect.value);
    await renderContent(content, horizon);
  };

  refreshBtn.addEventListener("click", loadData);
  horizonSelect.addEventListener("change", loadData);

  // Initial load
  await loadData();
}

async function renderContent(container, horizon) {
  container.innerHTML = `<div class="loading-spinner"></div><p style="text-align:center;color:var(--muted);">Loading your FPL state...</p>`;

  try {
    const bs = state.bootstrap || await api.bootstrap();
    const currentState = await buildCurrentState();

    if (currentState.error) {
      container.innerHTML = `
        <div class="sp-error">
          <div class="error-icon">⚠️</div>
          <h3>${currentState.error}</h3>
          <p>${currentState.message}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";

    // Current State Panel
    const statePanel = renderCurrentStatePanel(currentState);
    container.appendChild(statePanel);

    // Squad Panel (XI + Bench + C/VC)
    const squadPanel = await renderSquadPanel(currentState, horizon, bs);
    container.appendChild(squadPanel);

    // Fixture Matrix Panel
    const fixturePanel = renderFixtureMatrixPanel(currentState, horizon);
    container.appendChild(fixturePanel);

    // Top Targets Panel
    const targetsPanel = await renderTopTargetsPanel(horizon, bs, currentState);
    container.appendChild(targetsPanel);

  } catch (err) {
    console.error("Stat Picker error:", err);
    container.innerHTML = `
      <div class="sp-error">
        <div class="error-icon">❌</div>
        <h3>Error Loading Data</h3>
        <p>${err.message}</p>
      </div>
    `;
  }
}

function renderCurrentStatePanel(currentState) {
  const panel = utils.el("div", { class: "sp-panel" });

  const chipsUsedList = currentState.chipsUsed.length
    ? currentState.chipsUsed.map(c => `${c.chip} (GW${c.gw})`).join(", ")
    : "None";

  const chipsAvailList = currentState.chipsAvailable.length
    ? currentState.chipsAvailable.join(", ")
    : "None";

  panel.innerHTML = `
    <h2 class="sp-panel-title">Current State</h2>
    <div class="sp-state-grid">
      <div class="sp-state-item">
        <span class="sp-state-label">Team</span>
        <span class="sp-state-value">${currentState.entryName}</span>
      </div>
      <div class="sp-state-item">
        <span class="sp-state-label">Manager</span>
        <span class="sp-state-value">${currentState.playerName}</span>
      </div>
      <div class="sp-state-item">
        <span class="sp-state-label">Current GW</span>
        <span class="sp-state-value">${currentState.currentGw}${currentState.isLive ? " (LIVE)" : ""}</span>
      </div>
      <div class="sp-state-item">
        <span class="sp-state-label">Next GW</span>
        <span class="sp-state-value">${currentState.nextGw}</span>
      </div>
      <div class="sp-state-item">
        <span class="sp-state-label">Free Transfers</span>
        <span class="sp-state-value">${currentState.freeTransfers}</span>
      </div>
      <div class="sp-state-item">
        <span class="sp-state-label">Bank</span>
        <span class="sp-state-value">${currentState.bankFormatted}</span>
      </div>
      <div class="sp-state-item">
        <span class="sp-state-label">Team Value</span>
        <span class="sp-state-value">${currentState.teamValueFormatted}</span>
      </div>
      <div class="sp-state-item">
        <span class="sp-state-label">Total Value</span>
        <span class="sp-state-value">${currentState.totalValueFormatted}</span>
      </div>
      <div class="sp-state-item sp-state-wide">
        <span class="sp-state-label">Chips Available</span>
        <span class="sp-state-value">${chipsAvailList}</span>
      </div>
      <div class="sp-state-item sp-state-wide">
        <span class="sp-state-label">Chips Used</span>
        <span class="sp-state-value">${chipsUsedList}</span>
      </div>
      <div class="sp-state-item">
        <span class="sp-state-label">Overall Rank</span>
        <span class="sp-state-value">${currentState.overallRank?.toLocaleString() || "N/A"}</span>
      </div>
      <div class="sp-state-item">
        <span class="sp-state-label">Overall Points</span>
        <span class="sp-state-value">${currentState.overallPoints?.toLocaleString() || "N/A"}</span>
      </div>
    </div>

    ${currentState.flaggedPlayers.length > 0 ? `
      <div class="sp-flagged">
        <h3>Flagged Players</h3>
        <div class="sp-flagged-list">
          ${currentState.flaggedPlayers.map(p => `
            <div class="sp-flagged-item">
              <span class="sp-flagged-name">${p.web_name}</span>
              <span class="sp-flagged-reason">${p.flagReason}</span>
            </div>
          `).join("")}
        </div>
      </div>
    ` : ""}
  `;

  return panel;
}

async function renderSquadPanel(currentState, horizon, bs) {
  const panel = utils.el("div", { class: "sp-panel" });

  // Calculate xP for each player
  const xiWithXp = [];
  for (const p of currentState.xi) {
    const xp = await calculateExpectedPoints(p, horizon, bs);
    xiWithXp.push({ ...p, xp: xp.total, xpData: xp });
  }

  const benchWithXp = [];
  for (const p of currentState.bench) {
    const xp = await calculateExpectedPoints(p, horizon, bs);
    benchWithXp.push({ ...p, xp: xp.total, xpData: xp });
  }

  // Sort XI by position for display
  xiWithXp.sort((a, b) => a.pickPosition - b.pickPosition);

  const captain = currentState.captain;
  const vice = currentState.viceCaptain;

  panel.innerHTML = `
    <h2 class="sp-panel-title">This GW Squad</h2>

    <div class="sp-captain-row">
      <div class="sp-captain-card">
        <span class="sp-captain-badge">C</span>
        <span class="sp-captain-name">${captain?.web_name || "N/A"}</span>
        <span class="sp-captain-team">${captain?.teamName || ""}</span>
      </div>
      <div class="sp-captain-card">
        <span class="sp-captain-badge sp-vc">VC</span>
        <span class="sp-captain-name">${vice?.web_name || "N/A"}</span>
        <span class="sp-captain-team">${vice?.teamName || ""}</span>
      </div>
    </div>

    <h3>Starting XI</h3>
    <div class="sp-squad-table">
      <div class="sp-squad-header">
        <span>Player</span>
        <span>Team</span>
        <span>Pos</span>
        <span>Price</span>
        <span>xP (${horizon}GW)</span>
        <span>Why</span>
      </div>
      ${xiWithXp.map(p => `
        <div class="sp-squad-row ${p.status !== "a" ? "sp-flagged-row" : ""}">
          <span class="sp-player-name">
            ${p.isCaptain ? '<span class="mini-badge">C</span>' : ""}
            ${p.isVice ? '<span class="mini-badge">V</span>' : ""}
            ${p.web_name}
          </span>
          <span>${p.teamName}</span>
          <span>${p.positionName}</span>
          <span>£${(p.now_cost / 10).toFixed(1)}m</span>
          <span class="sp-xp-value">${p.xp.toFixed(1)}</span>
          <span class="sp-why" data-tooltip="${escapeHtml(p.xpData.explanation)}">?</span>
        </div>
      `).join("")}
    </div>

    <h3>Bench</h3>
    <div class="sp-squad-table">
      <div class="sp-squad-header">
        <span>Player</span>
        <span>Team</span>
        <span>Pos</span>
        <span>Price</span>
        <span>xP (${horizon}GW)</span>
        <span>Why</span>
      </div>
      ${benchWithXp.map(p => `
        <div class="sp-squad-row sp-bench-row ${p.status !== "a" ? "sp-flagged-row" : ""}">
          <span class="sp-player-name">${p.web_name}</span>
          <span>${p.teamName}</span>
          <span>${p.positionName}</span>
          <span>£${(p.now_cost / 10).toFixed(1)}m</span>
          <span class="sp-xp-value">${p.xp.toFixed(1)}</span>
          <span class="sp-why" data-tooltip="${escapeHtml(p.xpData.explanation)}">?</span>
        </div>
      `).join("")}
    </div>
  `;

  return panel;
}

function renderFixtureMatrixPanel(currentState, horizon) {
  const panel = utils.el("div", { class: "sp-panel" });

  const matrix = currentState.fixtureMatrix;
  const teamIds = Object.keys(matrix);

  if (teamIds.length === 0) {
    panel.innerHTML = `<h2 class="sp-panel-title">Fixture Matrix</h2><p>No fixture data available.</p>`;
    return panel;
  }

  // Show fixtures for selected horizon
  const rows = teamIds.map(teamId => {
    const team = matrix[teamId];
    const horizonData = team.horizons[horizon];

    if (!horizonData) return "";

    const fixtures = horizonData.fixtures.slice(0, horizon);
    const fxCells = fixtures.map(f => {
      const fdrClass = `fdr-${f.fdr}`;
      return `<span class="sp-fx-cell ${fdrClass}" data-tooltip="GW${f.gw}: ${f.isHome ? "" : "@"}${f.opponent} (FDR ${f.fdr})">${f.isHome ? "" : "@"}${f.opponent}</span>`;
    }).join("");

    return `
      <div class="sp-fx-row">
        <span class="sp-fx-team">${team.teamName}</span>
        <span class="sp-fx-fixtures">${fxCells}</span>
        <span class="sp-fx-avg">Avg: ${horizonData.avgFdr}</span>
      </div>
    `;
  }).join("");

  panel.innerHTML = `
    <h2 class="sp-panel-title">Fixture Matrix (Next ${horizon} GWs)</h2>
    <div class="sp-fx-matrix">
      ${rows}
    </div>
    <div class="sp-fx-legend">
      <span class="sp-fx-legend-item"><span class="sp-fx-dot fdr-1"></span>FDR 1 (Easiest)</span>
      <span class="sp-fx-legend-item"><span class="sp-fx-dot fdr-2"></span>FDR 2</span>
      <span class="sp-fx-legend-item"><span class="sp-fx-dot fdr-3"></span>FDR 3</span>
      <span class="sp-fx-legend-item"><span class="sp-fx-dot fdr-4"></span>FDR 4</span>
      <span class="sp-fx-legend-item"><span class="sp-fx-dot fdr-5"></span>FDR 5 (Hardest)</span>
    </div>
  `;

  return panel;
}

async function renderTopTargetsPanel(horizon, bs, currentState) {
  const panel = utils.el("div", { class: "sp-panel" });

  panel.innerHTML = `
    <h2 class="sp-panel-title">Top Targets by Position (Next ${horizon} GWs)</h2>
    <p style="color:var(--muted);margin-bottom:16px;">Players not in your squad, sorted by expected points.</p>
    <div class="loading-spinner"></div>
  `;

  // Load targets asynchronously
  try {
    const targets = await getTopTargets(horizon, bs, currentState);

    const posNames = { 1: "Goalkeepers", 2: "Defenders", 3: "Midfielders", 4: "Forwards" };

    let content = `<h2 class="sp-panel-title">Top Targets by Position (Next ${horizon} GWs)</h2>
      <p style="color:var(--muted);margin-bottom:16px;">Players not in your squad, sorted by expected points.</p>`;

    for (const posId of [1, 2, 3, 4]) {
      const players = targets[posId] || [];

      content += `
        <h3>${posNames[posId]}</h3>
        <div class="sp-targets-table">
          <div class="sp-targets-header">
            <span>Player</span>
            <span>Team</span>
            <span>Price</span>
            <span>Form</span>
            <span>Mins %</span>
            <span>xP</span>
            <span>Why</span>
          </div>
          ${players.map(p => `
            <div class="sp-targets-row">
              <span class="sp-target-name">${p.web_name}</span>
              <span>${p.teamName}</span>
              <span>£${(p.now_cost / 10).toFixed(1)}m</span>
              <span>${p.form}</span>
              <span class="sp-mins-score" data-tooltip="${p.minutesReliability.details.join(", ") || "Nailed"}">${p.minutesReliability.score}</span>
              <span class="sp-xp-value">${p.xp.toFixed(1)}</span>
              <span class="sp-why" data-tooltip="${escapeHtml(p.xpExplanation)}">?</span>
            </div>
          `).join("")}
        </div>
      `;
    }

    panel.innerHTML = content;
  } catch (err) {
    panel.innerHTML = `
      <h2 class="sp-panel-title">Top Targets by Position</h2>
      <p class="error">Error loading targets: ${err.message}</p>
    `;
  }

  return panel;
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;");
}
