// js/config.js
// Centralized API base resolution with override + validated fallback support.
// Resolution order:
//   1) window.__FPL_API_BASE__ (runtime injection)
//   2) localStorage "fpl.apiBase" (user override or validated host)
//   3) same-origin /api (default, always a string when location is available)
//   4) NO automatic fallback to a hardcoded host (previous dead worker issue)
//
// For fallback hosts, callers should use validateAndSetApiBase() which health-checks first.
import { log } from "./logger.js";

const STORAGE_KEY = "fpl.apiBase";
const VALIDATED_KEY = "fpl.apiBase.validated";
const VALIDATION_TS_KEY = "fpl.apiBase.validatedAt";
const VALIDATION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // Re-validate after 24h
export const HEALTH_PATH = "up";

// Candidate fallback hosts to try (in order) when no valid API is configured
// These are validated before use - they're NOT auto-selected.
const FALLBACK_CANDIDATES = [
  // Add any known-good proxy hosts here
  // "https://some-other-proxy.example.com/api",
];

let cachedBase = null;
let cachedSource = null;
let lastLoggedBase = null;
let lastLoggedSource = null;

function normalize(base) {
  if (typeof base !== "string") return null;
  const trimmed = base.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, typeof window !== "undefined" ? window.location.origin : undefined);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function buildDefaultBase() {
  if (typeof window === "undefined" || !window.location) return null;
  try {
    return new URL("./api", window.location.href).href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function readLocalOverride() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getValidatedHost() {
  try {
    const host = localStorage.getItem(VALIDATED_KEY);
    if (!host) return null;

    // Check if validation is still fresh
    const ts = Number(localStorage.getItem(VALIDATION_TS_KEY) || 0);
    if (Date.now() - ts > VALIDATION_MAX_AGE_MS) {
      // Stale validation, but still return it (will be re-validated on next health check)
      return { host, stale: true };
    }
    return { host, stale: false };
  } catch {
    return null;
  }
}

export function setApiBaseOverride(value) {
  const normalized = normalize(value);
  if (!normalized) return null;
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
    // Clear validated host since user is manually overriding
    localStorage.removeItem(VALIDATED_KEY);
    localStorage.removeItem(VALIDATION_TS_KEY);
  } catch {}
  cachedBase = normalized;
  cachedSource = "localStorage";
  return normalized;
}

export function clearApiBaseOverride() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VALIDATED_KEY);
    localStorage.removeItem(VALIDATION_TS_KEY);
  } catch {}
  cachedBase = null;
  cachedSource = null;
}

export function markApiBaseValidated(base) {
  if (!base) return;
  try {
    localStorage.setItem(VALIDATED_KEY, base);
    localStorage.setItem(VALIDATION_TS_KEY, String(Date.now()));
  } catch {}
  cachedBase = base;
  cachedSource = "validated";
  logResolution(base, "validated");
}

function logResolution(base, source) {
  if (!base) return;
  if (lastLoggedBase === base && lastLoggedSource === source) return;
  lastLoggedBase = base;
  lastLoggedSource = source;
  const label = source || "auto";
  log.info(`API base resolved from ${label}: ${base}`);
}

export function getApiBase() {
  if (cachedBase) return cachedBase;

  const candidates = [
    {
      value: typeof window !== "undefined" && typeof window.__FPL_API_BASE__ === "string"
        ? window.__FPL_API_BASE__
        : null,
      source: "window.__FPL_API_BASE__",
    },
    {
      value: readLocalOverride(),
      source: "localStorage",
    },
    {
      value: buildDefaultBase(),
      source: "default",
    },
    {
      value: getValidatedHost()?.host || null,
      source: "validated",
    },
  ];

  for (const candidate of candidates) {
    const normalized = normalize(candidate.value);
    if (normalized) {
      cachedBase = normalized;
      cachedSource = candidate.source;
      logResolution(normalized, candidate.source);
      return cachedBase;
    }
  }

  // If we still don't have a base, there's no valid API configured
  cachedBase = null;
  cachedSource = null;
  return null;
}

/**
 * Get detailed info about API base configuration
 */
export function getApiBaseInfo() {
  const validated = getValidatedHost();
  return {
    base: getApiBase(),
    source: cachedSource || null,
    override: readLocalOverride(),
    injected: typeof window !== "undefined" ? window.__FPL_API_BASE__ : null,
    validatedHost: validated?.host || null,
    validationStale: validated?.stale || false,
    sameOriginViable: !!buildDefaultBase(),
    defaultBase: buildDefaultBase(),
    fallbackCandidates: FALLBACK_CANDIDATES,
  };
}

/**
 * Attempt to validate and set an API base by health-checking it.
 * Returns true if successful, false otherwise.
 */
export async function validateApiBase(base, timeout = 5000) {
  const normalized = normalize(base);
  if (!normalized) return false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${normalized}/${HEALTH_PATH}`, {
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      markApiBaseValidated(normalized);
      cachedBase = normalized;
      cachedSource = "validated";
      return true;
    }
  } catch {
    // Health check failed
  }

  return false;
}

/**
 * Try to find a working API from the fallback candidates.
 * This should be called when no API is configured or current API is failing.
 */
export async function tryFallbackHosts() {
  for (const candidate of FALLBACK_CANDIDATES) {
    const isValid = await validateApiBase(candidate);
    if (isValid) {
      return candidate;
    }
  }
  return null;
}

/**
 * Check if the current API base needs validation (is stale or unknown)
 */
export function needsValidation() {
  const base = getApiBase();
  if (!base) return true;

  const validated = getValidatedHost();
  if (!validated) return true;

  return validated.stale;
}

/**
 * Clear the cached API base so it will be re-resolved on next call
 */
export function resetApiBaseCache() {
  cachedBase = null;
}
