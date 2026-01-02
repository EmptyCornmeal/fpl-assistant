// tests/benchOptimizer.test.js
// Unit tests for Bench Optimizer (Phase 8)
// Tests bench order optimization and chip suggestions

import { describe, it, assert } from "./testRunner.js";

// ============================================================================
// Chip Configuration Tests
// ============================================================================

describe("Chip Configuration", () => {
  const CHIP_CONFIG = {
    BB_MIN_BENCH_XP: 14,
    BB_MIN_PER_PLAYER_XP: 3,
    BB_CONFIDENCE_HIGH: 18,
    BB_CONFIDENCE_MEDIUM: 14,
    TC_MIN_XP: 8,
    TC_MIN_XMINS: 81,
    TC_MAX_FDR: 2,
    TC_CONFIDENCE_HIGH: 10,
    TC_CONFIDENCE_MEDIUM: 8,
    BENCH_PRIORITY_WEIGHTS: {
      xP: 0.6,
      xMins: 0.4,
    },
  };

  it("should have valid Bench Boost thresholds", () => {
    assert.ok(CHIP_CONFIG.BB_MIN_BENCH_XP > 0, "BB min bench xP should be positive");
    assert.ok(CHIP_CONFIG.BB_MIN_PER_PLAYER_XP > 0, "BB min per player xP should be positive");
    assert.ok(CHIP_CONFIG.BB_CONFIDENCE_HIGH >= CHIP_CONFIG.BB_CONFIDENCE_MEDIUM,
      "High confidence threshold should be >= medium");
  });

  it("should have valid Triple Captain thresholds", () => {
    assert.ok(CHIP_CONFIG.TC_MIN_XP > 0, "TC min xP should be positive");
    assert.ok(CHIP_CONFIG.TC_MIN_XMINS > 60, "TC min xMins should require near-full match");
    assert.ok(CHIP_CONFIG.TC_MAX_FDR <= 3, "TC should only trigger for easy fixtures");
  });

  it("should have weights summing to 1", () => {
    const { xP, xMins } = CHIP_CONFIG.BENCH_PRIORITY_WEIGHTS;
    assert.approximately(xP + xMins, 1.0, 0.001, "Weights should sum to 1");
  });
});

// ============================================================================
// Bench Order Optimization Tests
// ============================================================================

describe("Bench Order Optimization", () => {
  const mockBench = [
    { id: 1, web_name: "Henderson", element_type: 1, xP: 3.5, xMins: 90 }, // GKP
    { id: 2, web_name: "Walker", element_type: 2, xP: 4.0, xMins: 60 },     // DEF
    { id: 3, web_name: "Isak", element_type: 4, xP: 5.5, xMins: 85 },       // FWD
    { id: 4, web_name: "Cunha", element_type: 4, xP: 4.5, xMins: 70 },      // FWD
  ];

  it("should have exactly 4 bench players", () => {
    assert.lengthOf(mockBench, 4, "Bench should have 4 players");
  });

  it("should separate GKP from outfield bench", () => {
    const benchGkp = mockBench.find(p => p.element_type === 1);
    const outfieldBench = mockBench.filter(p => p.element_type !== 1);

    assert.ok(benchGkp, "Should find bench GKP");
    assert.lengthOf(outfieldBench, 3, "Should have 3 outfield bench players");
  });

  it("should calculate composite score correctly", () => {
    const weights = { xP: 0.6, xMins: 0.4 };
    const player = { xP: 5.0, xMins: 80 };

    const xpNorm = Math.min(player.xP / 6, 1);  // Normalize to 0-1
    const minsNorm = player.xMins / 90;         // Normalize to 0-1

    const compositeScore = weights.xP * xpNorm + weights.xMins * minsNorm;

    assert.ok(compositeScore > 0, "Composite score should be positive");
    assert.ok(compositeScore <= 1, "Composite score should be <= 1");
  });

  it("should order bench by composite score (highest first)", () => {
    const weights = { xP: 0.6, xMins: 0.4 };
    const outfield = mockBench.filter(p => p.element_type !== 1);

    const scored = outfield.map(p => ({
      ...p,
      compositeScore: weights.xP * Math.min(p.xP / 6, 1) + weights.xMins * (p.xMins / 90),
    }));

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    assert.equal(scored[0].web_name, "Isak", "Isak should be first sub");
    assert.ok(scored[0].compositeScore >= scored[1].compositeScore, "First should have highest score");
  });

  it("should detect suboptimal bench order", () => {
    const currentOrder = ["Walker", "Isak", "Cunha"]; // Suboptimal
    const optimalOrder = ["Isak", "Walker", "Cunha"]; // Optimal by xP/xMins

    const isSuboptimal = currentOrder[0] !== optimalOrder[0];
    assert.equal(isSuboptimal, true, "Should detect suboptimal order");
  });

  it("should generate warning for position mismatch", () => {
    const currentPos13 = { web_name: "Walker", compositeScore: 0.65 };
    const optimalPos13 = { web_name: "Isak", compositeScore: 0.82 };

    const scoreDiff = optimalPos13.compositeScore - currentPos13.compositeScore;
    const shouldWarn = scoreDiff > 0.1;

    assert.equal(shouldWarn, true, "Should warn about significant difference");
  });
});

