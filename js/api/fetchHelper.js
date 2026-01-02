// js/api/fetchHelper.js
// Shared fetch helper with timeout, retries, standardized response format,
// plus in-memory + localStorage cache for "last good dataset" fallback.

import { log } from "../logger.js";

/**
 * Error types for categorizing fetch failures
 */
export const ErrorType = {
  NETWORK: "network", // Network/connectivity issue
  TIMEOUT: "timeout", // Request timed out
  SERVER: "server", // 5xx server error
  CLIENT: "client", // 4xx client error
  RATE_LIMIT: "rate_limit", // 429 Too Many Requests
  PARSE: "parse", // JSON parse error
  UNKNOWN: "unknown", // Unknown error
};

/**
 * Configuration for fetch behavior
 */
const CONFIG = {
  timeout: 12000, // 12 second timeout (between 10-15s)
  maxRetries: 2, // 1-2 retries
  retryDelays: [1500, 3000], // backoff
  cachePrefix: "fpl.cache.", // localStorage key prefix

  // In-memory cache (per session)
  memoryCacheTtlMs: 30_000, // 30s "hot" cache for fast page navigation
  memoryCacheMaxEntries: 250, // prevent unbounded growth
};

/**
 * localStorage cache keys for different endpoints
 */
export const CacheKey = {
  BOOTSTRAP: "bootstrap",
  FIXTURES: "fixtures",
  ENTRY: "entry",
  ENTRY_HISTORY: "entryHistory",
  ENTRY_PICKS: "entryPicks",
  LEAGUE_CLASSIC: "leagueClassic",
  ELEMENT_SUMMARY: "elementSummary",
  // (optional future) EVENT_LIVE: "eventLive",
};

/**
 * Get human-readable error message based on error type
 */
export function getErrorMessage(errorType, endpoint = "") {
  const endpointName =
    endpoint.includes("/bs") ? "bootstrap data" :
    endpoint.includes("/fx") ? "fixtures" :
    endpoint.includes("/en/") && endpoint.includes("/history") ? "entry history" :
    endpoint.includes("/en/") ? "entry profile" :
    endpoint.includes("/ep/") ? "entry picks" :
    endpoint.includes("/lc/") ? "league standings" :
    endpoint.includes("/es/") ? "player summary" :
    endpoint.includes("/ev/") && endpoint.includes("/live") ? "live scores" :
    "data";

  switch (errorType) {
    case ErrorType.NETWORK:
      return `Unable to connect to FPL servers. Please check your internet connection.`;
    case ErrorType.TIMEOUT:
      return `Request for ${endpointName} timed out. The FPL API may be slow or unavailable.`;
    case ErrorType.SERVER:
      return `The FPL server is having issues. Please try again later.`;
    case ErrorType.RATE_LIMIT:
      return `Too many requests. Please wait a moment and try again.`;
    case ErrorType.CLIENT:
      return `Failed to fetch ${endpointName}. The requested data may not exist.`;
    case ErrorType.PARSE:
      return `Received invalid data from FPL. Please try again.`;
    default:
      return `Failed to fetch ${endpointName}. Please try again.`;
  }
}

/**
 * Check if an error type is retryable
 */
function isRetryable(errorType) {
  return [ErrorType.NETWORK, ErrorType.TIMEOUT, ErrorType.SERVER, ErrorType.RATE_LIMIT].includes(errorType);
}

/**
 * Determine error type from error object or response
 */
