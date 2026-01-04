// js/lib/playerImageResolver.js
// Tiered player image resolver with Wikipedia fallback
// Primary: Premier League CDN headshots
// Fallback: Wikipedia thumbnail via MediaWiki API
// Final: Local placeholder silhouette

import { log } from "../logger.js";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const PL_CDN_BASE = "https://resources.premierleague.com/premierleague";
const PLAYER_PHOTO_PATH = "/photos/players/110x140";

// Resolve placeholder relative to this module (works on GitHub Pages subpaths)
export const PLAYER_PLACEHOLDER_SRC = new URL(
  "../../assets/placeholder-player.svg",
  import.meta.url
).href;

// Wikipedia API endpoint (via CORS proxy or directly)
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

// Cache settings
const CACHE_KEY = "fpl.wikiThumbCache";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Rate limiter: max 1 request per second to Wikipedia
const RATE_LIMIT_MS = 1000;

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

// Rate limiter queue
let lastWikiRequestTime = 0;
const pendingRequests = [];
let isProcessingQueue = false;

// In-flight request deduplication
const inflightRequests = new Map(); // elementId -> Promise

// ═══════════════════════════════════════════════════════════════
// URL BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Extract the Opta/PL code from the FPL photo field
 * FPL API returns photo as "36903.jpg" - we need just "36903"
 *
 * @param {string} photoId - The photo field from FPL API (e.g., "36903.jpg" or "p36903.png")
 * @returns {string|null} The cleaned photo code, or null if invalid
 */
export function cleanPhotoCode(photoId) {
  if (!photoId) return null;
  // Remove extension (.jpg, .png) and any leading 'p' prefix
  return String(photoId).replace(/\.(png|jpg)$/i, "").replace(/^p/, "");
}

/**
 * Build Premier League CDN URL for a player photo
 *
 * @param {string} photoId - The photo field from FPL API (e.g., "36903.jpg")
 * @returns {string} The full CDN URL, or empty string if invalid
 */
export function buildPLImageUrl(photoId) {
  const code = cleanPhotoCode(photoId);
  if (!code) return "";
  // Premier League CDN format: /photos/players/110x140/p{code}.png
  return `${PL_CDN_BASE}${PLAYER_PHOTO_PATH}/p${code}.png`;
}

/**
 * Get the primary Premier League CDN URL for a player
 *
 * @param {Object} element - FPL element object with photo field
 * @returns {string} PL CDN URL or placeholder if invalid
 */
export function getPrimaryImageUrl(element) {
  const photoId = element?.photo || element?._raw?.photo;
  const url = buildPLImageUrl(photoId);
  return url || PLAYER_PLACEHOLDER_SRC;
}

// ═══════════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// In-memory fallback when localStorage is not available (e.g., Node.js tests)
let memoryCache = {};

/**
 * Check if localStorage is available
 * @returns {boolean}
 */
function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

/**
 * Load the Wikipedia thumbnail cache from localStorage
 * @returns {Object} Cache object with elementId -> { url, timestamp } entries
 */
