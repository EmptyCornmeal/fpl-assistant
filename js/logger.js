// js/logger.js
// Tiny logger utility with console output + optional on-screen dev panel

const LOG_LEVELS = {
  info: { label: 'INFO', color: '#3b82f6', priority: 0 },
  warn: { label: 'WARN', color: '#f59e0b', priority: 1 },
  error: { label: 'ERROR', color: '#ef4444', priority: 2 },
};

const MAX_LOG_ENTRIES = 100;
const logHistory = [];

let devPanelVisible = false;
let devPanelEl = null;

/**
 * Core log function
 */
function logMessage(level, ...args) {
  const config = LOG_LEVELS[level] || LOG_LEVELS.info;
  const timestamp = new Date().toISOString();
  const message = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
  ).join(' ');

  // Console output
  const consoleMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleMethod(`[${config.label}] ${timestamp.split('T')[1].split('.')[0]}:`, ...args);

  // Store in history
  const entry = { level, timestamp, message, args };
  logHistory.push(entry);
  if (logHistory.length > MAX_LOG_ENTRIES) {
    logHistory.shift();
  }

  // Update dev panel if visible
  if (devPanelVisible && devPanelEl) {
    appendLogToPanel(entry);
  }

  return entry;
}

/**
 * Create the dev panel DOM element
 */
function createDevPanel() {
  if (devPanelEl) return devPanelEl;

  const panel = document.createElement('div');
  panel.id = 'devLogPanel';
  panel.className = 'dev-log-panel';
  panel.innerHTML = `
    <div class="dev-log-header">
      <span class="dev-log-title">Dev Console</span>
      <div class="dev-log-controls">
        <button class="dev-log-clear" title="Clear logs">Clear</button>
        <button class="dev-log-close" title="Close panel">&times;</button>
      </div>
    </div>
    <div class="dev-log-filters">
      <label><input type="checkbox" data-level="info" checked> Info</label>
      <label><input type="checkbox" data-level="warn" checked> Warn</label>
      <label><input type="checkbox" data-level="error" checked> Error</label>
    </div>
    <div class="dev-log-content"></div>
  `;

  // Bind events
  panel.querySelector('.dev-log-close').addEventListener('click', () => log.hideDevPanel());
  panel.querySelector('.dev-log-clear').addEventListener('click', () => {
    logHistory.length = 0;
    panel.querySelector('.dev-log-content').innerHTML = '';
  });

  // Filter checkboxes
  panel.querySelectorAll('.dev-log-filters input').forEach(cb => {
    cb.addEventListener('change', () => refreshPanelContent());
  });

  devPanelEl = panel;
  return panel;
}

/**
 * Append a single log entry to the panel
 */
function appendLogToPanel(entry) {
  if (!devPanelEl) return;

  const content = devPanelEl.querySelector('.dev-log-content');
  const config = LOG_LEVELS[entry.level];

  // Check if filtered
  const checkbox = devPanelEl.querySelector(`input[data-level="${entry.level}"]`);
  if (checkbox && !checkbox.checked) return;

  const row = document.createElement('div');
  row.className = `dev-log-entry dev-log-${entry.level}`;
  row.innerHTML = `
    <span class="dev-log-time">${entry.timestamp.split('T')[1].split('.')[0]}</span>
    <span class="dev-log-level" style="color:${config.color}">[${config.label}]</span>
    <span class="dev-log-message">${escapeHtml(entry.message)}</span>
  `;
  content.appendChild(row);

  // Auto-scroll to bottom
  content.scrollTop = content.scrollHeight;
}

/**
 * Refresh all log entries in the panel based on current filters
 */
function refreshPanelContent() {
  if (!devPanelEl) return;

  const content = devPanelEl.querySelector('.dev-log-content');
  content.innerHTML = '';

  logHistory.forEach(entry => appendLogToPanel(entry));
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Logger API
 */
export const log = {
  info: (...args) => logMessage('info', ...args),
  warn: (...args) => logMessage('warn', ...args),
  error: (...args) => logMessage('error', ...args),

  /**
   * Get log history
   */
  getHistory: () => [...logHistory],

  /**
   * Clear log history
   */
  clear: () => { logHistory.length = 0; },

  /**
   * Show the dev panel
   */
  showDevPanel: () => {
    const panel = createDevPanel();
    if (!panel.parentElement) {
      document.body.appendChild(panel);
    }
    panel.classList.add('visible');
    devPanelVisible = true;
    refreshPanelContent();
  },

  /**
   * Hide the dev panel
   */
  hideDevPanel: () => {
    if (devPanelEl) {
      devPanelEl.classList.remove('visible');
    }
    devPanelVisible = false;
  },

  /**
   * Toggle the dev panel
   */
  toggleDevPanel: () => {
    if (devPanelVisible) {
      log.hideDevPanel();
    } else {
      log.showDevPanel();
    }
  },

  /**
   * Check if dev panel is visible
   */
  isDevPanelVisible: () => devPanelVisible,
};

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.fplLog = log;
}
