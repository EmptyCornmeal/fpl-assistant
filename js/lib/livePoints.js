// js/lib/livePoints.js
// Utility functions for calculating live GW points from picks + eventLive data
// Correctly handles captain multipliers, triple captain, and bench boost chips

/**
 * Calculate live GW points for a team's picks using eventLive data
 *
 * @param {Object} picksData - The picks response from /entry/{id}/event/{gw}/picks
 * @param {Map|Object} liveDataMap - Map of player ID -> live stats from /event/{gw}/live
 * @returns {Object} { total: number, breakdown: Array, chip: string|null }
 */
export function calculateLiveGwPoints(picksData, liveDataMap) {
  if (!picksData?.picks || !liveDataMap) {
    return { total: 0, breakdown: [], chip: null };
  }

  const picks = picksData.picks || [];
  const activeChip = picksData.active_chip || null;

  // Determine chip modifiers
  const isTripleCaptain = activeChip === '3xc';
  const isBenchBoost = activeChip === 'bboost';

  // Convert to Map if needed
  const liveMap = liveDataMap instanceof Map
    ? liveDataMap
    : new Map(Object.entries(liveDataMap).map(([k, v]) => [Number(k), v]));

  const breakdown = [];
  let total = 0;

  for (const pick of picks) {
    const playerId = pick.element;
    const position = pick.position; // 1-11 = starters, 12-15 = bench
    const isCaptain = pick.is_captain;
    const isViceCaptain = pick.is_vice_captain;

    // Get live stats for this player
    const liveData = liveMap.get(playerId);
    const stats = liveData?.stats || liveData || {};
    const basePoints = stats.total_points ?? 0;

    // Calculate multiplier
    let multiplier = 0;

    if (position <= 11) {
      // Starting XI
      multiplier = 1;

      if (isCaptain) {
        multiplier = isTripleCaptain ? 3 : 2;
      }
    } else {
      // Bench - only counts with bench boost
      multiplier = isBenchBoost ? 1 : 0;
    }

    const points = basePoints * multiplier;
    total += points;

    breakdown.push({
      playerId,
      position,
      isCaptain,
      isViceCaptain,
      basePoints,
      multiplier,
      points,
    });
  }

  return {
    total,
    breakdown,
    chip: activeChip,
  };
}

/**
 * Build a live data map from eventLive API response
 *
 * @param {Object} eventLiveData - Response from /event/{gw}/live
 * @returns {Map} Map of player ID -> stats object
 */
export function buildLiveDataMap(eventLiveData) {
  if (!eventLiveData?.elements) {
    return new Map();
  }

  return new Map(
    eventLiveData.elements.map(el => [
      el.id,
      {
        stats: el.stats || {},
        explain: el.explain || [],
      }
    ])
  );
}

/**
 * Get points for a single player from live data with optional multiplier
 *
 * @param {number} playerId - Player element ID
 * @param {Map} liveMap - Live data map from buildLiveDataMap
 * @param {number} multiplier - Points multiplier (1 = normal, 2 = captain, 3 = triple captain, 0 = bench)
 * @returns {number} Points for this player
 */
export function getPlayerLivePoints(playerId, liveMap, multiplier = 1) {
  const liveData = liveMap.get(playerId);
  const basePoints = liveData?.stats?.total_points ?? 0;
  return basePoints * multiplier;
}

/**
 * Check if the gameweek is currently live (in progress)
 *
 * @param {Object} event - Event object from bootstrap
 * @returns {boolean}
 */
export function isGameweekLive(event) {
  if (!event) return false;
  return event.is_current && !event.data_checked;
}

/**
 * Get the multiplier for a pick based on position and chips
 *
 * @param {Object} pick - Pick object from picks response
 * @param {string|null} activeChip - Active chip (e.g., '3xc', 'bboost')
 * @returns {number} Multiplier for this pick
 */
export function getPickMultiplier(pick, activeChip) {
  const isTripleCaptain = activeChip === '3xc';
  const isBenchBoost = activeChip === 'bboost';
  const position = pick.position;
  const isCaptain = pick.is_captain;

  if (position <= 11) {
    if (isCaptain) {
      return isTripleCaptain ? 3 : 2;
    }
    return 1;
  } else {
    return isBenchBoost ? 1 : 0;
  }
}
