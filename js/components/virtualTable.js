// js/components/virtualTable.js
// Phase 9: Virtual scrolling for large tables
// Renders only visible rows for better performance with 600+ player tables

import { utils } from "../utils.js";

/**
 * Configuration for virtual table
 */
const DEFAULT_CONFIG = {
  rowHeight: 48,           // Estimated row height in pixels
  overscan: 5,             // Extra rows to render above/below viewport
  initialChunkSize: 50,    // Initial rows to render
  chunkSize: 25,           // Rows to add when scrolling near bottom
  throttleMs: 16,          // Scroll event throttle (60fps)
};

/**
 * Creates a virtualized table that only renders visible rows
 * @param {Object} options - Configuration options
 * @param {Array} options.columns - Column definitions [{header, accessor, cell, sortBy, thClass, tdClass}]
 * @param {Array} options.data - Full data array
 * @param {Object} options.config - Override default config
 * @returns {HTMLElement} Virtual table container
 */
export function createVirtualTable(options) {
  const { columns, data, config = {} } = options;
  const cfg = { ...DEFAULT_CONFIG, ...config };

  let renderedCount = Math.min(cfg.initialChunkSize, data.length);
  let isLoading = false;

  // Container with scroll listener
  const container = utils.el("div", { class: "virtual-table-container" });
  container.style.cssText = "position:relative;overflow:auto;max-height:600px;";

  // Table element
  const table = utils.el("table", { class: "virtual-table" });

  // Header
  const thead = utils.el("thead");
  const headerRow = utils.el("tr");
  columns.forEach(col => {
    const th = utils.el("th", { class: col.thClass || "" }, col.header || "");
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = utils.el("tbody");
  table.appendChild(tbody);

  // Loading indicator
  const loadingIndicator = utils.el("div", { class: "virtual-table-loading" });
  loadingIndicator.style.cssText = "text-align:center;padding:12px;display:none;color:var(--text-secondary);";
  loadingIndicator.innerHTML = '<span class="spinner"></span> Loading more...';

  // Render visible rows
  function renderRows(start = 0, count = renderedCount) {
    const fragment = document.createDocumentFragment();

    for (let i = start; i < Math.min(start + count, data.length); i++) {
      const row = data[i];
      const tr = utils.el("tr");

      columns.forEach(col => {
        const td = utils.el("td", { class: col.tdClass || "" });

        if (col.cell) {
          // Custom cell renderer
          const content = col.cell(row, i);
          if (typeof content === "string") {
            td.innerHTML = content;
          } else if (content instanceof Node) {
            td.appendChild(content);
          } else {
            td.textContent = String(content ?? "");
          }
        } else if (col.accessor) {
          // Simple accessor
          const value = typeof col.accessor === "function" ? col.accessor(row) : row[col.accessor];
          td.textContent = String(value ?? "");
        }

        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    }

    return fragment;
  }

  // Initial render
  tbody.appendChild(renderRows(0, renderedCount));

  // Load more rows when scrolling near bottom
  function loadMore() {
    if (isLoading || renderedCount >= data.length) return;

    isLoading = true;
    loadingIndicator.style.display = "block";

    // Use requestAnimationFrame for smooth rendering
    requestAnimationFrame(() => {
      const newRows = Math.min(cfg.chunkSize, data.length - renderedCount);
      const fragment = renderRows(renderedCount, newRows);
      tbody.appendChild(fragment);
      renderedCount += newRows;

      isLoading = false;
      loadingIndicator.style.display = "none";
    });
  }

  // Throttled scroll handler
  let lastScrollTime = 0;
  function onScroll() {
    const now = Date.now();
    if (now - lastScrollTime < cfg.throttleMs) return;
    lastScrollTime = now;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const scrollBottom = scrollHeight - scrollTop - clientHeight;

    // Load more when within 200px of bottom
    if (scrollBottom < 200 && renderedCount < data.length) {
      loadMore();
    }
  }

  container.addEventListener("scroll", onScroll, { passive: true });

  // Progress indicator
  const progressBar = utils.el("div", { class: "virtual-table-progress" });
  progressBar.style.cssText = `
    position:sticky;
    bottom:0;
    left:0;
    right:0;
    height:3px;
    background:var(--surface-2);
    overflow:hidden;
  `;
  const progressFill = utils.el("div");
  progressFill.style.cssText = `
    height:100%;
    background:var(--accent);
    transition:width 0.2s ease;
    width:${Math.round(renderedCount / data.length * 100)}%;
  `;
  progressBar.appendChild(progressFill);

  // Update progress on scroll
  const updateProgress = () => {
    progressFill.style.width = `${Math.round(renderedCount / data.length * 100)}%`;
  };

  const originalLoadMore = loadMore;
  const loadMoreWithProgress = () => {
    originalLoadMore();
    updateProgress();
  };

  // Assemble
  container.appendChild(table);
  container.appendChild(loadingIndicator);
  if (data.length > cfg.initialChunkSize) {
    container.appendChild(progressBar);
  }

  // Public API
  container.virtualTable = {
    getRenderedCount: () => renderedCount,
    getTotalCount: () => data.length,
    loadAll: () => {
      while (renderedCount < data.length) {
        const fragment = renderRows(renderedCount, cfg.chunkSize);
        tbody.appendChild(fragment);
        renderedCount += Math.min(cfg.chunkSize, data.length - renderedCount);
      }
      updateProgress();
    },
    refresh: (newData) => {
      tbody.innerHTML = "";
      data.length = 0;
      data.push(...newData);
      renderedCount = Math.min(cfg.initialChunkSize, data.length);
      tbody.appendChild(renderRows(0, renderedCount));
      updateProgress();
    },
  };

  return container;
}

/**
 * Progressive table - renders in chunks with "Load More" button
 * Alternative to virtual scrolling for simpler UX
 */
export function createProgressiveTable(options) {
  const { columns, data, config = {} } = options;
  const cfg = { ...DEFAULT_CONFIG, ...config };

  let renderedCount = Math.min(cfg.initialChunkSize, data.length);

  const wrapper = utils.el("div", { class: "progressive-table-wrapper" });

  // Table
  const table = utils.el("table", { class: "progressive-table" });

  // Header
  const thead = utils.el("thead");
  const headerRow = utils.el("tr");
  columns.forEach(col => {
    const th = utils.el("th", { class: col.thClass || "" }, col.header || "");
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = utils.el("tbody");
  table.appendChild(tbody);

  // Render rows
  function renderRows(start, count) {
    const fragment = document.createDocumentFragment();
    for (let i = start; i < Math.min(start + count, data.length); i++) {
      const row = data[i];
      const tr = utils.el("tr");

      columns.forEach(col => {
        const td = utils.el("td", { class: col.tdClass || "" });
        if (col.cell) {
          const content = col.cell(row, i);
          if (typeof content === "string") {
            td.innerHTML = content;
          } else if (content instanceof Node) {
            td.appendChild(content);
          } else {
            td.textContent = String(content ?? "");
          }
        } else if (col.accessor) {
          const value = typeof col.accessor === "function" ? col.accessor(row) : row[col.accessor];
          td.textContent = String(value ?? "");
        }
        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    }
    return fragment;
  }

  // Initial render
  tbody.appendChild(renderRows(0, renderedCount));

  // Status bar
  const statusBar = utils.el("div", { class: "progressive-table-status" });
  statusBar.style.cssText = `
    display:flex;
    justify-content:space-between;
    align-items:center;
    padding:12px;
    background:var(--surface-2);
    border-radius:0 0 8px 8px;
  `;

  const statusText = utils.el("span", { class: "status-text" });
  const updateStatus = () => {
    statusText.textContent = `Showing ${renderedCount} of ${data.length} players`;
  };
  updateStatus();

  const loadMoreBtn = utils.el("button", { class: "btn-ghost" }, "Load More");
  loadMoreBtn.style.display = renderedCount >= data.length ? "none" : "";

  loadMoreBtn.addEventListener("click", () => {
    const newRows = Math.min(cfg.chunkSize, data.length - renderedCount);
    tbody.appendChild(renderRows(renderedCount, newRows));
    renderedCount += newRows;
    updateStatus();
    if (renderedCount >= data.length) {
      loadMoreBtn.style.display = "none";
    }
  });

  const loadAllBtn = utils.el("button", { class: "btn-primary" }, "Load All");
  loadAllBtn.style.display = renderedCount >= data.length ? "none" : "";

  loadAllBtn.addEventListener("click", () => {
    tbody.appendChild(renderRows(renderedCount, data.length - renderedCount));
    renderedCount = data.length;
    updateStatus();
    loadMoreBtn.style.display = "none";
    loadAllBtn.style.display = "none";
  });

  statusBar.appendChild(statusText);
  const btnGroup = utils.el("div", { style: "display:flex;gap:8px" });
  btnGroup.appendChild(loadMoreBtn);
  btnGroup.appendChild(loadAllBtn);
  statusBar.appendChild(btnGroup);

  wrapper.appendChild(table);
  if (data.length > cfg.initialChunkSize) {
    wrapper.appendChild(statusBar);
  }

  // Public API
  wrapper.progressiveTable = {
    getRenderedCount: () => renderedCount,
    getTotalCount: () => data.length,
    loadAll: () => {
      loadAllBtn.click();
    },
    refresh: (newData) => {
      tbody.innerHTML = "";
      data.length = 0;
      data.push(...newData);
      renderedCount = Math.min(cfg.initialChunkSize, data.length);
      tbody.appendChild(renderRows(0, renderedCount));
      updateStatus();
      loadMoreBtn.style.display = renderedCount >= data.length ? "none" : "";
      loadAllBtn.style.display = renderedCount >= data.length ? "none" : "";
    },
  };

  return wrapper;
}

export default {
  createVirtualTable,
  createProgressiveTable,
};
