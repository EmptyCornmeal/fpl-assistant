// js/api/fplMapping.js
// Normalize raw FPL API payloads to consistent app models

import { getPlayerImage, getTeamBadgeUrl as getBadgeProxyUrl } from "../lib/images.js";

/**
 * Status codes and their meanings
 */
export const PLAYER_STATUS = {
  a: { code: "a", label: "Available", color: "green", icon: "✅" },
  d: { code: "d", label: "Doubtful", color: "yellow", icon: "🟡" },
  i: { code: "i", label: "Injured", color: "red", icon: "🔴" },
  s: { code: "s", label: "Suspended", color: "red", icon: "⛔" },
  n: { code: "n", label: "Unavailable", color: "gray", icon: "⛔" },
  u: { code: "u", label: "Unknown", color: "gray", icon: "❓" },
};

/**
 * Position mappings
 */
export const POSITIONS = {
  1: { id: 1, name: "Goalkeeper", short: "GKP", plural: "Goalkeepers" },
  2: { id: 2, name: "Defender", short: "DEF", plural: "Defenders" },
  3: { id: 3, name: "Midfielder", short: "MID", plural: "Midfielders" },
  4: { id: 4, name: "Forward", short: "FWD", plural: "Forwards" },
};

/**
 * FDR color mapping
 */
export const FDR_COLORS = {
  1: { bg: "#257d5a", label: "Very Easy" },
  2: { bg: "#00ff87", label: "Easy" },
  3: { bg: "#ebebe4", label: "Medium" },
  4: { bg: "#ff1751", label: "Difficult" },
  5: { bg: "#80072d", label: "Very Difficult" },
};

/**
 * Construct player photo URL from API photo field
 * API provides: "12345.png" or "12345.jpg"
 * Returns: Full CDN URL
 */
export function getPlayerPhotoUrl(photoId, size = "110x140") {
  return getPlayerImage(photoId, size);
}

/**
 * Construct team badge URL
 */
export function getTeamBadgeUrl(teamCode, size = 70) {
  return getBadgeProxyUrl(teamCode, size);
}

/**
 * Map raw bootstrap player to normalized Player model
 * Source: bootstrap-static.elements[]
 */
export function mapPlayer(raw, teams = [], positions = []) {
  const teamMap = new Map(teams.map(t => [t.id, t]));
  const posMap = new Map(positions.map(p => [p.id, p]));

  const team = teamMap.get(raw.team);
  const position = posMap.get(raw.element_type) || POSITIONS[raw.element_type];
  const status = PLAYER_STATUS[raw.status] || PLAYER_STATUS.u;

  return {
    // Identity
    id: raw.id,
    webName: raw.web_name,
    firstName: raw.first_name,
    secondName: raw.second_name,
    fullName: `${raw.first_name} ${raw.second_name}`,
    photoUrl: getPlayerPhotoUrl(raw.photo),

    // Team
    teamId: raw.team,
    teamName: team?.name || "Unknown",
    teamShort: team?.short_name || "???",
    teamCode: team?.code,
    teamBadgeUrl: team ? getTeamBadgeUrl(team.code) : null,

    // Position
    positionId: raw.element_type,
    positionName: position?.singular_name || position?.name || "Unknown",
    positionShort: position?.singular_name_short || position?.short || "???",

    // Price (convert from tenths to millions)
    nowCost: raw.now_cost,
    nowCostGbp: raw.now_cost / 10,
    costChangeEvent: raw.cost_change_event,
    costChangeStart: raw.cost_change_start,

    // Availability
    status: status.code,
    statusLabel: status.label,
    statusIcon: status.icon,
    statusColor: status.color,
    news: raw.news || "",
    newsAdded: raw.news_added,
    chanceOfPlayingThisRound: raw.chance_of_playing_this_round,
    chanceOfPlayingNextRound: raw.chance_of_playing_next_round,

    // Ownership & Form
    selectedByPercent: parseFloat(raw.selected_by_percent) || 0,
    form: parseFloat(raw.form) || 0,
    pointsPerGame: parseFloat(raw.points_per_game) || 0,

    // Season Totals
    minutes: raw.minutes || 0,
    totalPoints: raw.total_points || 0,
    goalsScored: raw.goals_scored || 0,
    assists: raw.assists || 0,
    cleanSheets: raw.clean_sheets || 0,
    goalsConceded: raw.goals_conceded || 0,
    ownGoals: raw.own_goals || 0,
    penaltiesSaved: raw.penalties_saved || 0,
    penaltiesMissed: raw.penalties_missed || 0,
    yellowCards: raw.yellow_cards || 0,
    redCards: raw.red_cards || 0,
    saves: raw.saves || 0,
    bonus: raw.bonus || 0,
    bps: raw.bps || 0,

    // Underlying Stats (expected)
    expectedGoals: parseFloat(raw.expected_goals) || 0,
    expectedAssists: parseFloat(raw.expected_assists) || 0,
    expectedGoalInvolvements: parseFloat(raw.expected_goal_involvements) || 0,
    expectedGoalsConceded: parseFloat(raw.expected_goals_conceded) || 0,

    // ICT Index
    influence: parseFloat(raw.influence) || 0,
    creativity: parseFloat(raw.creativity) || 0,
    threat: parseFloat(raw.threat) || 0,
    ictIndex: parseFloat(raw.ict_index) || 0,

    // Transfers
    transfersInEvent: raw.transfers_in_event || 0,
    transfersOutEvent: raw.transfers_out_event || 0,
    transfersIn: raw.transfers_in || 0,
    transfersOut: raw.transfers_out || 0,
    netTransfersEvent: (raw.transfers_in_event || 0) - (raw.transfers_out_event || 0),

    // Raw reference (for edge cases)
    _raw: raw,
  };
}

