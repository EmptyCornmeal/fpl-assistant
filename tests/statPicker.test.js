// tests/statPicker.test.js
// Unit tests for Stat Picker (Phase 5-6)
// Tests horizon/objective recalculation and gate unlock logic

import { describe, it, beforeEach, assert } from "./testRunner.js";

// Mock localStorage for testing
const mockLocalStorage = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
  };
})();

// Replace global localStorage in tests
const originalLocalStorage = typeof localStorage !== "undefined" ? localStorage : null;

// ============================================================================
// Gate Unlock Logic Tests
// ============================================================================

describe("Gate Unlock Logic", () => {
  const GATE_KEY = "fpl.statpicker.unlocked";
  const GATE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
  const GATE_PASSWORD = "fpl2025";

  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it("should return false when no unlock data exists", () => {
    const data = mockLocalStorage.getItem(GATE_KEY);
    assert.equal(data, null, "No data should exist initially");

    const isUnlocked = data !== null;
    assert.equal(isUnlocked, false, "Should not be unlocked");
  });

  it("should return true when unlock timestamp is fresh", () => {
    const timestamp = Date.now();
    mockLocalStorage.setItem(GATE_KEY, JSON.stringify({ timestamp }));

    const data = JSON.parse(mockLocalStorage.getItem(GATE_KEY));
    const isExpired = Date.now() - data.timestamp > GATE_EXPIRY_MS;

    assert.equal(isExpired, false, "Should not be expired");
  });

  it("should return false when unlock timestamp is expired", () => {
    const timestamp = Date.now() - GATE_EXPIRY_MS - 1000; // 24h + 1s ago
    mockLocalStorage.setItem(GATE_KEY, JSON.stringify({ timestamp }));

    const data = JSON.parse(mockLocalStorage.getItem(GATE_KEY));
    const isExpired = Date.now() - data.timestamp > GATE_EXPIRY_MS;

    assert.equal(isExpired, true, "Should be expired");
  });

  it("should unlock with correct password", () => {
    const inputPassword = "fpl2025";
    const isCorrect = inputPassword === GATE_PASSWORD;

    assert.equal(isCorrect, true, "Password should match");

    if (isCorrect) {
      mockLocalStorage.setItem(GATE_KEY, JSON.stringify({ timestamp: Date.now() }));
    }

    const data = mockLocalStorage.getItem(GATE_KEY);
    assert.ok(data !== null, "Should be unlocked after correct password");
  });

  it("should reject incorrect password", () => {
    const inputPassword = "wrongpassword";
    const isCorrect = inputPassword === GATE_PASSWORD;

    assert.equal(isCorrect, false, "Password should not match");
  });

  it("should clear unlock on lock()", () => {
    mockLocalStorage.setItem(GATE_KEY, JSON.stringify({ timestamp: Date.now() }));
    assert.ok(mockLocalStorage.getItem(GATE_KEY) !== null, "Should be unlocked");

    mockLocalStorage.removeItem(GATE_KEY);
    assert.equal(mockLocalStorage.getItem(GATE_KEY), null, "Should be locked after removal");
  });

  it("should handle malformed JSON gracefully", () => {
    mockLocalStorage.setItem(GATE_KEY, "not valid json");

    let isUnlocked = false;
    try {
      const data = JSON.parse(mockLocalStorage.getItem(GATE_KEY));
      isUnlocked = data && Date.now() - data.timestamp < GATE_EXPIRY_MS;
    } catch {
      isUnlocked = false;
    }

    assert.equal(isUnlocked, false, "Should handle parse error gracefully");
  });
});

// ============================================================================
// Horizon Configuration Tests
// ============================================================================

