// js/config.js
// Centralized API base resolution with override + fallback support.
// Resolution order:
//   1) window.__FPL_API_BASE__ (runtime injection)
//   2) localStorage "fpl.apiBase"
//   3) same-origin /api
//   4) last-resort worker host if same-origin is clearly not viable

const STORAGE_KEY = "fpl.apiBase";
const FALLBACK_WORKER = "https://fpl-proxy.myles-fpl-proxy.workers.dev/api";
let cachedBase = null;

function normalize(base) {
  if (!base) return null;
  try {
    const url = new URL(base, typeof window !== "undefined" ? window.location.origin : undefined);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function looksSameOriginViable() {
  if (typeof window === "undefined") return false;
  const { location } = window;
  if (!location) return false;

  // GitHub Pages and file:// won't have a backing /api route without a proxy
  if (location.protocol === "file:") return false;
  if (location.hostname.endsWith("github.io")) return false;
  return true;
}

function readLocalOverride() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setApiBaseOverride(value) {
  const normalized = normalize(value);
  if (!normalized) return null;
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {}
  cachedBase = normalized;
  return normalized;
}

export function clearApiBaseOverride() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  cachedBase = null;
}

export function getApiBase() {
  if (cachedBase) return cachedBase;

  const injected =
    typeof window !== "undefined" && typeof window.__FPL_API_BASE__ === "string"
      ? window.__FPL_API_BASE__
      : null;
  const stored = readLocalOverride();

  const sameOrigin = looksSameOriginViable() && typeof window !== "undefined"
    ? `${window.location.origin}/api`
    : null;

  let base =
    normalize(injected) ||
    normalize(stored) ||
    normalize(sameOrigin);

  // If same-origin is not viable, fall back to the known worker host
  if (!base || (!looksSameOriginViable() && base === normalize(sameOrigin))) {
    base = normalize(FALLBACK_WORKER);
  }

  cachedBase = base || normalize(FALLBACK_WORKER);
  return cachedBase;
}

export function getApiBaseInfo() {
  return {
    base: getApiBase(),
    override: readLocalOverride(),
    injected: typeof window !== "undefined" ? window.__FPL_API_BASE__ : null,
    fallback: normalize(FALLBACK_WORKER),
    sameOriginViable: looksSameOriginViable(),
  };
}
