// js/api/fetchHelper.js
// Shared fetch helper with timeout, retries, and standardized response format
// Also manages localStorage cache for "last good dataset"

import { log } from "../logger.js";

/**
 * Error types for categorizing fetch failures
 */
export const ErrorType = {
  NETWORK: 'network',        // Network/connectivity issue
  TIMEOUT: 'timeout',        // Request timed out
  SERVER: 'server',          // 5xx server error
  CLIENT: 'client',          // 4xx client error
  RATE_LIMIT: 'rate_limit',  // 429 Too Many Requests
  PARSE: 'parse',            // JSON parse error
  UNKNOWN: 'unknown',        // Unknown error
};

/**
 * Configuration for fetch behavior
 */
const CONFIG = {
  timeout: 12000,           // 12 second timeout (between 10-15s)
  maxRetries: 2,            // 1-2 retries
  retryDelays: [1500, 3000], // Exponential backoff
  cachePrefix: 'fpl.cache.', // localStorage key prefix
};

/**
 * localStorage cache keys for different endpoints
 */
export const CacheKey = {
  BOOTSTRAP: 'bootstrap',
  FIXTURES: 'fixtures',
  ENTRY: 'entry',
  ENTRY_HISTORY: 'entryHistory',
  ENTRY_PICKS: 'entryPicks',
  LEAGUE_CLASSIC: 'leagueClassic',
  ELEMENT_SUMMARY: 'elementSummary',
};

/**
 * Get human-readable error message based on error type
 */
export function getErrorMessage(errorType, endpoint = '') {
  const endpointName = endpoint.includes('/bs') ? 'bootstrap data' :
                       endpoint.includes('/fx') ? 'fixtures' :
                       endpoint.includes('/en/') && endpoint.includes('/history') ? 'entry history' :
                       endpoint.includes('/en/') ? 'entry profile' :
                       endpoint.includes('/ep/') ? 'entry picks' :
                       endpoint.includes('/lc/') ? 'league standings' :
                       endpoint.includes('/es/') ? 'player summary' :
                       endpoint.includes('/ev/') && endpoint.includes('/live') ? 'live scores' :
                       'data';

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
  if (error?.name === 'AbortError' || error?.message?.includes('abort')) {
    return ErrorType.TIMEOUT;
  }
  if (error?.message?.includes('network') || error?.message?.includes('fetch') || error?.message?.includes('Failed to fetch')) {
    return ErrorType.NETWORK;
  }
  if (status === 429) {
    return ErrorType.RATE_LIMIT;
  }
  if (status >= 500) {
    return ErrorType.SERVER;
  }
  if (status >= 400) {
    return ErrorType.CLIENT;
  }
  if (error?.message?.includes('JSON') || error?.message?.includes('parse')) {
    return ErrorType.PARSE;
  }
  return ErrorType.UNKNOWN;
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Standardized fetch result
 * @typedef {Object} FetchResult
 * @property {boolean} ok - Whether the fetch succeeded
 * @property {any} data - The fetched data (if ok is true)
 * @property {string} errorType - Error type (if ok is false)
 * @property {string} message - Human-readable message
 * @property {boolean} fromCache - Whether data came from cache
 * @property {number} cacheAge - Age of cached data in ms (if fromCache)
 */

/**
 * Fetch data with timeout, retries, and standardized response
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {boolean} options.live - Bypass memory cache (add timestamp)
 * @param {number} options.timeout - Custom timeout in ms
 * @param {number} options.retries - Number of retries (0-2)
 * @returns {Promise<FetchResult>}
 */
export async function fetchWithTimeout(url, options = {}) {
  const {
    live = false,
    timeout = CONFIG.timeout,
    retries = CONFIG.maxRetries,
    fetchOptions = {},
  } = options;

  // Add cache buster for live endpoints
  const finalUrl = live
    ? `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`
    : url;

  let lastError = null;
  let lastErrorType = ErrorType.UNKNOWN;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Wait before retry (except first attempt)
    if (attempt > 0) {
      const delay = CONFIG.retryDelays[attempt - 1] || CONFIG.retryDelays[CONFIG.retryDelays.length - 1];
      log.debug(`Fetch retry ${attempt}/${retries} for ${url}, waiting ${delay}ms`);
      await sleep(delay);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(finalUrl, {
        ...fetchOptions,
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
          ...fetchOptions.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        lastErrorType = classifyError(null, response.status);
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);

        // Only retry on retryable errors
        if (!isRetryable(lastErrorType) || attempt >= retries) {
          return {
            ok: false,
            data: null,
            errorType: lastErrorType,
            message: getErrorMessage(lastErrorType, url),
            fromCache: false,
            cacheAge: 0,
          };
        }
        continue;
      }

      // Parse JSON
      let data;
      try {
        data = await response.json();
      } catch (e) {
        return {
          ok: false,
          data: null,
          errorType: ErrorType.PARSE,
          message: getErrorMessage(ErrorType.PARSE, url),
          fromCache: false,
          cacheAge: 0,
        };
      }

      return {
        ok: true,
        data,
        errorType: null,
        message: 'Success',
        fromCache: false,
        cacheAge: 0,
      };

    } catch (error) {
      clearTimeout(timeoutId);
      lastErrorType = classifyError(error);
      lastError = error;

      log.debug(`Fetch attempt ${attempt + 1} failed:`, error.message);

      // Only continue if we have retries left and error is retryable
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
  };
}

// ============================================================
// LocalStorage Cache for "Last Good Dataset"
// ============================================================

/**
 * Get the full localStorage key for a cache entry
 */
function getCacheStorageKey(cacheKey, ...params) {
  const paramStr = params.length > 0 ? `.${params.join('.')}` : '';
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
    // localStorage may be full or disabled
    log.warn(`Failed to cache ${cacheKey}:`, e.message);
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
    if (!entry || !entry.data) return null;

    return {
      data: entry.data,
      timestamp: entry.timestamp || 0,
    };
  } catch (e) {
    log.warn(`Failed to load cache ${cacheKey}:`, e.message);
    return null;
  }
}

