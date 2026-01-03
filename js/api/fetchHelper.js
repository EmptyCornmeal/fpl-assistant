// js/api/fetchHelper.js
// Shared fetch helper with timeout, retries, standardized response format,
// plus in-memory + localStorage cache for "last good dataset" fallback.
// Includes quota-aware localStorage eviction + cache policy (memory-only, skip persist).

import { log } from "../logger.js";

/**
 * Error types for categorizing fetch failures
 */
export const ErrorType = {
  NETWORK: "network",
  TIMEOUT: "timeout",
  SERVER: "server",
  CLIENT: "client",
  RATE_LIMIT: "rate_limit",
  PARSE: "parse",
  UNKNOWN: "unknown",
};

/**
 * Configuration for fetch behavior
 */
const CONFIG = {
  timeout: 12000,
  maxRetries: 2,
  retryDelays: [1500, 3000],
  cachePrefix: "fpl.cache.",

  // In-memory cache (per session)
  memoryCacheTtlMs: 30_000,
  memoryCacheMaxEntries: 250,

  // localStorage management
  // When quota is hit, we evict oldest entries and retry once.
  evictionBatch: 10,
  warnThrottleMs: 4000, // suppress identical warn spam
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
  EVENT_LIVE: "eventLive",
};

/**
 * Cache policy per key
 * - persist: whether to write to localStorage
 * - memory: whether to write to memory cache
 *
 * Recommendation:
 * - Keep BOOTSTRAP + ENTRY + ENTRY_HISTORY persisted (small-ish, useful offline).
 * - Consider FIXTURES persisted ONLY if you store "all fixtures" (not per-event).
 * - ELEMENT_SUMMARY is huge/high-cardinality -> memory-only by default.
 * - ENTRY_PICKS per GW also high-cardinality -> memory-only by default.
 */
