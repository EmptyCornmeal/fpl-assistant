// js/api/fplClient.js
// Centralized FPL API client with caching, retries, and error handling

const API_BASE = "https://fpl-proxy.myles-fpl-proxy.workers.dev/api";

// Cache configuration
const cache = new Map();
const CACHE_TTL = {
  bootstrap: 5 * 60 * 1000,      // 5 minutes
  fixtures: 5 * 60 * 1000,        // 5 minutes
  elementSummary: 2 * 60 * 1000,  // 2 minutes
  entry: 1 * 60 * 1000,           // 1 minute
  league: 2 * 60 * 1000,          // 2 minutes
};

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

/**
 * FPL API Error with structured information
 */
export class FplApiError extends Error {
  constructor(message, { endpoint, status, retryable = false, originalError = null }) {
    super(message);
    this.name = "FplApiError";
    this.endpoint = endpoint;
    this.status = status;
    this.retryable = retryable;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Fetch with retries and timeout
 */
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        ...options.headers,
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new FplApiError(`HTTP ${response.status}: ${response.statusText}`, {
        endpoint: url,
        status: response.status,
        retryable,
      });
    }

    return response;
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof FplApiError) {
      if (error.retryable && retries > 0) {
        const delay = RETRY_DELAYS[MAX_RETRIES - retries] || 4000;
        await new Promise(r => setTimeout(r, delay));
        return fetchWithRetry(url, options, retries - 1);
      }
      throw error;
    }

    // Network error or abort
    if (retries > 0) {
      const delay = RETRY_DELAYS[MAX_RETRIES - retries] || 4000;
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, options, retries - 1);
    }

    throw new FplApiError(`Network error: ${error.message}`, {
      endpoint: url,
      status: 0,
      retryable: false,
      originalError: error,
    });
  }
}

/**
 * Get cached data or fetch fresh
 */
function getCached(key, ttl) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < ttl) {
    return entry.data;
  }
  return null;
}

/**
 * Set cache entry
 */
function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

/**
 * FPL API Client
 */
export const fplClient = {
  /**
   * Get bootstrap data (all static game data)
   * Endpoint: bootstrap-static/
   */
  async bootstrap(forceRefresh = false) {
    const cacheKey = "bootstrap";
    if (!forceRefresh) {
      const cached = getCached(cacheKey, CACHE_TTL.bootstrap);
      if (cached) return cached;
    }

    const response = await fetchWithRetry(`${API_BASE}/bs`);
    const data = await response.json();
    setCache(cacheKey, data);
    return data;
  },

  /**
   * Get all fixtures or fixtures for a specific gameweek
   * Endpoint: fixtures/ or fixtures/?event={gwId}
   */
  async fixtures(gwId = null, forceRefresh = false) {
    const cacheKey = gwId ? `fixtures-${gwId}` : "fixtures-all";
    if (!forceRefresh) {
      const cached = getCached(cacheKey, CACHE_TTL.fixtures);
      if (cached) return cached;
    }

    const url = gwId ? `${API_BASE}/fx/${gwId}` : `${API_BASE}/fx`;
    const response = await fetchWithRetry(url);
    const data = await response.json();
    setCache(cacheKey, data);
    return data;
  },

  /**
   * Get player element summary (history + upcoming fixtures)
   * Endpoint: element-summary/{elementId}/
   */
  async elementSummary(elementId, forceRefresh = false) {
    const cacheKey = `element-${elementId}`;
    if (!forceRefresh) {
      const cached = getCached(cacheKey, CACHE_TTL.elementSummary);
      if (cached) return cached;
    }

    const response = await fetchWithRetry(`${API_BASE}/es/${elementId}`);
    const data = await response.json();
    setCache(cacheKey, data);
    return data;
  },

  /**
   * Get entry (manager) profile
   * Endpoint: entry/{entryId}/
   */
  async entry(entryId, forceRefresh = false) {
    const cacheKey = `entry-${entryId}`;
    if (!forceRefresh) {
      const cached = getCached(cacheKey, CACHE_TTL.entry);
      if (cached) return cached;
    }

    const response = await fetchWithRetry(`${API_BASE}/en/${entryId}`);
    const data = await response.json();
    setCache(cacheKey, data);
    return data;
  },

  /**
   * Get entry history (season GW-by-GW data)
   * Endpoint: entry/{entryId}/history/
   */
  async entryHistory(entryId, forceRefresh = false) {
    const cacheKey = `entry-history-${entryId}`;
    if (!forceRefresh) {
      const cached = getCached(cacheKey, CACHE_TTL.entry);
      if (cached) return cached;
    }

    const response = await fetchWithRetry(`${API_BASE}/en/${entryId}/history`);
    const data = await response.json();
    setCache(cacheKey, data);
    return data;
  },

  /**
   * Get entry picks for a specific gameweek
   * Endpoint: entry/{entryId}/event/{gwId}/picks/
   */
  async entryPicks(entryId, gwId) {
    // Picks are always fresh (no long cache)
    const response = await fetchWithRetry(`${API_BASE}/ep/${entryId}/${gwId}/picks`);
    return response.json();
  },

  /**
   * Get live event data (current scoring)
   * Endpoint: event/{gwId}/live/
   * Note: Always fresh, no cache
   */
  async eventLive(gwId) {
    const url = `${API_BASE}/ev/${gwId}/live?_=${Date.now()}`;
    const response = await fetchWithRetry(url);
    return response.json();
  },

  /**
   * Get event status (game state)
   * Endpoint: event-status/
   * Note: Always fresh, no cache
   */
  async eventStatus() {
    const url = `${API_BASE}/ev/status?_=${Date.now()}`;
    const response = await fetchWithRetry(url);
    return response.json();
  },

  /**
   * Get classic league standings
   * Endpoint: leagues-classic/{leagueId}/standings/?page_standings={page}
   */
  async leagueClassic(leagueId, page = 1, forceRefresh = false) {
    const cacheKey = `league-${leagueId}-${page}`;
    if (!forceRefresh) {
      const cached = getCached(cacheKey, CACHE_TTL.league);
      if (cached) return cached;
    }

    const response = await fetchWithRetry(`${API_BASE}/lc/${leagueId}/${page}`);
    const data = await response.json();
    setCache(cacheKey, data);
    return data;
  },

  /**
   * Clear all cache or specific key
   */
  clearCache(key = null) {
    if (key) {
      cache.delete(key);
    } else {
      cache.clear();
    }
  },

  /**
   * Get cache stats
   */
  getCacheStats() {
    const stats = { size: cache.size, entries: [] };
    for (const [key, entry] of cache) {
      const age = Math.round((Date.now() - entry.timestamp) / 1000);
      stats.entries.push({ key, ageSeconds: age });
    }
    return stats;
  },

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const response = await fetchWithRetry(`${API_BASE}/up?live=true`, {}, 1);
      const data = await response.json();
      return { ok: true, ...data };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  },
};

export default fplClient;
