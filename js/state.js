// js/state.js
// Writable state with auto-persistence to localStorage.
// Compatible with direct assignments like `state.entryId = 123`.

const LS_ENTRY   = "fpl.entryId";
const LS_LEAGUES = "fpl.leagueIds";

const _state = {
  entryId: null,
  leagueIds: [],
  bootstrap: null,
};

// Hydrate from localStorage (best-effort)
try {
  const savedEntry = localStorage.getItem(LS_ENTRY);
  if (savedEntry) _state.entryId = Number(savedEntry);

  const savedLeagues = localStorage.getItem(LS_LEAGUES);
  if (savedLeagues) _state.leagueIds = JSON.parse(savedLeagues);
} catch {}

function persist(prop, value) {
  try {
    if (prop === "entryId") {
      localStorage.setItem(LS_ENTRY, value ?? "");
    } else if (prop === "leagueIds") {
      localStorage.setItem(LS_LEAGUES, JSON.stringify(value || []));
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
    if (prop === "bootstrap") {
      _state.bootstrap = value;
      return true;
    }
    // Fallback for any ad-hoc props
    _state[prop] = value;
    return true;
  }
});
