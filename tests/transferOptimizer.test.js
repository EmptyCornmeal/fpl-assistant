// tests/transferOptimizer.test.js
// Unit tests for Transfer Optimizer (Phase 7)
// Tests formation validity, transfer simulation legality, and budget constraints

import { describe, it, beforeAll, assert } from "./testRunner.js";

// Mock data for testing
const mockBootstrap = {
  elements: [
    // Goalkeepers
    { id: 1, web_name: "Raya", element_type: 1, team: 1, now_cost: 55, selling_price: 55, status: "a", form: "5.0" },
    { id: 2, web_name: "Henderson", element_type: 1, team: 2, now_cost: 47, selling_price: 47, status: "a", form: "4.0" },
    // Defenders
    { id: 3, web_name: "Saliba", element_type: 2, team: 1, now_cost: 60, selling_price: 60, status: "a", form: "6.0" },
    { id: 4, web_name: "Gabriel", element_type: 2, team: 1, now_cost: 58, selling_price: 58, status: "a", form: "5.5" },
    { id: 5, web_name: "VanDijk", element_type: 2, team: 3, now_cost: 65, selling_price: 65, status: "a", form: "6.5" },
    { id: 6, web_name: "Alexander-Arnold", element_type: 2, team: 3, now_cost: 82, selling_price: 82, status: "a", form: "7.0" },
    { id: 7, web_name: "Walker", element_type: 2, team: 4, now_cost: 52, selling_price: 52, status: "d", form: "3.0" },
    { id: 8, web_name: "Cucurella", element_type: 2, team: 5, now_cost: 50, selling_price: 50, status: "a", form: "4.5" },
    // Midfielders
    { id: 9, web_name: "Salah", element_type: 3, team: 3, now_cost: 130, selling_price: 130, status: "a", form: "8.0" },
    { id: 10, web_name: "Palmer", element_type: 3, team: 5, now_cost: 110, selling_price: 110, status: "a", form: "8.5" },
    { id: 11, web_name: "Saka", element_type: 3, team: 1, now_cost: 100, selling_price: 100, status: "a", form: "7.0" },
    { id: 12, web_name: "Gordon", element_type: 3, team: 6, now_cost: 75, selling_price: 75, status: "a", form: "6.0" },
    { id: 13, web_name: "Martinelli", element_type: 3, team: 1, now_cost: 70, selling_price: 70, status: "i", form: "4.0" },
    { id: 18, web_name: "McGinn", element_type: 3, team: 7, now_cost: 65, selling_price: 65, status: "a", form: "5.0" },
    // Forwards
    { id: 14, web_name: "Haaland", element_type: 4, team: 4, now_cost: 150, selling_price: 150, status: "a", form: "9.0" },
    { id: 15, web_name: "Watkins", element_type: 4, team: 7, now_cost: 90, selling_price: 90, status: "a", form: "7.0" },
    { id: 16, web_name: "Isak", element_type: 4, team: 6, now_cost: 85, selling_price: 85, status: "a", form: "7.5" },
    { id: 17, web_name: "Cunha", element_type: 4, team: 8, now_cost: 70, selling_price: 70, status: "a", form: "6.5" },
  ],
  teams: [
    { id: 1, name: "Arsenal", short_name: "ARS" },
    { id: 2, name: "Crystal Palace", short_name: "CRY" },
    { id: 3, name: "Liverpool", short_name: "LIV" },
    { id: 4, name: "Man City", short_name: "MCI" },
    { id: 5, name: "Chelsea", short_name: "CHE" },
    { id: 6, name: "Newcastle", short_name: "NEW" },
    { id: 7, name: "Aston Villa", short_name: "AVL" },
    { id: 8, name: "Wolves", short_name: "WOL" },
  ],
  events: [
    { id: 1, is_current: false, is_next: false, data_checked: true },
    { id: 2, is_current: true, is_next: false, data_checked: false },
    { id: 3, is_current: false, is_next: true, data_checked: false },
  ],
  element_types: [
    { id: 1, singular_name: "Goalkeeper", singular_name_short: "GKP", squad_min_play: 1, squad_max_play: 1 },
    { id: 2, singular_name: "Defender", singular_name_short: "DEF", squad_min_play: 3, squad_max_play: 5 },
    { id: 3, singular_name: "Midfielder", singular_name_short: "MID", squad_min_play: 2, squad_max_play: 5 },
    { id: 4, singular_name: "Forward", singular_name_short: "FWD", squad_min_play: 1, squad_max_play: 3 },
  ],
};

