// js/lib/images.js
// Centralized helpers for player photos and team badges.
// Uses Premier League CDN directly for reliable image loading.

import { log } from "../logger.js";

// Resolve placeholder relative to this module so it works on GitHub Pages subpaths
export const PLAYER_PLACEHOLDER_SRC = new URL("../../assets/placeholder-player.svg", import.meta.url).href;
export const TEAM_PLACEHOLDER_SRC = new URL("../../assets/placeholder-team.svg", import.meta.url).href;

// Premier League CDN base URLs
const PL_CDN_BASE = "https://resources.premierleague.com/premierleague";
const PLAYER_PHOTO_PATH = "/photos/players/110x140";
const TEAM_BADGE_PATH = "/badges";

/**
 * Extract the Opta/PL code from the FPL photo field
 * FPL API returns photo as "36903.jpg" - we need just "36903"
 *
 * @param {string} photoId - The photo field from FPL API (e.g., "36903.jpg" or "p36903.png")
 * @returns {string|null} The cleaned photo code, or null if invalid
 */
function cleanPhotoCode(photoId) {
  if (!photoId) return null;
  // Remove extension (.jpg, .png) and any leading 'p' prefix
  return String(photoId).replace(/\.(png|jpg)$/i, "").replace(/^p/, "");
}

/**
 * Get the Premier League CDN URL for a player photo
 *
 * @param {string} photoId - The photo field from FPL API (e.g., "36903.jpg")
 * @returns {string} The full CDN URL for the player image, or placeholder if invalid
 */
export function getPlayerImage(photoId) {
  const code = cleanPhotoCode(photoId);
  if (!code) {
    log.debug?.("Invalid photo ID; using placeholder");
    return PLAYER_PLACEHOLDER_SRC;
  }
  // Premier League CDN format: /photos/players/110x140/p{code}.png
  return `${PL_CDN_BASE}${PLAYER_PHOTO_PATH}/p${code}.png`;
}

/**
 * Get the Premier League CDN URL for a team badge
 *
 * @param {number} teamCode - The team's code field from FPL API (e.g., 3 for Arsenal)
 * @param {number} size - Badge size (40, 70, 100, etc.) - defaults to 70
 * @returns {string|null} The full CDN URL for the team badge, or null if invalid
 */
export function getTeamBadgeUrl(teamCode, size = 70) {
  if (!teamCode) return null;
  // Premier League CDN format: /badges/{size}/t{code}.png or /badges/t{code}.svg
  // Using sized PNG for consistency
  return `${PL_CDN_BASE}${TEAM_BADGE_PATH}/${size}/t${teamCode}.png`;
}

/**
 * Get the Premier League CDN URL for a team badge (SVG version - higher quality)
 *
 * @param {number} teamCode - The team's code field from FPL API
 * @returns {string|null} The full CDN URL for the team badge SVG
 */
export function getTeamBadgeSvg(teamCode) {
  if (!teamCode) return null;
  return `${PL_CDN_BASE}${TEAM_BADGE_PATH}/t${teamCode}.svg`;
}

/**
 * Apply fallback handling to an image element
 * On first error: try once more with cache-bust
 * On second error: replace with placeholder
 *
 * @param {HTMLImageElement} img - The image element to protect
 * @param {string} placeholder - URL to use as fallback (defaults to player placeholder)
 * @returns {HTMLImageElement} The same image element for chaining
 */
export function applyImageFallback(img, placeholder = PLAYER_PLACEHOLDER_SRC) {
  if (!img) return img;

  const fallback = () => {
    const errorCount = Number(img.dataset.errorCount || 0);
    if (errorCount >= 1) {
      // Already tried once, apply placeholder
      if (img.dataset.fallbackApplied === "true") return;
      img.dataset.fallbackApplied = "true";
      img.src = placeholder;
      return;
    }

    // First error: try with cache-bust query param
    img.dataset.errorCount = String(errorCount + 1);
    try {
      const url = new URL(img.src, window.location.origin);
      url.searchParams.set("retry", errorCount + 1);
      img.src = url.toString();
    } catch {
      // If URL parsing fails, go straight to placeholder
      img.dataset.fallbackApplied = "true";
      img.src = placeholder;
    }
  };

  img.addEventListener("error", fallback);
  return img;
}

/**
 * Hide an image element on load error (for optional decorative images)
 *
 * @param {HTMLImageElement} img - The image element
 * @returns {HTMLImageElement} The same image element for chaining
 */
export function hideOnError(img) {
  if (!img) return img;
  const hide = () => { img.style.display = "none"; };
  img.addEventListener("error", hide, { once: true });
  return img;
}

/**
 * Legacy alias for getPlayerImage (for backwards compatibility)
 * @deprecated Use getPlayerImage instead
 */
export const getPlayerPhotoUrl = getPlayerImage;
