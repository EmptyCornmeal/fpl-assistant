// tests/playerImageResolver.test.js
// Tests for the tiered player image resolver with Wikipedia fallback

import { describe, it, assert, beforeEach } from "./testRunner.js";

describe("playerImageResolver - URL Building", () => {
  it("builds correct PL CDN URL from photo field", async () => {
    const { buildPLImageUrl } = await import("../js/lib/playerImageResolver.js");

    // Standard format: "510663.jpg"
    const url = buildPLImageUrl("510663.jpg");
    assert.ok(url.includes("resources.premierleague.com"), "Should use PL CDN");
    assert.ok(url.includes("/photos/players/110x140/"), "Should use correct path");
    assert.ok(url.includes("p510663.png"), "Should format as p{code}.png");
  });

  it("strips .jpg extension and adds p prefix", async () => {
    const { buildPLImageUrl } = await import("../js/lib/playerImageResolver.js");

    const url = buildPLImageUrl("36903.jpg");
    assert.ok(url.endsWith("p36903.png"), "Should strip .jpg and add p prefix");
  });

  it("strips .png extension and adds p prefix", async () => {
    const { buildPLImageUrl } = await import("../js/lib/playerImageResolver.js");

    const url = buildPLImageUrl("12345.png");
    assert.ok(url.endsWith("p12345.png"), "Should strip .png and add p prefix");
  });

  it("handles photo field with existing p prefix", async () => {
    const { buildPLImageUrl } = await import("../js/lib/playerImageResolver.js");

    const url = buildPLImageUrl("p12345.jpg");
    assert.ok(url.includes("p12345.png"), "Should not double the p prefix");
    assert.ok(!url.includes("pp12345"), "Should have single p prefix");
  });

  it("returns empty string for null/empty photo", async () => {
    const { buildPLImageUrl } = await import("../js/lib/playerImageResolver.js");

    assert.equal(buildPLImageUrl(null), "", "Null should return empty string");
    assert.equal(buildPLImageUrl(""), "", "Empty string should return empty string");
    assert.equal(buildPLImageUrl(undefined), "", "Undefined should return empty string");
  });

  it("cleanPhotoCode extracts numeric code correctly", async () => {
    const { cleanPhotoCode } = await import("../js/lib/playerImageResolver.js");

    assert.equal(cleanPhotoCode("510663.jpg"), "510663", "Should extract code from .jpg");
    assert.equal(cleanPhotoCode("510663.png"), "510663", "Should extract code from .png");
    assert.equal(cleanPhotoCode("p510663.jpg"), "510663", "Should strip p prefix");
    assert.equal(cleanPhotoCode(null), null, "Should return null for null input");
  });
});

describe("playerImageResolver - Cache Management", () => {
  beforeEach(async () => {
    // Clear cache before each test
    const { clearWikiCache } = await import("../js/lib/playerImageResolver.js");
    clearWikiCache();
  });

  it("stores and retrieves cached Wikipedia thumbnails", async () => {
    const { setCachedWikiThumb, getCachedWikiThumb } = await import("../js/lib/playerImageResolver.js");

    const testUrl = "https://upload.wikimedia.org/test-thumb.jpg";
    setCachedWikiThumb(123, testUrl);

    const cached = getCachedWikiThumb(123);
    assert.equal(cached, testUrl, "Should retrieve cached URL");
  });

  it("returns null for non-existent cache entries", async () => {
    const { getCachedWikiThumb, clearWikiCache } = await import("../js/lib/playerImageResolver.js");
    clearWikiCache();

    const cached = getCachedWikiThumb(999999);
    assert.equal(cached, null, "Should return null for missing entry");
  });

  it("caches null values for players without thumbnails", async () => {
    const { setCachedWikiThumb, getCachedWikiThumb, hasCacheEntry } = await import("../js/lib/playerImageResolver.js");

    setCachedWikiThumb(456, null);

    const hasEntry = hasCacheEntry(456);
    assert.ok(hasEntry, "Should have cache entry for null value");

    const cached = getCachedWikiThumb(456);
    assert.equal(cached, null, "Cached null should return null");
  });

  it("respects TTL expiry", async () => {
    const {
      loadWikiCache,
      saveWikiCache,
      getCachedWikiThumb,
      getCacheTTL,
    } = await import("../js/lib/playerImageResolver.js");

    // Manually set an expired entry
    const expiredCache = {
      789: {
        url: "https://expired.example.com/thumb.jpg",
        timestamp: Date.now() - getCacheTTL() - 1000, // Expired
      },
    };
    saveWikiCache(expiredCache);

    // Should return null for expired entry
    const cached = getCachedWikiThumb(789);
    assert.equal(cached, null, "Expired entry should return null");
  });

  it("keeps valid entries within TTL", async () => {
    const { loadWikiCache, saveWikiCache, getCachedWikiThumb, getCacheTTL } = await import("../js/lib/playerImageResolver.js");

    // Set a fresh entry manually
    const freshCache = {
      101: {
        url: "https://fresh.example.com/thumb.jpg",
        timestamp: Date.now() - 1000, // Just 1 second ago
      },
    };
    saveWikiCache(freshCache);

    // Should return the URL for fresh entry
    const cached = getCachedWikiThumb(101);
    assert.equal(cached, "https://fresh.example.com/thumb.jpg", "Fresh entry should return URL");
  });

  it("clearWikiCache removes all entries", async () => {
    const { setCachedWikiThumb, clearWikiCache, hasCacheEntry } = await import("../js/lib/playerImageResolver.js");

    setCachedWikiThumb(111, "https://test.com/1.jpg");
    setCachedWikiThumb(222, "https://test.com/2.jpg");

    clearWikiCache();

    assert.ok(!hasCacheEntry(111), "Cache entry 111 should be cleared");
    assert.ok(!hasCacheEntry(222), "Cache entry 222 should be cleared");
  });
});