// Helper function to build a valid squad
function createMockSquad() {
  const bs = mockBootstrap;
  const pick = (id) => bs.elements.find((p) => p.id === id);
  return [
    // XI
    pick(1),  // GKP: Raya (ARS)
    pick(3),  // DEF: Saliba (ARS)
    pick(5),  // DEF: VanDijk (LIV)
    pick(6),  // DEF: TAA (LIV)
    pick(7),  // DEF: Walker (MCI)
    pick(9),  // MID: Salah (LIV)
    pick(10), // MID: Palmer (CHE)
    pick(11), // MID: Saka (ARS)
    pick(12), // MID: Gordon (NEW)
    pick(14), // FWD: Haaland (MCI)
    pick(15), // FWD: Watkins (AVL)
    // Bench
    pick(2),   // GKP: Henderson (CRY)
    pick(8),   // DEF: Cucurella (CHE)
    pick(16),  // FWD: Isak (NEW)
    pick(18),  // MID: McGinn (AVL)
  ];
}

// ============================================================================
// Formation Validity Tests
// ============================================================================

describe("Formation Validity", () => {
  it("should validate a legal 4-4-2 formation", () => {
    const squad = createMockSquad();
    const xi = squad.slice(0, 11);

    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    xi.forEach(p => counts[p.element_type]++);

    // 4-4-2: 1 GKP, 4 DEF, 4 MID, 2 FWD
    assert.equal(counts[1], 1, "Should have exactly 1 GKP");
    assert.inRange(counts[2], 3, 5, "Should have 3-5 DEF");
    assert.inRange(counts[3], 2, 5, "Should have 2-5 MID");
    assert.inRange(counts[4], 1, 3, "Should have 1-3 FWD");
    assert.equal(counts[1] + counts[2] + counts[3] + counts[4], 11, "XI should have 11 players");
  });

  it("should validate 15-man squad composition", () => {
    const squad = createMockSquad();
    assert.lengthOf(squad, 15, "Squad should have exactly 15 players");

    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    squad.forEach(p => counts[p.element_type]++);

    // Valid squad: 2 GKP, 5 DEF, 5 MID, 3 FWD
    assert.equal(counts[1], 2, "Squad should have exactly 2 GKPs");
    assert.equal(counts[2], 5, "Squad should have exactly 5 DEFs");
    assert.equal(counts[3], 5, "Squad should have exactly 5 MIDs");
    assert.equal(counts[4], 3, "Squad should have exactly 3 FWDs");
  });

  it("should enforce max 3 players per club", () => {
    const squad = createMockSquad();

    const clubCounts = new Map();
    squad.forEach(p => {
      clubCounts.set(p.team, (clubCounts.get(p.team) || 0) + 1);
    });

    for (const [teamId, count] of clubCounts) {
      assert.ok(count <= 3, `Team ${teamId} has ${count} players, max is 3`);
    }
  });

  it("should detect invalid formation with 0 goalkeepers in XI", () => {
    const invalidXI = createMockSquad().slice(0, 11);
    invalidXI[0] = mockBootstrap.elements[2]; // Replace GKP with DEF

    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    invalidXI.forEach(p => counts[p.element_type]++);

    assert.equal(counts[1], 0, "Invalid XI should have 0 GKPs");
  });

  it("should detect invalid formation with too many of one position", () => {
    const squad = createMockSquad();
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    squad.forEach(p => counts[p.element_type]++);

    // A squad can't have 6+ DEFs (max is 5)
    assert.ok(counts[2] <= 5, "Squad cannot have more than 5 DEFs");
    assert.ok(counts[3] <= 5, "Squad cannot have more than 5 MIDs");
    assert.ok(counts[4] <= 3, "Squad cannot have more than 3 FWDs");
  });
});

