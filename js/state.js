// js/state.js
// Writable state with auto-persistence to localStorage.
// Compatible with direct assignments like `state.entryId = 123`.

import { STORAGE_KEYS, getItem, setItem, getJSON, setJSON } from './storage.js';

const _state = {
  entryId: null,
  leagueIds: [],
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
} catch {}

function persist(prop, value) {
  try {
    if (prop === "entryId") {
      setItem(STORAGE_KEYS.ENTRY_ID, value ?? "");
    } else if (prop === "leagueIds") {
      setJSON(STORAGE_KEYS.LEAGUE_IDS, value || []);
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
