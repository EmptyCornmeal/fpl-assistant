// js/api/fplDerived.js
// Derived metrics for FPL decision-making with explanations

/**
 * Minutes Reliability Score (0–100)
 * Measures how consistently a player plays 60+ minutes
 *
 * Why it matters:
 * - Players need 60+ minutes to earn bonus points and maximize returns
 * - Rotation risk is a major factor in FPL success
 * - Consistent starters provide predictable value
 */
export function minutesReliability(player, history = []) {
  const explanation = {
    name: "Minutes Reliability",
    shortDesc: "How consistently this player starts and plays 60+ minutes",
    calculation: "Based on % of available matches where player played 60+ mins, weighted by recency",
    why: "Players who regularly play 60+ minutes maximize point potential and reduce rotation risk",
  };

  if (!history || history.length === 0) {
    return { score: null, explanation, details: "No match history available" };
  }

  // Use last 10 gameweeks for relevance
  const recentHistory = history.slice(-10);
  const totalMatches = recentHistory.length;

  if (totalMatches === 0) {
    return { score: null, explanation, details: "No recent matches" };
  }

  // Count matches with 60+ minutes
  const fullMatches = recentHistory.filter(m => m.minutes >= 60).length;
  const partialMatches = recentHistory.filter(m => m.minutes > 0 && m.minutes < 60).length;
  const missedMatches = recentHistory.filter(m => m.minutes === 0).length;

  // Weighted score: full = 1, partial = 0.3, missed = 0
  const rawScore = ((fullMatches * 1) + (partialMatches * 0.3)) / totalMatches;

  // Apply recency weighting (most recent games matter more)
  let weightedScore = 0;
  let totalWeight = 0;
  recentHistory.forEach((match, idx) => {
    const weight = 1 + (idx * 0.2); // More recent = higher weight
    const matchScore = match.minutes >= 60 ? 1 : (match.minutes > 0 ? 0.3 : 0);
    weightedScore += matchScore * weight;
    totalWeight += weight;
  });

  const score = Math.round((weightedScore / totalWeight) * 100);

  return {
    score,
    explanation,
    details: {
      matchesAnalyzed: totalMatches,
      fullMatches,
      partialMatches,
      missedMatches,
      trend: getTrend(recentHistory.map(m => m.minutes >= 60 ? 1 : 0)),
    },
  };
}

/**
 * Fixture Ease Score (0–100)
 * Rates upcoming fixtures based on FDR and home/away
 *
 * Why it matters:
 * - Easier fixtures = higher expected points
 * - Key for transfer planning and captain selection
 * - FDR 2 fixtures historically yield 30%+ more points than FDR 5
 */
export function fixtureEase(upcomingFixtures, lookAhead = 5) {
  const explanation = {
    name: "Fixture Ease",
    shortDesc: "How favorable the next fixtures are based on difficulty rating",
    calculation: "Weighted average of FDR (1-5) for next N fixtures, with home advantage",
    why: "Easier fixtures (lower FDR) correlate with higher expected points. Home games add ~0.5 points on average",
  };

  if (!upcomingFixtures || upcomingFixtures.length === 0) {
    return { score: null, explanation, details: "No upcoming fixtures" };
  }

  const fixtures = upcomingFixtures.slice(0, lookAhead);

  // FDR scoring: 1 = easiest (100 pts), 5 = hardest (0 pts)
  // Home bonus: +10 points
  let totalScore = 0;
  let totalWeight = 0;

  const fixtureBreakdown = fixtures.map((fix, idx) => {
    const weight = 1 - (idx * 0.1); // First fixture matters most
    const fdrScore = ((5 - fix.difficulty) / 4) * 100; // Convert FDR 1-5 to 0-100
    const homeBonus = fix.isHome ? 10 : 0;
    const adjustedScore = Math.min(100, fdrScore + homeBonus);

    totalScore += adjustedScore * weight;
    totalWeight += weight;

    return {
      opponent: fix.opponent,
      difficulty: fix.difficulty,
      isHome: fix.isHome,
      score: Math.round(adjustedScore),
    };
  });

  const score = Math.round(totalScore / totalWeight);

  return {
    score,
    explanation,
    details: {
      fixturesAnalyzed: fixtures.length,
      breakdown: fixtureBreakdown,
      avgDifficulty: (fixtures.reduce((sum, f) => sum + f.difficulty, 0) / fixtures.length).toFixed(1),
    },
  };
}