export function loadWikiCache() {
  if (!hasLocalStorage()) {
    return { ...memoryCache };
  }
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Save the Wikipedia thumbnail cache to localStorage
 * @param {Object} cache - Cache object
 */
export function saveWikiCache(cache) {
  if (!hasLocalStorage()) {
    // Use in-memory cache as fallback
    memoryCache = { ...cache };
    return;
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    log.warn?.("Failed to save wiki cache:", e);
  }
}

/**
 * Get a cached Wikipedia thumbnail URL for an element
 * @param {number|string} elementId - Player element ID
 * @returns {string|null} Cached URL or null if not found/expired
 */
export function getCachedWikiThumb(elementId) {
  const cache = loadWikiCache();
  const entry = cache[elementId];
  if (!entry) return null;

  // Check TTL
  const age = Date.now() - (entry.timestamp || 0);
  if (age > CACHE_TTL_MS) {
    // Expired - remove from cache
    delete cache[elementId];
    saveWikiCache(cache);
    return null;
  }

  return entry.url || null;
}

/**
 * Set a cached Wikipedia thumbnail URL for an element
 * @param {number|string} elementId - Player element ID
 * @param {string|null} url - Thumbnail URL (null means "no thumbnail found")
 */
export function setCachedWikiThumb(elementId, url) {
  const cache = loadWikiCache();
  cache[elementId] = {
    url: url || null,
    timestamp: Date.now(),
  };
  saveWikiCache(cache);
}

/**
 * Clear the entire Wikipedia thumbnail cache (for testing)
 */
export function clearWikiCache() {
  // Clear in-memory cache
  memoryCache = {};

  // Clear localStorage if available
  if (hasLocalStorage()) {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Check if an entry exists in cache (even if null/no-thumbnail)
 * @param {number|string} elementId
 * @returns {boolean}
 */
export function hasCacheEntry(elementId) {
  const cache = loadWikiCache();
  const entry = cache[elementId];
  if (!entry) return false;

  // Check TTL
  const age = Date.now() - (entry.timestamp || 0);
  return age <= CACHE_TTL_MS;
}

// ═══════════════════════════════════════════════════════════════
// RATE LIMITER
// ═══════════════════════════════════════════════════════════════

/**
 * Process the rate-limited request queue
 */
async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (pendingRequests.length > 0) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastWikiRequestTime;
    const waitTime = Math.max(0, RATE_LIMIT_MS - timeSinceLastRequest);

    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    const { fn, resolve, reject } = pendingRequests.shift();
    lastWikiRequestTime = Date.now();

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  }

  isProcessingQueue = false;
}

/**
 * Enqueue a rate-limited Wikipedia API request
 * @param {Function} fn - Async function to execute
 * @returns {Promise} Result of the function
 */
function rateLimitedRequest(fn) {
  return new Promise((resolve, reject) => {
    pendingRequests.push({ fn, resolve, reject });
    processQueue();
  });
}

// ═══════════════════════════════════════════════════════════════
// WIKIPEDIA API
// ═══════════════════════════════════════════════════════════════

/**
 * Search Wikipedia for a player and return potential page titles
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} clubHint - Optional club name for disambiguation
 * @returns {Promise<string[]>} Array of potential page titles
 */
async function searchWikipedia(firstName, lastName, clubHint) {
  // Build search query: "First Last footballer" or "First Last footballer ClubName"
  let query = `${firstName} ${lastName} footballer`;
  if (clubHint) {
    query += ` ${clubHint}`;
  }

  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "5",
    format: "json",
    origin: "*", // CORS
  });

  const response = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!response.ok) {
    throw new Error(`Wikipedia search failed: ${response.status}`);
  }

  const data = await response.json();
  const results = data?.query?.search || [];
  return results.map((r) => r.title);
}

/**
 * Get thumbnail URL for a Wikipedia page title
 * @param {string} title - Wikipedia page title
 * @returns {Promise<string|null>} Thumbnail URL or null if not found
 */
async function getPageThumbnail(title) {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: "300",
    format: "json",
    origin: "*",
  });

  const response = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const pages = data?.query?.pages || {};

  // Get first page that has a thumbnail
  for (const pageId of Object.keys(pages)) {
    const page = pages[pageId];
    if (page?.thumbnail?.source) {
      return page.thumbnail.source;
    }
  }

  return null;
}

/**
 * Fetch Wikipedia thumbnail for a player
 * Searches for the player and returns the first result with a thumbnail
 *
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} clubHint - Optional club name
 * @returns {Promise<string|null>} Thumbnail URL or null if not found
 */