describe("playerImageResolver - resolvePlayerImageSrc", () => {
  it("returns PL URL for valid element with photo", async () => {
    const { resolvePlayerImageSrc } = await import("../js/lib/playerImageResolver.js");

    const element = { id: 1, photo: "510663.jpg" };
    const src = resolvePlayerImageSrc(element);

    assert.ok(src.includes("resources.premierleague.com"), "Should return PL CDN URL");
    assert.ok(src.includes("p510663.png"), "Should have correct photo code");
  });

  it("returns placeholder for element without photo", async () => {
    const { resolvePlayerImageSrc, PLAYER_PLACEHOLDER_SRC } = await import("../js/lib/playerImageResolver.js");

    const element = { id: 1, photo: null };
    const src = resolvePlayerImageSrc(element);

    assert.equal(src, PLAYER_PLACEHOLDER_SRC, "Should return placeholder for null photo");
  });

  it("handles _raw.photo nested property", async () => {
    const { resolvePlayerImageSrc } = await import("../js/lib/playerImageResolver.js");

    const element = { id: 1, _raw: { photo: "36903.jpg" } };
    const src = resolvePlayerImageSrc(element);

    assert.ok(src.includes("p36903.png"), "Should use _raw.photo");
  });
});

describe("playerImageResolver - Rate Limiter", () => {
  it("exposes rate limit interval", async () => {
    const { getRateLimitInterval } = await import("../js/lib/playerImageResolver.js");

    const interval = getRateLimitInterval();
    assert.equal(interval, 1000, "Rate limit should be 1000ms (1 second)");
  });

  it("exposes pending request count", async () => {
    const { getPendingRequestCount } = await import("../js/lib/playerImageResolver.js");

    // Initially should be 0
    const count = getPendingRequestCount();
    assert.ok(typeof count === "number", "Should return a number");
    assert.ok(count >= 0, "Count should be non-negative");
  });
});

describe("playerImageResolver - getPrimaryImageUrl", () => {
  it("returns PL URL for valid element", async () => {
    const { getPrimaryImageUrl } = await import("../js/lib/playerImageResolver.js");

    const element = {
      id: 318,
      photo: "510663.jpg",
      first_name: "Hugo",
      second_name: "Ekitike"
    };

    const url = getPrimaryImageUrl(element);
    assert.ok(url.includes("resources.premierleague.com"), "Should be PL CDN");
    assert.ok(url.includes("p510663.png"), "Should have correct photo code");
  });

  it("returns placeholder for null element", async () => {
    const { getPrimaryImageUrl, PLAYER_PLACEHOLDER_SRC } = await import("../js/lib/playerImageResolver.js");

    const url = getPrimaryImageUrl(null);
    assert.equal(url, PLAYER_PLACEHOLDER_SRC, "Null element should return placeholder");
  });

  it("returns placeholder for element without photo", async () => {
    const { getPrimaryImageUrl, PLAYER_PLACEHOLDER_SRC } = await import("../js/lib/playerImageResolver.js");

    const element = { id: 1 };
    const url = getPrimaryImageUrl(element);
    assert.equal(url, PLAYER_PLACEHOLDER_SRC, "Missing photo should return placeholder");
  });
});

describe("playerImageResolver - Fallback Logic", () => {
  it("applySmartImageFallback returns the same img element", async () => {
    const { applySmartImageFallback } = await import("../js/lib/playerImageResolver.js");

    // Create a mock img element
    const mockImg = {
      dataset: {},
      src: "",
      addEventListener: () => {},
    };

    const element = { id: 123, first_name: "Test", second_name: "Player" };
    const result = applySmartImageFallback(mockImg, element);

    assert.equal(result, mockImg, "Should return the same img element");
  });

  it("applySmartImageFallback handles null img gracefully", async () => {
    const { applySmartImageFallback } = await import("../js/lib/playerImageResolver.js");

    const result = applySmartImageFallback(null, { id: 1 });
    assert.equal(result, null, "Should return null for null img");
  });

  it("applySmartImageFallback handles null element gracefully", async () => {
    const { applySmartImageFallback } = await import("../js/lib/playerImageResolver.js");

    const mockImg = { dataset: {}, addEventListener: () => {} };
    const result = applySmartImageFallback(mockImg, null);

    assert.equal(result, mockImg, "Should return img even with null element");
  });
});
