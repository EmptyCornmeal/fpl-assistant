// js/components/ui.js
import { utils } from "../utils.js";
import { log } from "../logger.js";
import { formatPageUpdated, getPageFreshnessClass } from "../state.js";

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

  /**
   * Error card with retry button
   * @param {Object} options
   * @param {string} options.title - Error title
   * @param {string} options.message - Error message
   * @param {Error|string} options.error - Original error
   * @param {Function} options.onRetry - Retry callback
   * @param {Function} options.onDismiss - Optional dismiss callback
   */
  errorCard({ title = "Something went wrong", message = "", error = null, onRetry = null, onDismiss = null } = {}) {
    const card = utils.el("div", { class: "error-card" });

    // Header
    const header = utils.el("div", { class: "error-card-header" });
    header.append(utils.el("span", { class: "error-card-icon" }, "⚠️"));
    header.append(utils.el("span", { class: "error-card-title" }, title));
    card.append(header);

    // Message
    if (message) {
      card.append(utils.el("p", { class: "error-card-message" }, message));
    }

    // Error details
    if (error) {
      const errorText = typeof error === "string" ? error : (error.message || String(error));
      card.append(utils.el("div", { class: "error-card-details" }, errorText));
      log.error(`${title}: ${errorText}`);
    }

    // Actions
    const actions = utils.el("div", { class: "error-card-actions" });

    if (onRetry) {
      const retryBtn = utils.el("button", { class: "btn-retry" }, "Retry");
      retryBtn.addEventListener("click", async () => {
        retryBtn.disabled = true;
        retryBtn.textContent = "Retrying...";
        try {
          await onRetry();
        } catch (e) {
          log.error("Retry failed:", e);
          retryBtn.disabled = false;
          retryBtn.textContent = "Retry";
        }
      });
      actions.append(retryBtn);
    }

    if (onDismiss) {
      const dismissBtn = utils.el("button", { class: "btn-secondary" }, "Dismiss");
      dismissBtn.addEventListener("click", onDismiss);
      actions.append(dismissBtn);
    }

    if (actions.children.length > 0) {
      card.append(actions);
    }

    return card;
  },

  /**
   * Page metadata bar showing last updated time
   * @param {string} pageName - Name of the page for tracking
   */
  pageMeta(pageName) {
    const meta = utils.el("div", { class: "page-meta" });

    const updateTime = formatPageUpdated(pageName);
    const freshnessClass = getPageFreshnessClass(pageName);

    if (updateTime) {
      const updated = utils.el("span", {
        class: `page-updated ${freshnessClass}`.trim()
      }, `Updated ${updateTime}`);
      meta.append(updated);
    }

    return meta;
  },

  /**
   * Setup prompt for missing configuration
   * @param {Object} options
   * @param {string[]} options.missing - List of missing config items
   * @param {Function} options.onSave - Save callback with { entryId, leagueIds }
   * @param {Function} options.onSkip - Optional skip callback
   * @param {string} options.context - Context message (e.g., "to view your team")
   */
  setupPrompt({ missing = [], onSave, onSkip = null, context = "" } = {}) {
    const prompt = utils.el("div", { class: "setup-prompt" });

    // Icon
    prompt.append(utils.el("div", { class: "setup-prompt-icon" }, "⚙️"));

    // Title
    prompt.append(utils.el("h2", {}, "Setup Required"));

    // Subtitle
    const subtitle = context
      ? `Please configure your FPL details ${context}.`
      : "Please configure your FPL details to continue.";
    prompt.append(utils.el("p", { class: "setup-prompt-subtitle" }, subtitle));

    // Missing items warning
    if (missing.length > 0) {
      const missingBox = utils.el("div", { class: "setup-prompt-missing" });
      missingBox.append(utils.el("div", { class: "setup-prompt-missing-title" }, "Missing configuration:"));
      const list = utils.el("ul", { class: "setup-prompt-missing-list" });
      missing.forEach(item => {
        const label = item === "entryId" ? "FPL Entry ID" :
                     item === "leagueIds" ? "League IDs" : item;
        list.append(utils.el("li", {}, label));
      });
      missingBox.append(list);
      prompt.append(missingBox);
    }

    // Form fields
    const fields = utils.el("div", { class: "setup-prompt-fields" });

    // Entry ID field
    const entryField = utils.el("div", { class: "setup-prompt-field" });
    entryField.innerHTML = `
      <label>FPL Entry ID</label>
      <input type="text" id="setupEntryId" placeholder="e.g., 1234567 or paste your FPL team URL" inputmode="numeric" />
      <div class="field-hint">Find this in your FPL team URL: fantasy.premierleague.com/entry/<strong>1234567</strong>/history</div>
    `;
    fields.append(entryField);

    // League IDs field
    const leagueField = utils.el("div", { class: "setup-prompt-field" });
    leagueField.innerHTML = `
      <label>Classic League IDs (optional)</label>
      <input type="text" id="setupLeagueIds" placeholder="e.g., 12345, 67890 or paste league URLs" />
      <div class="field-hint">Comma-separated list of league IDs or URLs</div>
    `;
    fields.append(leagueField);

    prompt.append(fields);

    // Actions
    const actions = utils.el("div", { class: "setup-prompt-actions" });

    const saveBtn = utils.el("button", { class: "btn-save" }, "Save & Continue");
    saveBtn.addEventListener("click", () => {
      const entryInput = prompt.querySelector("#setupEntryId");
      const leagueInput = prompt.querySelector("#setupLeagueIds");

      // Extract entry ID (handle URLs)
      const entryRaw = entryInput?.value?.trim() || "";
      let entryId = null;
      const entryMatch = entryRaw.match(/\/entry\/(\d+)/) || entryRaw.match(/^(\d+)$/);
      if (entryMatch) entryId = Number(entryMatch[1]);

      // Extract league IDs (handle URLs and comma-separated)
      const leagueRaw = leagueInput?.value || "";
      const leagueIds = leagueRaw
        .split(",")
        .map(s => s.trim())
        .flatMap(tok => {
          const n = tok.match(/^\d+$/);
          if (n) return [Number(n[0])];
          const m = tok.match(/\/leagues\/classic\/(\d+)\b/);
          if (m) return [Number(m[1])];
          return [];
        });

      // Validate entry ID is required
      if (!entryId) {
        entryField.classList.add("has-error");
        entryField.classList.remove("has-value");
        return;
      }
      entryField.classList.remove("has-error");
      entryField.classList.add("has-value");

      if (onSave) {
        onSave({ entryId, leagueIds });
      }
    });
    actions.append(saveBtn);

    if (onSkip) {
      const skipBtn = utils.el("button", { class: "btn-skip" }, "Skip for now");
      skipBtn.addEventListener("click", onSkip);
      actions.append(skipBtn);
    }

    prompt.append(actions);

    return prompt;
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

    // Create scrollable wrapper container
    const wrapper = utils.el("div",{class:"table-scroll-wrapper"});
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
    wrapper.append(table);

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
    return wrapper;
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