/**
 * Map raw bootstrap team to normalized Team model
 * Source: bootstrap-static.teams[]
 */
export function mapTeam(raw) {
  return {
    id: raw.id,
    name: raw.name,
    shortName: raw.short_name,
    code: raw.code,
    badgeUrl: getTeamBadgeUrl(raw.code),

    // Strength metrics (for xFDR calculations)
    strength: raw.strength || 0,
    strengthOverallHome: raw.strength_overall_home || 0,
    strengthOverallAway: raw.strength_overall_away || 0,
    strengthAttackHome: raw.strength_attack_home || 0,
    strengthAttackAway: raw.strength_attack_away || 0,
    strengthDefenceHome: raw.strength_defence_home || 0,
    strengthDefenceAway: raw.strength_defence_away || 0,

    // Stats
    played: raw.played || 0,
    win: raw.win || 0,
    draw: raw.draw || 0,
    loss: raw.loss || 0,
    points: raw.points || 0,
    position: raw.position || 0,

    _raw: raw,
  };
}

/**
 * Map raw fixture to normalized Fixture model
 * Source: fixtures/
 */
export function mapFixture(raw, teams = []) {
  const teamMap = new Map(teams.map(t => [t.id, t]));
  const homeTeam = teamMap.get(raw.team_h);
  const awayTeam = teamMap.get(raw.team_a);

  return {
    id: raw.id,
    event: raw.event, // GW ID
    kickoffTime: raw.kickoff_time,
    kickoffDate: raw.kickoff_time ? new Date(raw.kickoff_time) : null,

    // Teams
    homeTeamId: raw.team_h,
    awayTeamId: raw.team_a,
    homeTeamName: homeTeam?.name || "TBD",
    awayTeamName: awayTeam?.name || "TBD",
    homeTeamShort: homeTeam?.short_name || "???",
    awayTeamShort: awayTeam?.short_name || "???",

    // Score
    homeScore: raw.team_h_score,
    awayScore: raw.team_a_score,

    // FDR
    homeDifficulty: raw.team_h_difficulty,
    awayDifficulty: raw.team_a_difficulty,

    // Status
    finished: raw.finished || false,
    finishedProvisional: raw.finished_provisional || false,
    started: raw.started || false,

    // Stats (if finished)
    stats: raw.stats || [],

    _raw: raw,
  };
}

/**
 * Map raw event (gameweek) to normalized Event model
 * Source: bootstrap-static.events[]
 */
export function mapEvent(raw) {
  return {
    id: raw.id,
    name: raw.name,
    deadlineTime: raw.deadline_time,
    deadlineDate: raw.deadline_time ? new Date(raw.deadline_time) : null,

    // Flags
    isCurrent: raw.is_current || false,
    isNext: raw.is_next || false,
    isPrevious: raw.is_previous || false,
    finished: raw.finished || false,
    dataChecked: raw.data_checked || false,

    // Stats
    averageScore: raw.average_entry_score || 0,
    highestScore: raw.highest_score || 0,
    highestScoringEntry: raw.highest_scoring_entry,

    // Chip usage
    chipPlays: raw.chip_plays || [],

    // Transfers
    mostSelected: raw.most_selected,
    mostTransferredIn: raw.most_transferred_in,
    mostCaptained: raw.most_captained,
    mostViceCaptained: raw.most_vice_captained,
    topElement: raw.top_element,
    topElementInfo: raw.top_element_info,

    _raw: raw,
  };
}

