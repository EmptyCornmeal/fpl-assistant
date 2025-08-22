import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";
import { makeSelect } from "../components/select.js";


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
    const fx = await api.fixtures(id);
    out.push(...fx);
    await utils.sleep(60);
  }
  return out;
}

function aggLast5(historyRows){
  const last5 = historyRows.slice(-5);
  const mins = last5.reduce((a,b)=>a+(b.minutes||0),0);
  const pts  = last5.reduce((a,b)=>a+(b.total_points||0),0);
  const g    = last5.reduce((a,b)=>a+(b.goals_scored||0),0);
  const a    = last5.reduce((a,b)=>a+(b.assists||0),0);
  const cs   = last5.reduce((a,b)=>a+(b.clean_sheets||0),0);
  return { mins, pts, g, a, cs, per90: mins ? +(pts/(mins/90)).toFixed(2) : 0 };
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
    // Position near cursor, clamped to viewport
    const pad = 12;
    const vw = window.innerWidth, vh = window.innerHeight;
    tip.style.left = "0px"; tip.style.top = "0px"; // reset to measure
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

/* ───────── page ───────── */

export async function renderFixtures(main){
  const shell = utils.el("div");
  shell.append(ui.spinner("Loading fixtures & difficulty…"));
  ui.mount(main, shell);

  try{
    const bs = state.bootstrap || await api.bootstrap();
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
        const picks = await api.entryPicks(state.entryId, Math.max(1,lastFinished));
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

    const pinMine = utils.el("label",{},[
      utils.el("input",{type:"checkbox", checked:true}), utils.el("span",{style:"margin-left:6px"},"Pin my teams")
    ]);
    const onlyDoubles = utils.el("label",{},[
      utils.el("input",{type:"checkbox"}), utils.el("span",{style:"margin-left:6px"},"Only doubles")
    ]);
    const showSwings = utils.el("label",{},[
      utils.el("input",{type:"checkbox"}), utils.el("span",{style:"margin-left:6px"},"Show swings")
    ]);

    const buildBtn = utils.el("button",{class:"btn-primary"},"Build Prompt");
    const toolbar = utils.el("div",{class:"controls fx-toolbar"},[
        utils.el("span",{class:"chip chip-dim"},"Window:"), windowSel.el,
        utils.el("span",{class:"chip chip-dim"},"View:"),   viewSel.el,
        utils.el("span",{class:"chip chip-dim"},"Position:"), seg,
        pinMine, onlyDoubles, showSwings,
        utils.el("span",{style:"flex:1"},""),
        buildBtn
      ]);
      
    /* Cards */
    const matrixCard = utils.el("div",{class:"card"});
    const chartCard  = utils.el("div",{class:"card"});
    const promptCard = utils.el("div",{class:"card"});

    shell.innerHTML = "";
    shell.append(
      utils.el("div",{class:"card"},[
        utils.el("h3",{},"Fixtures & Difficulty"),
        utils.el("div",{class:"tag"},"Legend: FDR 1 easiest → 5 hardest. Switch to xFDR for model-based difficulty. Position view adjusts xFDR logic."),
        toolbar
      ]),
      utils.el("div",{class:"grid cols-2"}, [matrixCard, chartCard]),
      promptCard
    );

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

      const rows = teams.map(t=>{
        const cells = [];
        let homeCount = 0, doublesCount = 0, top6Count = 0;

        for (const gw of windowIds){
          const matches = fixtures.filter(f => f.event===gw && (f.team_h===t.id || f.team_a===t.id));
          if (matches.length === 0){
            cells.push({ type:"blank", node: utils.el("span",{class:"tag"},"Blank"), fdrs:[], avg:null, swing:null });
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
            const homeAwayIcon = isHome ? "🏠" : "✈️";
            lines.push(utils.el("div",{class:"cell-line"},[
              fdrChip(useFdr),
              utils.el("span",{class:"abbr-tip","data-tooltip":`${opp.name}`}, `${homeAwayIcon} ${opp.short_name}`)
            ]));
          }

          const tdBox = utils.el("div"); lines.forEach(l => tdBox.append(l));
          const avg = fdrs.length ? fdrs.reduce((a,b)=>a+b,0)/fdrs.length : null;
          cells.push({ type: matches.length>1 ? "double" : "single", node: tdBox, fdrs, avg });
        }

        for (let i=1;i<cells.length;i++){
          const a=cells[i-1].avg, b=cells[i].avg;
          if (a!=null && b!=null){
            const delta = b - a;
            cells[i].swing = Math.abs(delta)>=2 ? (delta>0?"down":"up") : null;
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
      if (onlyDoubles.querySelector("input").checked){
        filtered = filtered.filter(r => r.summary.doubles > 0);
      }

      /* Pin mine top */
      if (pinMine.querySelector("input").checked && myTeamIds.size){
        filtered.sort((a,b)=>{
          const ai = myTeamIds.has(a.teamId) ? 0 : 1;
          const bi = myTeamIds.has(b.teamId) ? 0 : 1;
          if (ai!==bi) return ai-bi;
          return 0;
        });
      }

      /* Sort */
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
        utils.el("h3",{},`Matrix — GW${windowIds[0]}–${windowIds.slice(-1)[0]}`),
        utils.el("div",{class:"chips", style:"margin-bottom:6px"},[
          utils.el("span",{class:"summary-chip"}, "FDR: 1 easiest → 5 hardest"),
          utils.el("span",{class:"summary-chip"}, (viewSel.value==="XMODEL" || viewPos!=="ALL") ? `View: xFDR (${viewPos==="ALL"?"balanced":"pos-specific"})` : "View: Official FDR"),
        ])
      );

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

        /* Team cell with owned chip + floating tooltip */
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

        /* GW cells */
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

        /* summaries */
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

      /* Side chart */
      chartCard.innerHTML = "";
      chartCard.append(utils.el("h3",{},"Avg Difficulty (lower is easier)"));
      const canvas = utils.el("canvas");
      chartCard.append(canvas);

      const labels = filtered.map(r=>r.team);
      const data = filtered.map(r=> (r.summary.avg===99? null : +r.summary.avg.toFixed(2)) );
      const cfg = {
        type:"bar",
        data:{ labels, datasets:[{ label:"Avg Difficulty", data }] },
        options:{
          animation:false,
          responsive:true,
          scales:{ y:{ beginAtZero:true, suggestedMax:5, title:{display:true,text:"1 (easiest) → 5 (hardest)"} } },
          plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(ctx)=> `Avg: ${ctx.parsed.y ?? "—"}` } } }
        }
      };
      await ui.chart(canvas, cfg);

      /* Prompt builder */
      promptCard.innerHTML = "";
      const nextDeadline = events.find(e=>e.id===nextGw)?.deadline_time || null;
      const runLines = filtered.map(r=>{
        const avg = (r.summary.avg===99? "—" : r.summary.avg.toFixed(2));
        const mine = ownedByTeam.get(r.teamId)?.length || 0;
        return `${r.team}: avg ${avg}, H${r.summary.home}, D${r.summary.doubles}, Top6 ${r.summary.top6}${mine?` — you own ${mine}`:""}`;
      }).join("\n- ");

      const readable = [
        `You are my FPL assistant. Plan for GW${nextGw}. Consider fixture difficulty (${(viewSel.value==="XMODEL"||viewPos!=="ALL") ? `xFDR model${viewPos!=="ALL"?" for "+viewPos:""}` : "Official FDR"}), doubles/blanks, my squad & budget.`,
        `\nDEADLINE\n- GW${nextGw}: ${toLocal(nextDeadline, "Europe/London")} (London) / ${nextDeadline || "—"} UTC`,
        `\nTEAM RUNS (GW window)\n- ${runLines}`,
        `\nRETURN EXACTLY\n1) Three ranked transfer plans (with budget math & upside).\n2) Captain & vice (upside vs safety; mention EO if relevant).\n3) Start/Sit + bench order (call 50/50s).\n4) Watchlist (flags, price risks, minutes risk).`
      ].join("\n");

      const ta = utils.el("textarea",{
        style:"width:100%;height:260px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:10px"
      }, readable);
      ta.value = readable;
      const copyBtn = ui.copyButton(()=>ta.value, "Copy prompt");
      promptCard.append(ta, utils.el("div",{style:"height:6px"}), copyBtn);
    }

    windowSel.onchange = render;
    viewSel.onchange  = render;
    pinMine.querySelector("input").onchange  = render;
    onlyDoubles.querySelector("input").onchange = render;
    showSwings.querySelector("input").onchange  = render;
    // seg buttons also trigger render
    const _setSeg = (k)=>{ setSeg(k); render(); };
    segAll.onclick = ()=> _setSeg("ALL");
    segDef.onclick = ()=> _setSeg("DEF");
    segAtt.onclick = ()=> _setSeg("ATT");

    buildBtn.onclick = render;
    render();
  }catch(err){
    ui.mount(main, ui.error("Failed to load Fixtures", err));
  }
}
