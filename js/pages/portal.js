// js/pages/portal.js
// Portal Hub - FM26-style landing page with decision-making tiles
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { fplClient } from "../api/fplClient.js";
import { mapBootstrap, mapFixture } from "../api/fplMapping.js";
import { fixtureEase, getMetricExplanations } from "../api/fplDerived.js";

/* ───────────────── Constants ───────────────── */
const TEAM_BADGE_URL = (teamCode) =>
  `https://resources.premierleague.com/premierleague/badges/70/t${teamCode}.png`;

const PLAYER_PHOTO_URL = (photoId) => {
  if (!photoId) return null;
  const cleanId = String(photoId).replace(/\.(png|jpg)$/i, '').replace(/^p/, '');
  return `https://resources.premierleague.com/premierleague/photos/players/110x140/p${cleanId}.png`;
};

/* ───────────────── Skeleton Loading ───────────────── */
function renderSkeleton() {
  const wrap = utils.el("div", { class: "portal-page" });

  const grid = utils.el("div", { class: "portal-grid" });
  for (let i = 0; i < 6; i++) {
    const tile = utils.el("div", { class: "portal-tile skeleton" });
    tile.innerHTML = `
      <div class="skeleton-header" style="height:24px;width:60%;margin-bottom:12px;"></div>
      <div class="skeleton-body" style="height:80px;"></div>
    `;
    grid.append(tile);
  }
  wrap.append(grid);
  return wrap;
}

/* ───────────────── Decision Tile Builders ───────────────── */

// Deadline Countdown Tile
function buildDeadlineTile(events) {
  const tile = utils.el("div", { class: "portal-tile tile-deadline" });

  const now = Date.now();
  // Use deadlineTime (mapped) or deadline_time (raw)
  const upcoming = events.find(e => {
    const dl = e.deadlineTime || e.deadlineDate || e.deadline_time;
    return dl && new Date(dl) > now;
  });

  if (!upcoming) {
    tile.innerHTML = `
      <div class="tile-icon">⏰</div>
      <div class="tile-content">
        <h3 class="tile-title">Season Complete</h3>
        <p class="tile-desc">No upcoming deadlines</p>
      </div>
    `;
    return tile;
  }

  const deadline = new Date(upcoming.deadlineTime || upcoming.deadlineDate || upcoming.deadline_time);
  const diff = deadline - now;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  const urgencyClass = days < 1 ? "urgent" : days < 3 ? "soon" : "relaxed";

  tile.classList.add(`deadline-${urgencyClass}`);
  tile.innerHTML = `
    <div class="tile-icon">⏰</div>
    <div class="tile-content">
      <h3 class="tile-title">GW${upcoming.id} Deadline</h3>
      <div class="deadline-countdown">
        <span class="countdown-num">${days}</span><span class="countdown-label">d</span>
        <span class="countdown-num">${hours}</span><span class="countdown-label">h</span>
        <span class="countdown-num">${mins}</span><span class="countdown-label">m</span>
      </div>
      <p class="tile-desc">${deadline.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
    </div>
  `;

  tile.addEventListener("click", () => {
    window.location.hash = "#/my-team";
  });

  return tile;
}