/**
 * Captain Score (0–100)
 * Composite metric for captain selection
 *
 * Why it matters:
 * - Captain choice can be worth 8-20+ points per week
 * - Combines form, fixtures, and reliability
 * - Top managers get captain picks right 60%+ of the time
 */
export function captainScore(player, history = [], upcomingFixtures = []) {
  const explanation = {
    name: "Captain Score",
    shortDesc: "How suitable this player is for captaincy this week",
    calculation: "Weighted combination of: Form (40%), Fixture (30%), Minutes Reliability (20%), Ownership (10%)",
    why: "Captains earn double points. Best captains combine good form, easy fixtures, and guaranteed minutes",
  };

  // Get component scores
  const reliabilityResult = minutesReliability(player, history);
  const fixtureResult = fixtureEase(upcomingFixtures, 1); // Just next fixture for captaincy

  // Form score from recent history (goals, assists, bonus)
  const formScore = calculateFormScore(history.slice(-5));

  // Ownership consideration (differential potential)
  const ownershipScore = player.ownership
    ? (player.ownership > 30 ? 70 : 100 - player.ownership) // High ownership = safe, low = differential
    : 50;

  const components = {
    form: formScore,
    fixture: fixtureResult.score ?? 50,
    reliability: reliabilityResult.score ?? 50,
    ownership: ownershipScore,
  };

  // Weighted average
  const score = Math.round(
    (components.form * 0.4) +
    (components.fixture * 0.3) +
    (components.reliability * 0.2) +
    (components.ownership * 0.1)
  );

  return {
    score,
    explanation,
    details: {
      components,
      recommendation: score >= 80 ? "Strong captain pick" :
                      score >= 60 ? "Viable captain option" :
                      score >= 40 ? "Consider alternatives" :
                      "Not recommended for captaincy",
    },
  };
}

/**
 * Transfer Priority Score (0–100)
 * Ranks players for transfer consideration
 *
 * Why it matters:
 * - Each transfer costs 4 points (after free transfers)
 * - Prioritizing correctly maximizes points over the season
 * - Combines value, form trajectory, and fixture swing
 */
export function transferPriority(player, history = [], upcomingFixtures = [], isOwned = false) {
  const explanation = {
    name: "Transfer Priority",
    shortDesc: isOwned
      ? "How urgent it is to transfer this player OUT"
      : "How valuable it would be to transfer this player IN",
    calculation: "Considers form trajectory, fixture swing, value for money, and ownership trends",
    why: "Smart transfers maximize points. Consider fixture runs, not just single gameweeks",
  };

  // Form trajectory (improving or declining?)
  const trajectory = calculateTrajectory(history.slice(-6));

  // Fixture swing (next 5 GWs vs last 5)
  const fixtureScore = fixtureEase(upcomingFixtures, 5).score ?? 50;

  // Value assessment
  const valueScore = calculateValueScore(player);

  // Ownership momentum (rising = bandwagon, falling = sell signal)
  const ownershipMomentum = player.transfersInWeek && player.transfersOutWeek
    ? ((player.transfersInWeek - player.transfersOutWeek) / (player.transfersInWeek + player.transfersOutWeek + 1)) * 50 + 50
    : 50;

  let score;
  if (isOwned) {
    // For owned players: high score = transfer OUT
    score = Math.round(
      100 - (
        (trajectory * 0.35) +
        (fixtureScore * 0.35) +
        (valueScore * 0.15) +
        (ownershipMomentum * 0.15)
      )
    );
  } else {
    // For targets: high score = transfer IN
    score = Math.round(
      (trajectory * 0.3) +
      (fixtureScore * 0.35) +
      (valueScore * 0.2) +
      (ownershipMomentum * 0.15)
    );
  }

  return {
    score,
    explanation,
    details: {
      trajectory: trajectory > 60 ? "Improving" : trajectory < 40 ? "Declining" : "Stable",
      fixtureOutlook: fixtureScore > 60 ? "Favorable" : fixtureScore < 40 ? "Difficult" : "Mixed",
      value: valueScore > 60 ? "Good value" : valueScore < 40 ? "Overpriced" : "Fair",
      recommendation: isOwned
        ? (score >= 70 ? "Consider selling" : score >= 50 ? "Monitor" : "Hold")
        : (score >= 70 ? "Strong buy" : score >= 50 ? "Watchlist" : "Avoid"),
    },
  };
}

