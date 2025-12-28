export const utils = {
    // Normalize text for accent-insensitive search (e.g., "Ødegaard" -> "odegaard", "Guéhi" -> "guehi")
    // Handles Nordic/special characters that aren't decomposed by NFD
    normalizeText: (str) => {
      if (!str) return "";
      // First, map special characters that NFD doesn't decompose
      const specialChars = {
        'Ø': 'O', 'ø': 'o',
        'Æ': 'AE', 'æ': 'ae',
        'Œ': 'OE', 'œ': 'oe',
        'Ł': 'L', 'ł': 'l',
        'Đ': 'D', 'đ': 'd',
        'ß': 'ss',
        'Þ': 'TH', 'þ': 'th'
      };
      let normalized = str;
      for (const [char, replacement] of Object.entries(specialChars)) {
        normalized = normalized.split(char).join(replacement);
      }
      // Then apply NFD normalization and strip diacritics
      return normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    },
    moneyMillions: (now_cost) => (now_cost / 10).toFixed(1), // £m
    fmtMoney: (now_cost) => `£${(now_cost/10).toFixed(1)}m`,
    ppm: (points, now_cost) => now_cost ? (points / (now_cost/10)) : 0,
    percent: (n) => `${(+n).toFixed(1)}%`,
    byId: (arr, id) => arr.find(x => x.id === id),
    teamById: (teams, id) => teams.find(t => t.id === id),
    posName: (positions, type) => (positions.find(p=>p.id===type)?.singular_name_short)||"?",
    lastFinishedEventId(events) {
      const finished = events.filter(e => e.data_checked);
      return finished.length ? Math.max(...finished.map(e => e.id)) : null;
    },
    nextNEventIds(events, fromEventId, n) {
      return events.filter(e => e.id >= fromEventId).slice(0, n).map(e => e.id);
    },
    // crude FDR: map opponent team "strength_overall" to {1..5}
    fdrFromStrength(str) {
      // typical strength ~ (1..5) or up to ~100 historically; normalize roughly
      const s = Number(str) || 50;
      if (s <= 40) return 2;
      if (s <= 50) return 3;
      if (s <= 60) return 4;
      return 5;
    },
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    chunk: (arr, size) => Array.from({length: Math.ceil(arr.length/size)}, (_,i)=>arr.slice(i*size,(i+1)*size)),
    sum: (arr, k) => arr.reduce((a,b)=>a+(k? (b[k]||0):b), 0),
    el(tag, attrs={}, children=[]) {
      const e = document.createElement(tag);
      for (const [k,v] of Object.entries(attrs)) {
        if (k === "class") e.className = v;
        else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) e.setAttribute(k, v);
      }
      for (const c of (Array.isArray(children)?children:[children])) {
        if (c == null) continue;
        e.append(c.nodeType ? c : document.createTextNode(String(c)));
      }
      return e;
    }
  };
  
  // utils.abbr("CS", "Clean sheets") -> <span class="abbr-tip" data-tooltip="Clean sheets">CS</span>
utils.abbr = function(label, tip){
    const s = utils.el("span", { class: "abbr-tip" }, label);
    if (tip) s.dataset.tooltip = tip;
    return s;
  };
  