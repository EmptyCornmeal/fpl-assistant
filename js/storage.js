// js/storage.js
// Centralized localStorage keys and storage utilities
// All localStorage keys should be defined here for easy management and documentation

/**
 * localStorage key definitions
 * All keys are prefixed with 'fpl.' for namespacing
 */
export const STORAGE_KEYS = {
  // User identity
  ENTRY_ID: 'fpl.entryId',           // User's FPL team ID (number)
  LEAGUE_IDS: 'fpl.leagueIds',       // Classic league IDs (JSON array of numbers)

  // User preferences
  WATCHLIST: 'fpl.watchlist',        // Watched player IDs (JSON array of numbers)
  THEME: 'fpl.theme',                // Theme preference: 'light' | 'dark'
  SIDEBAR_COLLAPSED: 'fpl.sidebarCollapsed', // Sidebar state: 'true' | 'false'

  // Feature gates
  STAT_PICKER_UNLOCKED: 'fpl.statPickerUnlocked', // Stat picker access: 'true' | 'false'

  // Session/filter state (page-specific)
  ALL_PLAYERS_FILTERS: 'fpl.ap.filters',   // All Players page filter state (JSON)
  ALL_PLAYERS_SORT: 'fpl.ap.sort',         // All Players page sort state (JSON)
  ALL_PLAYERS_CHART_MODE: 'fpl.ap.chartmode', // All Players chart mode: 'points' | 'xp'

  // Rate limiting
  STAT_PICKER_GATE: 'fpl.stat-picker.gate', // Stat picker rate limit timestamp
};

/**
 * Required keys for core app functionality
 * These are needed for the app to function properly with personalized data
 */
export const REQUIRED_KEYS = {
  // Required for My Team, Portal personalized tiles, etc.
  ENTRY_ID: STORAGE_KEYS.ENTRY_ID,
};

/**
 * Optional but recommended keys
 * App works without these but with reduced functionality
 */
export const OPTIONAL_KEYS = {
  // Recommended for Mini-League page
  LEAGUE_IDS: STORAGE_KEYS.LEAGUE_IDS,
};

/**
 * Safe localStorage get - returns null on error
 */
export function getItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Safe localStorage set - returns success boolean
 */
export function setItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safe localStorage remove - returns success boolean
 */
export function removeItem(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get JSON value from localStorage
 */
export function getJSON(key, defaultValue = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

/**
 * Set JSON value to localStorage
 */
export function setJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if localStorage is available
 */
export function isStorageAvailable() {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all FPL-related keys and their values (for debugging)
 */
export function getAllFplData() {
  const data = {};
  try {
    for (const [name, key] of Object.entries(STORAGE_KEYS)) {
      const value = localStorage.getItem(key);
      if (value !== null) {
        // Try to parse JSON, fall back to raw string
        try {
          data[name] = JSON.parse(value);
        } catch {
          data[name] = value;
        }
      }
    }
  } catch {}
  return data;
}

/**
 * Clear all FPL-related data from localStorage
 */
export function clearAllFplData() {
  try {
    for (const key of Object.values(STORAGE_KEYS)) {
      localStorage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}
