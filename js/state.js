// js/state.js
// Writable state with auto-persistence to localStorage.
// Compatible with direct assignments like `state.entryId = 123`.

const LS_ENTRY     = "fpl.entryId";
const LS_LEAGUES   = "fpl.leagueIds";
const LS_WATCHLIST = "fpl.watchlist";

const _state = {
  entryId: null,
  leagueIds: [],
  watchlist: [],
  bootstrap: null,
};

// Hydrate from localStorage (best-effort)
try {
  const savedEntry = localStorage.getItem(LS_ENTRY);
  if (savedEntry) _state.entryId = Number(savedEntry);

  const savedLeagues = localStorage.getItem(LS_LEAGUES);
  if (savedLeagues) _state.leagueIds = JSON.parse(savedLeagues);

  const savedWatchlist = localStorage.getItem(LS_WATCHLIST);
  if (savedWatchlist) _state.watchlist = JSON.parse(savedWatchlist);
} catch {}

function persist(prop, value) {
  try {
    if (prop === "entryId") {
      localStorage.setItem(LS_ENTRY, value ?? "");
    } else if (prop === "leagueIds") {
      localStorage.setItem(LS_LEAGUES, JSON.stringify(value || []));
    } else if (prop === "watchlist") {
      localStorage.setItem(LS_WATCHLIST, JSON.stringify(value || []));
    }
  } catch {}
}

export const state = new Proxy({}, {
  get(_, prop) {
    return _state[prop];
  },
  set(_, prop, value) {
    if (prop === "entryId") {
      _state.entryId = value ?? null;
      persist("entryId", _state.entryId);
      return true;
    }
    if (prop === "leagueIds") {
      _state.leagueIds = Array.isArray(value) ? value : [];
      persist("leagueIds", _state.leagueIds);
      return true;
    }
    if (prop === "watchlist") {
      _state.watchlist = Array.isArray(value) ? value : [];
      persist("watchlist", _state.watchlist);
      return true;
    }
    if (prop === "bootstrap") {
      _state.bootstrap = value;
      return true;
    }
    // Fallback for any ad-hoc props
    _state[prop] = value;
    return true;
  }
});

// Watchlist helper functions
export function isInWatchlist(playerId) {
  return _state.watchlist.includes(playerId);
}

export function toggleWatchlist(playerId) {
  const idx = _state.watchlist.indexOf(playerId);
  if (idx === -1) {
    _state.watchlist = [..._state.watchlist, playerId];
  } else {
    _state.watchlist = _state.watchlist.filter(id => id !== playerId);
  }
  persist("watchlist", _state.watchlist);
  return isInWatchlist(playerId);
}

export function getWatchlist() {
  return [..._state.watchlist];
}
