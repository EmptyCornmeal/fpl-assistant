// tests/livePoints.test.js
// Tests for live GW points calculation with chip multipliers
import { describe, it, assert } from "./testRunner.js";
import {
  calculateLiveGwPoints,
  buildLiveDataMap,
  getPlayerLivePoints,
  getPickMultiplier,
} from "../js/lib/livePoints.js";

describe("livePoints - calculateLiveGwPoints", () => {
  it("calculates correct total for standard team (no chips)", () => {
    const picksData = {
      picks: [
        { element: 1, position: 1, is_captain: false, is_vice_captain: false },
        { element: 2, position: 2, is_captain: false, is_vice_captain: false },
        { element: 3, position: 3, is_captain: true, is_vice_captain: false },  // Captain
        { element: 4, position: 4, is_captain: false, is_vice_captain: true },  // VC
        { element: 5, position: 5, is_captain: false, is_vice_captain: false },
        { element: 6, position: 6, is_captain: false, is_vice_captain: false },
        { element: 7, position: 7, is_captain: false, is_vice_captain: false },
        { element: 8, position: 8, is_captain: false, is_vice_captain: false },
        { element: 9, position: 9, is_captain: false, is_vice_captain: false },
        { element: 10, position: 10, is_captain: false, is_vice_captain: false },
        { element: 11, position: 11, is_captain: false, is_vice_captain: false },
        { element: 12, position: 12, is_captain: false, is_vice_captain: false }, // Bench
        { element: 13, position: 13, is_captain: false, is_vice_captain: false }, // Bench
        { element: 14, position: 14, is_captain: false, is_vice_captain: false }, // Bench
        { element: 15, position: 15, is_captain: false, is_vice_captain: false }, // Bench
      ],
      active_chip: null,
    };

    // Each player scores 5 points
    const liveDataMap = new Map();
    for (let i = 1; i <= 15; i++) {
      liveDataMap.set(i, { stats: { total_points: 5 } });
    }

    const result = calculateLiveGwPoints(picksData, liveDataMap);

    // 10 starters * 5 points = 50
    // 1 captain (element 3) * 5 points * 2 = 10
    // 4 bench players * 0 = 0 (no bench boost)
    // Total = 50 + 10 = 60
    assert.equal(result.total, 60, "Standard team should have correct total");
    assert.equal(result.chip, null, "No chip should be active");
    assert.equal(result.breakdown.length, 15, "Should have all 15 players in breakdown");
  });

  it("applies triple captain multiplier (3x)", () => {
    const picksData = {
      picks: [
        { element: 1, position: 1, is_captain: true, is_vice_captain: false },  // Captain with 3xc
        { element: 2, position: 2, is_captain: false, is_vice_captain: false },
      ],
      active_chip: "3xc",
    };

    const liveDataMap = new Map([
      [1, { stats: { total_points: 10 } }],
      [2, { stats: { total_points: 5 } }],
    ]);

    const result = calculateLiveGwPoints(picksData, liveDataMap);

    // Captain with triple captain: 10 * 3 = 30
    // Other player: 5 * 1 = 5
    // Total = 35
    assert.equal(result.total, 35, "Triple captain should apply 3x multiplier");
    assert.equal(result.chip, "3xc", "Chip should be 3xc");
  });

  it("applies bench boost (all bench players count)", () => {
    const picksData = {
      picks: [
        { element: 1, position: 1, is_captain: true, is_vice_captain: false },
        { element: 2, position: 12, is_captain: false, is_vice_captain: false }, // Bench
        { element: 3, position: 13, is_captain: false, is_vice_captain: false }, // Bench
        { element: 4, position: 14, is_captain: false, is_vice_captain: false }, // Bench
        { element: 5, position: 15, is_captain: false, is_vice_captain: false }, // Bench
      ],
      active_chip: "bboost",
    };

    const liveDataMap = new Map([
      [1, { stats: { total_points: 10 } }],
      [2, { stats: { total_points: 5 } }],
      [3, { stats: { total_points: 5 } }],
      [4, { stats: { total_points: 5 } }],
      [5, { stats: { total_points: 5 } }],
    ]);

    const result = calculateLiveGwPoints(picksData, liveDataMap);

    // Captain: 10 * 2 = 20
    // 4 bench players with bench boost: 5 * 4 = 20
    // Total = 40
    assert.equal(result.total, 40, "Bench boost should include all bench players");
    assert.equal(result.chip, "bboost", "Chip should be bboost");
  });

  it("handles missing live data gracefully", () => {
    const picksData = {
      picks: [
        { element: 1, position: 1, is_captain: false, is_vice_captain: false },
        { element: 2, position: 2, is_captain: false, is_vice_captain: false },
      ],
      active_chip: null,
    };

    // Only player 1 has live data
    const liveDataMap = new Map([
      [1, { stats: { total_points: 10 } }],
    ]);

    const result = calculateLiveGwPoints(picksData, liveDataMap);

    // Player 1: 10 * 1 = 10
    // Player 2: 0 (no data)
    assert.equal(result.total, 10, "Should handle missing player data");
  });

  it("returns zero for null/undefined inputs", () => {
    const result1 = calculateLiveGwPoints(null, new Map());
    assert.equal(result1.total, 0, "Null picks should return 0");

    const result2 = calculateLiveGwPoints({ picks: [] }, null);
    assert.equal(result2.total, 0, "Null liveDataMap should return 0");

    const result3 = calculateLiveGwPoints({ picks: null }, new Map());
    assert.equal(result3.total, 0, "Null picks array should return 0");
  });
});