async function fetchWikipediaThumbnail(firstName, lastName, clubHint) {
  try {
    // Search for the player
    const titles = await searchWikipedia(firstName, lastName, clubHint);

    if (!titles.length) {
      log.debug?.(`Wikipedia: No search results for ${firstName} ${lastName}`);
      return null;
    }

    // Try each candidate title until we find one with a thumbnail
    for (const title of titles) {
      const thumbUrl = await getPageThumbnail(title);
      if (thumbUrl) {
        log.debug?.(
          `Wikipedia: Found thumbnail for ${firstName} ${lastName} via "${title}"`
        );
        return thumbUrl;
      }
    }

    log.debug?.(
      `Wikipedia: No thumbnails found for ${firstName} ${lastName}`
    );
    return null;
  } catch (error) {
    log.warn?.(`Wikipedia API error for ${firstName} ${lastName}:`, error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN RESOLVER
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve a Wikipedia thumbnail for a player element
 * Handles caching, rate limiting, and request deduplication
 *
 * @param {Object} element - FPL element object
 * @param {Object} options
 * @param {string} options.clubName - Optional club name hint
 * @returns {Promise<string|null>} Wikipedia thumbnail URL or null
 */
export async function resolveWikiThumbnail(element, options = {}) {
  const elementId = element?.id;
  if (!elementId) return null;

  // Check cache first
  if (hasCacheEntry(elementId)) {
    return getCachedWikiThumb(elementId);
  }

  // Check if there's already an in-flight request for this element
  if (inflightRequests.has(elementId)) {
    return inflightRequests.get(elementId);
  }

  // Extract player name
  const firstName =
    element.first_name || element.firstName || element._raw?.first_name || "";
  const lastName =
    element.second_name ||
    element.secondName ||
    element._raw?.second_name ||
    "";

  if (!firstName && !lastName) {
    setCachedWikiThumb(elementId, null);
    return null;
  }

  // Create the request promise
  const requestPromise = rateLimitedRequest(async () => {
    try {
      const thumbUrl = await fetchWikipediaThumbnail(
        firstName,
        lastName,
        options.clubName
      );
      setCachedWikiThumb(elementId, thumbUrl);
      return thumbUrl;
    } catch (error) {
      // Cache the failure to avoid retrying immediately
      setCachedWikiThumb(elementId, null);
      return null;
    } finally {
      // Remove from inflight when done
      inflightRequests.delete(elementId);
    }
  });

  // Store in inflight map for deduplication
  inflightRequests.set(elementId, requestPromise);
  return requestPromise;
}

/**
 * Get the player image source URL, checking cache for Wikipedia fallback
 * This returns the primary PL URL; fallback is handled by onError
 *
 * @param {Object} element - FPL element object
 * @param {Object} options
 * @param {string} options.clubName - Optional club name for Wikipedia search
 * @returns {string} Image URL (PL CDN or cached Wikipedia or placeholder)
 */
export function resolvePlayerImageSrc(element, options = {}) {
  // Always return primary PL URL as initial src
  // Fallback is handled by applySmartImageFallback on error
  return getPrimaryImageUrl(element);
}

/**
 * Apply smart image fallback with Wikipedia intermediate step
 * Attach this to an img element to handle PL CDN failures
 *
 * @param {HTMLImageElement} img - The image element
 * @param {Object} element - FPL element object (needed for Wikipedia lookup)
 * @param {Object} options
 * @param {string} options.clubName - Optional club name hint
 * @returns {HTMLImageElement} The same image element for chaining
 */
export function applySmartImageFallback(img, element, options = {}) {
  if (!img || !element) return img;

  const elementId = element.id;

  const handleError = async () => {
    const errorCount = Number(img.dataset.errorCount || 0);
    img.dataset.errorCount = String(errorCount + 1);

    // First error: try cache-busted PL URL
    if (errorCount === 0) {
      try {
        const url = new URL(img.src, window.location.origin);
        // Only retry PL CDN URLs
        if (url.href.includes("resources.premierleague.com")) {
          url.searchParams.set("retry", "1");
          img.src = url.toString();
          return;
        }
      } catch {
        // Fall through to Wikipedia fallback
      }
    }

    // Second error (or non-PL URL): try Wikipedia
    if (errorCount === 1 || (errorCount === 0 && !img.src.includes("resources.premierleague.com"))) {
      // Check if we already have a cached Wikipedia thumbnail
      const cachedThumb = getCachedWikiThumb(elementId);
      if (cachedThumb) {
        img.src = cachedThumb;
        return;
      }

      // Try to resolve Wikipedia thumbnail
      const wikiThumb = await resolveWikiThumbnail(element, options);
      if (wikiThumb) {
        img.src = wikiThumb;
        return;
      }
    }

    // Final fallback: placeholder
    if (img.dataset.fallbackApplied !== "true") {
      img.dataset.fallbackApplied = "true";
      img.src = PLAYER_PLACEHOLDER_SRC;
    }
  };

  img.addEventListener("error", handleError);
  return img;
}

/**
 * Preload Wikipedia thumbnail for an element (call ahead of render if desired)
 * This is optional - the fallback flow will handle it automatically
 *
 * @param {Object} element - FPL element object
 * @param {Object} options
 */
export async function preloadWikiThumbnail(element, options = {}) {
  // Don't preload if already cached
  if (hasCacheEntry(element?.id)) return;

  // Fire and forget - don't await
  resolveWikiThumbnail(element, options);
}

// ═══════════════════════════════════════════════════════════════
// TESTING UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Get cache TTL for testing
 * @returns {number} TTL in milliseconds
 */
export function getCacheTTL() {
  return CACHE_TTL_MS;
}

/**
 * Get rate limit interval for testing
 * @returns {number} Rate limit in milliseconds
 */
export function getRateLimitInterval() {
  return RATE_LIMIT_MS;
}

/**
 * Get the number of pending rate-limited requests (for testing)
 * @returns {number}
 */
export function getPendingRequestCount() {
  return pendingRequests.length;
}