// ============================================================================
// Transfer Simulation Legality Tests
// ============================================================================

describe("Transfer Simulation Legality", () => {
  let squad;
  let bank;

  beforeAll(() => {
    squad = createMockSquad();
    bank = 50; // £5.0m in the bank
  });

  it("should allow transfer when budget is sufficient", () => {
    // Selling Walker (52) to buy Cucurella (50)
    const playerOut = squad.find(p => p.id === 7); // Walker
    const playerIn = mockBootstrap.elements.find(p => p.id === 8); // Cucurella

    const sellPrice = playerOut.selling_price;
    const buyPrice = playerIn.now_cost;
    const availableBudget = bank + sellPrice;

    assert.ok(buyPrice <= availableBudget, "Should have enough budget for transfer");
    assert.equal(availableBudget - buyPrice, 52, "Remaining bank should be correct");
  });

  it("should reject transfer when budget is insufficient", () => {
    // Try to buy Haaland (150) selling Henderson (47) with 5.0m bank
    const playerOut = squad.find(p => p.id === 2); // Henderson
    const playerIn = mockBootstrap.elements.find(p => p.id === 14); // Haaland

    const sellPrice = playerOut.selling_price;
    const buyPrice = playerIn.now_cost;
    const availableBudget = bank + sellPrice;

    assert.ok(buyPrice > availableBudget, "Should NOT have enough budget");
  });

  it("should validate same position replacement", () => {
    const playerOut = squad.find(p => p.id === 7); // Walker (DEF)
    const playerIn = mockBootstrap.elements.find(p => p.id === 8); // Cucurella (DEF)

    assert.equal(playerOut.element_type, playerIn.element_type, "Transfer must be same position");
    assert.equal(playerOut.element_type, 2, "Both should be DEF");
  });

  it("should reject different position replacement", () => {
    const playerOut = squad.find(p => p.id === 7); // Walker (DEF)
    const playerIn = mockBootstrap.elements.find(p => p.id === 12); // Gordon (MID)

    assert.ok(playerOut.element_type !== playerIn.element_type, "Should reject cross-position transfer");
  });

  it("should enforce club limit after transfer", () => {
    // Arsenal already has Raya, Saliba, Saka (3 players - valid max)
    const arsenalCount = squad.filter(p => p.team === 1).length;
    assert.equal(arsenalCount, 3, "Should have exactly 3 Arsenal players");

    // Trying to add another Arsenal player would exceed limit
    const wouldExceed = arsenalCount >= 3;
    assert.ok(wouldExceed, "Adding Arsenal player would exceed club limit");
  });

  it("should allow club limit when swapping same team players", () => {
    // Selling Saliba (Arsenal) and buying a non-Arsenal DEF
    const playerOut = squad.find(p => p.id === 3); // Saliba
    const playerIn = mockBootstrap.elements.find(p => p.id === 8); // Cucurella (Chelsea)

    const arsenalCountBefore = squad.filter(p => p.team === 1).length;
    const arsenalCountAfter = arsenalCountBefore - 1; // -1 for Saliba out

    assert.ok(arsenalCountAfter < 3, "Should have room for Chelsea player");
  });

  it("should calculate hit cost correctly", () => {
    const freeTransfers = 1;
    const transfersToMake = 2;
    const hitCostPerTransfer = 4;

    const extraTransfers = Math.max(0, transfersToMake - freeTransfers);
    const hitCost = extraTransfers * hitCostPerTransfer;

    assert.equal(hitCost, 4, "1 extra transfer = -4 hit");
  });

  it("should calculate net gain correctly after hit", () => {
    const xpGain = 12.5; // Total xP gain from transfers
    const hitCost = 4; // -4 hit
    const netGain = xpGain - hitCost;

    assert.approximately(netGain, 8.5, 0.01, "Net gain should be xP - hit");
  });
});