const CACHE_POLICY = {
  [CacheKey.BOOTSTRAP]: { persist: true, memory: true },
  [CacheKey.ENTRY]: { persist: true, memory: true },
  [CacheKey.ENTRY_HISTORY]: { persist: true, memory: true },
  [CacheKey.LEAGUE_CLASSIC]: { persist: true, memory: true },

  // These are dangerous if you store them per-param in localStorage:
  // Persist fixtures + entry picks to enable offline fallbacks (cardinality is bounded: GW + entry)
  [CacheKey.FIXTURES]: { persist: true, memory: true },
  [CacheKey.ENTRY_PICKS]: { persist: true, memory: true },
  // Persist element summary to provide cached fallbacks for player profile
  [CacheKey.ELEMENT_SUMMARY]: { persist: true, memory: true },
  [CacheKey.EVENT_LIVE]: { persist: true, memory: true },
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

function isRetryable(errorType) {
  return [ErrorType.NETWORK, ErrorType.TIMEOUT, ErrorType.SERVER, ErrorType.RATE_LIMIT].includes(errorType);
}

function classifyError(error, status = 0) {
  if (error?.name === "AbortError" || `${error?.message || ""}`.toLowerCase().includes("abort")) {
    return ErrorType.TIMEOUT;
  }

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// In-memory cache (session-only)
// ============================================================

const _memoryCache = new Map();

function pruneMemoryCache() {
  if (_memoryCache.size <= CONFIG.memoryCacheMaxEntries) return;

  const entries = Array.from(_memoryCache.entries());
  entries.sort((a, b) => (a[1]?.timestamp || 0) - (b[1]?.timestamp || 0));
  const toRemove = Math.ceil(_memoryCache.size - CONFIG.memoryCacheMaxEntries);
  for (let i = 0; i < toRemove; i++) _memoryCache.delete(entries[i][0]);
}

function getMemoryCacheKey(url) {
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.delete("_");
    return u.toString();
  } catch {
    return url.replace(/([?&])_=([0-9]+)(&)?/g, "");
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

// ============================================================
// Warn throttling (stop console spam)
// ============================================================

const _warnBuckets = new Map();

function warnOnce(key, message, ...rest) {
  const now = Date.now();
  const last = _warnBuckets.get(key) || 0;
  if (now - last < CONFIG.warnThrottleMs) return;
  _warnBuckets.set(key, now);
  log.warn(message, ...rest);
}

// ============================================================
// Fetch with timeout + retries
// ============================================================

/**
 * @typedef {Object} FetchResult
 * @property {boolean} ok
 * @property {any} data
 * @property {string|null} errorType
 * @property {string} message
 * @property {boolean} fromCache
 * @property {number} cacheAge
 * @property {boolean} stale
 * @property {number} status
 * @property {number} durationMs
 * @property {number} attempt
 */

/**
 * Fetch data with timeout, retries, standardized response
 */
export async function fetchWithTimeout(url, options = {}) {
  const {
    live = false,
    timeout = CONFIG.timeout,
    retries = CONFIG.maxRetries,
    fetchOptions = {},
    forceRefresh = false,
    memoryTtlMs = CONFIG.memoryCacheTtlMs,
    useMemoryCache = true,
  } = options;

  if (!live && !forceRefresh && useMemoryCache) {
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

      let data;
      try {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json") || contentType.includes("+json")) {
          data = await response.json();
        } else {
          const text = await response.text();
          data = JSON.parse(text);
        }
      } catch {
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

      if (!live && useMemoryCache) saveToMemoryCache(url, data);

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

      if (!isRetryable(lastErrorType) || attempt >= retries) break;
    }
  }

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
// LocalStorage Cache for "Last Good Dataset" + Quota eviction
// ============================================================

function getCacheStorageKey(cacheKey, ...params) {
  const paramStr = params.length > 0 ? `.${params.join(".")}` : "";
  return `${CONFIG.cachePrefix}${cacheKey}${paramStr}`;
}

function isQuotaError(e) {
  // DOMException in most browsers, message varies
  return (
    e &&
    (e.name === "QuotaExceededError" ||
      e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      `${e.message || ""}`.toLowerCase().includes("exceeded the quota") ||
      `${e.message || ""}`.toLowerCase().includes("quota"))
  );
}

function listCacheEntriesOldestFirst() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(CONFIG.cachePrefix)) continue;

    const raw = localStorage.getItem(key);
    if (!raw) continue;

    let ts = 0;
    try {
      const parsed = JSON.parse(raw);
      ts = parsed?.timestamp || 0;
    } catch {
      ts = 0;
    }
    entries.push({ key, ts });
  }
  entries.sort((a, b) => a.ts - b.ts);
  return entries;
}

function evictOldestCacheEntries(count = CONFIG.evictionBatch) {
  try {
    const entries = listCacheEntriesOldestFirst();
    const toRemove = entries.slice(0, count);
    toRemove.forEach((e) => localStorage.removeItem(e.key));
    if (toRemove.length) log.info(`Evicted ${toRemove.length} old cache entries to free space`);
    return toRemove.length;
  } catch {
    return 0;
  }
}

/**
 * Save data to localStorage cache with timestamp
 */
export function saveToCache(cacheKey, data, ...params) {
  try {
    const storageKey = getCacheStorageKey(cacheKey, ...params);
    const entry = { data, timestamp: Date.now() };
    localStorage.setItem(storageKey, JSON.stringify(entry));
    log.debug(`Cached ${cacheKey}`, params);
    return true;
  } catch (e) {
    // If quota, evict and retry once
    if (isQuotaError(e)) {
      const evicted = evictOldestCacheEntries(CONFIG.evictionBatch);
      if (evicted > 0) {
        try {
          const storageKey = getCacheStorageKey(cacheKey, ...params);
          const entry = { data, timestamp: Date.now() };
          localStorage.setItem(storageKey, JSON.stringify(entry));
          log.debug(`Cached ${cacheKey} after eviction`, params);
          return true;
        } catch (e2) {
          warnOnce(
            `cache.quota.${cacheKey}`,
            `Failed to cache ${cacheKey}: localStorage quota (even after eviction). Disabling persist for this payload.`,
            e2?.message || e2
          );
          return false;
        }
      }

      warnOnce(
        `cache.quota.${cacheKey}`,
        `Failed to cache ${cacheKey}: localStorage quota. No entries evicted.`,
        e?.message || e
      );
      return false;
    }

    warnOnce(
      `cache.fail.${cacheKey}`,
      `Failed to cache ${cacheKey}:`,
      e?.message || e
    );
    return false;
  }
}

