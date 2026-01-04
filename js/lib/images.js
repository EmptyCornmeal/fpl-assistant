// js/lib/images.js
// Centralized helpers for player photos and team badges.
// Routes images through the configured API base (via the Cloudflare Worker)
// and falls back to a shared placeholder without spamming console errors.

import { getApiBase } from "../config.js";
import { log } from "../logger.js";

// Resolve placeholder relative to this module so it works on GitHub Pages subpaths
export const PLAYER_PLACEHOLDER_SRC = new URL("../../assets/placeholder-player.svg", import.meta.url).href;
const IMAGE_PROXY_SEGMENT = "/player-photo";
const RETRY_PARAM = "retry";

function cleanPhotoId(photoId) {
  if (!photoId) return null;
  return String(photoId).replace(/\.(png|jpg)$/i, "").replace(/^p/, "");
}

function buildApiBase(photoId) {
  const cleanId = cleanPhotoId(photoId);
  if (!cleanId) return null;
  const apiBase = getApiBase();
  if (!apiBase) return null;
  const normalized = apiBase.replace(/\/+$/, "");
  return `${normalized}${IMAGE_PROXY_SEGMENT}/${cleanId}`;
}

export function getTeamBadgeUrl(teamCode, size = 70) {
  if (!teamCode) return null;
  const apiBase = getApiBase();
  if (!apiBase) return null;
  const root = apiBase.replace(/\/?api\/?$/, "").replace(/\/+$/, "");
  return `${root}/img/badge/${size}/t${teamCode}.png`;
}

export function applyImageFallback(img, placeholder = PLAYER_PLACEHOLDER_SRC) {
  if (!img) return img;

  const fallback = () => {
    const errorCount = Number(img.dataset.errorCount || 0);
    if (errorCount >= 1) {
      if (img.dataset.fallbackApplied === "true") return;
      img.dataset.fallbackApplied = "true";
      img.src = placeholder;
      return;
    }

    img.dataset.errorCount = String(errorCount + 1);
    const url = new URL(img.src, window.location.origin);
    url.searchParams.set(RETRY_PARAM, errorCount + 1);
    img.src = url.toString();
  };

  img.addEventListener("error", fallback);
  return img;
}

export function hideOnError(img) {
  if (!img) return img;
  const hide = () => { img.style.display = "none"; };
  img.addEventListener("error", hide, { once: true });
  return img;
}

export function getPlayerImage(photoId) {
  const apiUrl = buildApiBase(photoId);
  if (!apiUrl) {
    log.debug?.("Image proxy base unavailable; using placeholder");
    return PLAYER_PLACEHOLDER_SRC;
  }
  return `${apiUrl}.png`;
}
