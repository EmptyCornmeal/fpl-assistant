// js/api/fplClient.js
// Centralized FPL API client with caching, retries, and graceful degradation
import {
  fetchWithTimeout,
  fetchWithCache,
  saveToCache,
  loadFromCache,
  hasCachedData,
  getCacheAge,
  formatCacheAge,
  clearAllCache,
  getCacheStats,
  ErrorType,
  CacheKey,
} from "./fetchHelper.js";
import { getApiBaseInfo } from "../config.js";

// In-memory cache configuration (for fast repeated access within same session)
const memoryCache = new Map();
const CACHE_TTL = {
  bootstrap: 5 * 60 * 1000,      // 5 minutes
  fixtures: 5 * 60 * 1000,        // 5 minutes
  elementSummary: 2 * 60 * 1000,  // 2 minutes
  entry: 1 * 60 * 1000,           // 1 minute
  league: 2 * 60 * 1000,          // 2 minutes
};
const HEALTH_PATHS = ["up?live=true", "up", "health", "status"];

const NO_API_MESSAGE = "No API configured. Set API base in Settings or localStorage.fpl.apiBase.";

function resolveApiUrl(path = "") {
  const info = getApiBaseInfo();
  const base = info.base || null;
  const source = info.source || null;

  if (!base) {
    const error = new FplApiError(NO_API_MESSAGE, {
      endpoint: path,
      status: 0,
      retryable: false,
      errorType: ErrorType.CLIENT,
    });
    error.code = "NO_API_BASE";
    error.apiBaseSource = source;
    return { ok: false, error, source, base: null };
  }

  const cleanPath = path.replace(/^\/+/, "");
  return {
    ok: true,
    url: `${base}/${cleanPath}`,
    base,
    source,
  };
}

function buildMissingApiResult(endpoint = "") {
  const info = getApiBaseInfo();
  return {
    ok: false,
    data: null,
    errorType: ErrorType.CLIENT,
    message: NO_API_MESSAGE,
    fromCache: false,
    cacheAge: 0,
    status: 0,
    code: "NO_API_BASE",
    meta: {
      apiBase: null,
      apiBaseSource: info.source || null,
      endpoint,
    },
  };
}

/**
 * FPL API Error with structured information
 */
export class FplApiError extends Error {
  constructor(message, { endpoint, status, retryable = false, errorType = ErrorType.UNKNOWN, originalError = null }) {
    super(message);
    this.name = "FplApiError";
    this.endpoint = endpoint;
    this.status = status;
    this.retryable = retryable;
    this.errorType = errorType;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Get cached data or fetch fresh (in-memory cache)
 */
function getMemoryCached(key, ttl) {
  const entry = memoryCache.get(key);
  if (entry && Date.now() - entry.timestamp < ttl) {
    return entry.data;
  }
  return null;
}

/**
 * Set in-memory cache entry
 */
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, timestamp: Date.now() });
}

function normalizeOptions(input = {}) {
  if (typeof input === "boolean") {
    return { forceRefresh: input, preferCache: false };
  }
  return {
    forceRefresh: !!input.forceRefresh,
    preferCache: !!input.preferCache,
  };
}

/**
 * FPL API Client with standardized responses
 *
 * All methods return: { ok, data, errorType, message, fromCache, cacheAge }
 * - ok: true if data was successfully fetched (fresh or cached)
 * - data: the response data
 * - errorType: error classification (if ok is false)
 * - message: human-readable message
 * - fromCache: true if data came from localStorage cache
 * - cacheAge: age of cached data in ms
 */
