// js/lib/images.js
// Centralized helpers for player photos and team badges.
// Routes images through the configured API base (via the Cloudflare Worker)
// and falls back to a shared placeholder without spamming console errors.

import { getApiBase } from "../config.js";
import { log } from "../logger.js";

// Resolve placeholder relative to this module so it works on GitHub Pages subpaths
export const PLAYER_PLACEHOLDER_SRC = new URL("../../assets/placeholder-player.svg", import.meta.url).href;
const IMAGE_PROXY_SEGMENT = "/img";

function cleanPhotoId(photoId) {
  if (!photoId) return null;
  return String(photoId).replace(/\.(png|jpg)$/i, "").replace(/^p/, "");
}

function resolveProxyBase() {
  const apiBase = getApiBase();
  if (!apiBase) return null;

  // Strip trailing /api (default worker path) to reach the root
  const root = apiBase.replace(/\/?api\/?$/, "").replace(/\/+$/, "");
  if (!root) return null;
  return `${root}${IMAGE_PROXY_SEGMENT}`;
}

export function getPlayerImage(photoId, size = "110x140") {
  const cleanId = cleanPhotoId(photoId);
  if (!cleanId) return PLAYER_PLACEHOLDER_SRC;

  const proxyBase = resolveProxyBase();
  if (!proxyBase) {
    log.debug?.("Image proxy base unavailable; using placeholder");
    return PLAYER_PLACEHOLDER_SRC;
  }

  return `${proxyBase}/player/${size}/p${cleanId}.png`;
}

export function getTeamBadgeUrl(teamCode, size = 70) {
  if (!teamCode) return null;
  const proxyBase = resolveProxyBase();
  if (!proxyBase) return null;
  return `${proxyBase}/badge/${size}/t${teamCode}.png`;
}

export function applyImageFallback(img, placeholder = PLAYER_PLACEHOLDER_SRC) {
  if (!img) return img;

  const fallback = () => {
    if (img.dataset.fallbackApplied === "true") return;
    img.dataset.fallbackApplied = "true";
    img.src = placeholder;
  };

  img.addEventListener("error", fallback, { once: true });
  return img;
}

export function hideOnError(img) {
  if (!img) return img;
  const hide = () => { img.style.display = "none"; };
  img.addEventListener("error", hide, { once: true });
  return img;
}