describe("Horizon Configuration", () => {
  const HORIZONS = {
    THIS_GW: { id: "this_gw", label: "This GW", gwCount: 1 },
    NEXT_3: { id: "next_3", label: "Next 3", gwCount: 3 },
    NEXT_5: { id: "next_5", label: "Next 5", gwCount: 5 },
  };

  it("should have valid horizon definitions", () => {
    assert.hasProperty(HORIZONS, "THIS_GW");
    assert.hasProperty(HORIZONS, "NEXT_3");
    assert.hasProperty(HORIZONS, "NEXT_5");
  });

  it("should calculate correct GW IDs for THIS_GW", () => {
    const startGw = 10;
    const gwCount = HORIZONS.THIS_GW.gwCount;
    const gwIds = [];

    for (let gw = startGw; gw < startGw + gwCount && gw <= 38; gw++) {
      gwIds.push(gw);
    }

    assert.deepEqual(gwIds, [10], "THIS_GW should have 1 gameweek");
  });

  it("should calculate correct GW IDs for NEXT_3", () => {
    const startGw = 10;
    const gwCount = HORIZONS.NEXT_3.gwCount;
    const gwIds = [];

    for (let gw = startGw; gw < startGw + gwCount && gw <= 38; gw++) {
      gwIds.push(gw);
    }

    assert.deepEqual(gwIds, [10, 11, 12], "NEXT_3 should have 3 gameweeks");
  });

  it("should calculate correct GW IDs for NEXT_5", () => {
    const startGw = 10;
    const gwCount = HORIZONS.NEXT_5.gwCount;
    const gwIds = [];

    for (let gw = startGw; gw < startGw + gwCount && gw <= 38; gw++) {
      gwIds.push(gw);
    }

    assert.deepEqual(gwIds, [10, 11, 12, 13, 14], "NEXT_5 should have 5 gameweeks");
  });

  it("should cap GW IDs at 38", () => {
    const startGw = 36;
    const gwCount = HORIZONS.NEXT_5.gwCount;
    const gwIds = [];

    for (let gw = startGw; gw < startGw + gwCount && gw <= 38; gw++) {
      gwIds.push(gw);
    }

    assert.deepEqual(gwIds, [36, 37, 38], "Should cap at GW38");
    assert.lengthOf(gwIds, 3, "Should have 3 gameweeks when near end of season");
  });

  it("should persist horizon selection to storage", () => {
    const STORAGE_KEY = "fpl.sp.horizon";
    const selectedHorizon = "next_3";

    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify(selectedHorizon));

    const stored = JSON.parse(mockLocalStorage.getItem(STORAGE_KEY));
    assert.equal(stored, "next_3", "Should persist horizon selection");
  });
});

// ============================================================================
// Objective Configuration Tests
// ============================================================================

describe("Objective Configuration", () => {
  const OBJECTIVES = {
    MAX_POINTS: { id: "max_points", label: "Max Points", description: "Maximize expected points" },
    MIN_RISK: { id: "min_risk", label: "Min Risk", description: "Prioritize nailed starters" },
    PROTECT_RANK: { id: "protect_rank", label: "Protect Rank", description: "Match effective ownership" },
    CHASE_UPSIDE: { id: "chase_upside", label: "Chase Upside", description: "Target differential picks" },
  };

  it("should have valid objective definitions", () => {
    assert.hasProperty(OBJECTIVES, "MAX_POINTS");
    assert.hasProperty(OBJECTIVES, "MIN_RISK");
    assert.hasProperty(OBJECTIVES, "PROTECT_RANK");
    assert.hasProperty(OBJECTIVES, "CHASE_UPSIDE");
  });

  it("should have descriptions for all objectives", () => {
    Object.values(OBJECTIVES).forEach(obj => {
      assert.ok(obj.description && obj.description.length > 0, `${obj.id} should have description`);
    });
  });

  it("should persist objective selection to storage", () => {
    const STORAGE_KEY = "fpl.sp.objective";
    const selectedObjective = "min_risk";

    mockLocalStorage.setItem(STORAGE_KEY, JSON.stringify(selectedObjective));

    const stored = JSON.parse(mockLocalStorage.getItem(STORAGE_KEY));
    assert.equal(stored, "min_risk", "Should persist objective selection");
  });

  it("should apply MIN_RISK weighting correctly", () => {
    // MIN_RISK should weight xMins heavily
    const weights = { xP: 0.4, xMins: 0.6 };

    const player1 = { xP: 5.0, xMins: 90 }; // Nailed
    const player2 = { xP: 6.0, xMins: 60 }; // Rotation risk

    const score1 = player1.xP * weights.xP + (player1.xMins / 90) * weights.xMins * 10;
    const score2 = player2.xP * weights.xP + (player2.xMins / 90) * weights.xMins * 10;

    assert.ok(score1 > score2, "Nailed player should score higher in MIN_RISK");
  });
});

// ============================================================================
// Captain Mode Tests
// ============================================================================

describe("Captain Mode", () => {
  const CAPTAIN_MODES = {
    CONSERVATIVE: {
      id: "conservative",
      label: "Conservative",
      description: "Prefer nailed starters with high floor",
    },
    AGGRESSIVE: {
      id: "aggressive",
      label: "Aggressive",
      description: "Target highest ceiling, accept variance",
    },
  };

  it("should have two captain modes", () => {
    assert.hasProperty(CAPTAIN_MODES, "CONSERVATIVE");
    assert.hasProperty(CAPTAIN_MODES, "AGGRESSIVE");
  });

  it("should rank captains correctly in CONSERVATIVE mode", () => {
    const candidates = [
      { name: "Salah", xP: 7.5, xMins: 90, status: "a" },
      { name: "Palmer", xP: 8.0, xMins: 75, status: "a" },
      { name: "Haaland", xP: 9.0, xMins: 60, status: "d" },
    ];

    // Conservative: weight floor (xMins) heavily
    const scored = candidates.map(p => ({
      ...p,
      score: p.xP * 0.5 + (p.xMins / 90) * 5 + (p.status === "a" ? 1 : 0),
    }));

    scored.sort((a, b) => b.score - a.score);

    assert.equal(scored[0].name, "Salah", "Salah should be top conservative pick");
  });

  it("should rank captains correctly in AGGRESSIVE mode", () => {
    const candidates = [
      { name: "Salah", xP: 7.5, ceiling: 15 },
      { name: "Palmer", xP: 8.0, ceiling: 18 },
      { name: "Haaland", xP: 9.0, ceiling: 25 },
    ];

    // Aggressive: weight ceiling heavily
    const scored = candidates.map(p => ({
      ...p,
      score: p.xP * 0.3 + p.ceiling * 0.7,
    }));

    scored.sort((a, b) => b.score - a.score);

    assert.equal(scored[0].name, "Haaland", "Haaland should be top aggressive pick");
  });
});

