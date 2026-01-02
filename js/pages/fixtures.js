// js/pages/fixtures.js
import { fplClient, legacyApi } from "../api/fplClient.js";
import { state, setPageUpdated } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { makeSelect } from "../components/select.js";
import { log } from "../logger.js";
import { getCacheAge, CacheKey } from "../api/fetchHelper.js";

/* ───────── helpers ───────── */

const clampFDR = n => Math.max(1, Math.min(5, Number(n)||3));
const fdrChip = n => utils.el("span",{class:`fdr fdr-${clampFDR(n)}`}, String(clampFDR(n)));
const mapTeams = teams => new Map(teams.map(t=>[t.id,t]));
const toLocal = (dt, tz="Europe/London")=>{
  if (!dt) return "—";
  try{
    const d = new Date(dt);
    return d.toLocaleString("en-GB",{ timeZone: tz, weekday:"short", year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }catch{ return dt; }
};

async function getFixturesForEvents(eventIds){
  const out = [];
  for (const id of eventIds){
    const result = await fplClient.fixtures(id);
    if (result.ok) {
      out.push(...result.data);
    }
    await utils.sleep(60);
  }
  return out;
}

/* xFDR model */
function buildXFDRScaler(teams){
  const vals = [];
  for (const t of teams){
    vals.push(
      t.strength_defence_home, t.strength_defence_away,
      t.strength_attack_home,  t.strength_attack_away
    );
  }
  const min = Math.min(...vals), max = Math.max(...vals);
  const bucket = (v)=>{
    if (!isFinite(v)) return 3;
    const p = (v - min) / Math.max(1e-6, (max - min));
    const band = Math.min(4, Math.floor(p*5)) + 1;
    return clampFDR(band);
  };
  return { bucket };
}
function xFDRForMatch({homeTeam, awayTeam, isHome, viewPos, bucket}){
  const opp = isHome ? awayTeam : homeTeam;
  const oppDef = isHome ? opp.strength_defence_away : opp.strength_defence_home;
  const oppAtt = isHome ? opp.strength_attack_away  : opp.strength_attack_home;
  let raw;
  if (viewPos === "DEF") raw = oppAtt;
  else if (viewPos === "ATT") raw = oppDef;
  else raw = (oppAtt + oppDef) / 2;
  return bucket(raw);
}

/* Floating, viewport-aware tooltip (avoids clipping) */
function getGlobalTip(){
  let el = document.getElementById("global-floating-tip");
  if (!el){
    el = document.createElement("div");
    el.id = "global-floating-tip";
    el.className = "tooltip-floating";
    document.body.appendChild(el);
  }
  return el;
}
function attachHoverTip(node, html){
  const tip = getGlobalTip();
  const move = (e)=>{
    tip.innerHTML = html;
    tip.style.display = "block";
    const pad = 12;
    const vw = window.innerWidth, vh = window.innerHeight;
    tip.style.left = "0px"; tip.style.top = "0px";
    const r = tip.getBoundingClientRect();
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + r.width + pad > vw) x = vw - r.width - pad;
    if (y + r.height + pad > vh) y = vh - r.height - pad;
    tip.style.left = x + "px";
    tip.style.top  = y + "px";
  };
  const leave = ()=>{ tip.style.display = "none"; };
  node.addEventListener("mousemove", move);
  node.addEventListener("mouseenter", move);
  node.addEventListener("mouseleave", leave);
}

/* inject minimal styles once (badges + chart fit) */
function ensureFixtureStyles(){
  if (document.getElementById("fixture-extras")) return;
  const css = `
  .fx-status{ margin-left:.5rem; font-size:.75rem; padding:.15rem .45rem; border-radius:999px; border:1px solid var(--border); opacity:.9 }
  .fx-done .fx-status{ opacity:.8 }
  .fx-done-badge{ background:rgba(255,255,255,.06) }
  .fx-live-badge{ background:rgba(255,0,0,.12); border-color:rgba(255,0,0,.35) }
  .fx-soon-badge{ background:rgba(255,255,255,.04) }
  .fx-blank{ opacity:.7 }
  .matrix .cell-line{ display:flex; align-items:center; gap:.4rem; }
  .matrix .cell-note{ margin-top:.25rem; font-size:.7rem; opacity:.8 }
  `;
  const style = document.createElement("style");
  style.id = "fixture-extras";
  style.textContent = css;
  document.head.appendChild(style);
}

/* ───────── page ───────── */

export async function renderFixtures(main){
  ensureFixtureStyles();

  // Show loading state
  ui.mount(main, ui.loadingWithTimeout("Loading fixtures & difficulty..."));

  // Fetch bootstrap
  const bootstrapResult = state.bootstrap
    ? { ok: true, data: state.bootstrap, fromCache: false, cacheAge: 0 }
    : await fplClient.bootstrap();

  if (!bootstrapResult.ok) {
    const cacheAge = getCacheAge(CacheKey.BOOTSTRAP);
    const hasCache = cacheAge !== null;

    ui.mount(main, ui.degradedCard({
      title: "Failed to Load Fixtures",
      errorType: bootstrapResult.errorType,
      message: bootstrapResult.message,
      cacheAge: hasCache ? cacheAge : null,
      onRetry: () => renderFixtures(main),
      onUseCached: hasCache ? async () => {
        state.bootstrap = fplClient.loadBootstrapFromCache().data;
        await renderFixtures(main);
      } : null,
    }));
    return;
  }

  // Track cache state
  let usingCache = bootstrapResult.fromCache;
  let maxCacheAge = bootstrapResult.cacheAge || 0;

  try{
    const bs = bootstrapResult.data;
    state.bootstrap = bs;
    const { events, teams, elements, element_types } = bs;
    const teamById = mapTeams(teams);

    const finished = events.filter(e=>e.data_checked);
    const lastFinished = finished.length ? Math.max(...finished.map(e=>e.id)) : 0;
    const nextGw = Math.max(1, lastFinished + 1);

    /* Owned players by team (for overlay chip) */
    let ownedByTeam = new Map();
    if (state.entryId){
      try{
        const picksResult = await fplClient.entryPicks(state.entryId, Math.max(1,lastFinished));
        const picks = picksResult.ok ? picksResult.data : { picks: [] };
        const byId = new Map(elements.map(p=>[p.id,p]));
        for (const pk of picks.picks){
          const pl = byId.get(pk.element);
          if (!pl) continue;
          const arr = ownedByTeam.get(pl.team) || [];
          arr.push({
            name: pl.web_name,
            pos: element_types.find(et=>et.id===pl.element_type)?.singular_name_short || "?",
            price: +(pl.now_cost/10).toFixed(1),
            c: !!pk.is_captain,
            vc: !!pk.is_vice_captain
          });
          ownedByTeam.set(pl.team, arr);
        }
      }catch{}
    }
    const myTeamIds = new Set([...ownedByTeam.keys()]);

    /* Toolbar */
    const windowSel = makeSelect({
      options: [{label:"Next 3", value:3}, {label:"Next 5", value:5}, {label:"Next 8", value:8}],
      value: 5,
      onChange: () => render()
    });
    const viewSel = makeSelect({
      options: [{label:"Official FDR", value:"OFFICIAL"}, {label:"xFDR (model)", value:"XMODEL"}],
      value: "OFFICIAL",
      onChange: () => render()
    });

    const seg = utils.el("div",{class:"segmented"});
    const segAll = utils.el("button",{class:"seg-btn active"},"All");
    const segDef = utils.el("button",{class:"seg-btn"},"GKP+DEF");
    const segAtt = utils.el("button",{class:"seg-btn"},"MID+FWD");
    seg.append(segAll, segDef, segAtt);
    let viewPos = "ALL";
    const setSeg = (k)=>{
      viewPos = k;
      [segAll,segDef,segAtt].forEach(b=>b.classList.remove("active"));
      ({ALL:segAll, DEF:segDef, ATT:segAtt}[k]).classList.add("active");
      if (k !== "ALL") viewSel.value = "XMODEL";
    };
    segAll.onclick = ()=> setSeg("ALL");
    segDef.onclick = ()=> setSeg("DEF");
    segAtt.onclick = ()=> setSeg("ATT");

    // Controlled toggle state for Fixtures
    const fixtureToggleState = {
      pinMine: true,
      onlyDoubles: false,
      showSwings: false
    };

    // Helper to create controlled fixture toggle with clearer labels
    function createFixtureToggle(key, label, tooltip) {
      const wrap = utils.el("label", { class: "fx-toggle", title: tooltip });
      const checkbox = utils.el("input", { type: "checkbox", checked: fixtureToggleState[key] });
      const labelSpan = utils.el("span", { class: "fx-toggle-label" }, label);
      const indicator = utils.el("span", { class: "fx-toggle-indicator" });

      wrap.append(checkbox, indicator, labelSpan);

      checkbox.addEventListener("change", () => {
        fixtureToggleState[key] = checkbox.checked;
        indicator.classList.toggle("active", checkbox.checked);
        render();
      });

      indicator.classList.toggle("active", fixtureToggleState[key]);

      return { wrap, checkbox, getState: () => fixtureToggleState[key] };
    }

    const pinMineToggle = createFixtureToggle("pinMine", "Pin my teams", "Keep your owned teams at the top of the matrix");
    const onlyDoublesToggle = createFixtureToggle("onlyDoubles", "Only doubles", "Show only teams with double gameweeks in the selected window");
    const showSwingsToggle = createFixtureToggle("showSwings", "Show swings", "Show difficulty direction arrows (▲easier ▼harder) between consecutive GWs");

    const pinMine = pinMineToggle.wrap;
    const onlyDoubles = onlyDoublesToggle.wrap;
    const showSwings = showSwingsToggle.wrap;

    // Compact toolbar
    const toolbar = utils.el("div",{class:"toolbar-compact"},[
      utils.el("span",{class:"chip chip-dim"},"Window:"), windowSel.el,
      utils.el("span",{class:"chip chip-dim"},"View:"),   viewSel.el,
      utils.el("span",{class:"chip chip-dim"},"Pos:"), seg,
      pinMine, onlyDoubles, showSwings
    ]);

    /* Dashboard layout: toolbar + 2-column content */
    const page = utils.el("div",{class:"fixtures-dashboard"});

    // Header with compact toolbar
    const header = utils.el("div",{class:"tile tile-flush", style:"padding:var(--gap-md)"});
    const headerTop = utils.el("div",{style:"display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--gap-sm)"});
    headerTop.innerHTML = `<span class="tile-title" style="font-size:11px">FIXTURES & DIFFICULTY</span><span style="font-size:9px;color:var(--muted)">FDR 1=easy → 5=hard</span>`;
    header.append(headerTop, toolbar);

    /* Cards */
    const matrixCard = utils.el("div",{class:"card card-flush", style:"flex:1;min-height:0;overflow:auto"});
    const chartCard  = utils.el("div",{class:"card card-flush", style:"flex:1;min-height:0;overflow:hidden"});

    // Content area: matrix left, chart right
    const content = utils.el("div",{class:"fixtures-content"});
    content.append(matrixCard, chartCard);

    page.append(header, content);
    ui.mount(main, page);

    const { bucket } = buildXFDRScaler(teams);

    let sortKey = "team"; // 'team' | 'avg' | 'home' | 'doubles' | 'top6'
    let sortDir = "asc";

    async function render(){
      const n = +windowSel.value;
      const useModel = (viewSel.value === "XMODEL") || (viewPos !== "ALL");
      const windowEvents = events.filter(e=>e.id>=nextGw).slice(0,n);
      const windowIds = windowEvents.map(e=>e.id);
      const fixtures = await getFixturesForEvents(windowIds);

      const ranked = teams.slice().sort((a,b)=> (b.strength||0)-(a.strength||0));
      const top6Ids = new Set(ranked.slice(0,6).map(t=>t.id));
      const showSwingArrows = fixtureToggleState.showSwings === true;

      const rows = teams.map(t=>{
        const cells = [];
        let homeCount = 0, doublesCount = 0, top6Count = 0;

        for (const gw of windowIds){
          const matches = fixtures.filter(f => f.event===gw && (f.team_h===t.id || f.team_a===t.id));
          if (matches.length === 0){
            const blank = utils.el("span",{class:"tag fx-blank"},"Blank");
            cells.push({ type:"blank", node: blank, fdrs:[], avg:null, swing:null });
            continue;
          }
          if (matches.length > 1) doublesCount++;

          const lines = [];
          const fdrs = [];
          for (const m of matches){
            const isHome = (m.team_h===t.id);
            const oppId = isHome ? m.team_a : m.team_h;
            const opp = teamById.get(oppId);
            if (isHome) homeCount++;
            if (top6Ids.has(oppId)) top6Count++;

            const offFdr = isHome ? m.team_h_difficulty : m.team_a_difficulty;
            const useFdr = useModel
              ? xFDRForMatch({ homeTeam: teamById.get(m.team_h), awayTeam: teamById.get(m.team_a), isHome, viewPos, bucket })
              : offFdr;
            fdrs.push(useFdr);

            const line = utils.el("div",{class:"cell-line"});
            line.append(
              fdrChip(useFdr),
              utils.el("span",{class:"abbr-tip","data-tooltip":`${opp.name}`}, `${isHome ? "H" : "A"} ${opp.short_name}`)
            );

            const hasScore = Number.isFinite(m.team_h_score) && Number.isFinite(m.team_a_score);
            if (m.finished || m.finished_provisional){
              line.classList.add("fx-done");
              const score = hasScore ? `${m.team_h_score}–${m.team_a_score}` : "";
              const ft = utils.el("span",{class:"fx-status fx-done-badge"}, score ? `${score} FT` : "FT");
              ft.dataset.tooltip = `Finished • ${toLocal(m.kickoff_time)}`;
              line.append(ft);
            } else if (m.started){
              const live = utils.el("span",{class:"fx-status fx-live-badge"},"LIVE");
              live.dataset.tooltip = `In progress • ${toLocal(m.kickoff_time)}`;
              line.append(live);
            } else if (m.kickoff_time){
              const soon = utils.el("span",{class:"fx-status fx-soon-badge"}, toLocal(m.kickoff_time).split(",").slice(-1)[0].trim());
              soon.dataset.tooltip = `Kickoff • ${toLocal(m.kickoff_time)}`;
              line.append(soon);
            }

            lines.push(line);
          }

          const tdBox = utils.el("div");
          lines.forEach(l => tdBox.append(l));
          const avg = fdrs.length ? fdrs.reduce((a,b)=>a+b,0)/fdrs.length : null;
          cells.push({ type: matches.length>1 ? "double" : "single", node: tdBox, fdrs, avg });
        }

        if (showSwingArrows){
          for (let i=1;i<cells.length;i++){
            const a=cells[i-1].avg, b=cells[i].avg;
            if (a!=null && b!=null){
              const delta = b - a;
              cells[i].swing = Math.abs(delta)>=2 ? (delta>0?"down":"up") : null;
            }
          }
        }

        const avgAll = (()=> {
          const flat = cells.flatMap(c=>c.fdrs);
          return flat.length ? +(flat.reduce((a,b)=>a+b,0)/flat.length).toFixed(2) : null;
        })();

        return {
          teamId: t.id,
          team: t.short_name,
          cells,
          summary: { avg: avgAll ?? 99, home: homeCount, doubles: doublesCount, top6: top6Count }
        };
      });

      /* Filters */
      let filtered = rows.slice();
      let emptyStateMessage = null;

      // Track if "Only doubles" is filtering
      const onlyDoublesActive = fixtureToggleState.onlyDoubles === true;
      if (onlyDoublesActive) {
        const beforeCount = filtered.length;
        filtered = filtered.filter(r => r.summary.doubles > 0);
        if (filtered.length === 0 && beforeCount > 0) {
          emptyStateMessage = "No double gameweeks in the selected horizon";
        }
      }

      // Track if "Show swings" would have any effect
      let swingCount = 0;
      if (showSwingArrows) {
        for (const r of filtered) {
          swingCount += r.cells.filter(c => c.swing).length;
        }
      }

      /* Pin mine top */
      if (fixtureToggleState.pinMine === true && myTeamIds.size){
        filtered.sort((a,b)=>{
          const ai = myTeamIds.has(a.teamId) ? 0 : 1;
          const bi = myTeamIds.has(b.teamId) ? 0 : 1;
          if (ai!==bi) return ai-bi;
          return 0;
        });
      }

      /* Sort rows for matrix (user-controlled) */
      filtered.sort((a,b)=>{
        let av, bv;
        if (sortKey==="team"){ av=a.team; bv=b.team; }
        else { av=a.summary[sortKey]; bv=b.summary[sortKey]; }
        const cmp = (av>bv) - (av<bv);
        return sortDir==="asc" ? cmp : -cmp;
      });

      /* Render Matrix */
      matrixCard.innerHTML = "";
      matrixCard.append(
        utils.el("h3",{},`Matrix — GW${windowIds[0]}–${windowIds.slice(-1)[0]}`)
      );

      // Legend explaining FDR types and features
      const legend = utils.el("div", { class: "fx-legend" });
      legend.innerHTML = `
        <div class="fx-legend-section">
          <span class="fx-legend-title">Difficulty:</span>
          <span class="fdr fdr-1">1</span><span class="fx-legend-label">Easiest</span>
          <span class="fdr fdr-2">2</span>
          <span class="fdr fdr-3">3</span>
          <span class="fdr fdr-4">4</span>
          <span class="fdr fdr-5">5</span><span class="fx-legend-label">Hardest</span>
        </div>
        <div class="fx-legend-section">
          <span class="fx-legend-title">View:</span>
          <span class="fx-legend-item ${viewSel.value === "OFFICIAL" && viewPos === "ALL" ? "active" : ""}">
            <strong>Official FDR</strong> — Premier League's difficulty rating
          </span>
          <span class="fx-legend-item ${viewSel.value === "XMODEL" || viewPos !== "ALL" ? "active" : ""}">
            <strong>xFDR</strong> — Model-based difficulty using team strength stats${viewPos !== "ALL" ? ` (${viewPos === "DEF" ? "defensive" : "attacking"} view)` : ""}
          </span>
        </div>
        ${showSwingArrows ? `
        <div class="fx-legend-section">
          <span class="fx-legend-title">Swings:</span>
          <span class="swing-up">▲ easier next</span>
          <span class="swing-down">▼ harder next</span>
          <span class="fx-legend-note">(shown when difficulty changes by ≥2)</span>
        </div>
        ` : ""}
      `;
      matrixCard.append(legend);

      // Handle empty states
      if (emptyStateMessage) {
        const emptyState = utils.el("div", { class: "fx-empty-state" });
        emptyState.innerHTML = `
          <div class="fx-empty-icon">📅</div>
          <h4>${emptyStateMessage}</h4>
          <p>Try selecting a longer window (Next 5 or Next 8) to find teams with double gameweeks.</p>
          <button class="btn-ghost fx-clear-filter">Clear "Only doubles" filter</button>
        `;
        emptyState.querySelector(".fx-clear-filter").addEventListener("click", () => {
          fixtureToggleState.onlyDoubles = false;
          onlyDoublesToggle.checkbox.checked = false;
          onlyDoublesToggle.wrap.querySelector(".fx-toggle-indicator").classList.remove("active");
          render();
        });
        matrixCard.append(emptyState);
        chartCard.innerHTML = "";
        chartCard.append(utils.el("div", { class: "fx-empty-state" }, [
          utils.el("p", {}, "No data to display. Clear the filter to see all teams.")
        ]));
        return;
      }

      // Show message if swings is enabled but no swings detected
      if (showSwingArrows && swingCount === 0 && filtered.length > 0) {
        const swingNotice = utils.el("div", { class: "fx-notice fx-notice-info" });
        swingNotice.innerHTML = `
          <span class="fx-notice-icon">ℹ️</span>
          <span><strong>No swing events detected</strong> — Fixture difficulty is relatively stable in this window. Swings only appear when difficulty changes by ≥2 between consecutive GWs.</span>
        `;
        matrixCard.append(swingNotice);
      }

      const table = utils.el("table",{class:"table matrix"});
      const thead = utils.el("thead");
      const trh = utils.el("tr");

      function makeTh(label, key=null){
        const th = utils.el("th",{}, label);
        if (key){
          th.classList.add("th-sortable");
          if (sortKey===key){ th.classList.add("active", sortDir); }
          th.addEventListener("click", ()=>{
            if (sortKey===key){ sortDir = (sortDir==="asc"?"desc":"asc"); }
            else { sortKey = key; sortDir = key==="team" ? "asc" : "asc"; }
            render();
          });
        }
        return th;
      }

      const thTeam = makeTh("Team","team"); thTeam.classList.add("sticky");
      trh.append(thTeam);
      for (const gw of windowIds) trh.append( makeTh(`GW${gw}`) );
      trh.append(
        makeTh("Avg","avg"),
        makeTh("#Home","home"),
        makeTh("#Doubles","doubles"),
        makeTh("#Top-6","top6"),
      );
      thead.append(trh);

      const tbody = utils.el("tbody");

      for (const r of filtered){
        const tr = utils.el("tr");

        const teamCell = utils.el("div",{style:"display:flex;align-items:center;gap:6px"});
        teamCell.append(utils.el("span",{}, r.team));
        const owned = ownedByTeam.get(r.teamId);
        if (owned && owned.length){
          const chip = utils.el("span",{class:"team-owned-chip"}, `🧍×${owned.length}`);
          const list = owned.map(p=>`${p.name} (${p.pos} £${p.price}m${p.c?" • C":p.vc?" • VC":""})`).join("<br>");
          attachHoverTip(chip, `<b>Your players:</b><br>${list}`);
          teamCell.append(chip);
        }
        const tdTeam = utils.el("td",{class:"sticky"}, teamCell);
        tr.append(tdTeam);

        r.cells.forEach(c=>{
          const td = utils.el("td");
          td.append(c.node);
          if (c.swing){
            td.append(utils.el("div",{class:`cell-note swing-${c.swing}`},
              c.swing==="up" ? "▲ easier next" : "▼ harder next"
            ));
          }
          tr.append(td);
        });

        const s=r.summary;
        tr.append(
          utils.el("td",{}, s.avg===99? "—" : s.avg.toFixed(2)),
          utils.el("td",{}, String(s.home)),
          utils.el("td",{}, String(s.doubles)),
          utils.el("td",{}, String(s.top6))
        );

        tbody.append(tr);
      }

      table.append(thead, tbody);
      matrixCard.append(utils.el("div",{class:"matrix-wrap"}, table));

/* Side chart (horizontal, packed, easiest → hardest) */
chartCard.innerHTML = "";
chartCard.append(utils.el("h3",{},"Avg Difficulty (easiest → hardest)"));

// Build + sort for chart
const chartRows = filtered.map(r => ({
  team: r.team,
  avg:  (r.summary.avg===99? null : +r.summary.avg.toFixed(2))
})).sort((a,b)=>{
  const av = (a.avg==null? Infinity : a.avg);
  const bv = (b.avg==null? Infinity : b.avg);
  return av - bv; // ascending: easiest first
});

const labels = chartRows.map(r=>r.team);
const data = chartRows.map(r=>r.avg);

// Dynamic height: set on WRAPPER (not on canvas)
const barHeight = 22;   // adjust to taste
const barGap    = 8;
const rowsCount = labels.length || 1;
const height    = Math.max(260, rowsCount * (barHeight + barGap) + 40);

// wrapper controls size; Chart.js reads parent size
const wrap   = utils.el("div",{style:"width:100%;position:relative;height:"+height+"px"});
const canvas = utils.el("canvas");
wrap.append(canvas);
chartCard.append(wrap);

// color ramp green(1) → red(5)
const colors = data.map(v=>{
  if (v==null) return "rgba(255,255,255,.25)";
  const t = Math.min(1, Math.max(0, (v-1)/4)); // 0..1 for 1..5
  const hue = 120 - 120*t; // 120=green → 0=red
  return `hsl(${hue} 60% 45%)`;
});

// tiny value labels at bar end
const valueLabels = {
  id: "valueLabels",
  afterDatasetsDraw(chart){
    const { ctx, scales:{ x, y } } = chart;
    ctx.save();
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.9)";
    chart.getDatasetMeta(0).data.forEach((bar, i)=>{
      const v = data[i];
      if (v == null) return;
      const xPos = x.getPixelForValue(v) + 8;
      const yPos = bar.y; // centered
      ctx.fillText(v.toFixed(2), xPos, yPos + 4);
    });
    ctx.restore();
  }
};

const maxVal = Math.max(...data.filter(v=>v!=null));
const cfg = {
  type:"bar",
  data:{ labels, datasets:[{
    label:"Avg Difficulty",
    data,
    backgroundColor: colors,
    borderWidth: 0,
    barThickness: barHeight,
    maxBarThickness: barHeight,
    categoryPercentage: 1.0,
    barPercentage: 0.9
  }] },
  options:{
    maintainAspectRatio:false,   // key: let parent (wrap) drive height
    animation:false,
    responsive:true,
    indexAxis: 'y',
    layout:{ padding:{ left:8, right:16, top:4, bottom:4 } },
    scales:{
      x:{
        min: 1,
        max: (isFinite(maxVal) ? Math.min(5, Math.max(2.5, maxVal + 0.2)) : 5),
        grid:{ display:true, drawTicks:false, color:"rgba(255,255,255,.06)" },
        ticks:{ stepSize:0.5 },
        title:{ display:true, text:"1 (easiest) → 5 (hardest)" }
      },
      y:{
        grid:{ display:false },
        ticks:{ autoSkip:false }
      }
    },
    plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(ctx)=> `Avg: ${ctx.parsed.x ?? "—"}` } } }
  },
  plugins:[valueLabels]
};

await ui.chart(canvas, cfg);

    }

// sorting toggles (sortKey/sortDir are already declared above)
const rerender = ()=>render();
windowSel.onchange = rerender;
viewSel.onchange  = rerender;
// Note: toggle event handlers are now set up in createFixtureToggle()
const _setSeg = (k)=>{ setSeg(k); rerender(); };
segAll.onclick = ()=> _setSeg("ALL");
segDef.onclick = ()=> _setSeg("DEF");
segAtt.onclick = ()=> _setSeg("ATT");

// initial paint
render();

  }catch(err){
    log.error("Fixtures: Failed to load", err);
    const errorCard = ui.errorCard({
      title: "Failed to load Fixtures",
      message: "There was a problem loading fixture data. Please try again.",
      error: err,
      onRetry: async () => {
        await renderFixtures(main);
      }
    });
    ui.mount(main, errorCard);
  }
}