function classifyError(error, status = 0) {
  if (error?.name === "AbortError" || `${error?.message || ""}`.toLowerCase().includes("abort")) {
    return ErrorType.TIMEOUT;
  }

  // fetch() failures are often TypeError in browsers
  const msg = `${error?.message || ""}`.toLowerCase();
  if (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("load failed") ||
    msg.includes("fetch")
  ) {
    return ErrorType.NETWORK;
  }

  if (status === 429) return ErrorType.RATE_LIMIT;
  if (status >= 500) return ErrorType.SERVER;
  if (status >= 400) return ErrorType.CLIENT;

  if (msg.includes("json") || msg.includes("parse")) return ErrorType.PARSE;
  return ErrorType.UNKNOWN;
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-memory cache (session-only)
 * Keyed by normalized URL (includes cache busters for live endpoints, so we don't store those).
 */
const _memoryCache = new Map();

function pruneMemoryCache() {
  if (_memoryCache.size <= CONFIG.memoryCacheMaxEntries) return;

  // naive prune: remove oldest entries first
  const entries = Array.from(_memoryCache.entries());
  entries.sort((a, b) => (a[1]?.timestamp || 0) - (b[1]?.timestamp || 0));
  const toRemove = Math.ceil(_memoryCache.size - CONFIG.memoryCacheMaxEntries);
  for (let i = 0; i < toRemove; i++) {
    _memoryCache.delete(entries[i][0]);
  }
}

function getMemoryCacheKey(url) {
  // Strip _= cachebuster param so "live" requests don't poison the cache
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.delete("_");
    return u.toString();
  } catch {
    // If URL constructor fails, fallback to basic stripping
    return url.replace(/([?&])_=([0-9]+)(&)?/g, (m, p1, p2, p3) => (p1 === "?" && p3 ? "?" : p1 === "?" ? "" : p3 ? p1 : ""));
  }
}

function getFromMemoryCache(url, ttlMs = CONFIG.memoryCacheTtlMs) {
  const key = getMemoryCacheKey(url);
  const entry = _memoryCache.get(key);
  if (!entry) return null;
  const age = Date.now() - (entry.timestamp || 0);
  if (age > ttlMs) return null;
  return { ...entry, cacheAge: age };
}

function saveToMemoryCache(url, data) {
  const key = getMemoryCacheKey(url);
  _memoryCache.set(key, { data, timestamp: Date.now() });
  pruneMemoryCache();
}

/**
 * Standardized fetch result
 * @typedef {Object} FetchResult
 * @property {boolean} ok - Whether the fetch succeeded
 * @property {any} data - The fetched data (if ok is true)
 * @property {string|null} errorType - Error type (if ok is false)
 * @property {string} message - Human-readable message
 * @property {boolean} fromCache - Whether data came from cache
 * @property {number} cacheAge - Age of cached data in ms (if fromCache)
 * @property {boolean} stale - Whether data was served as a fallback after a failed fetch
 * @property {number} status - HTTP status if available
 * @property {number} durationMs - Total request time for the attempt that returned
 * @property {number} attempt - Attempt index (0 = first try)
 */

/**
 * Fetch data with timeout, retries, standardized response
 * Supports in-memory cache unless live=true or forceRefresh=true
 *
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {boolean} options.live - Add timestamp cache-buster to URL
 * @param {number} options.timeout - Custom timeout in ms
 * @param {number} options.retries - Number of retries (0-2)
 * @param {Object} options.fetchOptions - Passed through to fetch()
 * @param {boolean} options.forceRefresh - Skip in-memory cache
 * @param {number} options.memoryTtlMs - Override in-memory TTL
 * @returns {Promise<FetchResult>}
 */
export async function fetchWithTimeout(url, options = {}) {
  const {
    live = false,
    timeout = CONFIG.timeout,
    retries = CONFIG.maxRetries,
    fetchOptions = {},
    forceRefresh = false,
    memoryTtlMs = CONFIG.memoryCacheTtlMs,
  } = options;

  // In-memory cache (fast path) unless explicitly bypassed
  if (!live && !forceRefresh) {
    const mem = getFromMemoryCache(url, memoryTtlMs);
    if (mem) {
      return {
        ok: true,
        data: mem.data,
        errorType: null,
        message: "Success (memory cache)",
        fromCache: true,
        cacheAge: mem.cacheAge || 0,
        stale: false,
        status: 200,
        durationMs: 0,
        attempt: 0,
      };
    }
  }

  // Add cache buster for live endpoints
  const finalUrl = live ? `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}` : url;

  let lastErrorType = ErrorType.UNKNOWN;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay =
        CONFIG.retryDelays[attempt - 1] ??
        CONFIG.retryDelays[CONFIG.retryDelays.length - 1] ??
        1500;
      log.debug(`Fetch retry ${attempt}/${retries} for ${url}, waiting ${delay}ms`);
      await sleep(delay);
    }

    const controller = new AbortController();
    const started = Date.now();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(finalUrl, {
        ...fetchOptions,
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...fetchOptions.headers,
        },
      });

      clearTimeout(timeoutId);

      lastStatus = response.status;

      if (!response.ok) {
        lastErrorType = classifyError(null, response.status);

        // Only retry on retryable errors
        if (!isRetryable(lastErrorType) || attempt >= retries) {
          return {
            ok: false,
            data: null,
            errorType: lastErrorType,
            message: getErrorMessage(lastErrorType, url),
            fromCache: false,
            cacheAge: 0,
            stale: false,
            status: response.status,
            durationMs: Date.now() - started,
            attempt,
          };
        }
        continue;
      }

      // Handle 204 / empty responses gracefully
      if (response.status === 204) {
        return {
          ok: true,
          data: null,
          errorType: null,
          message: "Success (no content)",
          fromCache: false,
          cacheAge: 0,
          stale: false,
          status: response.status,
          durationMs: Date.now() - started,
          attempt,
        };
      }

      // Parse JSON (with content-type sanity check + text fallback)
      let data;
      try {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json") || contentType.includes("+json")) {
          data = await response.json();
        } else {
          // Some proxies/CDNs lie — try json anyway, fallback to text
          const text = await response.text();
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error("Non-JSON response");
          }
        }
      } catch (e) {
        return {
          ok: false,
          data: null,
          errorType: ErrorType.PARSE,
          message: getErrorMessage(ErrorType.PARSE, url),
          fromCache: false,
          cacheAge: 0,
          stale: false,
          status: response.status,
          durationMs: Date.now() - started,
          attempt,
        };
      }

      // Save to in-memory cache (only for non-live requests)
      if (!live) saveToMemoryCache(url, data);

      return {
        ok: true,
        data,
        errorType: null,
        message: "Success",
        fromCache: false,
        cacheAge: 0,
        stale: false,
        status: response.status,
        durationMs: Date.now() - started,
        attempt,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      lastErrorType = classifyError(error);
      log.debug(`Fetch attempt ${attempt + 1} failed:`, error?.message || error);

      if (!isRetryable(lastErrorType) || attempt >= retries) {
        break;
      }
    }
  }

  // All retries exhausted
  return {
    ok: false,
    data: null,
    errorType: lastErrorType,
    message: getErrorMessage(lastErrorType, url),
    fromCache: false,
    cacheAge: 0,
    stale: false,
    status: lastStatus || 0,
    durationMs: 0,
    attempt: retries,
  };
}