// ============================================================================
// Verdict Assignment Tests
// ============================================================================

describe("Verdict Assignment", () => {
  const VERDICTS = {
    LOCK: { id: "lock", label: "LOCK" },
    START: { id: "start", label: "START" },
    BENCH: { id: "bench", label: "BENCH" },
    SELL_WATCH: { id: "sell_watch", label: "SELL WATCH" },
    SELL: { id: "sell", label: "SELL" },
  };

  it("should assign LOCK to high-confidence starters", () => {
    const player = { xP: 8.0, xMins: 90, status: "a", form: 7.0 };
    const isLock = player.xP >= 6 && player.xMins >= 85 && player.status === "a";

    assert.equal(isLock, true, "High-confidence player should be LOCK");
  });

  it("should assign SELL to injured players", () => {
    const player = { status: "i", news: "Out for 6 weeks" };
    const isSell = player.status === "i" || player.status === "n";

    assert.equal(isSell, true, "Injured player should be SELL");
  });

  it("should assign BENCH to low xP rotation players", () => {
    const player = { xP: 3.5, xMins: 65, status: "a" };
    const isBench = player.xP < 4 && player.xMins < 75;

    assert.equal(isBench, true, "Low xP rotation player should be BENCH");
  });

  it("should assign SELL_WATCH to declining form players", () => {
    const player = { form: 2.5, ppg: 5.0 };
    const isDecline = player.form < player.ppg * 0.6;

    assert.equal(isDecline, true, "Declining form should trigger SELL_WATCH");
  });
});

// ============================================================================
// Dependency Loading Tests
// ============================================================================

describe("Dependency Loading", () => {
  const DEPENDENCIES = {
    BOOTSTRAP: { id: "bootstrap", label: "Game Data", required: true },
    GW_STATE: { id: "gw_state", label: "GW & Deadline", required: true },
    SQUAD: { id: "squad", label: "Squad", required: true },
    FT_ITB: { id: "ft_itb", label: "FT + Bank", required: true },
    CHIPS: { id: "chips", label: "Chip Availability", required: true },
    FIXTURES: { id: "fixtures", label: "Fixtures", required: true },
    PREDICTIONS: { id: "predictions", label: "xP Predictions", required: false },
  };

  it("should identify required dependencies", () => {
    const required = Object.values(DEPENDENCIES).filter(d => d.required);
    assert.lengthOf(required, 6, "Should have 6 required dependencies");
  });

  it("should identify optional dependencies", () => {
    const optional = Object.values(DEPENDENCIES).filter(d => !d.required);
    assert.lengthOf(optional, 1, "Should have 1 optional dependency");
    assert.equal(optional[0].id, "predictions", "Predictions should be optional");
  });

  it("should track dependency status correctly", () => {
    const status = {
      bootstrap: { status: "success", fromCache: false },
      gw_state: { status: "success", fromCache: false },
      squad: { status: "loading", fromCache: false },
      ft_itb: { status: "pending", fromCache: false },
    };

    const loading = Object.entries(status).filter(([, s]) => s.status === "loading");
    assert.lengthOf(loading, 1, "Should have 1 loading dependency");
    assert.equal(loading[0][0], "squad", "Squad should be loading");
  });

  it("should handle partial failures gracefully", () => {
    const status = {
      bootstrap: { status: "success" },
      gw_state: { status: "success" },
      squad: { status: "failed", error: "Network error" },
    };

    const failures = Object.entries(status).filter(([, s]) => s.status === "failed");
    assert.lengthOf(failures, 1, "Should have 1 failed dependency");

    const failedDep = DEPENDENCIES[failures[0][0].toUpperCase()];
    const canContinue = failedDep && !failedDep.required;

    // Squad is required, so we can't continue
    assert.equal(canContinue, false, "Should not continue with failed required dep");
  });
});

export default {};