describe("livePoints - buildLiveDataMap", () => {
  it("builds map from eventLive response", () => {
    const eventLiveData = {
      elements: [
        { id: 1, stats: { total_points: 10, minutes: 90 }, explain: [] },
        { id: 2, stats: { total_points: 5, minutes: 45 }, explain: [] },
      ],
    };

    const map = buildLiveDataMap(eventLiveData);

    assert.equal(map.size, 2, "Map should have 2 entries");
    assert.ok(map.has(1), "Should have player 1");
    assert.ok(map.has(2), "Should have player 2");
    assert.equal(map.get(1).stats.total_points, 10, "Should have correct points for player 1");
  });

  it("handles empty/null response", () => {
    const map1 = buildLiveDataMap(null);
    assert.equal(map1.size, 0, "Null should return empty map");

    const map2 = buildLiveDataMap({});
    assert.equal(map2.size, 0, "Empty object should return empty map");

    const map3 = buildLiveDataMap({ elements: null });
    assert.equal(map3.size, 0, "Null elements should return empty map");
  });
});

describe("livePoints - getPickMultiplier", () => {
  it("returns correct multiplier for standard picks", () => {
    const standardPick = { position: 5, is_captain: false };
    assert.equal(getPickMultiplier(standardPick, null), 1, "Standard pick should be 1x");
  });

  it("returns 2x for captain", () => {
    const captainPick = { position: 1, is_captain: true };
    assert.equal(getPickMultiplier(captainPick, null), 2, "Captain should be 2x");
  });

  it("returns 3x for captain with triple captain chip", () => {
    const captainPick = { position: 1, is_captain: true };
    assert.equal(getPickMultiplier(captainPick, "3xc"), 3, "Triple captain should be 3x");
  });

  it("returns 0 for bench without bench boost", () => {
    const benchPick = { position: 12, is_captain: false };
    assert.equal(getPickMultiplier(benchPick, null), 0, "Bench without boost should be 0x");
  });

  it("returns 1x for bench with bench boost", () => {
    const benchPick = { position: 13, is_captain: false };
    assert.equal(getPickMultiplier(benchPick, "bboost"), 1, "Bench with boost should be 1x");
  });
});

describe("livePoints - getPlayerLivePoints", () => {
  it("returns correct points with multiplier", () => {
    const liveMap = new Map([
      [1, { stats: { total_points: 10 } }],
    ]);

    assert.equal(getPlayerLivePoints(1, liveMap, 1), 10, "1x multiplier");
    assert.equal(getPlayerLivePoints(1, liveMap, 2), 20, "2x multiplier");
    assert.equal(getPlayerLivePoints(1, liveMap, 3), 30, "3x multiplier");
    assert.equal(getPlayerLivePoints(1, liveMap, 0), 0, "0x multiplier (bench)");
  });

  it("returns 0 for missing player", () => {
    const liveMap = new Map();
    assert.equal(getPlayerLivePoints(999, liveMap, 1), 0, "Missing player should return 0");
  });
});