/**
 * Check if cached data exists for a key
 * @param {string} cacheKey - Cache key from CacheKey enum
 * @param {...any} params - Additional parameters for cache key
 * @returns {boolean}
 */
export function hasCachedData(cacheKey, ...params) {
  return loadFromCache(cacheKey, ...params) !== null;
}

/**
 * Get cached data age in milliseconds
 * @param {string} cacheKey - Cache key from CacheKey enum
 * @param {...any} params - Additional parameters for cache key
 * @returns {number | null}
 */
export function getCacheAge(cacheKey, ...params) {
  const entry = loadFromCache(cacheKey, ...params);
  if (!entry) return null;
  return Date.now() - entry.timestamp;
}

/**
 * Format cache age for display
 * @param {number} ageMs - Age in milliseconds
 * @returns {string}
 */
export function formatCacheAge(ageMs) {
  if (ageMs === null || ageMs === undefined) return 'Unknown';

  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Clear a specific cache entry
 * @param {string} cacheKey - Cache key from CacheKey enum
 * @param {...any} params - Additional parameters for cache key
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
      if (key && key.startsWith(CONFIG.cachePrefix)) {
        keys.push(key);
      }
    }
    keys.forEach(key => localStorage.removeItem(key));
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
  const stats = {
    entries: [],
    totalSize: 0,
  };

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CONFIG.cachePrefix)) {
        const raw = localStorage.getItem(key);
        const size = raw ? raw.length : 0;
        let age = null;

        try {
          const entry = JSON.parse(raw);
          if (entry?.timestamp) {
            age = Date.now() - entry.timestamp;
          }
        } catch {}

        stats.entries.push({
          key: key.replace(CONFIG.cachePrefix, ''),
          size,
          age: age !== null ? formatCacheAge(age) : 'Unknown',
        });
        stats.totalSize += size;
      }
    }
  } catch {}

  return stats;
}

// ============================================================
// Combined Fetch with Cache Fallback
// ============================================================

/**
 * Fetch data with automatic caching and cache fallback on failure
 * @param {string} url - URL to fetch
 * @param {string} cacheKey - Cache key for localStorage
 * @param {Object} options - Options
 * @param {Array} options.cacheParams - Parameters for cache key
 * @param {boolean} options.live - Bypass memory cache
 * @param {boolean} options.forceRefresh - Force fresh fetch (skip memory cache)
 * @param {number} options.timeout - Custom timeout
 * @returns {Promise<FetchResult>}
 */
export async function fetchWithCache(url, cacheKey, options = {}) {
  const {
    cacheParams = [],
    live = false,
    forceRefresh = false,
    timeout,
  } = options;

  // Try to fetch fresh data
  const result = await fetchWithTimeout(url, { live, timeout });

  if (result.ok) {
    // Success - save to localStorage cache
    saveToCache(cacheKey, result.data, ...cacheParams);
    return result;
  }

  // Fetch failed - check for cached data
  const cached = loadFromCache(cacheKey, ...cacheParams);
  if (cached) {
    const cacheAge = Date.now() - cached.timestamp;
    log.info(`Using cached ${cacheKey} (${formatCacheAge(cacheAge)} old) after fetch failure`);

    return {
      ok: true,
      data: cached.data,
      errorType: result.errorType, // Keep original error type for display
      message: result.message,      // Keep original error message
      fromCache: true,
      cacheAge,
    };
  }

  // No cache available - return the error
  return result;
}

export default {
  fetchWithTimeout,
  fetchWithCache,
  saveToCache,
  loadFromCache,
  hasCachedData,
  getCacheAge,
  formatCacheAge,
  clearCache,
  clearAllCache,
  getCacheStats,
  ErrorType,
  CacheKey,
  getErrorMessage,
};