/**
 * Map player history entry (from element-summary)
 * Source: element-summary/{id}.history[]
 */
export function mapPlayerHistory(raw) {
  return {
    fixture: raw.fixture,
    round: raw.round, // GW
    kickoffTime: raw.kickoff_time,
    wasHome: raw.was_home,
    opponentTeam: raw.opponent_team,

    // Performance
    totalPoints: raw.total_points || 0,
    minutes: raw.minutes || 0,
    goalsScored: raw.goals_scored || 0,
    assists: raw.assists || 0,
    cleanSheets: raw.clean_sheets || 0,
    goalsConceded: raw.goals_conceded || 0,
    ownGoals: raw.own_goals || 0,
    penaltiesSaved: raw.penalties_saved || 0,
    penaltiesMissed: raw.penalties_missed || 0,
    yellowCards: raw.yellow_cards || 0,
    redCards: raw.red_cards || 0,
    saves: raw.saves || 0,
    bonus: raw.bonus || 0,
    bps: raw.bps || 0,

    // Underlying
    expectedGoals: parseFloat(raw.expected_goals) || 0,
    expectedAssists: parseFloat(raw.expected_assists) || 0,
    expectedGoalInvolvements: parseFloat(raw.expected_goal_involvements) || 0,

    // ICT
    influence: parseFloat(raw.influence) || 0,
    creativity: parseFloat(raw.creativity) || 0,
    threat: parseFloat(raw.threat) || 0,
    ictIndex: parseFloat(raw.ict_index) || 0,

    // Value
    value: raw.value, // Cost at that GW (in tenths)
    selected: raw.selected, // Selection count

    _raw: raw,
  };
}

/**
 * Map entry (manager) profile
 * Source: entry/{id}/
 */
export function mapEntry(raw) {
  return {
    id: raw.id,
    playerFirstName: raw.player_first_name,
    playerLastName: raw.player_last_name,
    playerFullName: `${raw.player_first_name || ""} ${raw.player_last_name || ""}`.trim(),
    teamName: raw.name,
    startedEvent: raw.started_event,

    // Current state
    currentEvent: raw.current_event,
    summaryOverallPoints: raw.summary_overall_points || 0,
    summaryOverallRank: raw.summary_overall_rank || 0,
    summaryEventPoints: raw.summary_event_points || 0,
    summaryEventRank: raw.summary_event_rank || 0,

    // Rankings
    lastDeadlineBank: raw.last_deadline_bank || 0, // in tenths
    lastDeadlineValue: raw.last_deadline_value || 0, // in tenths
    lastDeadlineTotalTransfers: raw.last_deadline_total_transfers || 0,

    // Leagues
    leagues: {
      classic: (raw.leagues?.classic || []).map(l => ({
        id: l.id,
        name: l.name,
        rank: l.entry_rank,
        lastRank: l.entry_last_rank,
        entryCanLeave: l.entry_can_leave,
      })),
      h2h: (raw.leagues?.h2h || []).map(l => ({
        id: l.id,
        name: l.name,
        rank: l.entry_rank,
        lastRank: l.entry_last_rank,
      })),
    },

    _raw: raw,
  };
}

/**
 * Map entry picks for a GW
 * Source: entry/{id}/event/{gw}/picks/
 */
export function mapEntryPicks(raw) {
  return {
    activeChip: raw.active_chip || null,
    automaticSubs: (raw.automatic_subs || []).map(s => ({
      entry: s.entry,
      elementIn: s.element_in,
      elementOut: s.element_out,
      event: s.event,
    })),
    entryHistory: raw.entry_history ? {
      event: raw.entry_history.event,
      points: raw.entry_history.points,
      totalPoints: raw.entry_history.total_points,
      rank: raw.entry_history.rank,
      overallRank: raw.entry_history.overall_rank,
      bank: raw.entry_history.bank, // tenths
      value: raw.entry_history.value, // tenths
      eventTransfers: raw.entry_history.event_transfers,
      eventTransfersCost: raw.entry_history.event_transfers_cost,
      pointsOnBench: raw.entry_history.points_on_bench,
    } : null,
    picks: (raw.picks || []).map(p => ({
      element: p.element,
      position: p.position, // 1-15 (1-11 starters, 12-15 bench)
      multiplier: p.multiplier, // 1=normal, 2=captain, 0=bench
      isCaptain: p.is_captain || false,
      isViceCaptain: p.is_vice_captain || false,
    })),
    _raw: raw,
  };
}