export const fplClient = {
  /**
   * Get bootstrap data (all static game data)
   * Endpoint: bootstrap-static/
   */
  async bootstrap(options = {}) {
    const { forceRefresh, preferCache } = normalizeOptions(options);
    const cacheKey = "bootstrap";
    const resolved = resolveApiUrl("bs");
    if (!resolved.ok) return buildMissingApiResult("bs");
    const { url, base: apiBase, source: apiBaseSource } = resolved;

    // Check in-memory cache first
    if (!forceRefresh) {
      const memoryCached = getMemoryCached(cacheKey, CACHE_TTL.bootstrap);
      if (memoryCached) {
        return {
          ok: true,
          data: memoryCached,
          errorType: null,
          message: "Success (memory cache)",
          fromCache: false, // Not localStorage cache
          cacheAge: 0,
        };
      }
    }

    // Fetch with localStorage cache fallback
    const result = await fetchWithCache(url, CacheKey.BOOTSTRAP, {
      preferCache,
      forceRefresh,
      metadata: { apiBase, apiBaseSource, timestamp: Date.now() },
    });

    if (result.ok) {
      // Store in memory cache for fast repeated access
      setMemoryCache(cacheKey, result.data);
    }

    return result;
  },

  /**
   * Get all fixtures or fixtures for a specific gameweek
   * Endpoint: fixtures/ or fixtures/?event={gwId}
   */
  async fixtures(gwId = null, options = {}) {
    const { forceRefresh, preferCache } = normalizeOptions(options);
    const cacheKey = gwId ? `fixtures-${gwId}` : "fixtures-all";
    const path = gwId ? `fx/${gwId}` : "fx";
    const resolved = resolveApiUrl(path);
    if (!resolved.ok) return buildMissingApiResult(path);
    const url = resolved.url;
    const localCacheKey = gwId ? CacheKey.FIXTURES : CacheKey.FIXTURES;
    const cacheParams = gwId ? [gwId] : [];

    // Check in-memory cache first
    if (!forceRefresh) {
      const memoryCached = getMemoryCached(cacheKey, CACHE_TTL.fixtures);
      if (memoryCached) {
        return {
          ok: true,
          data: memoryCached,
          errorType: null,
          message: "Success (memory cache)",
          fromCache: false,
          cacheAge: 0,
        };
      }
    }

    // Fetch with localStorage cache fallback
    const result = await fetchWithCache(url, localCacheKey, { cacheParams, preferCache, forceRefresh });

    if (result.ok) {
      setMemoryCache(cacheKey, result.data);
    }

    return result;
  },

  /**
   * Get player element summary (history + upcoming fixtures)
   * Endpoint: element-summary/{elementId}/
   */
  async elementSummary(elementId, options = {}) {
    const { forceRefresh, preferCache } = normalizeOptions(options);
    const cacheKey = `element-${elementId}`;
    const path = `es/${elementId}`;
    const resolved = resolveApiUrl(path);
    if (!resolved.ok) return buildMissingApiResult(path);
    const url = resolved.url;

    // Check in-memory cache first
    if (!forceRefresh) {
      const memoryCached = getMemoryCached(cacheKey, CACHE_TTL.elementSummary);
      if (memoryCached) {
        return {
          ok: true,
          data: memoryCached,
          errorType: null,
          message: "Success (memory cache)",
          fromCache: false,
          cacheAge: 0,
        };
      }
    }

    // Fetch with localStorage cache fallback
    const result = await fetchWithCache(url, CacheKey.ELEMENT_SUMMARY, { cacheParams: [elementId], preferCache, forceRefresh });

    if (result.ok) {
      setMemoryCache(cacheKey, result.data);
    }

    return result;
  },

  /**
   * Get entry (manager) profile
   * Endpoint: entry/{entryId}/
   */
  async entry(entryId, options = {}) {
    const { forceRefresh, preferCache } = normalizeOptions(options);
    const cacheKey = `entry-${entryId}`;
    const path = `en/${entryId}`;
    const resolved = resolveApiUrl(path);
    if (!resolved.ok) return buildMissingApiResult(path);
    const url = resolved.url;

    // Check in-memory cache first
    if (!forceRefresh) {
      const memoryCached = getMemoryCached(cacheKey, CACHE_TTL.entry);
      if (memoryCached) {
        return {
          ok: true,
          data: memoryCached,
          errorType: null,
          message: "Success (memory cache)",
          fromCache: false,
          cacheAge: 0,
        };
      }
    }

    // Fetch with localStorage cache fallback
    const result = await fetchWithCache(url, CacheKey.ENTRY, { cacheParams: [entryId], preferCache, forceRefresh });

    if (result.ok) {
      setMemoryCache(cacheKey, result.data);
    }

    return result;
  },

  /**
   * Get entry history (season GW-by-GW data)
   * Endpoint: entry/{entryId}/history/
   */
  async entryHistory(entryId, options = {}) {
    const { forceRefresh, preferCache } = normalizeOptions(options);
    const cacheKey = `entry-history-${entryId}`;
    const path = `en/${entryId}/history`;
    const resolved = resolveApiUrl(path);
    if (!resolved.ok) return buildMissingApiResult(path);
    const url = resolved.url;

    // Check in-memory cache first
    if (!forceRefresh) {
      const memoryCached = getMemoryCached(cacheKey, CACHE_TTL.entry);
      if (memoryCached) {
        return {
          ok: true,
          data: memoryCached,
          errorType: null,
          message: "Success (memory cache)",
          fromCache: false,
          cacheAge: 0,
        };
      }
    }

    // Fetch with localStorage cache fallback
    const result = await fetchWithCache(url, CacheKey.ENTRY_HISTORY, { cacheParams: [entryId], preferCache, forceRefresh });

    if (result.ok) {
      setMemoryCache(cacheKey, result.data);
    }

    return result;
  },

  /**
   * Get entry picks for a specific gameweek
   * Endpoint: entry/{entryId}/event/{gwId}/picks/
   */
  async entryPicks(entryId, gwId, options = {}) {
    const { preferCache } = normalizeOptions(options);
    const path = `ep/${entryId}/${gwId}/picks`;
    const resolved = resolveApiUrl(path);
    if (!resolved.ok) return buildMissingApiResult(path);
    const url = resolved.url;

    // Entry picks should be cached per entry+gw
    const result = await fetchWithCache(url, CacheKey.ENTRY_PICKS, {
      cacheParams: [entryId, gwId],
      preferCache,
    });

    return result;
  },

  /**
   * Get live event data (current scoring)
   * Endpoint: event/{gwId}/live/
   * Note: Always fresh, no localStorage cache (in-memory only for short period)
   */
  async eventLive(gwId, options = {}) {
    const { preferCache } = normalizeOptions(options);
    const path = `ev/${gwId}/live`;
    const resolved = resolveApiUrl(path);
    if (!resolved.ok) return buildMissingApiResult(path);
    const url = resolved.url;

    // Live data should be fresh but allow cached fallback when offline
    return await fetchWithCache(url, CacheKey.EVENT_LIVE, {
      cacheParams: [gwId],
      live: true,
      preferCache,
    });
  },

  /**
   * Get event status (game state)
   * Endpoint: event-status/
   * Note: Always fresh, no cache
   */
  async eventStatus() {
    const path = "ev/status";
    const resolved = resolveApiUrl(path);
    if (!resolved.ok) return buildMissingApiResult(path);
    const url = resolved.url;

    // Status should always be fresh
    const result = await fetchWithTimeout(url, { live: true });

    return result;
  },

  /**
   * Get classic league standings
   * Endpoint: leagues-classic/{leagueId}/standings/?page_standings={page}
   */
  async leagueClassic(leagueId, page = 1, options = {}) {
    const { forceRefresh, preferCache } = normalizeOptions(options);
    const cacheKey = `league-${leagueId}-${page}`;
    const path = `lc/${leagueId}/${page}`;
    const resolved = resolveApiUrl(path);
    if (!resolved.ok) return buildMissingApiResult(path);
    const url = resolved.url;

    // Check in-memory cache first
    if (!forceRefresh) {
      const memoryCached = getMemoryCached(cacheKey, CACHE_TTL.league);
      if (memoryCached) {
        return {
          ok: true,
          data: memoryCached,
          errorType: null,
          message: "Success (memory cache)",
          fromCache: false,
          cacheAge: 0,
        };
      }
    }

    // Fetch with localStorage cache fallback
    const result = await fetchWithCache(url, CacheKey.LEAGUE_CLASSIC, {
      cacheParams: [leagueId, page],
      preferCache,
      forceRefresh,
    });

    if (result.ok) {
      setMemoryCache(cacheKey, result.data);
    }

    return result;
  },

  /**
   * Clear all in-memory cache or specific key
   */
  clearCache(key = null) {
    if (key) {
      memoryCache.delete(key);
    } else {
      memoryCache.clear();
    }
  },

  /**
   * Clear all localStorage cache
   */
  clearLocalStorageCache() {
    clearAllCache();
  },

  /**
   * Get in-memory cache stats
   */
  getMemoryCacheStats() {
    const stats = { size: memoryCache.size, entries: [] };
    for (const [key, entry] of memoryCache) {
      const age = Math.round((Date.now() - entry.timestamp) / 1000);
      stats.entries.push({ key, ageSeconds: age });
    }
    return stats;
  },

  /**
   * Get localStorage cache stats
   */
  getLocalStorageCacheStats() {
    return getCacheStats();
  },

  /**
   * Check if cached data exists for bootstrap
   */
  hasBootstrapCache() {
    // Check slim cache first (new approach)
    if (hasCachedData(CacheKey.BOOTSTRAP_SLIM)) return true;
    // Fall back to full cache (legacy)
    return hasCachedData(CacheKey.BOOTSTRAP);
  },

  /**
   * Get bootstrap cache age (checks slim cache first)
   */
  getBootstrapCacheAge() {
    // Check slim cache first (preferred for localStorage)
    const slimAge = getCacheAge(CacheKey.BOOTSTRAP_SLIM);
    if (slimAge !== null) return slimAge;
    // Fall back to full cache (legacy)
    return getCacheAge(CacheKey.BOOTSTRAP);
  },

  /**
   * Load bootstrap from localStorage cache only (no network)
   * Now loads from slim cache to avoid quota issues
   */
  loadBootstrapFromCache() {
    // Try slim cache first (new approach - reduced quota usage)
    let cached = loadFromCache(CacheKey.BOOTSTRAP_SLIM);
    let isSlim = true;

    // Fall back to full cache (legacy data)
    if (!cached) {
      cached = loadFromCache(CacheKey.BOOTSTRAP);
      isSlim = false;
    }

    if (cached) {
      return {
        ok: true,
        data: cached.data,
        errorType: null,
        message: isSlim ? "Loaded from slim cache" : "Loaded from cache",
        fromCache: true,
        cacheAge: Date.now() - cached.timestamp,
        cacheTimestamp: cached.timestamp || null,
        meta: cached.meta || null,
        isSlim,
      };
    }
    return {
      ok: false,
      data: null,
      errorType: ErrorType.CLIENT,
      message: "No cached data available",
      fromCache: false,
      cacheAge: 0,
    };
  },

  loadFixturesFromCache(gwId = null) {
    const cacheParams = gwId ? [gwId] : [];
    const cached = loadFromCache(CacheKey.FIXTURES, ...cacheParams);
    if (cached) {
      return {
        ok: true,
        data: cached.data,
        errorType: null,
        message: "Loaded fixtures from cache",
        fromCache: true,
        cacheAge: Date.now() - cached.timestamp,
        cacheTimestamp: cached.timestamp || null,
        meta: cached.meta || null,
      };
    }
    return {
      ok: false,
      data: null,
      errorType: ErrorType.CLIENT,
      message: "No cached fixtures available",
      fromCache: false,
      cacheAge: 0,
    };
  },

  loadEventLiveFromCache(gwId) {
    const cached = loadFromCache(CacheKey.EVENT_LIVE, gwId);
    if (cached) {
      return {
        ok: true,
        data: cached.data,
        errorType: null,
        message: "Loaded live data from cache",
        fromCache: true,
        cacheAge: Date.now() - cached.timestamp,
        cacheTimestamp: cached.timestamp || null,
        meta: cached.meta || null,
      };
    }
    return {
      ok: false,
      data: null,
      errorType: ErrorType.CLIENT,
      message: "No cached live data available",
      fromCache: false,
      cacheAge: 0,
    };
  },

  hasEventLiveCache(gwId) {
    return hasCachedData(CacheKey.EVENT_LIVE, gwId);
  },

  getEventLiveCacheAge(gwId) {
    return getCacheAge(CacheKey.EVENT_LIVE, gwId);
  },

  /**
   * Health check
   */
  async healthCheck() {
    const baseInfo = getApiBaseInfo();
    if (!baseInfo.base) {
      return { ok: false, error: NO_API_MESSAGE, errorType: ErrorType.CLIENT, code: "NO_API_BASE" };
    }

    let lastReachable = null;
    for (const path of HEALTH_PATHS) {
      const resolved = resolveApiUrl(path);
      if (!resolved.ok) continue;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(resolved.url, { signal: controller.signal, cache: "no-store" });
        clearTimeout(timeoutId);
        if (res.ok) {
          return { ok: true, status: res.status, path };
        }
        if (res.status > 0) {
          lastReachable = { status: res.status, path };
          // Allow trying another path if the endpoint itself is missing
          if (res.status === 404 || res.status === 405) continue;
          // Other status codes mean the host responded; treat as reachable but degraded
          return { ok: true, status: res.status, path, degraded: true };
        }
      } catch (err) {
        clearTimeout(timeoutId);
        lastReachable = lastReachable || { status: 0, path };
        continue;
      }
    }

    if (lastReachable) {
      return {
        ok: true,
        degraded: true,
        status: lastReachable.status,
        path: lastReachable.path,
        message: "Health endpoint unavailable, but API responded",
      };
    }

    return { ok: false, error: "Health check failed", errorType: ErrorType.NETWORK };
  },
};