/**
 * Expected Points (xP) Estimate
 * Projects points for upcoming gameweek
 *
 * Note: This is a simplified model. Official FPL doesn't provide xG/xA,
 * so we estimate based on historical averages and fixture difficulty.
 */
export function expectedPoints(player, history = [], nextFixture = null) {
  const explanation = {
    name: "Expected Points (xP)",
    shortDesc: "Projected points for the upcoming gameweek",
    calculation: "Based on position baseline, recent form, and fixture difficulty adjustment",
    why: "Helps compare players objectively. More reliable over many gameweeks than single picks",
    disclaimer: "Estimate only - actual FPL points depend on real match events",
  };

  if (!history || history.length === 0) {
    return { score: null, explanation, details: "Insufficient data" };
  }

  // Position baselines (average points per game)
  const positionBaseline = {
    1: 4.0,  // GKP
    2: 4.2,  // DEF
    3: 4.5,  // MID
    4: 4.3,  // FWD
  };

  const baseline = positionBaseline[player.position] || 4.0;

  // Recent form adjustment (last 5 games)
  const recentGames = history.slice(-5);
  const avgRecent = recentGames.reduce((sum, g) => sum + g.points, 0) / recentGames.length;
  const formMultiplier = avgRecent / baseline;

  // Fixture difficulty adjustment
  let fixtureMultiplier = 1.0;
  if (nextFixture) {
    // FDR 1 = 1.3x, FDR 2 = 1.15x, FDR 3 = 1.0x, FDR 4 = 0.85x, FDR 5 = 0.7x
    fixtureMultiplier = 1.3 - ((nextFixture.difficulty - 1) * 0.15);
    if (nextFixture.isHome) fixtureMultiplier += 0.05;
  }

  // Minutes factor
  const avgMinutes = recentGames.reduce((sum, g) => sum + g.minutes, 0) / recentGames.length;
  const minutesFactor = Math.min(1, avgMinutes / 90);

  const xP = baseline * formMultiplier * fixtureMultiplier * minutesFactor;

  return {
    score: Math.round(xP * 10) / 10, // Round to 1 decimal
    explanation,
    details: {
      baseline,
      formMultiplier: formMultiplier.toFixed(2),
      fixtureMultiplier: fixtureMultiplier.toFixed(2),
      minutesFactor: minutesFactor.toFixed(2),
      confidence: recentGames.length >= 5 ? "Medium" : "Low",
    },
  };
}


// ============ Helper Functions ============

/**
 * Calculate form score from recent history
 */
function calculateFormScore(history) {
  if (!history || history.length === 0) return 50;

  const maxPoints = history.length * 15; // Theoretical max ~15 pts/game for premium
  const actualPoints = history.reduce((sum, g) => sum + g.points, 0);

  // Normalize to 0-100
  return Math.min(100, Math.round((actualPoints / maxPoints) * 150));
}

/**
 * Calculate form trajectory (improving/declining)
 */
function calculateTrajectory(history) {
  if (!history || history.length < 3) return 50;

  const firstHalf = history.slice(0, Math.floor(history.length / 2));
  const secondHalf = history.slice(Math.floor(history.length / 2));

  const firstAvg = firstHalf.reduce((sum, g) => sum + g.points, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, g) => sum + g.points, 0) / secondHalf.length;

  // Normalize difference to 0-100 scale
  const diff = secondAvg - firstAvg;
  return Math.max(0, Math.min(100, 50 + (diff * 10)));
}

/**
 * Calculate value score (points per million)
 */
function calculateValueScore(player) {
  if (!player.price || !player.form) return 50;

  // Points per million this season
  const ppm = player.totalPoints / (player.price / 10);

  // Good value = 15+ points per million, poor = under 10
  return Math.max(0, Math.min(100, (ppm - 5) * 10));
}

