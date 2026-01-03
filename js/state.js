// js/state.js
// Writable state with auto-persistence to localStorage.
// Compatible with direct assignments like `state.entryId = 123`.

import { STORAGE_KEYS, getItem, setItem, getJSON, setJSON } from './storage.js';

const _state = {
  entryId: null,
  leagueIds: [],
  watchlist: [],
  pinnedTeams: [],
  bootstrap: null,
  bootstrapMeta: null,
  // Per-page fetch timestamps
  pageLastUpdated: {},
};

// Hydrate from localStorage (best-effort)
try {
  const savedEntry = getItem(STORAGE_KEYS.ENTRY_ID);
  if (savedEntry) _state.entryId = Number(savedEntry);

  const savedLeagues = getJSON(STORAGE_KEYS.LEAGUE_IDS);
  if (savedLeagues) _state.leagueIds = savedLeagues;

  const savedWatchlist = getJSON(STORAGE_KEYS.WATCHLIST);
  if (savedWatchlist) _state.watchlist = savedWatchlist;

  const savedPinnedTeams = getJSON(STORAGE_KEYS.PINNED_TEAMS);
  if (savedPinnedTeams) _state.pinnedTeams = savedPinnedTeams;
} catch {}

function persist(prop, value) {
  try {
    if (prop === "entryId") {
      setItem(STORAGE_KEYS.ENTRY_ID, value ?? "");
    } else if (prop === "leagueIds") {
      setJSON(STORAGE_KEYS.LEAGUE_IDS, value || []);
    } else if (prop === "watchlist") {
      setJSON(STORAGE_KEYS.WATCHLIST, value || []);
    } else if (prop === "pinnedTeams") {
      setJSON(STORAGE_KEYS.PINNED_TEAMS, value || []);
    }
  } catch {}
}

export const state = new Proxy({}, {
  get(_, prop) {
    return _state[prop];
  },
  set(_, prop, value) {
    if (prop === "entryId") {
      _state.entryId = value ?? null;
      persist("entryId", _state.entryId);
      return true;
    }
    if (prop === "leagueIds") {
      _state.leagueIds = Array.isArray(value) ? value : [];
      persist("leagueIds", _state.leagueIds);
      return true;
    }
    if (prop === "watchlist") {
      _state.watchlist = Array.isArray(value) ? value : [];
      persist("watchlist", _state.watchlist);
      return true;
    }
    if (prop === "pinnedTeams") {
      _state.pinnedTeams = Array.isArray(value) ? value : [];
      persist("pinnedTeams", _state.pinnedTeams);
      return true;
    }
    if (prop === "bootstrap") {
      _state.bootstrap = value;
      return true;
    }
    if (prop === "bootstrapMeta") {
      _state.bootstrapMeta = value;
      return true;
    }
    if (prop === "pageLastUpdated") {
      _state.pageLastUpdated = value;
      return true;
    }
    // Fallback for any ad-hoc props
    _state[prop] = value;
    return true;
  }
});

// Watchlist helper functions
export function isInWatchlist(playerId) {
  return _state.watchlist.includes(playerId);
}

export function toggleWatchlist(playerId) {
  const idx = _state.watchlist.indexOf(playerId);
  if (idx === -1) {
    _state.watchlist = [..._state.watchlist, playerId];
  } else {
    _state.watchlist = _state.watchlist.filter(id => id !== playerId);
  }
  persist("watchlist", _state.watchlist);
  try {
    window.dispatchEvent(new CustomEvent("watchlist-changed", { detail: { playerId, active: isInWatchlist(playerId) } }));
  } catch {}
  return isInWatchlist(playerId);
}

export function getWatchlist() {
  return [..._state.watchlist];
}

// Pinned teams helper functions
export function isTeamPinned(teamId) {
  return _state.pinnedTeams.includes(teamId);
}

export function togglePinnedTeam(teamId) {
  const idx = _state.pinnedTeams.indexOf(teamId);
  if (idx === -1) {
    _state.pinnedTeams = [..._state.pinnedTeams, teamId];
  } else {
    _state.pinnedTeams = _state.pinnedTeams.filter(id => id !== teamId);
  }
  persist("pinnedTeams", _state.pinnedTeams);
  try {
    window.dispatchEvent(new CustomEvent("pinned-teams-changed", { detail: { teamId, active: isTeamPinned(teamId) } }));
  } catch {}
  return isTeamPinned(teamId);
}

export function getPinnedTeams() {
  return [..._state.pinnedTeams];
}

/**
 * Validate required state for app functionality
 * @param {Object} options - Validation options
 * @param {boolean} options.requireEntryId - Require entry ID (default: true)
 * @param {boolean} options.requireLeagueIds - Require league IDs (default: false)
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function validateState(options = {}) {
  const {
    requireEntryId = true,
    requireLeagueIds = false,
  } = options;

  const missing = [];

  if (requireEntryId && !_state.entryId) {
    missing.push('entryId');
  }

  if (requireLeagueIds && (!_state.leagueIds || _state.leagueIds.length === 0)) {
    missing.push('leagueIds');
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

/**
 * Check if entry ID is configured
 */
export function hasEntryId() {
  return !!_state.entryId;
}

/**
 * Check if league IDs are configured
 */
export function hasLeagueIds() {
  return _state.leagueIds && _state.leagueIds.length > 0;
}

/**
 * Set page last updated timestamp
 */
export function setPageUpdated(pageName) {
  _state.pageLastUpdated = {
    ..._state.pageLastUpdated,
    [pageName]: Date.now(),
  };
}

/**
 * Get page last updated timestamp
 */
export function getPageUpdated(pageName) {
  return _state.pageLastUpdated[pageName] || null;
}

/**
 * Format relative time for display
 */
export function formatPageUpdated(pageName) {
  const timestamp = getPageUpdated(pageName);
  if (!timestamp) return null;

  const diff = Math.floor((Date.now() - timestamp) / 1000);

  if (diff < 5) return 'Just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/**
 * Get freshness class for styling
 */
export function getPageFreshnessClass(pageName) {
  const timestamp = getPageUpdated(pageName);
  if (!timestamp) return '';

  const diff = Math.floor((Date.now() - timestamp) / 1000);

  if (diff > 300) return 'old';      // >5 min
  if (diff > 60) return 'stale';     // >1 min
  return '';                          // fresh
}
