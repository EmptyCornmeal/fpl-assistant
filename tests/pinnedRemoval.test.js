// tests/pinnedRemoval.test.js
// Tests to verify pinned players/teams features have been removed
import { describe, it, assert } from "./testRunner.js";

describe("pinned features removal", () => {
  it("state.js should not export watchlist functions", async () => {
    const stateModule = await import("../js/state.js");

    // These functions should no longer exist
    assert.equal(typeof stateModule.isInWatchlist, "undefined", "isInWatchlist should be removed");
    assert.equal(typeof stateModule.toggleWatchlist, "undefined", "toggleWatchlist should be removed");
    assert.equal(typeof stateModule.getWatchlist, "undefined", "getWatchlist should be removed");
  });

  it("state.js should not export pinned teams functions", async () => {
    const stateModule = await import("../js/state.js");

    // These functions should no longer exist
    assert.equal(typeof stateModule.isTeamPinned, "undefined", "isTeamPinned should be removed");
    assert.equal(typeof stateModule.togglePinnedTeam, "undefined", "togglePinnedTeam should be removed");
    assert.equal(typeof stateModule.getPinnedTeams, "undefined", "getPinnedTeams should be removed");
  });

  it("storage.js should not have WATCHLIST key", async () => {
    const { STORAGE_KEYS } = await import("../js/storage.js");

    assert.equal(STORAGE_KEYS.WATCHLIST, undefined, "WATCHLIST key should be removed");
  });

  it("storage.js should not have PINNED_TEAMS key", async () => {
    const { STORAGE_KEYS } = await import("../js/storage.js");

    assert.equal(STORAGE_KEYS.PINNED_TEAMS, undefined, "PINNED_TEAMS key should be removed");
  });

  it("state.js should still export required functions", async () => {
    const stateModule = await import("../js/state.js");

    // Core functions should still exist
    assert.equal(typeof stateModule.state, "object", "state should still exist");
    assert.equal(typeof stateModule.validateState, "function", "validateState should still exist");
    assert.equal(typeof stateModule.setPageUpdated, "function", "setPageUpdated should still exist");
    assert.equal(typeof stateModule.hasEntryId, "function", "hasEntryId should still exist");
  });

  it("storage.js should still have required keys", async () => {
    const { STORAGE_KEYS } = await import("../js/storage.js");

    // Core keys should still exist
    assert.ok(STORAGE_KEYS.ENTRY_ID, "ENTRY_ID key should exist");
    assert.ok(STORAGE_KEYS.LEAGUE_IDS, "LEAGUE_IDS key should exist");
    assert.ok(STORAGE_KEYS.THEME, "THEME key should exist");
  });
});