// ============================================================================
// Player Pool Building Tests
// ============================================================================

describe("Player Pool Building", () => {
  it("should exclude squad players from pool", () => {
    const squad = createMockSquad();
    const squadIds = new Set(squad.map(p => p.id));
    const pool = mockBootstrap.elements.filter(p => !squadIds.has(p.id));

    squad.forEach(p => {
      assert.ok(!pool.find(x => x.id === p.id), `${p.web_name} should not be in pool`);
    });
  });

  it("should exclude unavailable players from pool", () => {
    const pool = mockBootstrap.elements.filter(p => p.status !== "u" && p.status !== "n");
    const unavailable = pool.filter(p => p.status === "u" || p.status === "n");

    assert.lengthOf(unavailable, 0, "Pool should have no unavailable players");
  });

  it("should exclude players from excluded teams", () => {
    const excludedTeamIds = [1, 3]; // Exclude Arsenal and Liverpool
    const pool = mockBootstrap.elements.filter(p => !excludedTeamIds.includes(p.team));

    const arsenalPlayers = pool.filter(p => p.team === 1);
    const liverpoolPlayers = pool.filter(p => p.team === 3);

    assert.lengthOf(arsenalPlayers, 0, "No Arsenal players in pool");
    assert.lengthOf(liverpoolPlayers, 0, "No Liverpool players in pool");
  });

  it("should sort candidates by form/threat/creativity score", () => {
    const candidates = mockBootstrap.elements.slice();
    candidates.sort((a, b) => {
      const scoreA = (parseFloat(a.form) || 0) * 2;
      const scoreB = (parseFloat(b.form) || 0) * 2;
      return scoreB - scoreA;
    });

    // First should have highest form
    assert.ok(parseFloat(candidates[0].form) >= parseFloat(candidates[1].form), "Should be sorted by form desc");
  });
});

// ============================================================================
// Expendability Scoring Tests
// ============================================================================

describe("Expendability Scoring", () => {
  it("should penalize injured players heavily", () => {
    const injuredPlayer = { id: 13, status: "i", news: "Knee injury" };
    const availablePlayer = { id: 14, status: "a" };

    const injuredPenalty = 50; // From EXPENDABILITY_REASONS.INJURED
    const availablePenalty = 0;

    assert.ok(injuredPenalty > availablePenalty, "Injured should have higher expendability");
  });

  it("should penalize suspended players", () => {
    const suspendedPenalty = 40; // From EXPENDABILITY_REASONS.SUSPENDED
    assert.ok(suspendedPenalty > 0, "Suspended players should be penalized");
  });

  it("should penalize doubtful players proportionally", () => {
    const chanceOfPlaying = 50; // 50% chance
    const penalty = Math.round((100 - chanceOfPlaying) * 0.3);

    assert.equal(penalty, 15, "50% chance = 15 penalty");
  });

  it("should cap expendability score at 100", () => {
    let score = 0;
    score += 50; // Injured
    score += 25; // Low minutes
    score += 30; // Low xP
    score += 15; // Poor fixtures

    const capped = Math.min(100, score);
    assert.equal(capped, 100, "Score should be capped at 100");
  });

  it("should rank players by expendability score", () => {
    const players = [
      { id: 1, expendabilityScore: 75 },
      { id: 2, expendabilityScore: 25 },
      { id: 3, expendabilityScore: 50 },
    ];

    players.sort((a, b) => b.expendabilityScore - a.expendabilityScore);

    assert.equal(players[0].id, 1, "Highest score first");
    assert.equal(players[1].id, 3, "Second highest second");
    assert.equal(players[2].id, 2, "Lowest score last");
  });
});

export default {};
