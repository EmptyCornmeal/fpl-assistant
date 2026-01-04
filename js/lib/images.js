// js/lib/images.js
// Centralized helpers for player photos and team badges.
// Routes images through the configured API base (via the Cloudflare Worker)
// and falls back to a shared placeholder without spamming console errors.

import { getApiBase } from "../config.js";
import { log } from "../logger.js";

// Resolve placeholder relative to this module so it works on GitHub Pages subpaths
export const PLAYER_PLACEHOLDER_SRC = new URL("../../assets/placeholder-player.svg", import.meta.url).href;
const IMAGE_PROXY_SEGMENT = "/img";
const LOCAL_PLAYER_DIR = "../../assets/players";

function cleanPhotoId(photoId) {
  if (!photoId) return null;
  return String(photoId).replace(/\.(png|jpg)$/i, "").replace(/^p/, "");
}

function resolveApiBase() {
  const resolved = getApiBase();
  if (resolved) return resolved.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location) {
    try {
      return new URL("./api", window.location.href).href.replace(/\/+$/, "");
    } catch {
      return null;
    }
  }
  return null;
}

function resolveProxyBase() {
  const apiBase = resolveApiBase();
  if (!apiBase) return null;

  // Strip trailing /api (default worker path) to reach the root
  const root = apiBase.replace(/\/?api\/?$/, "").replace(/\/+$/, "");
  if (!root) return null;
  return `${root}${IMAGE_PROXY_SEGMENT}`;
}

function getLocalPlayerAsset(cleanId) {
  if (!cleanId) return null;
  try {
    return new URL(`${LOCAL_PLAYER_DIR}/p${cleanId}.png`, import.meta.url).href;
  } catch (err) {
    log.debug?.("Local player asset resolution failed", err);
    return null;
  }
}

export function getPlayerImageSources(photoId, size = "110x140") {
  const cleanId = cleanPhotoId(photoId);
  if (!cleanId) {
    return { src: PLAYER_PLACEHOLDER_SRC, fallback: PLAYER_PLACEHOLDER_SRC };
  }

  const apiBase = resolveApiBase();
  const src = apiBase ? `${apiBase.replace(/\/+$/, "")}/player-photo/${cleanId}` : PLAYER_PLACEHOLDER_SRC;
  const fallback = getLocalPlayerAsset(cleanId) || PLAYER_PLACEHOLDER_SRC;

  return { src, fallback, cleanId, size };
}

export function getPlayerImage(photoId, size = "110x140") {
  const { src } = getPlayerImageSources(photoId, size);
  return src;
}

export function getTeamBadgeUrl(teamCode, size = 70) {
  if (!teamCode) return null;
  const proxyBase = resolveProxyBase();
  if (!proxyBase) return null;
  return `${proxyBase}/badge/${size}/t${teamCode}.png`;
}

/**
 * Apply graceful fallback to an <img> element when the worker returns 404 or the image is unreachable.
 * We attempt a HEAD request to distinguish 404 from transient failures; only 404 guarantees the local
 * fallback swap. All other failures fall back to the placeholder so players never render broken avatars.
 */
export function applyImageFallback(img, primaryFallback = PLAYER_PLACEHOLDER_SRC, secondaryFallback = null) {
  if (!img) return img;

  const fallbacks = [secondaryFallback, primaryFallback].filter(Boolean);
  const avatarLabel = img.dataset.avatarLabel || "";
  const avatarFallback = buildAvatarDataUrl(avatarLabel);
  if (avatarFallback) fallbacks.push(avatarFallback);

  let idx = 0;
  let validating = false;

  const fallback = async () => {
    if (img.dataset.fallbackApplied === "true") return;
    if (idx >= fallbacks.length && validating) return;
    if (validating) return;

    validating = true;
    try {
      const res = await fetch(img.currentSrc || img.src, { method: "HEAD", cache: "no-store" });
      if (res.status === 404 && fallbacks[idx]) {
        img.src = fallbacks[idx++];
        return;
      }
      if (!res.ok && fallbacks[idx]) {
        img.src = fallbacks[idx++];
        return;
      }
    } catch {
      if (fallbacks[idx]) {
        img.src = fallbacks[idx++];
        return;
      }
    } finally {
      validating = false;
      if (!fallbacks[idx]) img.dataset.fallbackApplied = "true";
    }
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

function buildAvatarDataUrl(label = "") {
  const initials = (label || "")
    .split(" ")
    .filter(Boolean)
    .map((s) => s[0]?.toUpperCase())
    .slice(0, 2)
    .join("") || "PL";
  const colors = ["#0EA5E9", "#8B5CF6", "#10B981", "#F59E0B", "#EC4899"];
  const pick = initials.charCodeAt(0) % colors.length;
  const bg = colors[pick];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'>
    <defs>
      <linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'>
        <stop stop-color='${bg}' offset='0%'/>
        <stop stop-color='#0f172a' offset='100%'/>
      </linearGradient>
    </defs>
    <rect width='120' height='120' rx='16' fill='url(#g)'/>
    <circle cx='60' cy='48' r='24' fill='rgba(255,255,255,0.16)'/>
    <rect x='32' y='76' width='56' height='32' rx='12' fill='rgba(255,255,255,0.08)'/>
    <text x='60' y='70' text-anchor='middle' fill='#E2E8F0' font-family='Inter, sans-serif' font-size='28' font-weight='700'>${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
