import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";

/* -------- helpers -------- */

async function getFixturesForEvents(eventIds){
  const out = [];
  for (const id of eventIds){
    const fx = await api.fixtures(id);
    out.push(...fx);
    await utils.sleep(100);
  }
  return out;
}
const clampFDR = n => Math.max(1, Math.min(5, Number(n)||3));
const fdrChip = n => utils.el("span",{class:`fdr fdr-${clampFDR(n)}`}, String(clampFDR(n)));
const mapTeams = teams => new Map(teams.map(t=>[t.id,t]));
const mapPos = pos => new Map(pos.map(p=>[p.id,p.singular_name_short]));

function statusLabel(code){
  return ({ a:"Available", d:"Doubtful", i:"Injured", n:"Unavailable" }[code] || code || "Unknown");
}
function fmtMoney(m){ return `£${(+m).toFixed(1)}m`; }
function fmtPct(p){ return `${(+p).toFixed(1)}%`; }
function toLocal(dt, tz="Europe/London"){
  if (!dt) return "—";
  try{
    const d = new Date(dt);
    return d.toLocaleString("en-GB",{ timeZone: tz, weekday:"short", year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }catch{ return dt; }
}

function shortNextFixtures(nextCells, take=3){
  // nextCells: [{gw, fixtures:[{vs:"H XXX", fdr, kickoff_time}]}]
  const flat = [];
  for (const c of nextCells){
    for (const f of c.fixtures) flat.push({ gw:c.gw, vs:f.vs, fdr:f.fdr });
  }
  return flat.slice(0, take).map(f => `${f.vs} (FDR ${clampFDR(f.fdr)})`).join(", ");
}

function matrixSummaryLines(matrix, futureIds){
  // matrix: [{team, cells:[{text, fdr, type}...]}]
  return matrix.map(r=>{
    const cells = r.cells.map(c=>{
      if (!c || c.type==="blank") return "—";
      if (Array.isArray(c.fdr)) {
        const parts = c.text.split(" & ");
        return parts.map((p,i)=> `${p} (FDR ${clampFDR(c.fdr[i])})`).join(" + ");
      }
      return `${c.text} (FDR ${clampFDR(c.fdr)})`;
    });
    return `${r.team}: ${cells.join(" | ")}`;
  });
}

function aggLast5(historyRows){
  // rows are elementSummary.history objects
  const last5 = historyRows.slice(-5);
  const mins = last5.reduce((a,b)=>a+(b.minutes||0),0);
  const pts  = last5.reduce((a,b)=>a+(b.total_points||0),0);
  const g    = last5.reduce((a,b)=>a+(b.goals_scored||0),0);
  const a    = last5.reduce((a,b)=>a+(b.assists||0),0);
  const cs   = last5.reduce((a,b)=>a+(b.clean_sheets||0),0);
  return { mins, pts, g, a, cs, per90: mins ? +(pts/(mins/90)).toFixed(2) : 0 };
}

/* -------- page -------- */

export async function renderFixtures(main){
  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading fixtures & difficulty…"));
  ui.mount(main, wrap);

  const bs = state.bootstrap || await api.bootstrap();
  state.bootstrap = bs;
  const { events, teams, elements: players, element_types: positions } = bs;

  const teamById = mapTeams(teams);
  const posById = mapPos(positions);

  const finished = events.filter(e=>e.data_checked);
  const lastFinished = finished.length ? Math.max(...finished.map(e=>e.id)) : 0;
  const nextGw = Math.max(1, lastFinished + 1);

  // Controls
  const gwSel = utils.el("select");
  gwSel.innerHTML = `
    <option value="3">Next 3 GWs</option>
    <option value="5" selected>Next 5 GWs</option>
    <option value="8">Next 8 GWs</option>`;
  const buildBtn = utils.el("button",{class:"btn-primary"},"Build Matrix & Prompt");
  const controls = utils.el("div",{class:"controls"},[gwSel, buildBtn]);

  const matrixCard = utils.el("div",{class:"card"});
  const promptCard = utils.el("div",{class:"card"});

  wrap.innerHTML = "";
  wrap.append(utils.el("div",{class:"card"},[
    utils.el("h3",{},"Fixtures Difficulty Matrix"),
    controls
  ]));
  wrap.append(matrixCard, promptCard);
  ui.mount(main, wrap);

  buildBtn.addEventListener("click", ()=> build(+gwSel.value));
  build(+gwSel.value);

  async function build(n){
    const windowEvents = events.filter(e=>e.id>=nextGw).slice(0,n);
    const windowIds = windowEvents.map(e=>e.id);
    const deadlines = new Map(windowEvents.map(e=>[e.id, e.deadline_time]));
    const deadlineNext = deadlines.get(nextGw) || null;

    matrixCard.innerHTML = "";
    matrixCard.append(ui.spinner("Computing difficulty…"));
    const fixtures = await getFixturesForEvents(windowIds);

    // Build matrix (supports doubles/blanks)
    const matrix = teams.map(t=>{
      const row = { team: t.short_name, cells: [] };
      for (const gw of windowIds){
        const gwMatches = fixtures.filter(f => f.event===gw && (f.team_h===t.id || f.team_a===t.id));
        if (gwMatches.length===0){
          row.cells.push({ text:"—", fdr:null, type:"blank" });
          continue;
        }
        const parts = gwMatches.map(m=>{
          const home = m.team_h===t.id;
          const oppId = home ? m.team_a : m.team_h;
          const opp = teamById.get(oppId);
          const diff = home ? m.team_h_difficulty : m.team_a_difficulty;
          return { text:`${home?"vs":"@"} ${opp.short_name}`, fdr: diff };
        });
        row.cells.push({
          text: parts.map(p=>p.text).join(" & "),
          fdr: parts.map(p=>p.fdr),
          type: parts.length>1 ? "double" : "single"
        });
      }
      return row;
    });

    // Render matrix
    const table = utils.el("table",{class:"table"});
    const thead = utils.el("thead");
    const trh = utils.el("tr");
    trh.append(utils.el("th",{},"Team"));
    for (const gw of windowIds) trh.append(utils.el("th",{},`GW${gw}`));
    thead.append(trh);
    const tbody = utils.el("tbody");
    for (const r of matrix){
      const tr = utils.el("tr");
      tr.append(utils.el("td",{}, r.team));
      r.cells.forEach(c=>{
        const td = utils.el("td");
        if (c.type==="blank"){
          td.append(utils.el("span",{class:"tag"},"Blank"));
        } else if (Array.isArray(c.fdr)){
          const div = utils.el("div");
          const parts = c.text.split(" & ");
          c.fdr.forEach((d,i)=>{
            const line = utils.el("div");
            line.append(fdrChip(d)," ", utils.el("span",{}, parts[i]));
            div.append(line);
          });
          td.append(div);
        } else {
          const div = utils.el("div");
          div.append(fdrChip(c.fdr[0])," ", utils.el("span",{}, c.text));
          td.append(div);
        }
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(thead, tbody);
    matrixCard.innerHTML = "";
    matrixCard.append(
      utils.el("h3",{},`Difficulty matrix — GWs ${windowIds[0]}–${windowIds[windowIds.length-1]}`),
      table
    );

    // ===== Prompt (readable) =====
    promptCard.innerHTML = "";
    promptCard.append(utils.el("h3",{},"Planner Prompt (readable)"));

    if (!state.entryId){
      promptCard.append(utils.el("div",{class:"tag"},"Enter your Entry ID to generate a tailored prompt."));
      return;
    }

    // Load manager + baseline squad (last finished GW picks as current squad)
    const [profile, hist, picks] = await Promise.all([
      api.entry(state.entryId),
      api.entryHistory(state.entryId),
      api.entryPicks(state.entryId, Math.max(1,lastFinished))
    ]);
    const bank = (hist.current.find(h=>h.event===lastFinished)?.bank || 0)/10;
    const value = (hist.current.find(h=>h.event===lastFinished)?.value || 0)/10;

    // Chips
    const usedChipsArr = (hist.chips||[]).map(c=>c.name.toLowerCase());
    const chipsUsed = usedChipsArr.length ? usedChipsArr.join(", ") : "None";
    const chipsAvailable = [
      !usedChipsArr.includes("3xc") ? "TC" : null,
      !usedChipsArr.includes("bboost") ? "BB" : null,
      !usedChipsArr.includes("freehit") ? "FH" : null,
      !usedChipsArr.includes("wildcard") ? "WC" : null
    ].filter(Boolean).join(", ") || "Unknown";

    // Enrich squad
    const byId = new Map(players.map(p=>[p.id,p]));
    const ordered = picks.picks.slice().sort((a,b)=>a.position-b.position);
    const startingSet = new Set(ordered.slice(0,11).map(x=>x.element));

    async function enrich(pk){
      const pl = byId.get(pk.element);
      const t = teamById.get(pl.team);
      // next fixtures for player's team in window
      const nextCells = windowIds.map(gw=>{
        const gwMatches = fixtures.filter(f => f.event===gw && (f.team_h===pl.team || f.team_a===pl.team));
        return {
          gw,
          fixtures: gwMatches.map(m=>{
            const home = m.team_h===pl.team;
            const oppId = home ? m.team_a : m.team_h;
            const opp = teamById.get(oppId);
            const fdr = home ? m.team_h_difficulty : m.team_a_difficulty;
            return { vs: `${home?"H":"A"} ${opp.short_name}`, fdr, kickoff_time: m.kickoff_time };
          })
        };
      });

      // last 5 confirmed
      let last5 = { mins:0, pts:0, g:0, a:0, cs:0, per90:0 };
      try{
        const sum = await api.elementSummary(pl.id);
        const rows = sum.history.filter(h=>h.round<=lastFinished);
        last5 = aggLast5(rows);
      }catch{}

      return {
        id: pl.id,
        name: pl.web_name,
        team: t.short_name,
        pos: posById.get(pl.element_type) || "?",
        price: (pl.now_cost/10).toFixed(1),
        form: pl.form,
        own: pl.selected_by_percent,
        status: pl.status,
        news: pl.news || "",
        chance: pl.chance_of_playing_next_round ?? null,
        is_start: startingSet.has(pl.id),
        is_c: !!pk.is_captain,
        is_vc: !!pk.is_vice_captain,
        nextCells,
        last5
      };
    }

    const squad = [];
    for (const pk of ordered) squad.push(await enrich(pk));

    // EO snapshot (optional)
    let eoLines = [];
    if (state.leagueId){
      try{
        const league = await api.leagueClassic(state.leagueId, 1);
        const top = (league?.standings?.results || []).slice(0,20);
        const counts = new Map();
        for (const chunk of utils.chunk(top, 5)){
          const data = await Promise.all(chunk.map(r => api.entryPicks(r.entry, lastFinished).catch(()=>null)));
          for (const d of data){
            if (!d) continue;
            d.picks.forEach(p=>{
              counts.set(p.element, (counts.get(p.element)||0) + 1 * (p.is_captain?2:1));
            });
          }
          await utils.sleep(300);
        }
        const arr = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([el, own])=>{
          const pl = byId.get(el);
          const t = teamById.get(pl.team)?.short_name || "?";
          const pct = (own/(top.length*2))*100;
          return `${pl.web_name} (${t}) ~${pct.toFixed(0)}%`;
        });
        eoLines = arr;
      }catch{}
    }

    // Blanks/doubles map for window
    const blanksDoubles = {};
    for (const gw of windowIds){
      const byTeam = {};
      for (const t of teams){
        const count = fixtures.filter(f => f.event===gw && (f.team_h===t.id || f.team_a===t.id)).length;
        byTeam[t.short_name] = count===0 ? "blank" : (count>1 ? "double" : "single");
      }
      blanksDoubles[`GW${gw}`] = byTeam;
    }

    // Matrix textual summary (1 line per team)
    const matrixLines = matrixSummaryLines(matrix, windowIds);

    // ---------- Build READABLE prompt ----------
    const readable = [];

    // Header & constraints
    readable.push(`You are my FPL assistant. Plan for GW${nextGw}. Use confirmed data only (no live). Consider fixture difficulty, recent form, injuries/flags, and my budget.`);

    // Deadline
    readable.push(`\nDEADLINE\n- GW${nextGw}: ${toLocal(deadlineNext, "Europe/London")} (London) / ${deadlineNext || "—"} (UTC)`);

    // Manager & bank/value & chips
    readable.push(`\nMANAGER CONTEXT\n- Team: ${profile.name}\n- Manager: ${profile.player_first_name} ${profile.player_last_name}\n- Overall rank: ${profile.summary_overall_rank ?? "—"} | Total points: ${profile.summary_overall_points ?? "—"}\n- Bank: ${fmtMoney(bank)} | Team value: ${fmtMoney(value)}\n- Chips used: ${chipsUsed}\n- Chips available (assumed): ${chipsAvailable}\n- Free transfers assumed: 1 (adjust if different)`);

    // Blanks/doubles highlight (only non-single)
    const bdHighlights = [];
    for (const gw of windowIds){
      const map = blanksDoubles[`GW${gw}`];
      const dbl = Object.entries(map).filter(([_,v])=>v==="double").map(([k])=>k);
      const blk = Object.entries(map).filter(([_,v])=>v==="blank").map(([k])=>k);
      if (dbl.length || blk.length){
        bdHighlights.push(`GW${gw}: ${dbl.length?`Doubles: ${dbl.join(", ")}`:"No doubles"}; ${blk.length?`Blanks: ${blk.join(", ")}`:"No blanks"}`);
      }
    }
    readable.push(`\nBLANKS/DOUBLES (window GW${windowIds[0]}–${windowIds[windowIds.length-1]})\n- ${bdHighlights.length? bdHighlights.join("\n- ") : "No blanks or doubles in this window."}`);

    // EO snapshot
    if (eoLines.length){
      readable.push(`\nLEAGUE EO SNAPSHOT (top 20 approx)\n- ${eoLines.join("\n- ")}`);
    }

    // Starting XI & bench
    const xi = squad.filter(s=>s.is_start);
    const bench = squad.filter(s=>!s.is_start);
    const formation = (()=> {
      const d = xi.filter(s=>s.pos==="DEF").length;
      const m = xi.filter(s=>s.pos==="MID").length;
      const f = xi.filter(s=>s.pos==="FWD").length;
      return `${d}-${m}-${f}`;
    })();

    readable.push(`\nCURRENT SQUAD\n- Formation guess: ${formation}`);
    readable.push(`- Starting XI:`);
    xi.forEach(s=>{
      const cap = s.is_c ? " (C)" : s.is_vc ? " (VC)" : "";
      const stat = statusLabel(s.status);
      const next3 = shortNextFixtures(s.nextCells, 3);
      readable.push(`  • ${s.name}${cap} — ${s.pos}, ${s.team}, ${fmtMoney(s.price)}, form ${s.form}, own ${fmtPct(s.own)} | ${stat}${s.chance!=null?` (${s.chance}%)`:""} | next: ${next3} | last5: ${s.last5.pts} pts in ${s.last5.mins}m (G${s.last5.g}/A${s.last5.a}/CS${s.last5.cs}, ${s.last5.per90} pts/90)`);
    });

    readable.push(`- Bench:`);
    bench.forEach(s=>{
      const stat = statusLabel(s.status);
      const next2 = shortNextFixtures(s.nextCells, 2);
      readable.push(`  • ${s.name} — ${s.pos}, ${s.team}, ${fmtMoney(s.price)}, form ${s.form} | ${stat}${s.chance!=null?` (${s.chance}%)`:""} | next: ${next2}`);
    });

    // Matrix overview, short
    readable.push(`\nTEAM FIXTURE RUNS (GW${windowIds[0]}–${windowIds[windowIds.length-1]})`);
    matrixLines.forEach(line => readable.push(`- ${line}`));

    // What to output
    readable.push(`\nWHAT TO RETURN\n1) Three transfer plans (ranked). Include exact budget math and expected upside (short note: fixtures + role + recent form). Avoid > -8 unless compelling.\n2) Captain & vice with upside vs safety; mention EO risks if league context present.\n3) Start/Sit + bench order. Call any 50/50s and why.\n4) Watchlist: flags/injuries, likely price changes, minutes risk.`);

    const readableText = readable.join("\n");

    // Optional JSON appendix (for models that like structure)
    const payload = {
      season: "2025/26",
      reference_time_utc: new Date().toISOString(),
      last_finished_gw: lastFinished,
      next_gw: nextGw,
      next_gw_deadline_utc: deadlineNext,
      window_gws: windowIds,
      manager: {
        entry_id: state.entryId,
        team_name: profile.name,
        manager_name: `${profile.player_first_name} ${profile.player_last_name}`,
        overall_rank: profile.summary_overall_rank ?? null,
        total_points: profile.summary_overall_points ?? null,
        bank_m: +bank.toFixed(1),
        team_value_m: +value.toFixed(1),
        chips_used: (hist.chips||[]).map(c=>({ name:c.name, event:c.event })),
      },
      squad: squad.map(s => ({
        name: s.name, team: s.team, pos: s.pos, price_m: +s.price, form: s.form, own_percent: +s.own,
        status: s.status, chance: s.chance, is_start: s.is_start, captain: s.is_c, vice_captain: s.is_vc,
        last5: s.last5,
        next_fixtures: s.nextCells
      })),
      matrix,
      blanks_doubles: blanksDoubles,
      league_context: eoLines.length ? { league_id: state.leagueId, topN: 20, approx_eo_list: eoLines } : null
    };

    // UI: textarea + buttons
    const taReadable = utils.el("textarea",{
      style:"width:100%;height:380px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:10px"
    }, readableText);
    taReadable.value = readableText;

    const btnCopyReadable = ui.copyButton(()=>taReadable.value, "Copy readable prompt");
    const btnCopyWithJSON = ui.copyButton(()=> `${taReadable.value}\n\nJSON appendix:\n${JSON.stringify(payload,null,2)}`, "Copy readable + JSON appendix");

    promptCard.append(
      utils.el("div",{class:"tag"},"Readable by humans and models. JSON appendix optional."),
      utils.el("div",{style:"height:8px"}),
      taReadable,
      utils.el("div",{style:"height:8px"}),
      utils.el("div",{class:"controls"}, [btnCopyReadable, btnCopyWithJSON])
    );
  }
}