// ============================================================
// LocalStorage Cache for "Last Good Dataset"
// ============================================================

/**
 * Get the full localStorage key for a cache entry
 */
function getCacheStorageKey(cacheKey, ...params) {
  const paramStr = params.length > 0 ? `.${params.join(".")}` : "";
  return `${CONFIG.cachePrefix}${cacheKey}${paramStr}`;
}

/**
 * Save data to localStorage cache with timestamp
 * @param {string} cacheKey - Cache key from CacheKey enum
 * @param {any} data - Data to cache
 * @param {...any} params - Additional parameters for cache key (e.g., entryId)
 */
export function saveToCache(cacheKey, data, ...params) {
  try {
    const storageKey = getCacheStorageKey(cacheKey, ...params);
    const entry = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(storageKey, JSON.stringify(entry));
    log.debug(`Cached ${cacheKey}`, params);
    return true;
  } catch (e) {
    log.warn(`Failed to cache ${cacheKey}:`, e?.message || e);
    return false;
  }
}

/**
 * Load data from localStorage cache
 * @param {string} cacheKey - Cache key from CacheKey enum
 * @param {...any} params - Additional parameters for cache key
 * @returns {{ data: any, timestamp: number } | null}
 */
export function loadFromCache(cacheKey, ...params) {
  try {
    const storageKey = getCacheStorageKey(cacheKey, ...params);
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;

    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== "object") return null;

    // allow caching falsy payloads, but require "data" key to exist
    if (!Object.prototype.hasOwnProperty.call(entry, "data")) return null;

    return {
      data: entry.data,
      timestamp: entry.timestamp || 0,
    };
  } catch (e) {
    log.warn(`Failed to load cache ${cacheKey}:`, e?.message || e);
    return null;
  }
}

/**
 * Check if cached data exists for a key
 */
export function hasCachedData(cacheKey, ...params) {
  return loadFromCache(cacheKey, ...params) !== null;
}

/**
 * Get cached data age in milliseconds
 */
export function getCacheAge(cacheKey, ...params) {
  const entry = loadFromCache(cacheKey, ...params);
  if (!entry) return null;
  return Date.now() - entry.timestamp;
}