// ============================================================
// Legacy API (throws on error for backward compatibility)
// ============================================================

/**
 * Legacy wrapper that throws errors like the original api.js
 * Use this for gradual migration - pages can switch to result-based API incrementally
 */
export const legacyApi = {
  async bootstrap() {
    const result = await fplClient.bootstrap();
    if (!result.ok && !result.fromCache) {
      throw new FplApiError(result.message, {
        endpoint: "bootstrap",
        errorType: result.errorType,
        status: 0,
        retryable: [ErrorType.NETWORK, ErrorType.TIMEOUT, ErrorType.SERVER].includes(result.errorType),
      });
    }
    return result.data;
  },

  async fixtures(gwId) {
    const result = await fplClient.fixtures(gwId);
    if (!result.ok && !result.fromCache) {
      throw new FplApiError(result.message, {
        endpoint: "fixtures",
        errorType: result.errorType,
        status: 0,
        retryable: true,
      });
    }
    return result.data;
  },

  async elementSummary(id) {
    const result = await fplClient.elementSummary(id);
    if (!result.ok && !result.fromCache) {
      throw new FplApiError(result.message, {
        endpoint: "elementSummary",
        errorType: result.errorType,
        status: 0,
        retryable: true,
      });
    }
    return result.data;
  },

  async entry(id) {
    const result = await fplClient.entry(id);
    if (!result.ok && !result.fromCache) {
      throw new FplApiError(result.message, {
        endpoint: "entry",
        errorType: result.errorType,
        status: 0,
        retryable: true,
      });
    }
    return result.data;
  },

  async entryHistory(id) {
    const result = await fplClient.entryHistory(id);
    if (!result.ok && !result.fromCache) {
      throw new FplApiError(result.message, {
        endpoint: "entryHistory",
        errorType: result.errorType,
        status: 0,
        retryable: true,
      });
    }
    return result.data;
  },

  async entryPicks(id, gw) {
    const result = await fplClient.entryPicks(id, gw);
    if (!result.ok && !result.fromCache) {
      throw new FplApiError(result.message, {
        endpoint: "entryPicks",
        errorType: result.errorType,
        status: 0,
        retryable: true,
      });
    }
    return result.data;
  },

  async eventLive(gw) {
    const result = await fplClient.eventLive(gw);
    if (!result.ok) {
      throw new FplApiError(result.message, {
        endpoint: "eventLive",
        errorType: result.errorType,
        status: 0,
        retryable: true,
      });
    }
    return result.data;
  },

  async eventStatus() {
    const result = await fplClient.eventStatus();
    if (!result.ok) {
      throw new FplApiError(result.message, {
        endpoint: "eventStatus",
        errorType: result.errorType,
        status: 0,
        retryable: true,
      });
    }
    return result.data;
  },

  async leagueClassic(lid, p = 1) {
    const result = await fplClient.leagueClassic(lid, p);
    if (!result.ok && !result.fromCache) {
      throw new FplApiError(result.message, {
        endpoint: "leagueClassic",
        errorType: result.errorType,
        status: 0,
        retryable: true,
      });
    }
    return result.data;
  },

  clearCache() {
    fplClient.clearCache();
  },
};

export default fplClient;
