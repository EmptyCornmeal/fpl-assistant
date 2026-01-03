// js/api.js
// Legacy-friendly API surface that delegates to the structured fplClient.
// Uses configurable API base resolution from js/config.js (see getApiBase()).

import { fplClient, legacyApi } from "./api/fplClient.js";
import { getApiBase } from "./config.js";

function wrapResult(result, endpoint) {
  if (result.ok) return result.data;

  const err = new Error(result.message || `Failed to fetch ${endpoint}`);
  err.status = result.status || 0;
  err.url = result.url;
  err.errorType = result.errorType;
  throw err;
}

export const api = {
  async bootstrap() {
    return wrapResult(await fplClient.bootstrap(), "bootstrap");
  },
  async elementSummary(id) {
    return wrapResult(await fplClient.elementSummary(id), "elementSummary");
  },
  async eventStatus() {
    return wrapResult(await fplClient.eventStatus(), "eventStatus");
  },
  async eventLive(gw) {
    return wrapResult(await fplClient.eventLive(gw), "eventLive");
  },
  async entry(id) {
    return wrapResult(await fplClient.entry(id), "entry");
  },
  async entryHistory(id) {
    return wrapResult(await fplClient.entryHistory(id), "entryHistory");
  },
  async entryPicks(id, gw) {
    return wrapResult(await fplClient.entryPicks(id, gw), "entryPicks");
  },
  async fixtures(eventId) {
    return wrapResult(await fplClient.fixtures(eventId), "fixtures");
  },
  async leagueClassic(lid, p = 1) {
    return wrapResult(await fplClient.leagueClassic(lid, p), "leagueClassic");
  },
  async up() {
    const res = await fplClient.healthCheck();
    if (!res.ok) {
      const err = new Error(res.error || "Health check failed");
      err.errorType = res.errorType;
      throw err;
    }
    return res;
  },
  clearCache() {
    legacyApi.clearCache();
    fplClient.clearLocalStorageCache();
  },
};

export { getApiBase };