/**
 * Map live event data
 * Source: event/{gw}/live/
 */
export function mapEventLive(raw) {
  const elementsMap = new Map();
  for (const el of raw.elements || []) {
    elementsMap.set(el.id, {
      id: el.id,
      stats: {
        minutes: el.stats?.minutes || 0,
        goalsScored: el.stats?.goals_scored || 0,
        assists: el.stats?.assists || 0,
        cleanSheets: el.stats?.clean_sheets || 0,
        goalsConceded: el.stats?.goals_conceded || 0,
        ownGoals: el.stats?.own_goals || 0,
        penaltiesSaved: el.stats?.penalties_saved || 0,
        penaltiesMissed: el.stats?.penalties_missed || 0,
        yellowCards: el.stats?.yellow_cards || 0,
        redCards: el.stats?.red_cards || 0,
        saves: el.stats?.saves || 0,
        bonus: el.stats?.bonus || 0,
        bps: el.stats?.bps || 0,
        totalPoints: el.stats?.total_points || 0,
      },
      explain: (el.explain || []).map(ex => ({
        fixture: ex.fixture,
        stats: (ex.stats || []).map(s => ({
          identifier: s.identifier,
          points: s.points,
          value: s.value,
        })),
      })),
    });
  }
  return { elements: elementsMap };
}

/**
 * Map league standings
 * Source: leagues-classic/{id}/standings/
 */
export function mapLeagueStandings(raw) {
  return {
    league: {
      id: raw.league?.id,
      name: raw.league?.name,
      created: raw.league?.created,
      adminEntry: raw.league?.admin_entry,
    },
    newEntries: raw.new_entries || { results: [] },
    standings: {
      hasNext: raw.standings?.has_next || false,
      page: raw.standings?.page || 1,
      results: (raw.standings?.results || []).map(r => ({
        id: r.id,
        entryName: r.entry_name,
        playerName: r.player_name,
        rank: r.rank,
        lastRank: r.last_rank,
        rankSort: r.rank_sort,
        total: r.total,
        entry: r.entry,
        eventTotal: r.event_total,
      })),
    },
    _raw: raw,
  };
}

/**
 * Build complete normalized dataset from bootstrap
 */
export function mapBootstrap(raw) {
  const teams = (raw.teams || []).map(mapTeam);
  const positions = raw.element_types || [];
  const players = (raw.elements || []).map(p => mapPlayer(p, raw.teams, positions));
  const events = (raw.events || []).map(mapEvent);

  // Create lookup maps
  const playersById = new Map(players.map(p => [p.id, p]));
  const teamsById = new Map(teams.map(t => [t.id, t]));
  const eventsByGw = new Map(events.map(e => [e.id, e]));

  // Identify key events
  const currentEvent = events.find(e => e.isCurrent);
  const nextEvent = events.find(e => e.isNext);
  const lastFinishedEvent = [...events].reverse().find(e => e.dataChecked);

  return {
    players,
    teams,
    events,
    positions: positions.map(p => ({
      id: p.id,
      name: p.singular_name,
      short: p.singular_name_short,
      plural: p.plural_name,
      squadSelect: p.squad_select,
      squadMinPlay: p.squad_min_play,
      squadMaxPlay: p.squad_max_play,
    })),

    // Lookup helpers
    playersById,
    teamsById,
    eventsByGw,

    // Key events
    currentEvent,
    nextEvent,
    lastFinishedEvent,

    // Timestamp
    fetchedAt: new Date().toISOString(),
    _raw: raw,
  };
}

export default {
  mapPlayer,
  mapTeam,
  mapFixture,
  mapEvent,
  mapPlayerHistory,
  mapEntry,
  mapEntryPicks,
  mapEventLive,
  mapLeagueStandings,
  mapBootstrap,
  getPlayerPhotoUrl,
  getTeamBadgeUrl,
  PLAYER_STATUS,
  POSITIONS,
  FDR_COLORS,
};