export function loadFromCache(cacheKey, ...params) {
  try {
    const storageKey = getCacheStorageKey(cacheKey, ...params);
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;

    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== "object") return null;
    if (!Object.prototype.hasOwnProperty.call(entry, "data")) return null;

    return { data: entry.data, timestamp: entry.timestamp || 0 };
  } catch (e) {
    warnOnce(`cache.load.${cacheKey}`, `Failed to load cache ${cacheKey}:`, e?.message || e);
    return null;
  }
}

export function hasCachedData(cacheKey, ...params) {
  return loadFromCache(cacheKey, ...params) !== null;
}

export function getCacheAge(cacheKey, ...params) {
  const entry = loadFromCache(cacheKey, ...params);
  if (!entry) return null;
  return Date.now() - entry.timestamp;
}

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

export function clearCache(cacheKey, ...params) {
  try {
    const storageKey = getCacheStorageKey(cacheKey, ...params);
    localStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

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
// Combined Fetch with Cache Fallback (policy-aware)
// ============================================================

/**
 * Fetch data with automatic caching + cache fallback on failure.
 *
 * IMPORTANT: localStorage is now policy-driven to avoid quota death.
 */
export async function fetchWithCache(url, cacheKey, options = {}) {
  const {
    cacheParams = [],
    live = false,
    forceRefresh = false,
    timeout,
    preferCache = false,
    maxStaleMs = null,

    // overrides
    persist = undefined, // override CACHE_POLICY.persist
    memory = undefined,  // override CACHE_POLICY.memory
  } = options;

  const policy = CACHE_POLICY[cacheKey] || { persist: true, memory: true };
  const shouldPersist = persist ?? policy.persist;
  const shouldMemory = memory ?? policy.memory;

  // Optional: instant paint from localStorage (ONLY if this key is allowed to persist)
  if (preferCache && shouldPersist) {
    const cached = loadFromCache(cacheKey, ...cacheParams);
    if (cached) {
      const cacheAge = Date.now() - cached.timestamp;
      const okAge = maxStaleMs == null ? true : cacheAge <= maxStaleMs;
      if (okAge) {
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

  // Network first
  const result = await fetchWithTimeout(url, {
    live,
    timeout,
    forceRefresh,
    useMemoryCache: shouldMemory,
  });

  if (result.ok) {
    // Persist to localStorage if allowed
    if (shouldPersist) saveToCache(cacheKey, result.data, ...cacheParams);
    return result;
  }

  // If failed, localStorage fallback ONLY if allowed
  if (shouldPersist) {
    const cached = loadFromCache(cacheKey, ...cacheParams);
    if (cached) {
      const cacheAge = Date.now() - cached.timestamp;
      const okAge = maxStaleMs == null ? true : cacheAge <= maxStaleMs;

      if (okAge) {
        log.info(`Using cached ${cacheKey} (${formatCacheAge(cacheAge)} old) after fetch failure`);
        return {
          ok: true,
          data: cached.data,
          errorType: result.errorType,
          message: result.message,
          fromCache: true,
          cacheAge,
          stale: true,
          status: result.status || 0,
          durationMs: result.durationMs || 0,
          attempt: result.attempt ?? 0,
        };
      }
    }
  }

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