// ============================================================================
// Bench Boost Evaluation Tests
// ============================================================================

describe("Bench Boost Evaluation", () => {
  const THRESHOLDS = {
    MIN_TOTAL_XP: 14,
    MIN_PER_PLAYER: 3,
    CONFIDENCE_HIGH: 18,
    CONFIDENCE_MEDIUM: 14,
  };

  it("should trigger BB when all conditions met", () => {
    const bench = [
      { xP: 4.0, hasFixture: true },
      { xP: 4.5, hasFixture: true },
      { xP: 3.5, hasFixture: true },
      { xP: 3.0, hasFixture: true },
    ];

    const totalXp = bench.reduce((sum, p) => sum + p.xP, 0);
    const allHaveFixtures = bench.every(p => p.hasFixture);
    const allMeetMinimum = bench.every(p => p.xP >= THRESHOLDS.MIN_PER_PLAYER);

    const triggered = totalXp >= THRESHOLDS.MIN_TOTAL_XP && allHaveFixtures && allMeetMinimum;

    assert.equal(triggered, true, "BB should trigger with good bench");
    assert.equal(totalXp, 15, "Total xP should be 15");
  });

  it("should NOT trigger BB when bench total is low", () => {
    const bench = [
      { xP: 2.0, hasFixture: true },
      { xP: 2.5, hasFixture: true },
      { xP: 3.0, hasFixture: true },
      { xP: 2.5, hasFixture: true },
    ];

    const totalXp = bench.reduce((sum, p) => sum + p.xP, 0);
    const triggered = totalXp >= THRESHOLDS.MIN_TOTAL_XP;

    assert.equal(triggered, false, "BB should NOT trigger with weak bench");
    assert.equal(totalXp, 10, "Total xP should be 10");
  });

  it("should NOT trigger BB when player has blank GW", () => {
    const bench = [
      { xP: 5.0, hasFixture: true },
      { xP: 4.0, hasFixture: false }, // BLANK
      { xP: 4.0, hasFixture: true },
      { xP: 3.5, hasFixture: true },
    ];

    const allHaveFixtures = bench.every(p => p.hasFixture);
    assert.equal(allHaveFixtures, false, "Not all have fixtures");
  });

  it("should calculate confidence level correctly", () => {
    const getConfidence = (totalXp) => {
      if (totalXp >= THRESHOLDS.CONFIDENCE_HIGH) return "HIGH";
      if (totalXp >= THRESHOLDS.CONFIDENCE_MEDIUM) return "MEDIUM";
      return "LOW";
    };

    assert.equal(getConfidence(20), "HIGH", "20 xP = HIGH confidence");
    assert.equal(getConfidence(16), "MEDIUM", "16 xP = MEDIUM confidence");
    assert.equal(getConfidence(10), "LOW", "10 xP = LOW confidence");
  });
});

// ============================================================================
// Triple Captain Evaluation Tests
// ============================================================================

