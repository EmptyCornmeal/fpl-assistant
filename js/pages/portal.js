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
function buildCaptainTile(players, fixtures, currentGw) {
  const tile = utils.el("div", { class: "portal-tile tile-action tile-clickable" });

  // Find top captain picks based on form and fixtures
  // Use positionId (mapped) or element_type (raw) - Mids (3) and FWDs (4) with good form
  const withForm = players
    .filter(p => {
      const pos = p.positionId || p.element_type || 0;
      const form = p.form || 0;
      return pos >= 3 && form > 3;
    })
    .sort((a, b) => (b.form || 0) - (a.form || 0))
    .slice(0, 3);

  tile.innerHTML = `
    <div class="tile-header">
      <span class="tile-icon">👑</span>
      <h3 class="tile-title">Captain Picks</h3>
    </div>
    <div class="tile-body captain-picks">
      ${withForm.length === 0 ? '<p class="tile-desc">No captain picks available</p>' : withForm.map(p => `
        <div class="captain-option" data-player-id="${p.id}">
          <img class="captain-photo" src="${p.photoUrl || PLAYER_PHOTO_URL(p._raw?.photo || p.photo)}" alt="${p.webName || p.web_name}" onerror="this.style.display='none'">
          <div class="captain-info">
            <span class="captain-name">${p.webName || p.web_name || 'Unknown'}</span>
            <span class="captain-form">Form: ${(p.form || 0).toFixed(1)}</span>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="tile-footer">
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

  // Get next 5 GWs of fixtures per team
  const gwIds = [];
  for (let i = currentGw; i < currentGw + 5 && i <= 38; i++) {
    gwIds.push(i);
  }

  // Find teams with easiest upcoming fixtures
  // Use mapped property names (homeTeamId, awayTeamId, homeDifficulty, awayDifficulty)
  const teamFixtures = teams.map(team => {
    const upcoming = fixtures
      .filter(f => f.event >= currentGw && f.event < currentGw + 5)
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

    const easeResult = fixtureEase(upcoming, 5);
    return { team, fixtures: upcoming, easeScore: easeResult.score || 50 };
  });

  // Sort for easiest and hardest (need to copy array to avoid mutating)
  const easiest = [...teamFixtures].sort((a, b) => b.easeScore - a.easeScore).slice(0, 4);
  const hardest = [...teamFixtures].sort((a, b) => a.easeScore - b.easeScore).slice(0, 4);

  tile.innerHTML = `
    <div class="tile-header">
      <span class="tile-icon">📅</span>
      <h3 class="tile-title">Fixture Outlook</h3>
    </div>
    <div class="tile-body fixtures-overview">
      <div class="fixtures-column">
        <h4 class="fixtures-label good">Easiest Run</h4>
        ${easiest.map(t => `
          <div class="fixture-team-row">
            <img class="fixture-badge" src="${TEAM_BADGE_URL(t.team.code)}" alt="${t.team.shortName || t.team.short_name}" onerror="this.style.display='none'">
            <span class="fixture-team-name">${t.team.shortName || t.team.short_name || '???'}</span>
            <span class="fixture-score score-good">${t.easeScore}</span>
          </div>
        `).join('')}
      </div>
      <div class="fixtures-column">
        <h4 class="fixtures-label bad">Toughest Run</h4>
        ${hardest.map(t => `
          <div class="fixture-team-row">
            <img class="fixture-badge" src="${TEAM_BADGE_URL(t.team.code)}" alt="${t.team.shortName || t.team.short_name}" onerror="this.style.display='none'">
            <span class="fixture-team-name">${t.team.shortName || t.team.short_name || '???'}</span>
            <span class="fixture-score score-bad">${t.easeScore}</span>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="tile-footer">
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
    grid.append(buildCaptainTile(bootstrap.players, fixtures, currentGw));

    // Row 3: Transfers + Metrics
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
