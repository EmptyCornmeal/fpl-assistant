// tests/images.test.js
// Updated tests for Premier League CDN image URLs
import { describe, it, assert } from "./testRunner.js";

describe("image helpers (Premier League CDN)", () => {
  it("builds correct Premier League CDN URL for player photo", async () => {
    const { getPlayerImage } = await import("../js/lib/images.js");

    // Test with typical FPL API photo field format
    const url = getPlayerImage("36903.jpg");

    // Should use Premier League CDN
    assert.ok(url.includes("resources.premierleague.com"), "URL should use Premier League CDN");
    assert.ok(url.includes("/photos/players/110x140/"), "URL should use correct photo path");
    assert.ok(url.includes("p36903.png"), "URL should have correct photo code with 'p' prefix");
  });

  it("strips extension and normalizes photo ID", async () => {
    const { getPlayerImage } = await import("../js/lib/images.js");

    // Test with .jpg extension
    const url1 = getPlayerImage("12345.jpg");
    assert.ok(url1.includes("p12345.png"), "Should strip .jpg and add .png");

    // Test with .png extension
    const url2 = getPlayerImage("12345.png");
    assert.ok(url2.includes("p12345.png"), "Should strip .png and add correct extension");

    // Test with 'p' prefix already present
    const url3 = getPlayerImage("p12345.jpg");
    assert.ok(url3.includes("p12345.png"), "Should handle existing 'p' prefix");
    assert.ok(!url3.includes("pp12345"), "Should not double the 'p' prefix");
  });

  it("returns placeholder for null/empty photo ID", async () => {
    const { getPlayerImage, PLAYER_PLACEHOLDER_SRC } = await import("../js/lib/images.js");

    assert.equal(getPlayerImage(null), PLAYER_PLACEHOLDER_SRC, "Null should return placeholder");
    assert.equal(getPlayerImage(""), PLAYER_PLACEHOLDER_SRC, "Empty string should return placeholder");
    assert.equal(getPlayerImage(undefined), PLAYER_PLACEHOLDER_SRC, "Undefined should return placeholder");
  });

  it("builds correct Premier League CDN URL for team badge", async () => {
    const { getTeamBadgeUrl } = await import("../js/lib/images.js");

    // Arsenal's code is 3
    const url = getTeamBadgeUrl(3);

    assert.ok(url.includes("resources.premierleague.com"), "URL should use Premier League CDN");
    assert.ok(url.includes("/badges/"), "URL should use badges path");
    assert.ok(url.includes("t3.png"), "URL should have correct team code");
  });

  it("uses correct badge size parameter", async () => {
    const { getTeamBadgeUrl } = await import("../js/lib/images.js");

    const url40 = getTeamBadgeUrl(3, 40);
    const url70 = getTeamBadgeUrl(3, 70);
    const url100 = getTeamBadgeUrl(3, 100);

    assert.ok(url40.includes("/40/"), "Should use size 40");
    assert.ok(url70.includes("/70/"), "Should use size 70");
    assert.ok(url100.includes("/100/"), "Should use size 100");
  });

  it("returns null for invalid team code", async () => {
    const { getTeamBadgeUrl } = await import("../js/lib/images.js");

    assert.equal(getTeamBadgeUrl(null), null, "Null should return null");
    assert.equal(getTeamBadgeUrl(0), null, "Zero should return null");
    assert.equal(getTeamBadgeUrl(undefined), null, "Undefined should return null");
  });
});
