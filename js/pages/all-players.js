// js/pages/all-players.js
import { api } from "../api.js";
import { state } from "../state.js";
import { utils } from "../utils.js";
import { ui } from "../components/ui.js";

export async function renderAllPlayers(main){
  const wrap = utils.el("div");
  wrap.append(ui.spinner("Loading players…"));
  ui.mount(main, wrap);

  try{
    const bs = state.bootstrap || await api.bootstrap();
    state.bootstrap = bs;
    const { elements: players, teams, element_types: positions } = bs;

    const controls = utils.el("div",{class:"controls"});
    const q = utils.el("input",{placeholder:"Search name"});
    const posSel = utils.el("select");
    posSel.innerHTML = `<option value="">All positions</option>` + positions.map(p=>`<option value="${p.id}">${p.singular_name_short}</option>`).join("");
    const teamSel = utils.el("select");
    teamSel.innerHTML = `<option value="">All teams</option>`+teams.map(t=>`<option value="${t.id}">${t.name}</option>`).join("");
    const priceMin = utils.el("input",{placeholder:"Min £m", inputmode:"decimal", style:"width:90px"});
    const priceMax = utils.el("input",{placeholder:"Max £m", inputmode:"decimal", style:"width:90px"});
    const sortSel = utils.el("select");
    sortSel.innerHTML = `
      <option value="total_points desc">Total points ↓</option>
      <option value="now_cost asc">Price ↑</option>
      <option value="now_cost desc">Price ↓</option>
      <option value="form desc">Form ↓</option>
      <option value="selected_by_percent desc">Ownership ↓</option>
      <option value="ppm desc">Value (PPM) ↓</option>
    `;
    const xgiChk = utils.el("label",{},[
      utils.el("input",{type:"checkbox"}), utils.el("span",{style:"margin-left:6px"},"Add xGI/90 (last 5) for visible")
    ]);
    const applyBtn = utils.el("button",{class:"btn-primary"},"Apply");
    controls.append(q, posSel, teamSel, priceMin, priceMax, sortSel, xgiChk, applyBtn);

    const posById = new Map(positions.map(p=>[p.id,p.singular_name_short]));
    const teamShort = new Map(teams.map(t=>[t.id,t.short_name]));
    const enrich = p => ({
      ...p,
      team_name: teamShort.get(p.team) || "?",
      pos_name: posById.get(p.element_type) || "?",
      price_m: +(p.now_cost/10).toFixed(1),
      ppm: (p.total_points / (p.now_cost/10)) || 0
    });

    let working = players.map(enrich);
    const card = utils.el("div",{class:"card"});

    let chartInstance = null;

    function renderChart(rows){
      const canvas = utils.el("canvas");
      const ds = rows.map(p=>({
        x: p.price_m,
        y: p.total_points,
        label: `${p.web_name} (${p.team_name})`,
        own: parseFloat(p.selected_by_percent)||0,
        pos: p.element_type
      }));
      const colors = {1:"#60a5fa", 2:"#34d399", 3:"#f472b6", 4:"#f59e0b"};
      // dynamic axes from filtered rows
      const xs = rows.map(r=>r.price_m), ys = rows.map(r=>r.total_points);
      const xmin = Math.min(...xs), xmax = Math.max(...xs);
      const ymin = Math.min(...ys), ymax = Math.max(...ys);
      const padX = Math.max(0.1, (xmax-xmin)*0.04), padY = Math.max(1, (ymax-ymin)*0.08);

      const cfg = {
        type: "scatter",
        data: { datasets: [{
          data: ds,
          parsing: false,
          pointRadius: (ctx)=> Math.max(3, Math.sqrt((ctx.raw.own||0)) + 2),
          pointHoverRadius: (ctx)=> Math.max(5, Math.sqrt((ctx.raw.own||0)) + 5),
          pointBackgroundColor:(ctx)=> colors[ctx.raw.pos] || "#93c5fd"
        }]},
        options:{
          animation:false,
          plugins:{
            legend:{display:false},
            tooltip:{ callbacks:{ label: (ctx)=>{
              const r = ctx.raw;
              return `${r.label}: £${r.x}m, ${r.y} pts, Own ${Math.round(r.own)}%`;
            }}}
          },
          scales:{
            x:{title:{text:"Price (£m)",display:true}, min: xmin - padX, max: xmax + padX},
            y:{title:{text:"Total Points",display:true}, min: ymin - padY, max: ymax + padY}
          }
        }
      };
      card.append(utils.el("h3",{},"Price vs Total Points (filtered)"), canvas);
      return ui.chart(canvas, cfg, chartInstance).then((inst)=>{ chartInstance = inst; });
    }

    function renderTable(rows){
      const cols = [
        {header:"Name", accessor:r=>r.web_name, sortBy:r=>r.web_name},
        {header:"Pos", accessor:r=>r.pos_name, sortBy:r=>r.pos_name},
        {header:"Team", accessor:r=>r.team_name, sortBy:r=>r.team_name},
        {header:"Price", accessor:r=>r.price_m, cell:r=> `£${r.price_m.toFixed(1)}m`, sortBy:r=>r.price_m},
        {header:"Pts", accessor:r=>r.total_points, sortBy:r=>r.total_points},
        {header:"Form", accessor:r=>+r.form, sortBy:r=>+r.form},
        {header:"Own%", accessor:r=>+r.selected_by_percent, cell:r=> `${Number(r.selected_by_percent).toFixed(1)}%`, sortBy:r=>+r.selected_by_percent},
        {header:"PPM", accessor:r=>r.ppm, cell:r=> r.ppm.toFixed(2), sortBy:r=>r.ppm},
        {header:"xGI/90 (L5)", accessor:r=>r._xgi90!=null? r._xgi90 : "", sortBy:r=>r._xgi90 ?? -1}
      ];
      card.append(utils.el("h3",{},"All Players"), ui.table(cols, rows));
    }

    async function addXgi(rows){
      const box = utils.el("div",{class:"tag"},"Calculating xGI/90 (last 5) for visible rows…");
      card.prepend(box);
      for (let i=0;i<rows.length;i++){
        const r = rows[i];
        try{
          const sum = await api.elementSummary(r.id);
          const lastFinished = (state.bootstrap.events.filter(e=>e.data_checked).slice(-1)[0]?.id||1);
          const last5 = sum.history.filter(h=>h.round <= lastFinished).slice(-5);
          const mins = last5.reduce((a,b)=>a+(b.minutes||0),0);
          const exgi = last5.reduce((a,b)=>a+(+b.expected_goal_involvements||0),0);
          r._xgi90 = mins ? +(exgi/(mins/90)).toFixed(2) : 0;
        }catch{ r._xgi90 = 0; }
        if ((i%15)===0) await utils.sleep(100);
      }
      box.textContent = "xGI/90 added.";
    }

    function filterSort(){
      card.innerHTML="";
      const qv = q.value.trim().toLowerCase();
      const pid = +posSel.value || null;
      const tid = +teamSel.value || null;
      const min = priceMin.value ? +priceMin.value : null;
      const max = priceMax.value ? +priceMax.value : null;
      const [sortKey, dir] = sortSel.value.split(" ");
      let rows = working.filter(p=>{
        if (qv && !(`${p.first_name} ${p.second_name} ${p.web_name}`.toLowerCase().includes(qv))) return false;
        if (pid && p.element_type !== pid) return false;
        if (tid && p.team !== tid) return false;
        if (min!=null && p.price_m < min) return false;
        if (max!=null && p.price_m > max) return false;
        return true;
      });
      rows.sort((a,b)=>{
        const av=a[sortKey], bv=b[sortKey];
        const cmp = (av>bv)-(av<bv);
        return dir==="desc" ? -cmp : cmp;
      });
      const top = rows.slice(0, 600);
      renderChart(top).then(()=>{
        renderTable(top);
        if (xgiChk.querySelector("input").checked){
          addXgi(top).then(()=>{
            const tables = card.querySelectorAll("table");
            tables.forEach(t=>t.remove());
            renderTable(top);
          });
        }
      });
    }

    const container = utils.el("div");
    container.append(utils.el("div",{class:"card"},[utils.el("h3",{},"Filters & Sort (use Apply)"), controls]));
    container.append(card);
    ui.mount(main, container);

    applyBtn.addEventListener("click", filterSort);
    filterSort();
  }catch(e){
    ui.mount(main, ui.error("Failed to load All Players", e));
  }
}