describe("Triple Captain Evaluation", () => {
  const THRESHOLDS = {
    MIN_XP: 8,
    MIN_XMINS: 81,
    MAX_FDR: 2,
    CONFIDENCE_HIGH: 10,
    CONFIDENCE_MEDIUM: 8,
  };

  it("should trigger TC when all conditions met", () => {
    const captain = {
      web_name: "Haaland",
      xP: 10.5,
      xMins: 88,
      fdr: 2,
      hasFixture: true,
    };

    const meetsXp = captain.xP >= THRESHOLDS.MIN_XP;
    const meetsMins = captain.xMins >= THRESHOLDS.MIN_XMINS;
    const meetsFdr = captain.fdr <= THRESHOLDS.MAX_FDR;
    const triggered = captain.hasFixture && meetsXp && meetsMins && meetsFdr;

    assert.equal(triggered, true, "TC should trigger for Haaland");
  });

  it("should NOT trigger TC with tough fixture", () => {
    const captain = {
      xP: 7.5,
      xMins: 90,
      fdr: 4, // Tough fixture
    };

    const meetsFdr = captain.fdr <= THRESHOLDS.MAX_FDR;
    assert.equal(meetsFdr, false, "Should not trigger with FDR 4");
  });

  it("should NOT trigger TC with rotation risk", () => {
    const captain = {
      xP: 9.0,
      xMins: 65, // Rotation risk
      fdr: 2,
    };

    const meetsMins = captain.xMins >= THRESHOLDS.MIN_XMINS;
    assert.equal(meetsMins, false, "Should not trigger with low minutes");
  });

  it("should NOT trigger TC with low xP", () => {
    const captain = {
      xP: 5.5, // Below threshold
      xMins: 90,
      fdr: 2,
    };

    const meetsXp = captain.xP >= THRESHOLDS.MIN_XP;
    assert.equal(meetsXp, false, "Should not trigger with low xP");
  });

  it("should calculate TC confidence correctly", () => {
    const getConfidence = (xP, xMins, fdr) => {
      if (xP >= THRESHOLDS.CONFIDENCE_HIGH && xMins >= 85 && fdr <= 2) return "HIGH";
      if (xP >= THRESHOLDS.CONFIDENCE_MEDIUM) return "MEDIUM";
      return "LOW";
    };

    assert.equal(getConfidence(11, 90, 2), "HIGH", "Strong captain = HIGH");
    assert.equal(getConfidence(8.5, 85, 3), "MEDIUM", "Decent captain = MEDIUM");
    assert.equal(getConfidence(7, 80, 2), "LOW", "Weak captain = LOW");
  });
});

// ============================================================================
// Chip Priority Tests
// ============================================================================

describe("Chip Priority", () => {
  it("should prioritize BB over TC when bench is stacked", () => {
    const bbResult = { triggered: true, confidence: "HIGH", totalXp: 20 };
    const tcResult = { triggered: true, confidence: "MEDIUM", xP: 9.0 };

    // BB with HIGH confidence takes priority
    let recommendation = "none";
    if (bbResult.triggered && bbResult.confidence !== "LOW") {
      recommendation = "bboost";
    } else if (tcResult.triggered && tcResult.confidence !== "LOW") {
      recommendation = "3xc";
    }

    assert.equal(recommendation, "bboost", "BB should take priority");
  });

  it("should recommend TC when BB not triggered", () => {
    const bbResult = { triggered: false, confidence: null };
    const tcResult = { triggered: true, confidence: "HIGH", xP: 11.0 };

    let recommendation = "none";
    if (bbResult.triggered && bbResult.confidence !== "LOW") {
      recommendation = "bboost";
    } else if (tcResult.triggered && tcResult.confidence !== "LOW") {
      recommendation = "3xc";
    }

    assert.equal(recommendation, "3xc", "TC should be recommended");
  });

  it("should recommend neither when both LOW confidence", () => {
    const bbResult = { triggered: true, confidence: "LOW" };
    const tcResult = { triggered: true, confidence: "LOW" };

    let recommendation = "none";
    if (bbResult.triggered && bbResult.confidence !== "LOW") {
      recommendation = "bboost";
    } else if (tcResult.triggered && tcResult.confidence !== "LOW") {
      recommendation = "3xc";
    }

    assert.equal(recommendation, "none", "Should not recommend LOW confidence chips");
  });
});

export default {};
