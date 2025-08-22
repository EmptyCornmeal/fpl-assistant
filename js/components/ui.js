// js/components/ui.js
import { utils } from "../utils.js";

let chartPromise = null;
async function ensureChart(){
  if (window.Chart) return window.Chart;
  if (!chartPromise){
    chartPromise = new Promise((resolve, reject)=>{
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
      s.onload = ()=> resolve(window.Chart);
      s.onerror = ()=> reject(new Error("Failed to load Chart.js"));
      document.head.appendChild(s);
    });
  }
  return chartPromise;
}

export const ui = {
  mount(main, node){ main.innerHTML=""; main.appendChild(node); },

  spinner(msg="Loading…"){
    return utils.el("div", {class:"card"}, [ utils.el("div", {class:"badge"}, "⏳ "+msg) ]);
  },

  error(title="Something went wrong", err=null){
    const box = utils.el("div",{class:"card"});
    box.append(utils.el("h3",{}, title));
    if (err) box.append(utils.el("div",{class:"tag"}, String(err?.message||err)));
    return box;
  },

  metric(label, value){
    const wrap = utils.el("div", {class:"metric"});
    wrap.append(utils.el("div",{class:"label"},label));
    wrap.append(utils.el("div",{class:"value"},value));
    return wrap;
  },

  // columns: [{ header, accessor?, cell?, sortBy?, className?, tdClass?(row)->string|string[] }]
  table(columns, rows){
    let sortIdx = -1, sortDir = "asc";
    const table = utils.el("table",{class:"table"});
    const thead = utils.el("thead");
    const trh = utils.el("tr");
    columns.forEach((c, i)=>{
      const th = utils.el("th", {class: c.sortBy || c.accessor ? "th-sortable" : ""}, c.header);
      if (c.className) th.classList.add(c.className);
      if (c.sortBy || c.accessor){
        th.addEventListener("click", ()=>{
          if (sortIdx === i){ sortDir = (sortDir === "asc" ? "desc" : "asc"); }
          else { sortIdx = i; sortDir = "asc"; }
          renderBody();
          [...thead.querySelectorAll("th")].forEach(el=>el.classList.remove("active","asc","desc"));
          th.classList.add("active", sortDir);
        });
      }
      trh.append(th);
    });
    thead.append(trh);

    const tbody = utils.el("tbody");
    table.append(thead, tbody);

    function getVal(r, col){
      if (typeof col.sortBy === "function") return col.sortBy(r);
      if (typeof col.accessor === "function") return col.accessor(r);
      if (typeof col.accessor === "string") return r[col.accessor];
      return (typeof col.cell === "function") ? col.cell(r)?.textContent ?? "" : "";
    }

    function renderBody(){
      const data = rows.slice();
      if (sortIdx >= 0){
        const col = columns[sortIdx];
        data.sort((a,b)=>{
          const av = getVal(a,col); const bv = getVal(b,col);
          const na = typeof av === "number" || /^[\d.]+$/.test(String(av));
          const nb = typeof bv === "number" || /^[\d.]+$/.test(String(bv));
          let cmp = 0;
          if (na && nb) cmp = (+av) - (+bv);
          else cmp = String(av).localeCompare(String(bv));
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
      tbody.innerHTML = "";
      data.forEach(r=>{
        const tr = utils.el("tr");
        columns.forEach(c=>{
          const td = utils.el("td");
          const val = typeof c.cell === "function" ? c.cell(r) :
                      (c.accessor ? (typeof c.accessor==="function" ? c.accessor(r) : r[c.accessor]) : "");
          if (val instanceof HTMLElement) td.append(val); else td.textContent = val ?? "";
          if (typeof c.tdClass === "function"){
            const cls = c.tdClass(r);
            if (Array.isArray(cls)) td.classList.add(...cls.filter(Boolean));
            else if (cls) td.classList.add(cls);
          }
          tr.append(td);
        });
        tbody.append(tr);
      });
    }
    renderBody();
    return table;
  },

  async chart(canvas, cfg, previousInstance=null){
    try{
      const Chart = await ensureChart();
      if (previousInstance && typeof previousInstance.destroy === "function"){
        try{ previousInstance.destroy(); }catch{}
      }
      return new Chart(canvas.getContext("2d"), cfg);
    }catch(err){
      const parent = canvas.parentElement;
      if (parent) parent.replaceChild(this.error("Chart failed to render", err), canvas);
      return null;
    }
  },

  copyButton(getText, label="Copy"){
    const btn = utils.el("button",{class:"btn-primary"}, label);
    btn.addEventListener("click", async ()=>{
      const txt = typeof getText === "function" ? getText() : String(getText);
      await navigator.clipboard.writeText(txt);
      btn.textContent = "Copied!";
      setTimeout(()=> btn.textContent = label, 1200);
    });
    return btn;
  }
};
