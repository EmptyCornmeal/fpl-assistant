// js/components/ui.js
import { utils } from "../utils.js";
import { log } from "../logger.js";
import { formatPageUpdated, getPageFreshnessClass } from "../state.js";
import { formatCacheAge, getErrorMessage, ErrorType } from "../api/fetchHelper.js";

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
   * Degraded state card with Retry and Use Cached Data options
   * Shows when a fetch fails but cached data is available
   * @param {Object} options
   * @param {string} options.title - Error title
   * @param {string} options.message - Error message (or auto-generated from errorType)
   * @param {string} options.errorType - Error type from fetchHelper
   * @param {number} options.cacheAge - Age of cached data in ms
   * @param {Function} options.onRetry - Retry callback
   * @param {Function} options.onUseCached - Use cached data callback
   */
  degradedCard({ title = "Connection Issue", message = "", errorType = null, cacheAge = null, onRetry = null, onUseCached = null } = {}) {
    const card = utils.el("div", { class: "degraded-card" });

    // Header
    const header = utils.el("div", { class: "degraded-card-header" });
    header.append(utils.el("span", { class: "degraded-card-icon" }, "⚠️"));
    header.append(utils.el("span", { class: "degraded-card-title" }, title));
    card.append(header);

    // Message - use provided or generate from errorType
    const displayMessage = message || (errorType ? getErrorMessage(errorType) : "Unable to load fresh data.");
    card.append(utils.el("p", { class: "degraded-card-message" }, displayMessage));

    // Cache info
    if (cacheAge !== null && onUseCached) {
      const cacheInfo = utils.el("div", { class: "degraded-card-cache-info" });
      cacheInfo.innerHTML = `
        <span class="cache-icon">💾</span>
        <span class="cache-text">Cached data available from <strong>${formatCacheAge(cacheAge)}</strong></span>
      `;
      card.append(cacheInfo);
    }

    // Actions
    const actions = utils.el("div", { class: "degraded-card-actions" });

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

    if (onUseCached && cacheAge !== null) {
      const cacheBtn = utils.el("button", { class: "btn-use-cached" }, "Use Cached Data");
      cacheBtn.addEventListener("click", () => {
        if (onUseCached) onUseCached();
      });
      actions.append(cacheBtn);
    }

    if (actions.children.length > 0) {
      card.append(actions);
    }

    return card;
  },

  /**
   * Banner shown when viewing cached data
   * @param {Object} options
   * @param {number} options.cacheAge - Age of cached data in ms
   * @param {Function} options.onRefresh - Optional refresh callback
   * @param {Function} options.onDismiss - Optional dismiss callback
   */
  cachedBanner({ cacheAge = 0, onRefresh = null, onDismiss = null } = {}) {
    const banner = utils.el("div", { class: "cached-banner" });

    const content = utils.el("div", { class: "cached-banner-content" });
    content.innerHTML = `
      <span class="cached-banner-icon">📡</span>
      <span class="cached-banner-text">
        <strong>Offline Mode</strong> — Using cached data from ${formatCacheAge(cacheAge)}
      </span>
    `;

    banner.append(content);

    const actions = utils.el("div", { class: "cached-banner-actions" });

    if (onRefresh) {
      const refreshBtn = utils.el("button", { class: "btn-banner-refresh" }, "Try Again");
      refreshBtn.addEventListener("click", async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = "Refreshing...";
        try {
          await onRefresh();
        } catch {
          refreshBtn.disabled = false;
          refreshBtn.textContent = "Try Again";
        }
      });
      actions.append(refreshBtn);
    }

    if (onDismiss) {
      const dismissBtn = utils.el("button", { class: "btn-banner-dismiss" }, "✕");
      dismissBtn.title = "Dismiss";
      dismissBtn.addEventListener("click", () => {
        banner.remove();
        if (onDismiss) onDismiss();
      });
      actions.append(dismissBtn);
    }

    banner.append(actions);

    return banner;
  },

  /**
   * Loading state with timeout warning
   * Shows a spinner initially, then adds a warning after timeout threshold
   * @param {string} message - Loading message
   * @param {number} warnAfterMs - Show warning after this many ms (default: 5000)
   */
  loadingWithTimeout(message = "Loading...", warnAfterMs = 5000) {
    const wrap = utils.el("div", { class: "loading-state" });

    const spinner = utils.el("div", { class: "loading-spinner-large" });
    wrap.append(spinner);

    const msg = utils.el("div", { class: "loading-message" }, message);
    wrap.append(msg);

    const warning = utils.el("div", { class: "loading-warning hidden" });
    warning.textContent = "This is taking longer than expected...";
    wrap.append(warning);

    // Show warning after timeout
    const timeoutId = setTimeout(() => {
      warning.classList.remove("hidden");
    }, warnAfterMs);

    // Clean up timeout when element is removed
    wrap._cleanupTimeout = () => clearTimeout(timeoutId);

    return wrap;
  },

  /**
   * Mount content with optional cached banner
   * @param {HTMLElement} main - Main container
   * @param {HTMLElement} node - Content to mount
   * @param {Object} options - Mount options
   * @param {boolean} options.fromCache - Whether content is from cache
   * @param {number} options.cacheAge - Age of cached data
   * @param {Function} options.onRefresh - Refresh callback for banner
   */
  mountWithCache(main, node, options = {}) {
    const { fromCache = false, cacheAge = 0, onRefresh = null } = options;

    main.innerHTML = "";

    // Add cached banner if using cached data
    if (fromCache && cacheAge > 0) {
      const banner = this.cachedBanner({
        cacheAge,
        onRefresh,
        onDismiss: () => {},
      });
      main.append(banner);
    }

    main.append(node);
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

  /**
   * Progressive table - renders in chunks for better performance with large datasets
   * Phase 9: Optimized rendering for 600+ row tables
   * @param {Array} columns - Column definitions
   * @param {Array} rows - Data rows
   * @param {Object} options - Configuration
   * @param {number} options.initialChunk - Initial rows to render (default: 50)
   * @param {number} options.chunkSize - Rows to add per chunk (default: 25)
   * @param {boolean} options.enableAutoScroll - Load more on scroll (default: true)
   */
  progressiveTable(columns, rows, options = {}) {
    const {
      initialChunk = 50,
      chunkSize = 25,
      enableAutoScroll = true,
    } = options;

    let renderedCount = Math.min(initialChunk, rows.length);
    let sortIdx = -1, sortDir = "asc";
    let sortedRows = rows.slice();

    // Container
    const container = utils.el("div", { class: "progressive-table-container" });

    // Table
    const wrapper = utils.el("div", { class: "table-scroll-wrapper" });
    const table = utils.el("table", { class: "table" });
    const thead = utils.el("thead");
    const tbody = utils.el("tbody");

    // Header
    const trh = utils.el("tr");
    columns.forEach((c, i) => {
      const th = utils.el("th", { class: c.sortBy || c.accessor ? "th-sortable" : "" }, c.header);
      if (c.className) th.classList.add(c.className);
      if (c.thClass) th.classList.add(c.thClass);
      if (c.sortBy || c.accessor) {
        th.addEventListener("click", () => {
          if (sortIdx === i) { sortDir = sortDir === "asc" ? "desc" : "asc"; }
          else { sortIdx = i; sortDir = "asc"; }
          resortAndRender();
          [...thead.querySelectorAll("th")].forEach(el => el.classList.remove("active", "asc", "desc"));
          th.classList.add("active", sortDir);
        });
      }
      trh.append(th);
    });
    thead.append(trh);
    table.append(thead, tbody);
    wrapper.append(table);

    // Helper functions
    function getVal(r, col) {
      if (typeof col.sortBy === "function") return col.sortBy(r);
      if (typeof col.accessor === "function") return col.accessor(r);
      if (typeof col.accessor === "string") return r[col.accessor];
      return "";
    }

    function createRow(r) {
      const tr = utils.el("tr");
      columns.forEach(c => {
        const td = utils.el("td");
        if (c.tdClass) {
          const cls = typeof c.tdClass === "function" ? c.tdClass(r) : c.tdClass;
          if (Array.isArray(cls)) td.classList.add(...cls.filter(Boolean));
          else if (cls) td.classList.add(cls);
        }
        const val = typeof c.cell === "function" ? c.cell(r) :
                    (c.accessor ? (typeof c.accessor === "function" ? c.accessor(r) : r[c.accessor]) : "");
        if (val instanceof HTMLElement) td.append(val);
        else td.textContent = val ?? "";
        tr.append(td);
      });
      return tr;
    }

    function renderChunk(start, count) {
      const fragment = document.createDocumentFragment();
      for (let i = start; i < Math.min(start + count, sortedRows.length); i++) {
        fragment.appendChild(createRow(sortedRows[i]));
      }
      tbody.appendChild(fragment);
    }

    function resortAndRender() {
      sortedRows = rows.slice();
      if (sortIdx >= 0) {
        const col = columns[sortIdx];
        sortedRows.sort((a, b) => {
          const av = getVal(a, col), bv = getVal(b, col);
          const na = typeof av === "number" || /^[\d.]+$/.test(String(av));
          const nb = typeof bv === "number" || /^[\d.]+$/.test(String(bv));
          let cmp = 0;
          if (na && nb) cmp = (+av) - (+bv);
          else cmp = String(av).localeCompare(String(bv));
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
      tbody.innerHTML = "";
      renderedCount = Math.min(initialChunk, sortedRows.length);
      renderChunk(0, renderedCount);
      updateStatus();
    }

    // Initial render
    renderChunk(0, renderedCount);

    // Status bar
    const statusBar = utils.el("div", { class: "progressive-table-status" });
    statusBar.style.cssText = `
      display:flex;
      justify-content:space-between;
      align-items:center;
      padding:8px 12px;
      background:var(--surface-2, #1e2530);
      border-radius:0 0 8px 8px;
      font-size:0.85rem;
    `;

    const statusText = utils.el("span", { class: "status-text", style: "color:var(--text-secondary)" });
    function updateStatus() {
      statusText.textContent = `Showing ${renderedCount} of ${rows.length}`;
      loadMoreBtn.style.display = renderedCount >= rows.length ? "none" : "";
      loadAllBtn.style.display = renderedCount >= rows.length ? "none" : "";
    }

    const loadMoreBtn = utils.el("button", { class: "btn-ghost", style: "font-size:0.8rem;padding:4px 12px" }, "Load More");
    const loadAllBtn = utils.el("button", { class: "btn-ghost", style: "font-size:0.8rem;padding:4px 12px" }, "Load All");

    loadMoreBtn.addEventListener("click", () => {
      const newCount = Math.min(chunkSize, rows.length - renderedCount);
      renderChunk(renderedCount, newCount);
      renderedCount += newCount;
      updateStatus();
    });

    loadAllBtn.addEventListener("click", () => {
      renderChunk(renderedCount, rows.length - renderedCount);
      renderedCount = rows.length;
      updateStatus();
    });

    updateStatus();

    const btnGroup = utils.el("div", { style: "display:flex;gap:8px" });
    btnGroup.append(loadMoreBtn, loadAllBtn);
    statusBar.append(statusText, btnGroup);

    container.append(wrapper);
    if (rows.length > initialChunk) {
      container.append(statusBar);
    }

    // Auto-load on scroll
    if (enableAutoScroll) {
      let scrollTimeout = null;
      wrapper.addEventListener("scroll", () => {
        if (scrollTimeout) return;
        scrollTimeout = setTimeout(() => {
          scrollTimeout = null;
          const { scrollTop, scrollHeight, clientHeight } = wrapper;
          if (scrollHeight - scrollTop - clientHeight < 200 && renderedCount < rows.length) {
            loadMoreBtn.click();
          }
        }, 100);
      }, { passive: true });
    }

    // Public API
    container.progressiveTable = {
      refresh: (newRows) => {
        rows.length = 0;
        rows.push(...newRows);
        resortAndRender();
      },
      loadAll: () => loadAllBtn.click(),
      getRenderedCount: () => renderedCount,
    };

    return container;
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