/**
 * Format cache age for display
 */
export function formatCacheAge(ageMs) {
  if (ageMs === null || ageMs === undefined) return "Unknown";

  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Clear a specific cache entry
 */
export function clearCache(cacheKey, ...params) {
  try {
    const storageKey = getCacheStorageKey(cacheKey, ...params);
    localStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear all FPL cache entries
 */
export function clearAllCache() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CONFIG.cachePrefix)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
    log.info(`Cleared ${keys.length} cache entries`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get cache statistics for debugging
 */
export function getCacheStats() {
  const stats = { entries: [], totalSize: 0 };

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(CONFIG.cachePrefix)) continue;

      const raw = localStorage.getItem(key);
      const size = raw ? raw.length : 0;
      let age = null;

      try {
        const entry = JSON.parse(raw);
        if (entry?.timestamp) age = Date.now() - entry.timestamp;
      } catch {}

      stats.entries.push({
        key: key.replace(CONFIG.cachePrefix, ""),
        size,
        age: age !== null ? formatCacheAge(age) : "Unknown",
      });
      stats.totalSize += size;
    }
  } catch {}

  return stats;
}

// ============================================================
// Combined Fetch with Cache Fallback
// ============================================================

/**
 * Fetch data with automatic caching + cache fallback on failure.
 *
 * Options:
 * - forceRefresh: skips in-memory cache (still does network first)
 * - preferCache: if true, will immediately return localStorage cache when present
 *               (useful for instant paint), then caller can manually trigger refresh.
 * - maxStaleMs: if set, only allow localStorage fallback when cache age <= maxStaleMs
 *
 * @param {string} url
 * @param {string} cacheKey
 * @param {Object} options
 * @param {Array} options.cacheParams
 * @param {boolean} options.live
 * @param {boolean} options.forceRefresh
 * @param {number} options.timeout
 * @param {boolean} options.preferCache
 * @param {number|null} options.maxStaleMs
 * @returns {Promise<FetchResult>}
 */
export async function fetchWithCache(url, cacheKey, options = {}) {
  const {
    cacheParams = [],
    live = false,
    forceRefresh = false,
    timeout,
    preferCache = false,
    maxStaleMs = null,
  } = options;

  // Optional: instant paint from localStorage (caller can still refresh)
  if (preferCache) {
    const cached = loadFromCache(cacheKey, ...cacheParams);
    if (cached) {
      const cacheAge = Date.now() - cached.timestamp;
      const withinMaxStale = maxStaleMs == null ? true : cacheAge <= maxStaleMs;

      if (withinMaxStale) {
        return {
          ok: true,
          data: cached.data,
          errorType: null,
          message: "Success (local cache)",
          fromCache: true,
          cacheAge,
          stale: false,
          status: 200,
          durationMs: 0,
          attempt: 0,
        };
      }
    }
  }

  // Try to fetch fresh data (network first)
  const result = await fetchWithTimeout(url, { live, timeout, forceRefresh });

  if (result.ok) {
    saveToCache(cacheKey, result.data, ...cacheParams);
    return result;
  }

  // Network failed -> fallback to localStorage "last good"
  const cached = loadFromCache(cacheKey, ...cacheParams);
  if (cached) {
    const cacheAge = Date.now() - cached.timestamp;
    const withinMaxStale = maxStaleMs == null ? true : cacheAge <= maxStaleMs;

    if (withinMaxStale) {
      log.info(`Using cached ${cacheKey} (${formatCacheAge(cacheAge)} old) after fetch failure`);

      return {
        ok: true,
        data: cached.data,
        errorType: result.errorType, // keep original error type for UI messaging
        message: result.message, // keep original message for UI messaging
        fromCache: true,
        cacheAge,
        stale: true, // important: this was a fallback after a failed fetch
        status: result.status || 0,
        durationMs: result.durationMs || 0,
        attempt: result.attempt ?? 0,
      };
    }
  }

  // No cache available (or too stale) -> return the error as-is
  return result;
}

export default {
  fetchWithTimeout,
  fetchWithCache,

  // localStorage cache tools
  saveToCache,
  loadFromCache,
  hasCachedData,
  getCacheAge,
  formatCacheAge,
  clearCache,
  clearAllCache,
  getCacheStats,

  // error tools
  ErrorType,
  CacheKey,
  getErrorMessage,
};