/**
 * Get trend direction from binary array
 */
function getTrend(values) {
  if (values.length < 3) return "Insufficient data";

  const firstHalf = values.slice(0, Math.floor(values.length / 2));
  const secondHalf = values.slice(Math.floor(values.length / 2));

  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  if (secondAvg > firstAvg + 0.1) return "Improving";
  if (secondAvg < firstAvg - 0.1) return "Declining";
  return "Stable";
}


// ============ Batch Operations ============

/**
 * Calculate all derived metrics for a player
 */
export function allMetrics(player, history = [], upcomingFixtures = []) {
  return {
    minutesReliability: minutesReliability(player, history),
    fixtureEase: fixtureEase(upcomingFixtures, 5),
    captainScore: captainScore(player, history, upcomingFixtures),
    transferPriority: transferPriority(player, history, upcomingFixtures, false),
    expectedPoints: expectedPoints(player, history, upcomingFixtures[0]),
  };
}

/**
 * Get metric explanations for help/documentation
 */
export function getMetricExplanations() {
  return {
    minutesReliability: {
      name: "Minutes Reliability",
      shortDesc: "How consistently this player starts and plays 60+ minutes",
      fullDesc: "Measures rotation risk by analyzing the percentage of available matches where a player completed 60+ minutes. Recent games are weighted more heavily. A score of 90+ indicates a nailed-on starter, while below 60 suggests significant rotation risk.",
      interpretation: {
        "90-100": "Nailed starter - minimal rotation risk",
        "70-89": "Regular starter with occasional rest",
        "50-69": "Rotation risk - monitor team news",
        "0-49": "Heavy rotation or injury concerns",
      },
    },
    fixtureEase: {
      name: "Fixture Ease",
      shortDesc: "How favorable upcoming fixtures are",
      fullDesc: "Converts FPL's Fixture Difficulty Rating (FDR 1-5) into a 0-100 score. Accounts for home advantage (+10 points) and weights near-term fixtures more heavily. Historical data shows FDR 2 fixtures yield ~30% more points than FDR 5.",
      interpretation: {
        "80-100": "Excellent run - prioritize these players",
        "60-79": "Good fixtures - expect decent returns",
        "40-59": "Mixed fixtures - assess form carefully",
        "0-39": "Difficult run - consider alternatives",
      },
    },
    captainScore: {
      name: "Captain Score",
      shortDesc: "Suitability for captaincy",
      fullDesc: "Composite metric combining Form (40%), Fixture (30%), Minutes Reliability (20%), and Ownership (10%). Designed to identify the optimal captain choice each gameweek. High-ownership options are considered 'safe', while differentials can swing rank.",
      interpretation: {
        "80-100": "Strong captain pick - high confidence",
        "60-79": "Viable option - solid choice",
        "40-59": "Risky - consider alternatives",
        "0-39": "Not recommended for captaincy",
      },
    },
    transferPriority: {
      name: "Transfer Priority",
      shortDesc: "Urgency of transfer action",
      fullDesc: "Ranks players for transfer decisions by analyzing form trajectory, fixture swing (next 5 vs previous 5), value for money, and ownership trends. For owned players, high score = sell signal. For targets, high score = buy signal.",
      interpretation: {
        "80-100": "Urgent action recommended",
        "60-79": "Worth considering for next transfer",
        "40-59": "Monitor situation",
        "0-39": "No immediate action needed",
      },
    },
    expectedPoints: {
      name: "Expected Points (xP)",
      shortDesc: "Projected gameweek points",
      fullDesc: "Estimates likely points for the next gameweek based on position baseline, recent form, fixture difficulty, and minutes reliability. Note: This is a simplified projection without access to underlying xG/xA data.",
      interpretation: {
        "8+": "Premium performer - strong returns expected",
        "5-8": "Solid returns likely",
        "3-5": "Modest expectation",
        "0-3": "Low upside this week",
      },
    },
  };
}

export default {
  minutesReliability,
  fixtureEase,
  captainScore,
  transferPriority,
  expectedPoints,
  allMetrics,
  getMetricExplanations,
};