// Quick Action: Captain Pick
function buildCaptainTile(players, fixtures, currentGw, teams) {
  const tile = utils.el("div", { class: "portal-tile tile-action tile-wide tile-clickable" });

  // Build team map for fixture lookup
  const teamMap = new Map((teams || []).map(t => [t.id, t]));

  // Helper to get next fixture difficulty for a player
  const getNextFixture = (player) => {
    const teamId = player.teamId || player.team;
    const nextFix = (fixtures || [])
      .filter(f => f.event === currentGw || f.event === currentGw + 1)
      .find(f => (f.homeTeamId || f.team_h) === teamId || (f.awayTeamId || f.team_a) === teamId);
    if (!nextFix) return { opponent: '?', fdr: 3, isHome: false };
    const isHome = (nextFix.homeTeamId || nextFix.team_h) === teamId;
    const oppId = isHome ? (nextFix.awayTeamId || nextFix.team_a) : (nextFix.homeTeamId || nextFix.team_h);
    const oppTeam = teamMap.get(oppId);
    return {
      opponent: oppTeam?.shortName || oppTeam?.short_name || '???',
      fdr: isHome ? (nextFix.homeDifficulty || nextFix.team_h_difficulty || 3) : (nextFix.awayDifficulty || nextFix.team_a_difficulty || 3),
      isHome
    };
  };

  // Score captain candidates - prioritize form, fixtures, and minutes
  const candidates = players
    .filter(p => {
      const pos = p.positionId || p.element_type || 0;
      const form = p.form || 0;
      const mins = p.minutes || 0;
      // MIDs and FWDs with form > 2 and has played some minutes
      return pos >= 3 && form >= 2 && mins > 200;
    })
    .map(p => {
      const fix = getNextFixture(p);
      const form = p.form || 0;
      const ppg = p.pointsPerGame || p.points_per_game || 0;
      const mins90 = p.minutes ? (p.minutes / 90) : 1;
      const minsReliability = mins90 > 10 ? 'Nailed' : mins90 > 5 ? 'Regular' : 'Rotation';

      // Score: form*2 + bonus for easy fixtures + PPG
      const fdrBonus = fix.fdr <= 2 ? 2 : fix.fdr >= 4 ? -1 : 0;
      const score = (form * 2) + fdrBonus + (parseFloat(ppg) || 0);

      return {
        ...p,
        form,
        ppg: parseFloat(ppg) || 0,
        fixture: fix,
        minsReliability,
        score
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const fdrClass = (fdr) => fdr <= 2 ? 'fdr-easy' : fdr >= 4 ? 'fdr-hard' : 'fdr-mid';

  tile.innerHTML = `
    <div class="tile-header">
      <span class="tile-icon">👑</span>
      <h3 class="tile-title">Captain Picks</h3>
      <span class="tile-badge" data-tooltip="Ranked by: Form (recent 5 GWs) + Fixture difficulty + Minutes reliability">GW${currentGw}</span>
    </div>
    <div class="tile-body captain-picks-expanded">
      ${candidates.length === 0 ? '<p class="tile-desc">No captain picks available</p>' : candidates.map((p, i) => `
        <div class="captain-option-row" data-player-id="${p.id}">
          <span class="captain-rank">${i + 1}</span>
          <img class="captain-photo" src="${p.photoUrl || PLAYER_PHOTO_URL(p._raw?.photo || p.photo)}" alt="${p.webName || p.web_name}" onerror="this.style.display='none'">
          <div class="captain-details">
            <span class="captain-name">${p.webName || p.web_name || 'Unknown'}</span>
            <div class="captain-meta">
              <span class="captain-chip" data-tooltip="Average points over last 5 GWs. Higher = hotter form.">Form ${p.form.toFixed(1)}</span>
              <span class="captain-chip ${fdrClass(p.fixture.fdr)}" data-tooltip="Next opponent (FDR ${p.fixture.fdr}/5). Lower FDR = easier fixture.">${p.fixture.isHome ? 'H' : 'A'} ${p.fixture.opponent}</span>
              <span class="captain-chip chip-mins" data-tooltip="${p.minsReliability === 'Nailed' ? '10+ full games played, regular starter' : p.minsReliability === 'Regular' ? '5-10 full games, usually plays' : 'Rotation risk, under 5 full games'}">${p.minsReliability}</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="tile-footer">
      <span class="tile-hint">Form + Fixture + Minutes = Captain Score</span>
      <span class="tile-link">View all players →</span>
    </div>
  `;

  tile.addEventListener("click", () => {
    window.location.hash = "#/all-players";
  });

  return tile;
}

// Fixture Difficulty Overview
function buildFixturesTile(teams, fixtures, currentGw) {
  const tile = utils.el("div", { class: "portal-tile tile-wide tile-clickable" });

  // Defensive check for teams array
  if (!Array.isArray(teams) || teams.length === 0) {
    tile.innerHTML = `
      <div class="tile-header">
        <span class="tile-icon">📅</span>
        <h3 class="tile-title">Fixture Outlook</h3>
      </div>
      <div class="tile-body empty-prompt">
        <p>Unable to load fixture data</p>
      </div>
    `;
    return tile;
  }

  // Get next 5 GWs of fixtures per team
  const windowSize = 5;
  const gwIds = [];
  for (let i = currentGw; i < currentGw + windowSize && i <= 38; i++) {
    gwIds.push(i);
  }

  // Find teams with easiest upcoming fixtures
  // Use mapped property names (homeTeamId, awayTeamId, homeDifficulty, awayDifficulty)
  const teamFixtures = teams.map(team => {
    const upcoming = fixtures
      .filter(f => f.event >= currentGw && f.event < currentGw + windowSize)
      .filter(f => (f.homeTeamId || f.team_h) === team.id || (f.awayTeamId || f.team_a) === team.id)
      .map(f => {
        const homeId = f.homeTeamId || f.team_h;
        const awayId = f.awayTeamId || f.team_a;
        const isHome = homeId === team.id;
        return {
          gw: f.event,
          opponent: isHome ? awayId : homeId,
          isHome,
          difficulty: isHome ? (f.homeDifficulty || f.team_h_difficulty) : (f.awayDifficulty || f.team_a_difficulty),
        };
      });

    const easeResult = fixtureEase(upcoming, windowSize);
    return { team, fixtures: upcoming, easeScore: easeResult.score || 50 };
  });

  // Sort for easiest and hardest (need to copy array to avoid mutating)
  const easiest = [...teamFixtures].sort((a, b) => b.easeScore - a.easeScore).slice(0, 4);
  const hardest = [...teamFixtures].sort((a, b) => a.easeScore - b.easeScore).slice(0, 4);

  tile.innerHTML = `
    <div class="tile-header">
      <span class="tile-icon">📅</span>
      <h3 class="tile-title">Fixture Outlook</h3>
      <span class="tile-badge" data-tooltip="Next ${windowSize} gameweeks, scored by average FDR. Higher = easier fixtures.">GW${currentGw}-${currentGw + windowSize - 1}</span>
    </div>
    <div class="tile-body fixtures-overview">
      <div class="fixtures-column">
        <h4 class="fixtures-label good" data-tooltip="Teams with lowest average FDR over the next ${windowSize} GWs. Target their assets for transfers.">Easiest Run</h4>
        ${easiest.map(t => `
          <div class="fixture-team-row">
            <img class="fixture-badge" src="${TEAM_BADGE_URL(t.team.code)}" alt="${t.team.shortName || t.team.short_name}" onerror="this.style.display='none'">
            <span class="fixture-team-name">${t.team.shortName || t.team.short_name || '???'}</span>
            <span class="fixture-score score-good" data-tooltip="Ease score: ${t.easeScore}/100">${t.easeScore}</span>
          </div>
        `).join('')}
      </div>
      <div class="fixtures-column">
        <h4 class="fixtures-label bad" data-tooltip="Teams with highest average FDR. Consider benching or selling their players.">Toughest Run</h4>
        ${hardest.map(t => `
          <div class="fixture-team-row">
            <img class="fixture-badge" src="${TEAM_BADGE_URL(t.team.code)}" alt="${t.team.shortName || t.team.short_name}" onerror="this.style.display='none'">
            <span class="fixture-team-name">${t.team.shortName || t.team.short_name || '???'}</span>
            <span class="fixture-score score-bad" data-tooltip="Ease score: ${t.easeScore}/100">${t.easeScore}</span>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="tile-footer">
      <span class="tile-hint">Ease Score: Higher = easier fixtures (0-100 scale based on FDR)</span>
      <span class="tile-link">Full fixtures →</span>
    </div>
  `;

  tile.addEventListener("click", () => {
    window.location.hash = "#/fixtures";
  });

  return tile;
}

// Transfer Targets
function buildTransfersTile(players) {
  const tile = utils.el("div", { class: "portal-tile tile-action tile-clickable" });

  // Find hot transfers (most transferred in this week)
  // Use transfersIn (mapped) or transfers_in (raw)
  const hotTransfers = players
    .filter(p => (p.transfersIn || p.transfers_in || 0) > 50000)
    .sort((a, b) => (b.transfersIn || b.transfers_in || 0) - (a.transfersIn || a.transfers_in || 0))
    .slice(0, 3);

  // Find differential picks (low ownership, good form)
  // Use selectedByPercent (mapped) or selected_by_percent (raw)
  const differentials = players
    .filter(p => {
      const ownership = p.selectedByPercent || parseFloat(p.selected_by_percent) || 0;
      const form = p.form || 0;
      return ownership < 10 && form > 4;
    })
    .sort((a, b) => (b.form || 0) - (a.form || 0))
    .slice(0, 3);

  const getName = p => p.webName || p.web_name || 'Unknown';
  const getTransfersIn = p => p.transfersIn || p.transfers_in || 0;
  const getOwnership = p => p.selectedByPercent || parseFloat(p.selected_by_percent) || 0;

  tile.innerHTML = `
    <div class="tile-header">
      <span class="tile-icon">🔄</span>
      <h3 class="tile-title">Transfer Targets</h3>
    </div>
    <div class="tile-body transfers-preview">
      <div class="transfers-section">
        <h4 class="transfers-label">🔥 Trending</h4>
        ${hotTransfers.length === 0 ? '<p class="tile-desc">No trending transfers</p>' : hotTransfers.map(p => `
          <div class="transfer-row">
            <span class="transfer-name">${getName(p)}</span>
            <span class="transfer-stat">+${(getTransfersIn(p) / 1000).toFixed(0)}K</span>
          </div>
        `).join('')}
      </div>
      <div class="transfers-section">
        <h4 class="transfers-label">💎 Differentials</h4>
        ${differentials.length === 0 ? '<p class="tile-desc">No differentials found</p>' : differentials.map(p => `
          <div class="transfer-row">
            <span class="transfer-name">${getName(p)}</span>
            <span class="transfer-stat">${getOwnership(p).toFixed(1)}%</span>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="tile-footer">
      <span class="tile-link">All players →</span>
    </div>
  `;

  tile.addEventListener("click", () => {
    window.location.hash = "#/all-players";
  });

  return tile;
}

// Team Status (if entry ID set)
function buildTeamStatusTile(entryId) {
  const tile = utils.el("div", { class: "portal-tile tile-status tile-clickable" });

  if (!entryId) {
    tile.innerHTML = `
      <div class="tile-header">
        <span class="tile-icon">⚽</span>
        <h3 class="tile-title">My Team</h3>
      </div>
      <div class="tile-body empty-prompt">
        <p>Enter your FPL Entry ID in the sidebar to see your team</p>
        <span class="tile-link">Set up now →</span>
      </div>
    `;
    tile.addEventListener("click", () => {
      document.getElementById("entryIdInput")?.focus();
    });
    return tile;
  }

  // Will be populated asynchronously
  tile.innerHTML = `
    <div class="tile-header">
      <span class="tile-icon">⚽</span>
      <h3 class="tile-title">My Team</h3>
    </div>
    <div class="tile-body">
      <div class="loading-spinner"></div>
    </div>
  `;

  // Load team data async
  loadTeamStatus(tile, entryId);

  tile.addEventListener("click", () => {
    window.location.hash = "#/my-team";
  });

  return tile;
}

async function loadTeamStatus(tile, entryId) {
  try {
    const [entry, history] = await Promise.all([
      fplClient.entry(entryId),
      fplClient.entryHistory(entryId),
    ]);

    const lastGw = history.current[history.current.length - 1];
    const rank = entry.summary_overall_rank;
    const rankStr = rank > 999999 ? (rank / 1000000).toFixed(1) + 'M' :
                    rank > 999 ? (rank / 1000).toFixed(0) + 'K' : rank;

    tile.querySelector(".tile-body").innerHTML = `
      <div class="team-status-grid">
        <div class="status-item">
          <span class="status-value">${entry.summary_overall_points}</span>
          <span class="status-label">Total Pts</span>
        </div>
        <div class="status-item">
          <span class="status-value">${rankStr}</span>
          <span class="status-label">Rank</span>
        </div>
        <div class="status-item">
          <span class="status-value">${lastGw?.points || '—'}</span>
          <span class="status-label">Last GW</span>
        </div>
        <div class="status-item">
          <span class="status-value">£${((lastGw?.value || 0) / 10).toFixed(1)}m</span>
          <span class="status-label">Value</span>
        </div>
      </div>
    `;

    const footer = utils.el("div", { class: "tile-footer" });
    footer.innerHTML = `<span class="tile-link">View team →</span>`;
    tile.append(footer);
  } catch (e) {
    tile.querySelector(".tile-body").innerHTML = `
      <p class="tile-error">Could not load team data</p>
    `;
  }
}

// League Standings Summary
function buildLeagueTile(leagueIds) {
  const tile = utils.el("div", { class: "portal-tile tile-status tile-clickable" });

  if (!leagueIds || leagueIds.length === 0) {
    tile.innerHTML = `
      <div class="tile-header">
        <span class="tile-icon">🏆</span>
        <h3 class="tile-title">Mini-Leagues</h3>
      </div>
      <div class="tile-body empty-prompt">
        <p>Add your league IDs in the sidebar to track standings</p>
        <span class="tile-link">Set up now →</span>
      </div>
    `;
    tile.addEventListener("click", () => {
      document.getElementById("leagueIdInput")?.focus();
    });
    return tile;
  }

  tile.innerHTML = `
    <div class="tile-header">
      <span class="tile-icon">🏆</span>
      <h3 class="tile-title">Mini-Leagues</h3>
    </div>
    <div class="tile-body">
      <div class="loading-spinner"></div>
    </div>
  `;

  // Load league data async
  loadLeagueStatus(tile, leagueIds);

  tile.addEventListener("click", () => {
    window.location.hash = "#/mini-league";
  });

  return tile;
}

async function loadLeagueStatus(tile, leagueIds) {
  try {
    const leagues = await Promise.all(
      leagueIds.slice(0, 3).map(id => fplClient.leagueClassic(id, 1).catch(() => null))
    );

    const validLeagues = leagues.filter(Boolean);

    if (validLeagues.length === 0) {
      tile.querySelector(".tile-body").innerHTML = `
        <p class="tile-error">Could not load league data</p>
      `;
      return;
    }

    tile.querySelector(".tile-body").innerHTML = `
      <div class="leagues-preview">
        ${validLeagues.map(league => `
          <div class="league-row">
            <span class="league-name">${league.league?.name || 'League'}</span>
            <span class="league-members">${league.standings?.results?.length || 0} members</span>
          </div>
        `).join('')}
      </div>
    `;

    const footer = utils.el("div", { class: "tile-footer" });
    footer.innerHTML = `<span class="tile-link">View standings →</span>`;
    tile.append(footer);
  } catch (e) {
    tile.querySelector(".tile-body").innerHTML = `
      <p class="tile-error">Could not load league data</p>
    `;
  }
}

// Metrics Help Tile
function buildMetricsTile() {
  const tile = utils.el("div", { class: "portal-tile tile-info tile-clickable" });
  const explanations = getMetricExplanations();

  tile.innerHTML = `
    <div class="tile-header">
      <span class="tile-icon">📊</span>
      <h3 class="tile-title">Metrics Guide</h3>
    </div>
    <div class="tile-body metrics-preview">
      <div class="metric-item">
        <span class="metric-name">xP</span>
        <span class="metric-desc">Expected points projection</span>
      </div>
      <div class="metric-item">
        <span class="metric-name">FDR</span>
        <span class="metric-desc">Fixture difficulty (1-5)</span>
      </div>
      <div class="metric-item">
        <span class="metric-name">EO</span>
        <span class="metric-desc">Effective ownership %</span>
      </div>
    </div>
    <div class="tile-footer">
      <span class="tile-link">Learn more →</span>
    </div>
  `;

  tile.addEventListener("click", () => {
    window.location.hash = "#/help";
  });

  return tile;
}

// Injuries & Unavailable Players Tile
function buildInjuriesTile(players) {
  const tile = utils.el("div", { class: "portal-tile tile-warning tile-clickable" });

  // Find highly-owned injured/doubtful players
  const unavailable = players
    .filter(p => {
      const status = p.status || p._raw?.status || 'a';
      const ownership = p.selectedByPercent || parseFloat(p.selected_by_percent) || 0;
      return status !== 'a' && ownership > 5; // At least 5% owned
    })
    .sort((a, b) => {
      const ownershipA = a.selectedByPercent || parseFloat(a.selected_by_percent) || 0;
      const ownershipB = b.selectedByPercent || parseFloat(b.selected_by_percent) || 0;
      return ownershipB - ownershipA;
    })
    .slice(0, 5);

  const statusIcon = (status) => {
    switch(status) {
      case 'i': return '🔴';
      case 'd': return '🟡';
      case 's': return '⛔';
      case 'n': return '❌';
      default: return '❓';
    }
  };

  const statusLabel = (status) => {
    switch(status) {
      case 'i': return 'Injured';
      case 'd': return 'Doubtful';
      case 's': return 'Suspended';
      case 'n': return 'Unavailable';
      default: return 'Unknown';
    }
  };

  tile.innerHTML = `
    <div class="tile-header">
      <span class="tile-icon">🏥</span>
      <h3 class="tile-title">Injury Watch</h3>
      <span class="tile-badge" data-tooltip="Highly-owned players who are injured, doubtful, or unavailable">Check before deadline</span>
    </div>
    <div class="tile-body injuries-list">
      ${unavailable.length === 0 ? '<p class="tile-desc">No major injuries among popular players</p>' : unavailable.map(p => {
        const status = p.status || p._raw?.status || '?';
        const ownership = p.selectedByPercent || parseFloat(p.selected_by_percent) || 0;
        const news = p.news || p._raw?.news || '';
        const chance = p.chanceOfPlayingNextRound ?? p._raw?.chance_of_playing_next_round ?? null;
        return `
          <div class="injury-row">
            <span class="injury-icon">${statusIcon(status)}</span>
            <div class="injury-details">
              <span class="injury-name">${p.webName || p.web_name || 'Unknown'}</span>
              <span class="injury-status">${statusLabel(status)}${chance !== null ? ` (${chance}%)` : ''}</span>
            </div>
            <span class="injury-ownership" data-tooltip="${ownership.toFixed(1)}% ownership">${ownership.toFixed(0)}%</span>
          </div>
          ${news ? `<div class="injury-news">${news}</div>` : ''}
        `;
      }).join('')}
    </div>
    <div class="tile-footer">
      <span class="tile-hint">Check player news before locking your team</span>
      <span class="tile-link">View all players →</span>
    </div>
  `;

  tile.addEventListener("click", () => {
    window.location.hash = "#/all-players";
  });

  return tile;
}

// Fixture Swings Tile - teams whose fixture difficulty changes significantly
function buildFixtureSwingsTile(teams, fixtures, currentGw) {
  const tile = utils.el("div", { class: "portal-tile tile-insight tile-clickable" });

  if (!Array.isArray(teams) || teams.length === 0) {
    tile.innerHTML = `
      <div class="tile-header">
        <span class="tile-icon">🔄</span>
        <h3 class="tile-title">Fixture Swings</h3>
      </div>
      <div class="tile-body empty-prompt">
        <p>Unable to load fixture data</p>
      </div>
    `;
    return tile;
  }

  // Calculate FDR for GW N-2 to N (recent) vs GW N+1 to N+3 (upcoming)
  const recentWindow = 3;
  const upcomingWindow = 3;

  const teamSwings = teams.map(team => {
    // Recent fixtures (last 3 completed)
    const recentFixtures = fixtures
      .filter(f => f.event && f.event >= currentGw - recentWindow && f.event < currentGw)
      .filter(f => (f.homeTeamId || f.team_h) === team.id || (f.awayTeamId || f.team_a) === team.id)
      .map(f => {
        const isHome = (f.homeTeamId || f.team_h) === team.id;
        return isHome ? (f.homeDifficulty || f.team_h_difficulty || 3) : (f.awayDifficulty || f.team_a_difficulty || 3);
      });

    // Upcoming fixtures (next 3)
    const upcomingFixtures = fixtures
      .filter(f => f.event && f.event >= currentGw && f.event < currentGw + upcomingWindow)
      .filter(f => (f.homeTeamId || f.team_h) === team.id || (f.awayTeamId || f.team_a) === team.id)
      .map(f => {
        const isHome = (f.homeTeamId || f.team_h) === team.id;
        return isHome ? (f.homeDifficulty || f.team_h_difficulty || 3) : (f.awayDifficulty || f.team_a_difficulty || 3);
      });

    const recentAvg = recentFixtures.length ? recentFixtures.reduce((a, b) => a + b, 0) / recentFixtures.length : 3;
    const upcomingAvg = upcomingFixtures.length ? upcomingFixtures.reduce((a, b) => a + b, 0) / upcomingFixtures.length : 3;
    const swing = recentAvg - upcomingAvg; // Positive = fixtures getting easier

    return { team, recentAvg, upcomingAvg, swing };
  });

  // Get teams with biggest positive and negative swings
  const gettingEasier = [...teamSwings].filter(t => t.swing > 0.5).sort((a, b) => b.swing - a.swing).slice(0, 3);
  const gettingHarder = [...teamSwings].filter(t => t.swing < -0.5).sort((a, b) => a.swing - b.swing).slice(0, 3);

  tile.innerHTML = `
    <div class="tile-header">
      <span class="tile-icon">🔄</span>
      <h3 class="tile-title">Fixture Swings</h3>
      <span class="tile-badge" data-tooltip="Comparing average FDR of last ${recentWindow} vs next ${upcomingWindow} gameweeks">Turn-around alert</span>
    </div>
    <div class="tile-body fixture-swings">
      <div class="swing-column">
        <h4 class="swing-label good" data-tooltip="Fixtures getting easier - consider buying these teams' players">Getting Easier</h4>
        ${gettingEasier.length === 0 ? '<p class="tile-desc">No significant improvements</p>' : gettingEasier.map(t => `
          <div class="swing-row">
            <img class="swing-badge" src="${TEAM_BADGE_URL(t.team.code)}" alt="${t.team.shortName || t.team.short_name}" onerror="this.style.display='none'">
            <span class="swing-name">${t.team.shortName || t.team.short_name || '???'}</span>
            <span class="swing-change good" data-tooltip="FDR dropping from ${t.recentAvg.toFixed(1)} to ${t.upcomingAvg.toFixed(1)}">↓${t.swing.toFixed(1)}</span>
          </div>
        `).join('')}
      </div>
      <div class="swing-column">
        <h4 class="swing-label bad" data-tooltip="Fixtures getting harder - consider selling or benching these teams' players">Getting Harder</h4>
        ${gettingHarder.length === 0 ? '<p class="tile-desc">No significant worsening</p>' : gettingHarder.map(t => `
          <div class="swing-row">
            <img class="swing-badge" src="${TEAM_BADGE_URL(t.team.code)}" alt="${t.team.shortName || t.team.short_name}" onerror="this.style.display='none'">
            <span class="swing-name">${t.team.shortName || t.team.short_name || '???'}</span>
            <span class="swing-change bad" data-tooltip="FDR rising from ${t.recentAvg.toFixed(1)} to ${t.upcomingAvg.toFixed(1)}">↑${Math.abs(t.swing).toFixed(1)}</span>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="tile-footer">
      <span class="tile-hint">Plan transfers around fixture swings</span>
      <span class="tile-link">Full fixtures →</span>
    </div>
  `;

  tile.addEventListener("click", () => {
    window.location.hash = "#/fixtures";
  });

  return tile;
}

/* ───────────────── Main Render ───────────────── */
export async function renderPortal(main) {
  // Show skeleton while loading
  ui.mount(main, renderSkeleton());

  try {
    // Load bootstrap data
    const rawBootstrap = await fplClient.bootstrap();
    const bootstrap = mapBootstrap(rawBootstrap);

    // Get current GW
    const currentGw = bootstrap.currentEvent?.id || bootstrap.events.find(e => e.isCurrent)?.id || 1;

    // Load fixtures - pass array, not Map
    const rawFixtures = await fplClient.fixtures();
    const fixtures = rawFixtures.map(f => mapFixture(f, bootstrap.teams));

    // Build the portal
    const page = utils.el("div", { class: "portal-page" });

    // Welcome header
    const header = utils.el("div", { class: "portal-header" });
    header.innerHTML = `
      <h1 class="portal-title">FPL Command Center</h1>
      <p class="portal-subtitle">Quick decisions, smart moves</p>
    `;
    page.append(header);

    // Main grid of tiles
    const grid = utils.el("div", { class: "portal-grid" });

    // Row 1: Deadline + Team Status + League
    grid.append(buildDeadlineTile(bootstrap.events));
    grid.append(buildTeamStatusTile(state.entryId));
    grid.append(buildLeagueTile(state.leagueIds));

    // Row 2: Fixtures (wide) + Captain Picks
    grid.append(buildFixturesTile(bootstrap.teams, fixtures, currentGw));
    grid.append(buildCaptainTile(bootstrap.players, fixtures, currentGw, bootstrap.teams));

    // Row 3: Injuries + Fixture Swings
    grid.append(buildInjuriesTile(bootstrap.players));
    grid.append(buildFixtureSwingsTile(bootstrap.teams, fixtures, currentGw));

    // Row 4: Transfers + Metrics
    grid.append(buildTransfersTile(bootstrap.players));
    grid.append(buildMetricsTile());

    page.append(grid);
    ui.mount(main, page);

  } catch (e) {
    console.error("Portal render error:", e);
    // Render error with retry button
    const errorPage = utils.el("div", { class: "portal-page" });
    errorPage.innerHTML = `
      <div class="portal-error">
        <div class="error-icon">⚠️</div>
        <h2>Failed to load Portal</h2>
        <p class="error-message">${e.message || 'Unknown error'}</p>
        <button class="btn-primary retry-btn">Retry</button>
      </div>
    `;
    errorPage.querySelector('.retry-btn')?.addEventListener('click', () => renderPortal(main));
    ui.mount(main, errorPage);
  }
}

export default { renderPortal };
