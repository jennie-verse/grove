import {
  ALIGNMENTS,
  EDGE_DASHES,
  EDGE_TYPES,
  FONT_OPTIONS,
  MAX_FILE_BYTES,
  PALETTE,
  SHAPES,
  addCrossLink,
  addNode,
  backupEnvelope,
  canonicalMap,
  childrenOf,
  clone,
  connectedCrossLinks,
  createMap,
  descendantsOf,
  duplicateNode,
  nodeById,
  normalizeOrders,
  now,
  parseGroveFile,
  removeCrossLink,
  removeNode,
  reparentNode,
  reorderNode,
  safeFilename,
  sanitizeMap,
  uid,
} from "./model.js";
import {
  clearAll,
  deleteRecord,
  getRecord,
  getView,
  listRecords,
  openDB,
  persistentStorageStatus,
  putMany,
  putRecord,
  putView,
  replaceAll,
  storageEstimate,
} from "./store.js";
import { HistoryManager } from "./history.js";
import { renderMarkdown } from "./markdown.js";
import * as sync from "./sync.js";
import * as syncRunner from "./sync-runner.js";
import * as journal from "./journal.js";
import { APP_BUILD } from "./version.js";
import { createSessionTracker } from "./activity-session.js";
import { MAP_MUTATION_ACTIONS, canMutateMapState, canPersistViewState } from "./mode-policy.js";
import {
  backupJsonFile,
  canShareFile,
  cloneWithNewMapId,
  createPngFile,
  createSvgFile,
  downloadFile,
  mapJsonFile,
  shareFile,
} from "./formats.js";

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character]));

const app = $("#app");
const preferenceKey = "grove-preferences-v2";
const defaultPreferences = {
  theme: "system",
  uiSize: 12,
  spacing: "normal",
  lastBackupAt: null,
};

// One-time fresh-start reset for the 2026.09.05 first-release rebuild. Wipes
// only grove's own localStorage keys and its own IndexedDB database — never
// "sync.token.v1" (a GitHub token shared across all apps on this origin) and
// never anything under ../../shared/v1, which other apps also read. Gated on
// a dedicated marker so it runs exactly once, not on every load of this build.
function runFreshStartOnce() {
  const FRESH_START_STAMP = "2026.09.05-firstrelease1";
  try {
    if (localStorage.getItem("grove.freshStartDone") === FRESH_START_STAMP) return;
    [
      "grove-preferences-v2",
      "grove.journalEnabled.v1",
      "grove.journalActivity.v1",
      "grove.journalSessions.v1",
      "grove.syncEnabled",
      "grove.lastSyncAt",
      "grove.lastRemoteBackupAt",
      "grove.pendingEvents",
      "grove.deletedMaps",
      "grove.syncContextId",
      "grove.syncContextLabel",
    ].forEach((key) => localStorage.removeItem(key));
    indexedDB.deleteDatabase("grove-db");
    localStorage.setItem("grove.freshStartDone", FRESH_START_STAMP);
  } catch {
    // Best effort — if storage is unavailable the app still starts normally.
  }
}
runFreshStartOnce();

let preferences = readPreferences();
let composing = false;
let saveTimer = null;
let viewTimer = null;
let pointerFrame = null;
let activeSave = null;
let pendingInlineEdit = null;
const usageSessions = createSessionTracker({
  kind: "usage-session", itemType: "mind-map", storageKey: "grove.journalSessions.v1",
  onRecord: (record) => journal.recordSession(record),
});

const state = {
  screen: "library",
  records: [],
  map: null,
  record: null,
  selected: null,
  inspectorOpen: false,
  outlineOpen: false,
  panel: "style",
  view: defaultView(),
  history: new HistoryManager(),
  dirty: false,
  saving: false,
  saveError: null,
  drag: null,
  touchPoints: new Map(),
  pinch: null,
  suppressClickUntil: 0,
  longPressTimer: null,
  linkSource: null,
  librarySearch: "",
  mapSearch: "",
  searchIndex: 0,
  modal: null,
  updateRegistration: null,
  previewOnly: false,
  previewSourceName: null,
};

function canMutateMap() {
  return canMutateMapState(state);
}

function defaultView() {
  return {
    panX: 0,
    panY: 0,
    zoom: 1,
    read: false,
    tempCollapseOverrides: [],
    tempRevealed: [],
  };
}

function readPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
    return {
      ...defaultPreferences,
      ...parsed,
      uiSize: [6, 8, 10, 12, 14, 17].includes(Number(parsed.uiSize)) ? Number(parsed.uiSize) : 12,
    };
  } catch {
    return { ...defaultPreferences };
  }
}

function savePreferences() {
  try {
    localStorage.setItem(preferenceKey, JSON.stringify(preferences));
  } catch {
    toast("Preferences will stay in this session only.", "warn");
  }
}

function applyTheme() {
  const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = preferences.theme === "system" ? (systemDark ? "dark" : "light") : preferences.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--ui-size", `${preferences.uiSize}px`);
  document.documentElement.style.setProperty("--visual-height", `${window.visualViewport?.height || window.innerHeight}px`);
  $("meta[name='theme-color']")?.setAttribute("content", theme === "dark" ? "#211C1E" : "#FDF7F8");
}

function icon(name, size = 20) {
  const paths = {
    grove: '<path d="M12 21V3m0 5 5-4m-5 8-5-4m5 6 5-4m-5 8-5-4M7 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM7 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>',
    map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="m9 3v15m6-12v15"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 1 1 0 12"/>',
    redo: '<path d="m15 7 5 5-5 5"/><path d="M20 12H10a6 6 0 1 0 0 12"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    trash: '<path d="M4 7h16M10 11v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 14h10l1-14"/>',
    duplicate: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    collapse: '<path d="m6 9 6 6 6-6"/>',
    expand: '<path d="m6 15 6-6 6 6"/>',
    fit: '<path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.2 2.2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3.1v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.2-2.2.1-.1A1.7 1.7 0 0 0 6.7 15a1.7 1.7 0 0 0-1.5-1H5v-3.1h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.2-2.2.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4h3.1v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.2 2.2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.4 1Z"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/>',
    upload: '<path d="M12 21V9m0 0 4 4m-4-4-4 4M5 3h14"/>',
    read: '<path d="M3 5a3 3 0 0 1 3-2h4a3 3 0 0 1 2 1 3 3 0 0 1 2-1h4a3 3 0 0 1 3 2v14a3 3 0 0 0-3-2h-4a3 3 0 0 0-2 1 3 3 0 0 0-2-1H6a3 3 0 0 0-3 2V5Z"/><path d="M12 5v13"/>',
    outline: '<path d="M6 6h15M6 12h15M6 18h15"/><circle cx="3" cy="6" r=".8" fill="currentColor"/><circle cx="3" cy="12" r=".8" fill="currentColor"/><circle cx="3" cy="18" r=".8" fill="currentColor"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    retry: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    share: '<path d="M12 16V3m0 0-4 4m4-4 4 4M5 12v8h14v-8"/>',
    edit: '<path d="m4 16-.8 4.8L8 20l10.8-10.8a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
    warning: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v.1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.more}</svg>`;
}

function iconButton(label, iconName, attributes = "", text = "") {
  return `<button class="icon-btn" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${attributes}>${icon(iconName)}${text ? `<span>${escapeHtml(text)}</span>` : ""}</button>`;
}

function toast(message, type = "") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  node.setAttribute("role", type === "error" ? "alert" : "status");
  $("#toasts").append(node);
  setTimeout(() => node.remove(), 4200);
}

async function init() {
  applyTheme();
  try {
    await openDB();
    await refreshLibrary();
    render();
    await registerServiceWorker();

    syncRunner.attach({
      getPreferences: () => ({
        theme: preferences.theme,
        uiSize: preferences.uiSize,
        spacing: preferences.spacing,
      }),
    });
    // Runs only when sync is enabled and a token and context exist. Failures are
    // silent: the app is fully usable offline and the queue keeps the changes.
    syncRunner.runSync().then(async (result) => {
      if (result && (result.pulled || result.removed)) {
        await refreshLibrary();
        render();
      }
      if (result && result.tooLarge && result.tooLarge.length) {
        toast(`Too large to sync: ${result.tooLarge.join(", ")}`, "warn");
      }
    }).catch(() => { /* local storage is always the source of truth */ });
  } catch (error) {
    renderFatal(error);
  }
}

function renderFatal(error) {
  app.innerHTML = `<main class="fatal"><div class="empty-tree">${icon("warning", 56)}</div><h1>Grove needs local storage</h1><p>${escapeHtml(error?.message || "Local storage could not be opened.")}</p><button class="primary-btn" id="fatal-retry">Retry</button></main>`;
  $("#fatal-retry")?.addEventListener("click", () => location.reload());
}

async function refreshLibrary() {
  state.records = (await listRecords()).map((record) => ({
    ...record,
    map: sanitizeMap(record.map, { strict: false }),
  })).sort(
    (a, b) => new Date(b.map.updatedAt) - new Date(a.map.updatedAt),
  );
}

function render({ preserveFocus = null } = {}) {
  const focusId = preserveFocus || document.activeElement?.id || null;
  document.title = state.screen === "editor" && state.map
    ? `${state.map.title} — Grove`
    : "Grove — Mind maps";
  app.innerHTML = state.screen === "library" ? libraryHtml() : editorHtml();
  bindUi();
  if (focusId) requestAnimationFrame(() => $(`#${CSS.escape(focusId)}`)?.focus());
}

function libraryHtml() {
  const query = state.librarySearch.normalize("NFC").toLocaleLowerCase().trim();
  const records = state.records.filter((record) => (
    record.map.title.normalize("NFC").toLocaleLowerCase().includes(query)
  ));
  const backupBase = preferences.lastBackupAt
    ? new Date(preferences.lastBackupAt)
    : state.records.reduce((oldest, record) => {
      const created = new Date(record.map.createdAt);
      return !oldest || created < oldest ? created : oldest;
    }, null);
  const backupDue = backupBase && Date.now() - backupBase.getTime() > 7 * 864e5;
  const backupAge = backupBase ? daysAgoText(backupBase) : "No full backup yet";

  return `<main class="library" aria-label="Map Library">
    <header class="library-top">
      <div class="brand">${icon("grove", 30)}<b>Grove</b></div>
      <div class="library-actions">
        <label class="search-box">${icon("search", 18)}<input id="map-search" value="${escapeHtml(state.librarySearch)}" placeholder="Search maps…" aria-label="Search maps"></label>
        ${iconButton("More", "more", 'data-action="library-menu"')}
        <button class="primary-btn" data-action="new-map" aria-label="Create a new map" title="Create a new map">${icon("plus")}<span>New Map</span></button>
      </div>
    </header>
    <section class="library-content">
      <h1>Maps</h1>
      <p>Your maps stay on this device. Grove opens native Grove JSON maps; use <a href="../folio/" class="inline-link">Folio</a> for HTML, standalone SVG, and HTML+asset ZIP packages.</p>
      ${backupDue ? `<button class="backup-due" data-action="backup"><span>${icon("clock")}</span><b>Backup due</b><span>${escapeHtml(backupAge)}</span><strong>Back up now ${icon("chevron")}</strong></button>` : ""}
      ${records.length ? `<div class="map-table"><div class="table-head"><span>Name</span><span>Updated</span></div>${records.map(mapRowHtml).join("")}</div>` : emptyLibraryHtml(query)}
      <footer>${icon("download", 16)} Stored locally <i>·</i> Export a backup regularly</footer>
    </section>
    ${state.modal ? modalHtml() : ""}
  </main>`;
}

function mapRowHtml(record) {
  const map = record.map;
  return `<article class="map-row" data-map-id="${escapeHtml(map.id)}">
    <button class="map-open" data-open-map="${escapeHtml(map.id)}">
      <div class="thumb">${miniMapSvg(map)}</div>
      <span><b>${escapeHtml(map.title)}</b><small>${map.nodes.length} ${map.nodes.length === 1 ? "node" : "nodes"}</small></span>
    </button>
    <time datetime="${escapeHtml(map.updatedAt)}">${escapeHtml(formatDate(map.updatedAt))}</time>
    <div class="row-more">${iconButton(`More actions for ${map.title}`, "more", `data-row-menu="${escapeHtml(map.id)}"`)}</div>
  </article>`;
}

function emptyLibraryHtml(hasQuery) {
  if (hasQuery) {
    return `<section class="empty-state"><div class="empty-tree">${icon("search", 68)}</div><h2>No matching maps</h2><p>Try a different map title.</p></section>`;
  }
  return `<section class="empty-state">
    <div class="empty-tree">${icon("grove", 78)}</div>
    <h2>No maps yet</h2>
    <p>Create your first map to start growing ideas.</p>
    <div><button class="primary-btn" data-action="new-map">${icon("plus")} New Map</button><button class="tool-btn" data-action="import">${icon("upload")} Import a map</button></div>
    <small>Private by default · Stored locally on this device</small>
  </section>`;
}

function miniMapSvg(map) {
  const nodes = map.nodes.slice(0, 40);
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  const scaleX = (x) => 12 + (x - minX) / (maxX - minX || 1) * 135;
  const scaleY = (y) => 9 + (y - minY) / (maxY - minY || 1) * 46;
  return `<svg viewBox="0 0 160 64" aria-hidden="true">
    ${nodes.filter((node) => node.parentId).map((node) => {
      const parent = nodeById(map, node.parentId);
      return parent ? `<path d="M${scaleX(parent.x)} ${scaleY(parent.y)} L${scaleX(node.x)} ${scaleY(node.y)}"/>` : "";
    }).join("")}
    ${nodes.map((node) => `<rect x="${scaleX(node.x) - 8}" y="${scaleY(node.y) - 3}" width="16" height="6" rx="3" fill="${node.style.fill}"/>`).join("")}
  </svg>`;
}

function editorHtml() {
  if (!state.map) return "";
  const selected = nodeById(state.map, state.selected);
  const saveLabel = state.saveError ? "Save failed" : state.saving || state.dirty ? "Saving…" : "Saved";
  const inspector = state.inspectorOpen ? inspectorHtml(selected) : "";
  return `<main class="editor ${state.inspectorOpen ? "has-inspector" : ""} ${state.outlineOpen ? "has-outline" : ""}" aria-label="Mind map editor">
    <header class="editor-top">
      <div class="editor-left">
        <button class="brand compact" data-action="library" aria-label="Back to Maps">${icon("grove", 26)}<b>Grove</b></button>
        <button class="maps-btn" data-action="library">${icon("map")}<span>Maps</span></button>
        <button class="map-title" data-action="rename-map" title="Rename map" ${canMutateMap() ? "" : "disabled"}>${escapeHtml(state.map.title)} ${icon("duplicate", 16)}</button>
        ${state.previewOnly ? '<span class="mode-badge preview" role="status" aria-label="Preview only mode">Preview only</span>' : state.view.read ? '<span class="mode-badge read" role="status" aria-label="Read mode">Read mode</span>' : `<span class="save-state ${state.saveError ? "error" : ""}" role="status">${saveLabel}</span>`}
      </div>
      <div class="editor-actions">
        ${iconButton("Search in map", "search", 'data-action="search"')}
        ${iconButton("Undo", "undo", `data-action="undo" ${state.history.canUndo && canMutateMap() ? "" : "disabled"}`)}
        ${iconButton("Redo", "redo", `data-action="redo" ${state.history.canRedo && canMutateMap() ? "" : "disabled"}`)}
        ${iconButton("Outline view", "outline", `data-action="outline" aria-pressed="${state.outlineOpen}"`)}
        ${iconButton("Settings", "settings", 'data-action="settings"')}
        <button class="read-btn ${state.view.read ? "active" : ""}" data-action="${state.previewOnly ? "preview-import-edit" : "read"}" aria-pressed="${state.view.read}" aria-label="${state.previewOnly ? "Import to Library and edit" : state.view.read ? "Exit Read Mode and edit" : "Enter Read Mode"}">${icon(state.previewOnly ? "upload" : "read")}<span>${state.previewOnly ? "Import to Edit" : state.view.read ? "Edit" : "Read"}</span></button>
        ${iconButton("Export map", "share", 'data-action="editor-more"')}
      </div>
    </header>
    ${state.saveError ? saveErrorHtml() : ""}
    <section id="canvas" class="canvas" aria-label="Mind map canvas" tabindex="0">
      <div id="world" class="world"><svg id="edges" aria-hidden="true"></svg><div id="nodes" class="node-layer"></div></div>
      ${selected && !state.view.read ? miniToolbarHtml(selected) : ""}
      <div class="canvas-controls">
        <button data-action="fit" aria-label="Fit to screen" title="Fit to screen">${icon("fit")}</button>
        <button data-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
        <button class="zoom-value" data-action="zoom-reset" aria-label="Reset zoom to 100%" title="Reset zoom to 100%">${Math.round(state.view.zoom * 100)}%</button>
        <button data-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
        <select id="canvas-spacing" aria-label="Branch spacing" title="Branch spacing" ${canMutateMap() ? "" : "disabled"}>
          ${["tight", "normal", "airy"].map((spacing) => `<option value="${spacing}" ${preferences.spacing === spacing ? "selected" : ""}>${spacing[0].toUpperCase() + spacing.slice(1)}</option>`).join("")}
        </select>
      </div>
      <div class="gesture-hint">Drag or scroll to pan · Pinch or Ctrl/⌘ + scroll to zoom</div>
      ${state.linkSource ? `<div class="link-mode" role="status">Select another node to link <button data-action="cancel-link">Cancel</button></div>` : ""}
    </section>
    ${state.outlineOpen ? outlineHtml() : ""}
    ${inspector}
    ${state.modal ? modalHtml() : ""}
  </main>`;
}

function saveErrorHtml() {
  const message = state.saveError?.code === "QUOTA_EXCEEDED"
    ? "Local storage is full. Keep this tab open and export a recovery copy."
    : state.saveError?.code === "REVISION_CONFLICT"
      ? "This map also changed in another Grove window."
      : "Your latest changes are still in memory but are not saved.";
  return `<section class="save-error-banner" role="alert">${icon("warning")}<div><b>Save failed</b><span>${escapeHtml(message)}</span></div><button class="tool-btn" data-action="retry-save">${icon("retry")} Retry</button><button class="tool-btn" data-action="recovery-export">${icon("download")} Export recovery copy</button></section>`;
}

function miniToolbarHtml(node) {
  return `<div class="mini-toolbar" data-mini-toolbar>
    <button data-action="edit-selected" title="Edit text" aria-label="Edit text">${icon("edit")}</button>
    <button data-action="add-child" title="Add child" aria-label="Add child">${icon("plus")}</button>
    <button data-action="move" title="Move node" aria-label="Move node" ${node.id === state.map.rootNodeId ? "disabled" : ""}>${icon("arrow")}</button>
    <button data-action="link" title="Cross-link" aria-label="Cross-link">${icon("link")}</button>
    <button data-action="collapse" title="Collapse or expand" aria-label="Collapse or expand">${icon(isCollapsed(node) ? "expand" : "collapse")}</button>
    <button data-action="node-more" title="More node actions" aria-label="More node actions">${icon("more")}</button>
  </div>`;
}

function outlineHtml() {
  return `<aside class="outline-panel" aria-label="Outline"><div class="panel-head"><b>Outline</b>${iconButton("Close outline", "close", 'data-action="outline"')}</div><div class="outline-tree" role="tree">${outlineItemsHtml(state.map.rootNodeId, 0)}</div></aside>`;
}

function outlineItemsHtml(id, depth) {
  const node = nodeById(state.map, id);
  const children = childrenOf(state.map, id);
  const collapsed = isCollapsed(node);
  return `<div role="treeitem" aria-level="${depth + 1}" aria-selected="${state.selected === id}" aria-expanded="${children.length ? !collapsed : "undefined"}" class="outline-item ${state.selected === id ? "selected" : ""}" style="--depth:${depth}">
    ${children.length ? `<button class="outline-toggle" data-outline-toggle="${escapeHtml(id)}" aria-label="${collapsed ? "Expand" : "Collapse"} ${escapeHtml(node.text || "Untitled")}">${icon(collapsed ? "expand" : "collapse", 15)}</button>` : '<span class="tree-dot"></span>'}
    <button class="outline-label" data-select-node="${escapeHtml(id)}">${escapeHtml(node.text) || "Untitled"}</button>
  </div>${collapsed ? "" : children.map((child) => outlineItemsHtml(child.id, depth + 1)).join("")}`;
}

function inspectorHtml(node) {
  if (!node) {
    return `<aside class="inspector empty-inspector"><div class="panel-head"><b>Node</b>${iconButton("Close inspector", "close", 'data-action="close-inspector"')}</div><p>Select a node to edit its details.</p></aside>`;
  }
  return `<aside class="inspector ${state.view.read ? "read-only" : ""}" aria-label="Node inspector">
    <div class="sheet-grab"></div>
    <div class="panel-head"><b>Node</b>${iconButton("Close inspector", "close", 'data-action="close-inspector"')}</div>
    <div class="tabs" role="tablist">
      ${[
        { id: "style", label: "Style", title: "Change this node's visual style" },
        { id: "memo", label: "Memo", title: "Short plain-text memo" },
        { id: "note", label: "Note (Markdown)", title: "Long-form note with Markdown formatting" },
      ].map((panel) => `<button role="tab" aria-selected="${state.panel === panel.id}" class="${state.panel === panel.id ? "active" : ""}" data-panel="${panel.id}" title="${panel.title}">${panel.label}</button>`).join("")}
    </div>
    ${state.view.read ? '<p class="read-only-note">Read Mode is on. Pan, zoom, search, Outline, and temporary collapse remain available.</p>' : ""}
    ${state.panel === "style" ? stylePanelHtml(node) : state.panel === "memo" ? memoPanelHtml(node) : notePanelHtml(node)}
  </aside>`;
}

function stylePanelHtml(node) {
  const style = node.style;
  const edge = node.parentEdgeStyle;
  const disabled = state.view.read ? "disabled" : "";
  const links = connectedCrossLinks(state.map, node.id);
  return `<div class="inspector-body style-panel">
    <section class="inspector-section"><h3>Node</h3>
      <label>Fill <input type="color" data-node-style="fill" value="${style.fill}" ${disabled}></label>
      <label>Border <input type="color" data-node-style="border" value="${style.border}" ${disabled}></label>
      <label>Text <input type="color" data-node-style="text" value="${style.text}" ${disabled}></label>
      <label>Shape <select data-node-style="shape" ${disabled}>${SHAPES.map((shape) => `<option value="${shape}" ${style.shape === shape ? "selected" : ""}>${titleCase(shape)}</option>`).join("")}</select></label>
    </section>
    <section class="inspector-section"><h3>Typography</h3>
      <label>Font <select data-node-style="font" ${disabled}>${FONT_OPTIONS.map((font) => `<option value="${font}" ${style.font === font ? "selected" : ""}>${font}</option>`).join("")}</select></label>
      <label>Size <div class="stepper"><button data-font-delta="-1" aria-label="Decrease node font size" ${disabled}>−</button><input data-node-style="fontSize" type="number" min="8" max="96" value="${style.fontSize}" ${disabled}><button data-font-delta="1" aria-label="Increase node font size" ${disabled}>+</button></div></label>
      <label>Weight <select data-node-style="fontWeight" ${disabled}>${[400, 500, 600, 700, 800].map((weight) => `<option value="${weight}" ${Math.round(style.fontWeight / 100) * 100 === weight ? "selected" : ""}>${weight}</option>`).join("")}</select></label>
      <label>Align <select data-node-style="align" ${disabled}>${ALIGNMENTS.map((align) => `<option value="${align}" ${style.align === align ? "selected" : ""}>${titleCase(align)}</option>`).join("")}</select></label>
    </section>
    <section class="inspector-section"><h3>Size</h3>
      <label>Width <input data-node-field="width" type="number" value="${Math.round(node.width)}" min="80" max="1600" ${disabled}></label>
      <label>Height <input data-node-field="height" type="number" value="${Math.round(node.height)}" min="44" max="1200" ${disabled}></label>
      <button class="secondary-btn full" data-action="toggle-size-mode" ${disabled}>${node.sizeMode === "auto" ? "Auto size on" : "Use auto size"}</button>
    </section>
    ${node.id === state.map.rootNodeId ? "" : `<section class="inspector-section"><h3>Parent edge</h3>
      <label>Color <input type="color" data-edge-style="color" value="${edge.color}" ${disabled}></label>
      <label>Type <select data-edge-style="type" ${disabled}>${EDGE_TYPES.map((type) => `<option value="${type}" ${edge.type === type ? "selected" : ""}>${titleCase(type)}</option>`).join("")}</select></label>
      <label>Width <input type="range" data-edge-style="width" min="1" max="12" value="${edge.width}" ${disabled}></label>
      <label>Line <select data-edge-style="dash" ${disabled}>${EDGE_DASHES.map((dash) => `<option value="${dash}" ${edge.dash === dash ? "selected" : ""}>${titleCase(dash)}</option>`).join("")}</select></label>
    </section>`}
    <section class="inspector-section"><h3>Cross-links <span>${links.length}</span></h3>
      ${links.length ? links.map((link) => crossLinkEditorHtml(link, node, disabled)).join("") : '<p class="muted">Use the link action, then select another node.</p>'}
    </section>
    <button class="secondary-btn full" data-action="tidy" ${disabled}>Tidy Branch</button>
    <p class="muted">Changes apply to this node only.</p>
  </div>`;
}

function crossLinkEditorHtml(link, selectedNode, disabled) {
  const otherId = link.sourceId === selectedNode.id ? link.targetId : link.sourceId;
  const other = nodeById(state.map, otherId);
  return `<div class="cross-link-editor" data-link-id="${escapeHtml(link.id)}">
    <div><b>${escapeHtml(other?.text || "Untitled")}</b><button data-remove-link="${escapeHtml(link.id)}" aria-label="Remove cross-link to ${escapeHtml(other?.text || "Untitled")}" ${disabled}>${icon("trash", 17)}</button></div>
    <label>Color <input type="color" data-link-style="color" data-link="${escapeHtml(link.id)}" value="${link.style.color}" ${disabled}></label>
    <label>Type <select data-link-style="type" data-link="${escapeHtml(link.id)}" ${disabled}>${EDGE_TYPES.map((type) => `<option value="${type}" ${link.style.type === type ? "selected" : ""}>${titleCase(type)}</option>`).join("")}</select></label>
    <label>Line <select data-link-style="dash" data-link="${escapeHtml(link.id)}" ${disabled}>${EDGE_DASHES.map((dash) => `<option value="${dash}" ${link.style.dash === dash ? "selected" : ""}>${titleCase(dash)}</option>`).join("")}</select></label>
  </div>`;
}

function memoPanelHtml(node) {
  return `<div class="inspector-body"><label class="field-label" for="memo-input">Short memo</label><textarea id="memo-input" maxlength="2000" placeholder="Add a short memo…" ${state.view.read ? "disabled" : ""}>${escapeHtml(node.memo)}</textarea><p class="muted">Plain text · saved automatically</p></div>`;
}

function notePanelHtml(node) {
  return `<div class="inspector-body note-panel">
    <div class="note-toggle"><button class="${state.view.noteMode !== "preview" ? "active" : ""}" data-note-mode="edit">Edit</button><button class="${state.view.noteMode === "preview" ? "active" : ""}" data-note-mode="preview">Preview</button></div>
    <textarea id="note-input" maxlength="200000" placeholder="Write a note in Markdown…" class="${state.view.noteMode === "preview" ? "hidden" : ""}" ${state.view.read ? "disabled" : ""}>${escapeHtml(node.noteMarkdown)}</textarea>
    <div id="note-preview" class="markdown-preview ${state.view.noteMode === "preview" ? "" : "hidden"}">${renderMarkdown(node.noteMarkdown)}</div>
    <p class="muted">Markdown supported · HTML is disabled</p>
  </div>`;
}

function modalHtml() {
  const modal = state.modal;
  if (!modal) return "";
  const close = iconButton("Close dialog", "close", 'data-action="modal-cancel"');
  if (modal.type === "confirm") {
    return dialogShell(modal.title, `<p>${escapeHtml(modal.message)}</p><div class="dialog-actions"><button class="tool-btn" data-action="modal-cancel">Cancel</button><button class="danger-btn" data-action="modal-confirm">${escapeHtml(modal.confirm || "Confirm")}</button></div>`);
  }
  if (modal.type === "rename") {
    return dialogShell(modal.title, `<label>Name <input id="modal-name" maxlength="200" value="${escapeHtml(modal.value)}"></label><div class="dialog-actions"><button class="tool-btn" data-action="modal-cancel">Cancel</button><button class="primary-btn" data-action="modal-save">Save</button></div>`);
  }
  if (modal.type === "library-menu") return libraryMenuModalHtml();
  if (modal.type === "settings") return settingsModalHtml(close);
  if (modal.type === "search") return searchModalHtml(close);
  if (modal.type === "move") return moveModalHtml();
  if (modal.type === "export") return exportModalHtml();
  if (modal.type === "backup") return backupModalHtml();
  if (modal.type === "map-import-choice") return mapImportChoiceModalHtml();
  if (modal.type === "map-import") return mapImportModalHtml();
  if (modal.type === "restore") return restoreModalHtml();
  if (modal.type === "revision-conflict") return revisionConflictModalHtml();
  if (modal.type === "node-menu") return nodeMenuModalHtml();
  return "";
}

function libraryMenuModalHtml() {
  const close = iconButton("Close dialog", "close", 'data-action="modal-cancel"');
  return `<div class="modal-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
    <div class="dialog-title"><h2 id="dialog-title">Menu</h2>${close}</div>
    <div class="menu-list">
      <button class="tool-btn" data-action="import">${icon("upload")}<span>Import a map</span></button>
      <button class="tool-btn" data-action="backup" ${state.records.length ? "" : "disabled"}>${icon("download")}<span>Back up all maps</span></button>
      <button class="tool-btn" data-action="settings">${icon("settings")}<span>Settings</span></button>
    </div>
  </section></div>`;
}

function dialogShell(title, content, className = "") {
  return `<div class="modal-backdrop"><section class="dialog ${className}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">${escapeHtml(title)}</h2>${content}</section></div>`;
}

function settingsModalHtml(close) {
  return `<div class="modal-backdrop"><section class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
    <div class="dialog-title"><h2 id="dialog-title">Settings</h2>${close}</div>
    <b>Display</b>
    <label>Theme <select id="set-theme"><option value="system" ${preferences.theme === "system" ? "selected" : ""}>System</option><option value="light" ${preferences.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${preferences.theme === "dark" ? "selected" : ""}>Dark</option></select></label>
    <label>UI text size <select id="set-size">${[6, 8, 10, 12, 14, 17].map((size) => `<option value="${size}" ${preferences.uiSize === size ? "selected" : ""}>${size}px</option>`).join("")}</select></label>
    <label>Suggested spacing <select id="set-spacing">${["tight", "normal", "airy"].map((spacing) => `<option value="${spacing}" ${preferences.spacing === spacing ? "selected" : ""}>${titleCase(spacing)}</option>`).join("")}</select></label>
    <button class="tool-btn" data-action="reset-ui-size">Reset UI text size</button>
    <div class="storage-card"><b>Storage</b><span id="storage-use">Checking…</span><span id="storage-persist">Persistent storage: checking…</span><button class="tool-btn" data-action="persistent">Request persistent storage</button></div>
    <hr>
    ${syncSectionHtml()}
    <hr>
    ${journalSectionHtml()}
    <hr>
    <p class="hint">App version ${escapeHtml(APP_BUILD)}</p>
    <hr>
    <div class="danger-zone"><b>Danger Zone</b><p>Delete all maps and device views from this browser.</p><button class="danger-btn" data-action="reset">Delete all data</button></div>
  </section></div>`;
}

/* ── Sync section ────────────────────────────────────────────────────────
   Sync is off until it is switched on here, and Grove is fully usable while it
   stays off. Two rules are load-bearing:

   1. The device name is asked for BEFORE sync is switched on. The context id is
      fixed at creation and goes into the remote file names, so a name added
      afterwards would only change the label — the files would stay
      `context-3f2a1b9c`. Only a–z and 0–9 survive into the id.
   2. Uploads never remove entries from the map list. Deleting a map writes a
      delete mark instead, and that mark is only ever written when the user
      asks for the deletion.
   ────────────────────────────────────────────────────────────────────── */

function syncStatusText() {
  if (!sync.isEnabled()) return "Off — everything stays on this device.";
  const pending = sync.pendingEventCount();
  const last = sync.getLastSyncAt();
  const ago = last ? `${Math.max(0, Math.floor((Date.now() - last) / 60000))} min ago` : "never";
  return `On · device ${sync.getContextId() || "—"} · last sync ${ago}${pending ? ` · ${pending} queued` : ""}`;
}

function syncSectionHtml() {
  const hasContext = Boolean(sync.getContextId());
  const ready = sync.isReady();
  return `<div class="sync-card">
    <b>Sync</b>
    <p class="hint" id="sync-status" role="status">${escapeHtml(syncStatusText())}</p>
    <label>Device name <input id="sync-device-name" type="text" autocapitalize="none" autocomplete="off" spellcheck="false"
      placeholder="iphone-home" value="${escapeHtml(sync.getContextLabel())}" ${hasContext ? "disabled" : ""}></label>
    <p class="hint">Use English letters and numbers — the file name is built from this and cannot be changed later.</p>
    <label>Access token <input id="sync-token" type="password" autocapitalize="none" autocomplete="off" spellcheck="false"
      placeholder="${escapeHtml(sync.tokenHint() || "github_pat_…")}"></label>
    <div class="sync-row">
      <button class="tool-btn" data-action="sync-save-token">Save token</button>
      <button class="tool-btn" data-action="sync-clear-token">Clear token</button>
    </div>
    <label class="toggle"><input id="sync-enabled" type="checkbox" ${sync.isEnabled() ? "checked" : ""}> Sync with GitHub</label>
    <div class="sync-row">
      <button class="tool-btn" data-action="sync-now" ${ready ? "" : "disabled"}>Sync now</button>
      <button class="tool-btn" data-action="sync-backup" ${ready ? "" : "disabled"}>Back up to GitHub</button>
    </div>
    <p class="hint">Deleting a map here also deletes it on your other devices.</p>
  </div>`;
}

function setSyncStatus(message) {
  const element = $("#sync-status");
  if (element) element.textContent = message || syncStatusText();
}

function journalDateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 92);
  const value = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { from: value(from), to: value(to) };
}

function journalStatusText() {
  const current = journal.getJournalState();
  return current.enabled
    ? `${current.status || "ready"}${current.pendingCount ? ` · ${current.pendingCount} pending` : ""}`
    : "Off — map activity stays local.";
}

function journalSectionHtml() {
  const range = journalDateRange();
  return `<div class="sync-card">
    <b>Journal</b>
    <p class="hint" id="journal-status" role="status">${escapeHtml(journalStatusText())}</p>
    <label class="toggle"><input id="journal-enabled" type="checkbox" ${journal.isJournalEnabled() ? "checked" : ""}> Include in journal</label>
    <p class="hint">Starts off and is independent from Sync. Only map titles and created/opened/edited/export-requested activity are sent. Nodes, memo, and Markdown notes are never copied.</p>
    <div class="sync-row journal-range">
      <label>From <input id="journal-from" type="date" value="${range.from}"></label>
      <label>To <input id="journal-to" type="date" value="${range.to}"></label>
    </div>
    <button class="tool-btn" data-action="journal-backfill">Add existing history</button>
    <button class="tool-btn" data-action="journal-clear-activity">Clear captured activity</button>
    <p class="hint">Manual history import uses map createdAt and the current updatedAt only.</p>
  </div>`;
}

function setJournalStatus(message) {
  const element = $("#journal-status");
  if (element) element.textContent = message || journalStatusText();
}

async function journalToggle(enabled) {
  if (!enabled) { await journal.toggleJournal(false); render(); return; }
  const typed = sync.getContextLabel() || ($("#sync-device-name")?.value || "").trim();
  if (!sync.getContextId() && !/[a-z0-9]/i.test(typed)) {
    toast("Enter a device name using English letters or numbers.", "warn");
    render();
    return;
  }
  const result = await journal.toggleJournal(true, typed);
  if (!result.ok) toast(result.reason === "token" ? "Save an access token first." : "The journal device could not be created.", "warn");
  else toast("Grove is now included in Daybook.");
  render();
}

async function journalBackfill() {
  if (!journal.isJournalEnabled()) { toast("Turn on Include in journal first.", "warn"); return; }
  const from = $("#journal-from")?.value || "";
  const to = $("#journal-to")?.value || "";
  if (!from || !to || from > to) { toast("Choose a valid date range.", "warn"); return; }
  const records = await listRecords();
  const count = records.reduce((total, record) => {
    const created = String(record.map?.createdAt || "").slice(0, 10);
    const updated = String(record.map?.updatedAt || "").slice(0, 10);
    return total + (created >= from && created <= to ? 1 : 0) + (updated !== created && updated >= from && updated <= to ? 1 : 0);
  }, 0);
  state.modal = {
    type: "confirm",
    title: "Add existing history?",
    message: `${count} created/latest-edited record${count === 1 ? "" : "s"} will be written. Intermediate past edits and opens cannot be reconstructed.`,
    confirm: "Add history",
    onConfirm: async () => {
      const result = await journal.backfillJournal(records, { from, to });
      state.modal = { type: "settings" };
      render();
      setJournalStatus(result.error ? `Import paused with ${result.pendingCount || 0} pending.` : `Added ${result.records} records across ${result.dates} days.`);
    },
  };
  render();
}

async function syncSaveToken() {
  const value = $("#sync-token")?.value || "";
  if (!sync.saveToken(value)) { toast("Enter a token first.", "warn"); return; }
  $("#sync-token").value = "";
  render();
  setSyncStatus("Token saved.");
}

async function syncClearToken() {
  sync.clearToken();
  sync.setEnabled(false);
  render();
  setSyncStatus("Token cleared.");
}

async function syncToggle(enabled) {
  if (!enabled) { sync.setEnabled(false); render(); return; }
  if (!sync.getToken()) { toast("Save an access token first.", "warn"); render(); return; }
  if (!sync.getContextId()) {
    const typed = ($("#sync-device-name")?.value || "").trim();
    if (!/[a-z0-9]/i.test(typed)) {
      toast("Enter a device name using English letters or numbers.", "warn");
      render();
      return;
    }
    try {
      // The id is created here, once, from the name typed above.
      await sync.ensureContext(typed);
    } catch (error) {
      render();
      setSyncStatus(sync.describeError(error));
      return;
    }
    sync.setContextLabel(typed);
  }
  sync.setEnabled(true);
  render();
  await syncNow();
}

async function syncNow() {
  setSyncStatus("Syncing…");
  const result = await syncRunner.runSync();
  if (result && (result.pulled || result.removed)) {
    await refreshLibrary();
    render();
  }
  if (result?.error) { setSyncStatus(sync.describeError(result.error)); return; }
  if (result?.tooLarge?.length) { setSyncStatus(`Too large to sync: ${result.tooLarge.join(", ")}`); return; }
  setSyncStatus();
}

async function syncBackupNow() {
  setSyncStatus("Backing up…");
  try {
    // Read from storage, never from screen state: an upload must not be able to
    // shrink what is already backed up.
    const records = await listRecords();
    // Same envelope as the Export backup file, so Restore reads either one.
    await sync.backupNow(backupEnvelope(records.map((record) => record.map), null, journal.exportActivityLedger(), journal.exportSessionLedger()));
    setSyncStatus("Backed up to GitHub.");
  } catch (error) {
    setSyncStatus(sync.describeError(error));
  }
}


function searchModalHtml(close) {
  const results = searchNodes(state.mapSearch);
  state.searchIndex = Math.min(state.searchIndex, Math.max(0, results.length - 1));
  return `<div class="modal-backdrop search-backdrop"><section class="dialog search-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
    <div class="dialog-title"><h2 id="dialog-title">Search</h2>${close}</div>
    <label class="search-box">${icon("search", 18)}<input id="search-input" value="${escapeHtml(state.mapSearch)}" placeholder="Search nodes, memo, notes…"></label>
    <div class="search-nav"><span>${results.length ? `${state.searchIndex + 1} of ${results.length}` : "No results"}</span><button data-search-nav="-1" ${results.length ? "" : "disabled"} aria-label="Previous result">${icon("up")}</button><button data-search-nav="1" ${results.length ? "" : "disabled"} aria-label="Next result">${icon("down")}</button></div>
    <div class="search-results">${searchResultsHtml(results)}</div>
  </section></div>`;
}

function searchResultsHtml(results) {
  return results.length ? results.map((result, index) => `<button data-search-node="${escapeHtml(result.id)}" class="${index === state.searchIndex ? "current" : ""}"><b>${escapeHtml(result.text) || "Untitled"}</b><small>${escapeHtml(result.path)} · ${escapeHtml(result.snippet)}</small></button>`).join("") : '<p class="muted">No matching nodes.</p>';
}

function moveModalHtml() {
  const node = nodeById(state.map, state.selected);
  const blocked = new Set([node.id, ...descendantsOf(state.map, node.id).map((item) => item.id)]);
  const parentOptions = state.map.nodes.filter((item) => !blocked.has(item.id));
  const referenceOptions = state.map.nodes.filter((item) => !blocked.has(item.id) && item.id !== state.map.rootNodeId);
  return dialogShell("Move Node", `<p>Move <b>${escapeHtml(node.text || "Untitled")}</b> without changing its canvas position.</p>
    <label>Placement <select id="move-placement"><option value="child">As last child of</option><option value="before">Before node</option><option value="after">After node</option></select></label>
    <label id="move-parent-label">Parent <select id="move-parent">${parentOptions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === node.parentId ? "selected" : ""}>${escapeHtml(nodePath(item.id))}</option>`).join("")}</select></label>
    <label id="move-reference-label" class="hidden">Reference <select id="move-reference">${referenceOptions.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(nodePath(item.id))}</option>`).join("")}</select></label>
    <div class="move-quick"><button class="tool-btn" data-action="move-up">${icon("up")} Move Up</button><button class="tool-btn" data-action="move-down">${icon("down")} Move Down</button></div>
    <div class="dialog-actions"><button class="tool-btn" data-action="modal-cancel">Cancel</button><button class="primary-btn" data-action="move-confirm">Move</button></div>`);
}

function exportModalHtml() {
  return dialogShell("Export map", `<p>JSON is the complete editable copy. SVG and PNG use the map's content bounds.</p>
    <label>Image margin <input id="export-margin" type="number" min="0" max="300" value="48"></label>
    <label class="toggle"><input id="export-background" type="checkbox" checked> Include background in SVG/PNG</label>
    <div class="export-list">
      ${exportRow("json", "Map JSON", "Complete editable copy")}
      ${exportRow("svg", "SVG image", "Editable text; fonts may vary elsewhere")}
      ${exportRow("png", "PNG image", "2× raster image")}
    </div>
    <div class="dialog-actions"><button class="tool-btn" data-action="modal-cancel">Close</button></div>`);
}

function exportRow(kind, title, description) {
  return `<div class="export-row"><span><b>${title}</b><small>${description}</small></span><button class="tool-btn" data-export-kind="${kind}" data-export-action="download">${icon("download")} Download</button><button class="icon-btn" data-export-kind="${kind}" data-export-action="share" aria-label="Share ${title}" title="Share ${title}">${icon("share")}</button></div>`;
}

function backupModalHtml() {
  return dialogShell("Full backup", `<p>Export every map to one Grove JSON file. Store it outside this app, such as in iCloud Drive.</p>
    <label class="toggle"><input id="backup-preferences" type="checkbox"> Include theme, UI text size, and spacing</label>
    <p class="dialog-note">A browser can confirm that a download started, but cannot confirm where you stored the file.</p>
    <div class="dialog-actions"><button class="tool-btn" data-action="modal-cancel">Cancel</button><button class="tool-btn" data-action="backup-share">${icon("share")} Share…</button><button class="primary-btn" data-action="backup-download">${icon("download")} Download</button></div>`);
}

function mapImportChoiceModalHtml() {
  const map = state.modal.map;
  return dialogShell("Open Grove map", `<p><b>${escapeHtml(map.title)}</b> · ${map.nodes.length} node${map.nodes.length === 1 ? "" : "s"}</p>
    <p><b>Preview only</b> keeps the file in memory and does not add it to the Library, device views, backup, or sync.</p>
    <p class="dialog-note">Grove opens Grove native JSON. For HTML, standalone SVG, or HTML+asset ZIP packages, use <a href="../folio/">Folio</a>.</p>
    <div class="dialog-actions"><button class="tool-btn" data-action="modal-cancel">Cancel</button><button class="tool-btn" data-action="import-map-view">Import &amp; View</button><button class="tool-btn" data-action="import-map-edit">Import &amp; Edit</button><button class="primary-btn" data-action="preview-start">Preview only</button></div>`);
}

function mapImportModalHtml() {
  const incoming = state.modal.map;
  const local = state.modal.existing.map;
  return dialogShell("Map already exists", `<p>Grove found the same map ID with different content. No existing map has been changed. Keep both is the safest choice.</p>
    <div class="compare-grid"><div><small>On this device</small><b>${escapeHtml(local.title)}</b><time>${escapeHtml(formatDate(local.updatedAt))}</time></div><div><small>Imported file</small><b>${escapeHtml(incoming.title)}</b><time>${escapeHtml(formatDate(incoming.updatedAt))}</time></div></div>
    <div class="dialog-actions"><button class="tool-btn" data-action="modal-cancel">Cancel</button><button class="tool-btn" data-action="import-replace">Replace</button><button class="primary-btn" data-action="import-keep-both">Keep both</button></div>`);
}

function restoreModalHtml() {
  const conflicts = state.modal.conflicts || [];
  return dialogShell("Restore backup", `<p>${state.modal.maps.length} map${state.modal.maps.length === 1 ? "" : "s"} found. ${conflicts.length ? `${conflicts.length} ID conflict${conflicts.length === 1 ? "" : "s"} found.` : "No ID conflicts found."}</p>
    ${conflicts.length ? `<label>For changed conflicts <select id="restore-conflicts"><option value="keep-both">Keep both (recommended)</option><option value="keep-local">Keep local</option><option value="replace">Replace with backup</option></select></label>` : ""}
    ${state.modal.portablePreferences ? '<label class="toggle"><input id="restore-preferences" type="checkbox"> Restore app settings</label>' : ""}
    <div class="restore-summary"><span><b>Merge</b> adds new maps and applies the conflict choice.</span><span><b>Replace all</b> removes every current map first.</span></div>
    <div class="dialog-actions"><button class="tool-btn" data-action="modal-cancel">Cancel</button><button class="danger-btn" data-action="restore-replace-request">Replace all</button><button class="primary-btn" data-action="restore-merge">Merge</button></div>`);
}

function revisionConflictModalHtml() {
  return dialogShell("Map changed elsewhere", `<p>This map was saved by another Grove window. Choose which version to keep.</p>
    <div class="dialog-actions"><button class="tool-btn" data-action="conflict-reload">Reload external version</button><button class="primary-btn" data-action="conflict-keep-both">Keep both</button></div>`);
}

function nodeMenuModalHtml() {
  const node = nodeById(state.map, state.selected);
  const siblings = node?.parentId ? childrenOf(state.map, node.parentId) : [];
  const siblingIndex = siblings.findIndex((item) => item.id === node?.id);
  return dialogShell(node?.text || "Node", `<div class="node-menu-actions">
    <button data-action="edit-selected" ${state.view.read ? "disabled" : ""}>Edit text</button>
    <button data-action="open-inspector">Style, memo &amp; note</button>
    <button data-action="add-child" ${state.view.read ? "disabled" : ""}>Add child</button>
    <button data-action="move" ${state.view.read || node?.id === state.map.rootNodeId ? "disabled" : ""}>Move Node…</button>
    <button data-action="move-up" ${state.view.read || siblingIndex <= 0 ? "disabled" : ""}>Move up</button>
    <button data-action="move-down" ${state.view.read || siblingIndex < 0 || siblingIndex >= siblings.length - 1 ? "disabled" : ""}>Move down</button>
    <button data-action="collapse">${isCollapsed(node) ? "Expand branch" : "Collapse branch"}</button>
    <button data-action="duplicate-node" ${state.view.read || node?.id === state.map.rootNodeId ? "disabled" : ""}>Duplicate node</button>
    <button class="danger" data-action="delete-node" ${state.view.read || node?.id === state.map.rootNodeId ? "disabled" : ""}>Delete node</button>
  </div><div class="dialog-actions"><button class="tool-btn" data-action="modal-cancel">Close</button></div>`);
}

function bindUi() {
  $$('[data-action]', app).forEach((element) => element.addEventListener("click", (event) => {
    void runAction(event.currentTarget.dataset.action, event);
  }));
  $("#map-search")?.addEventListener("input", (event) => {
    state.librarySearch = event.target.value;
    render({ preserveFocus: "map-search" });
    const input = $("#map-search");
    if (input) input.setSelectionRange(input.value.length, input.value.length);
  });
  $$('[data-open-map]', app).forEach((element) => element.addEventListener("click", () => openMap(element.dataset.openMap)));
  $$('[data-row-menu]', app).forEach((element) => element.addEventListener("click", (event) => openRowMenu(element.dataset.rowMenu, event.currentTarget)));
  $$('[data-panel]', app).forEach((element) => element.addEventListener("click", () => {
    state.panel = element.dataset.panel;
    state.inspectorOpen = true;
    if (window.innerWidth < 1280) state.outlineOpen = false;
    saveViewSoon();
    render();
  }));
  $$('[data-select-node]', app).forEach((element) => element.addEventListener("click", () => selectNode(element.dataset.selectNode, true)));
  $$('[data-outline-toggle]', app).forEach((element) => element.addEventListener("click", () => toggleCollapse(element.dataset.outlineToggle)));
  $$('[data-export-kind]', app).forEach((element) => element.addEventListener("click", () => exportMap(element.dataset.exportKind, element.dataset.exportAction)));
  $$('[data-search-node]', app).forEach((element) => element.addEventListener("click", () => {
    const results = searchNodes(state.mapSearch);
    state.searchIndex = Math.max(0, results.findIndex((result) => result.id === element.dataset.searchNode));
    focusSearchResult(results[state.searchIndex]);
  }));
  $$('[data-search-nav]', app).forEach((element) => element.addEventListener("click", () => navigateSearch(Number(element.dataset.searchNav))));
  bindInspector();
  bindModalFields();
  if (state.screen === "editor") bindCanvas();
  if (state.modal?.type === "settings") void loadStorageDetails();
  if (state.modal?.type === "settings") void journal.refreshJournalState().then(() => setJournalStatus());
  if (state.modal) requestAnimationFrame(() => $(".dialog input:not([type=checkbox]), .dialog select, .dialog button")?.focus());
}

function bindInspector() {
  const node = nodeById(state.map, state.selected);
  if (!node || !canMutateMap()) return;

  $$('[data-node-style]', app).forEach((element) => element.addEventListener("change", () => {
    mutateMap(`Change ${element.dataset.nodeStyle}`, () => {
      const key = element.dataset.nodeStyle;
      node.style[key] = ["fontSize", "fontWeight"].includes(key) ? Number(element.value) : element.value;
      if (node.sizeMode === "auto" && ["font", "fontSize", "fontWeight"].includes(key)) autoSizeNode(node);
    });
  }));
  $$('[data-edge-style]', app).forEach((element) => element.addEventListener("change", () => {
    mutateMap("Change parent edge", () => {
      const key = element.dataset.edgeStyle;
      node.parentEdgeStyle[key] = key === "width" ? Number(element.value) : element.value;
    });
  }));
  $$('[data-font-delta]', app).forEach((element) => element.addEventListener("click", () => {
    mutateMap("Change font size", () => {
      node.style.fontSize = Math.max(8, Math.min(96, node.style.fontSize + Number(element.dataset.fontDelta)));
      if (node.sizeMode === "auto") autoSizeNode(node);
    });
  }));
  $$('[data-node-field]', app).forEach((element) => element.addEventListener("change", () => {
    mutateMap(`Change node ${element.dataset.nodeField}`, () => {
      const key = element.dataset.nodeField;
      node[key] = Math.max(Number(element.min), Math.min(Number(element.max), Number(element.value) || node[key]));
      node.sizeMode = "manual";
    });
  }));
  $$('[data-link-style]', app).forEach((element) => element.addEventListener("change", () => {
    const link = state.map.crossLinks.find((item) => item.id === element.dataset.link);
    if (!link) return;
    mutateMap("Change cross-link", () => {
      const key = element.dataset.linkStyle;
      link.style[key] = key === "width" ? Number(element.value) : element.value;
    });
  }));
  $$('[data-remove-link]', app).forEach((element) => element.addEventListener("click", () => {
    mutateMap("Remove cross-link", () => removeCrossLink(state.map, element.dataset.removeLink));
  }));
  bindLongTextInput("#memo-input", "memo", "Edit memo");
  bindLongTextInput("#note-input", "noteMarkdown", "Edit note");
  $$('[data-note-mode]', app).forEach((element) => element.addEventListener("click", () => {
    state.view.noteMode = element.dataset.noteMode;
    saveViewSoon();
    render();
  }));
}

function bindLongTextInput(selector, field, label) {
  const input = $(selector);
  const node = nodeById(state.map, state.selected);
  if (!input || !node) return;
  let before = null;
  input.addEventListener("focus", () => { before = clone(state.map); });
  input.addEventListener("input", (event) => {
    if (!canMutateMap()) {
      event.target.value = node[field];
      return;
    }
    node[field] = event.target.value.normalize("NFC");
    state.map.updatedAt = now();
    markDirty();
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (before) {
        node[field] = input.value.normalize("NFC");
        state.map.updatedAt = now();
        state.history.commit(before, state.map, label);
        before = null;
        markDirty();
        render();
      }
    }, 0);
  }, { once: true });
}

function bindModalFields() {
  $("[data-action='modal-save']")?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    saveModalName();
  });
  $("#search-input")?.addEventListener("input", (event) => {
    state.mapSearch = event.target.value;
    state.searchIndex = 0;
    const results = searchNodes(state.mapSearch);
    $(".search-results").innerHTML = searchResultsHtml(results);
    $(".search-nav span").textContent = results.length ? `1 of ${results.length}` : "No results";
    bindSearchResultButtons();
  });
  $("#move-placement")?.addEventListener("change", (event) => {
    const child = event.target.value === "child";
    $("#move-parent-label")?.classList.toggle("hidden", !child);
    $("#move-reference-label")?.classList.toggle("hidden", child);
  });
  $("#set-theme")?.addEventListener("change", (event) => {
    preferences.theme = event.target.value;
    savePreferences();
    applyTheme();
  });
  $("#set-size")?.addEventListener("change", (event) => {
    preferences.uiSize = Number(event.target.value);
    savePreferences();
    applyTheme();
  });
  $("#set-spacing")?.addEventListener("change", (event) => {
    preferences.spacing = event.target.value;
    savePreferences();
  });
  $("#sync-enabled")?.addEventListener("change", (event) => {
    void syncToggle(event.target.checked);
  });
  $("#journal-enabled")?.addEventListener("change", (event) => {
    void journalToggle(event.target.checked);
  });
}

function bindSearchResultButtons() {
  $$('[data-search-node]', app).forEach((element) => element.addEventListener("click", () => {
    const results = searchNodes(state.mapSearch);
    state.searchIndex = Math.max(0, results.findIndex((result) => result.id === element.dataset.searchNode));
    focusSearchResult(results[state.searchIndex]);
  }));
}

function bindCanvas() {
  const canvas = $("#canvas");
  if (!canvas) return;
  renderGraph();
  bindPinch(canvas);
  canvas.addEventListener("pointerdown", startCanvasPan);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("wheel", handleWheel, { passive: false });
  $("#canvas-spacing")?.addEventListener("change", (event) => {
    if (!canMutateMap()) { event.target.value = state.map?.canvasDefaults?.spacing || preferences.spacing; return; }
    preferences.spacing = event.target.value;
    state.map.canvasDefaults.spacing = preferences.spacing;
    savePreferences();
    markDirty();
    render();
  });
}

function renderGraph() {
  if (!state.map || !$("#nodes") || !$("#edges")) return;
  const visibleIds = visibleNodeIds();
  const nodes = state.map.nodes.filter((node) => visibleIds.has(node.id));
  $("#nodes").innerHTML = nodes.map(nodeHtml).join("");
  renderEdges(visibleIds);
  $$(".node", $("#nodes")).forEach((element) => {
    element.addEventListener("click", (event) => handleNodeClick(event, element.dataset.nodeId));
    element.addEventListener("dblclick", (event) => { event.stopPropagation(); editNode(element.dataset.nodeId); });
    element.addEventListener("pointerdown", (event) => startNodeDrag(event, element.dataset.nodeId));
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      selectNode(element.dataset.nodeId);
      state.modal = { type: "node-menu" };
      render();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !state.view.read) { event.preventDefault(); editNode(element.dataset.nodeId); }
    });
  });
  applyWorld();
  positionMiniToolbar();
}

function visibleNodeIds() {
  const visible = new Set();
  const visit = (id) => {
    if (visible.has(id)) return;
    visible.add(id);
    const node = nodeById(state.map, id);
    if (node && !isCollapsed(node)) childrenOf(state.map, id).forEach((child) => visit(child.id));
  };
  visit(state.map.rootNodeId);
  return visible;
}

function renderEdges(visibleIds = visibleNodeIds()) {
  const svg = $("#edges");
  if (!svg) return;
  const treeEdges = state.map.nodes
    .filter((node) => node.parentId && visibleIds.has(node.id) && visibleIds.has(node.parentId))
    .map((node) => pathEdge(nodeById(state.map, node.parentId), node, node.parentEdgeStyle));
  const crossEdges = state.map.crossLinks
    .filter((link) => visibleIds.has(link.sourceId) && visibleIds.has(link.targetId))
    .map((link) => pathEdge(nodeById(state.map, link.sourceId), nodeById(state.map, link.targetId), link.style, "cross"));
  svg.removeAttribute("viewBox");
  svg.innerHTML = [...treeEdges, ...crossEdges].join("");
}

function nodeHtml(node) {
  const selected = state.selected === node.id;
  const style = `--x:${node.x}px;--y:${node.y}px;--w:${node.width}px;--h:${node.height}px;--fill:${node.style.fill};--node-border:${node.style.border};--node-text:${node.style.text};--font:${fontCss(node.style.font)};--font-size:${node.style.fontSize}px;--weight:${node.style.fontWeight};--align:${node.style.align}`;
  return `<div class="node ${selected ? "selected" : ""} ${state.linkSource === node.id ? "link-source" : ""} shape-${node.style.shape}" style="${style}" data-node-id="${escapeHtml(node.id)}" role="button" tabindex="0" aria-label="${escapeHtml(node.text || "Untitled")}" aria-pressed="${selected}"><span>${escapeHtml(node.text) || "Untitled"}</span>${childrenOf(state.map, node.id).length ? `<i class="node-collapse" aria-hidden="true">${isCollapsed(node) ? "+" : "−"}</i>` : ""}</div>`;
}

function pathEdge(source, target, style, className = "") {
  if (!source || !target) return "";
  const direction = target.x >= source.x ? 1 : -1;
  const x1 = source.x + direction * source.width / 2;
  const y1 = source.y;
  const x2 = target.x - direction * target.width / 2;
  const y2 = target.y;
  const path = style.type === "straight"
    ? `M${x1},${y1} L${x2},${y2}`
    : `M${x1},${y1} C${x1 + direction * 70},${y1} ${x2 - direction * 70},${y2} ${x2},${y2}`;
  return `<path class="edge ${className}" d="${path}" stroke="${style.color}" stroke-width="${style.width}" stroke-dasharray="${style.dash === "dashed" ? "7 7" : ""}"/>`;
}

function fontCss(font) {
  return font === "System Sans"
    ? "system-ui, -apple-system, sans-serif"
    : `'${font}', Verdana, 'Trebuchet MS', sans-serif`;
}

function applyWorld() {
  const world = $("#world");
  const canvas = $("#canvas");
  if (world && canvas) {
    const frame = canvasFrame(canvas);
    world.style.transform = `translate(${frame.centerX + state.view.panX}px, ${frame.centerY + state.view.panY}px) scale(${state.view.zoom})`;
  }
}

function canvasFrame(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  return { width, height, usableHeight: height, centerX: width / 2, centerY: height / 2 };
}

function positionMiniToolbar() {
  const toolbar = $("[data-mini-toolbar]");
  const node = nodeById(state.map, state.selected);
  const canvas = $("#canvas");
  if (!toolbar || !node || !canvas) return;
  const frame = canvasFrame(canvas);
  const x = frame.centerX + state.view.panX + node.x * state.view.zoom;
  const centerY = frame.centerY + state.view.panY + node.y * state.view.zoom;
  const belowY = centerY + node.height / 2 * state.view.zoom + 17;
  const toolbarWidth = toolbar.offsetWidth || 250;
  const toolbarHeight = toolbar.offsetHeight || 50;
  const visibleIds = visibleNodeIds();
  const intersectsBelow = state.map.nodes.some((other) => {
    if (other.id === node.id || !visibleIds.has(other.id)) return false;
    const otherX = frame.centerX + state.view.panX + other.x * state.view.zoom;
    const otherY = frame.centerY + state.view.panY + other.y * state.view.zoom;
    const halfW = other.width / 2 * state.view.zoom;
    const halfH = other.height / 2 * state.view.zoom;
    return otherX + halfW > x - toolbarWidth / 2
      && otherX - halfW < x + toolbarWidth / 2
      && otherY + halfH > belowY
      && otherY - halfH < belowY + toolbarHeight;
  });
  const placeAbove = (intersectsBelow || belowY + toolbarHeight > frame.usableHeight - 12)
    && centerY - node.height / 2 * state.view.zoom - 17 - toolbarHeight > 12;
  const y = placeAbove ? centerY - node.height / 2 * state.view.zoom - 17 : belowY;
  toolbar.style.setProperty("--toolbar-x", `${x}px`);
  toolbar.style.setProperty("--toolbar-y", `${y}px`);
  toolbar.style.setProperty("--toolbar-shift", placeAbove ? "-100%" : "0%");
}

function startCanvasPan(event) {
  if (event.target.closest(".node, button, select, input, textarea, .inspector, .outline-panel, .dialog")) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  state.drag = {
    kind: "pan",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    panX: state.view.panX,
    panY: state.view.panY,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function startNodeDrag(event, id) {
  if (!canMutateMap() || (event.pointerType === "mouse" && event.button !== 0) || state.pinch) return;
  event.stopPropagation();
  state.selected = id;
  const ids = [id, ...descendantsOf(state.map, id).map((node) => node.id)];
  state.drag = {
    kind: "node",
    id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    ids,
    moved: false,
    before: clone(state.map),
    origin: new Map(ids.map((nodeId) => {
      const node = nodeById(state.map, nodeId);
      return [nodeId, { x: node.x, y: node.y }];
    })),
    drop: null,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  clearTimeout(state.longPressTimer);
  if (event.pointerType !== "mouse") {
    state.longPressTimer = setTimeout(() => {
      if (state.drag?.kind === "node" && !state.drag.moved && !state.pinch) {
        state.drag = null;
        state.modal = { type: "node-menu" };
        navigator.vibrate?.(12);
        render();
      }
    }, 560);
  }
}

function handlePointerMove(event) {
  if (!state.drag || state.pinch) return;
  state.drag.latestEvent = { clientX: event.clientX, clientY: event.clientY };
  if (pointerFrame) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = null;
    const drag = state.drag;
    if (!drag?.latestEvent) return;
    const { clientX, clientY } = drag.latestEvent;
    const deltaX = clientX - drag.startX;
    const deltaY = clientY - drag.startY;
    if (Math.hypot(deltaX, deltaY) > 6) {
      drag.moved = true;
      clearTimeout(state.longPressTimer);
    }
    if (drag.kind === "pan") {
      state.view.panX = drag.panX + deltaX;
      state.view.panY = drag.panY + deltaY;
      applyWorld();
      positionMiniToolbar();
      return;
    }
    if (drag.kind === "node") {
      if (!canMutateMap()) {
        state.map = clone(drag.before);
        state.drag = null;
        render();
        return;
      }
      const dx = deltaX / state.view.zoom;
      const dy = deltaY / state.view.zoom;
      for (const id of drag.ids) {
        const node = nodeById(state.map, id);
        const origin = drag.origin.get(id);
        node.x = origin.x + dx;
        node.y = origin.y + dy;
        const element = $(`[data-node-id="${CSS.escape(id)}"]`);
        element?.style.setProperty("--x", `${node.x}px`);
        element?.style.setProperty("--y", `${node.y}px`);
      }
      drag.drop = detectDropTarget(clientX, clientY, drag);
      showDropTarget(drag.drop);
      renderEdges();
      positionMiniToolbar();
    }
  });
}

function detectDropTarget(clientX, clientY, drag) {
  const canvas = $("#canvas");
  const rect = canvas.getBoundingClientRect();
  const frame = canvasFrame(canvas);
  const x = (clientX - rect.left - frame.centerX - state.view.panX) / state.view.zoom;
  const y = (clientY - rect.top - frame.centerY - state.view.panY) / state.view.zoom;
  const blocked = new Set(drag.ids);
  const target = state.map.nodes.find((node) => !blocked.has(node.id)
    && Math.abs(node.x - x) <= node.width / 2
    && Math.abs(node.y - y) <= node.height / 2);
  if (!target) return null;
  const relativeY = (y - target.y) / target.height;
  if (target.id !== state.map.rootNodeId && relativeY < -0.26) return { target, mode: "before" };
  if (target.id !== state.map.rootNodeId && relativeY > 0.26) return { target, mode: "after" };
  return { target, mode: "child" };
}

function showDropTarget(drop) {
  $$(".node.drop-target, .node.drop-before, .node.drop-after").forEach((element) => element.classList.remove("drop-target", "drop-before", "drop-after"));
  if (!drop) return;
  const element = $(`[data-node-id="${CSS.escape(drop.target.id)}"]`);
  element?.classList.add(drop.mode === "child" ? "drop-target" : drop.mode === "before" ? "drop-before" : "drop-after");
}

function finishPointer(event) {
  clearTimeout(state.longPressTimer);
  if (state.touchPoints.has(event.pointerId)) return;
  const drag = state.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (drag.kind === "node" && drag.moved && canMutateMap()) {
    if (drag.drop && drag.id !== state.map.rootNodeId) {
      const { target, mode } = drag.drop;
      if (mode === "child") reparentNode(state.map, drag.id, target.id);
      else reparentNode(state.map, drag.id, target.parentId, insertionIndexForReference(target, mode === "after", drag.id));
    } else {
      const node = nodeById(state.map, drag.id);
      if (node?.parentId === state.map.rootNodeId) {
        node.side = node.x < nodeById(state.map, state.map.rootNodeId).x ? "left" : "right";
      }
    }
    normalizeOrders(state.map);
    state.map.updatedAt = now();
    state.history.commit(drag.before, state.map, "Move node");
    markDirty();
    state.suppressClickUntil = performance.now() + 300;
    render();
  } else if (drag.kind === "node" && drag.moved) {
    // A mode transition can happen while a pointer interaction is in flight.
    // Restore the pre-drag snapshot so Read/Preview never retain transient edits.
    state.map = clone(drag.before);
    render();
  } else if (drag.kind === "pan") {
    saveViewSoon();
  }
  state.drag = null;
}

function bindPinch(canvas) {
  const updatePoint = (event) => state.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    updatePoint(event);
    if (state.touchPoints.size === 2) {
      clearTimeout(state.longPressTimer);
      const points = [...state.touchPoints.values()];
      state.pinch = {
        distance: pointDistance(points),
        center: pointCenter(points),
        zoom: state.view.zoom,
        panX: state.view.panX,
        panY: state.view.panY,
      };
      state.drag = null;
    }
  }, { capture: true });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.touchPoints.has(event.pointerId)) return;
    updatePoint(event);
    if (!state.pinch || state.touchPoints.size !== 2) return;
    event.preventDefault();
    const points = [...state.touchPoints.values()];
    const center = pointCenter(points);
    state.view.zoom = clamp(state.pinch.zoom * pointDistance(points) / Math.max(1, state.pinch.distance), 0.2, 2.5);
    state.view.panX = state.pinch.panX + center.x - state.pinch.center.x;
    state.view.panY = state.pinch.panY + center.y - state.pinch.center.y;
    applyWorld();
    positionMiniToolbar();
    updateZoomDisplay();
  }, { capture: true, passive: false });
  for (const type of ["pointerup", "pointercancel"]) {
    canvas.addEventListener(type, (event) => {
      state.touchPoints.delete(event.pointerId);
      if (state.touchPoints.size < 2 && state.pinch) {
        state.pinch = null;
        saveViewSoon();
      }
    }, { capture: true });
  }
}

function handleWheel(event) {
  event.preventDefault();
  if (!event.ctrlKey && !event.metaKey) {
    state.view.panX -= event.deltaX;
    state.view.panY -= event.deltaY;
    applyWorld();
    positionMiniToolbar();
    saveViewSoon();
    return;
  }
  const canvas = $("#canvas");
  const rect = canvas.getBoundingClientRect();
  const frame = canvasFrame(canvas);
  const localX = event.clientX - rect.left - frame.centerX;
  const localY = event.clientY - rect.top - frame.centerY;
  const worldX = (localX - state.view.panX) / state.view.zoom;
  const worldY = (localY - state.view.panY) / state.view.zoom;
  const factor = Math.exp(-event.deltaY * 0.0015);
  const nextZoom = clamp(state.view.zoom * factor, 0.2, 2.5);
  state.view.panX = localX - worldX * nextZoom;
  state.view.panY = localY - worldY * nextZoom;
  state.view.zoom = nextZoom;
  applyWorld();
  positionMiniToolbar();
  updateZoomDisplay();
  saveViewSoon();
}

function updateZoomDisplay() {
  const button = $("[data-action='zoom-reset']");
  if (button) button.textContent = `${Math.round(state.view.zoom * 100)}%`;
}

function stepZoom(factor) {
  const canvas = $("#canvas");
  if (!canvas) return;
  const previousZoom = state.view.zoom;
  const nextZoom = clamp(previousZoom * factor, 0.2, 2.5);
  if (nextZoom === previousZoom) return;
  state.view.panX *= nextZoom / previousZoom;
  state.view.panY *= nextZoom / previousZoom;
  state.view.zoom = nextZoom;
  applyWorld();
  positionMiniToolbar();
  updateZoomDisplay();
  saveViewSoon();
}

function handleNodeClick(event, id) {
  event.stopPropagation();
  if (performance.now() < state.suppressClickUntil) return;
  if (state.linkSource && state.linkSource !== id) {
    mutateMap("Add cross-link", () => {
      if (!addCrossLink(state.map, state.linkSource, id)) throw new Error("That cross-link already exists.");
    }, { success: "Cross-link added." });
    state.linkSource = null;
    return;
  }
  selectNode(id);
}

function selectNode(id, reveal = false) {
  const node = nodeById(state.map, id);
  if (!node) return;
  state.selected = id;
  if (window.innerWidth < 1280) state.outlineOpen = false;
  if (reveal) centerNode(node, true);
  saveViewSoon();
  render();
}

function centerNode(node, revealAncestors = false) {
  if (revealAncestors) {
    let current = node;
    while (current?.parentId) {
      state.view.tempRevealed = [...new Set([...state.view.tempRevealed, current.parentId])];
      current = nodeById(state.map, current.parentId);
    }
  }
  state.view.panX = -node.x * state.view.zoom;
  state.view.panY = -node.y * state.view.zoom;
}

function editNode(id) {
  if (!canMutateMap()) return;
  pendingInlineEdit?.commit();
  const node = nodeById(state.map, id);
  const element = $(`[data-node-id="${CSS.escape(id)}"]`);
  if (!node || !element) return;
  const before = clone(state.map);
  let finished = false;
  let pending = null;
  element.innerHTML = `<input aria-label="Edit node" maxlength="10000" value="${escapeHtml(node.text)}">`;
  const input = $("input", element);
  input.focus();
  input.select();
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (pendingInlineEdit === pending) pendingInlineEdit = null;
    if (commit && canMutateMap()) {
      node.text = input.value.normalize("NFC").slice(0, 10000);
      if (node.sizeMode === "auto") autoSizeNode(node);
      state.map.updatedAt = now();
      state.history.commit(before, state.map, "Edit node text");
      markDirty();
    }
    const pendingRenameValue = state.modal?.type === "rename" ? $("#modal-name")?.value : null;
    if (pendingRenameValue != null) state.modal.value = pendingRenameValue;
    render();
  };
  pending = { commit: () => finish(true), cancel: () => finish(false) };
  pendingInlineEdit = pending;
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(true); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => setTimeout(() => finish(true), 0), { once: true });
}

function autoSizeNode(node) {
  const text = node.text || "Untitled";
  const root = node.id === state.map.rootNodeId;
  const fontSize = Number(node.style.fontSize) || 16;
  const approximate = text.length * fontSize * (/[\u3131-\uD79D]/.test(text) ? 0.92 : 0.58);
  const maxWidth = root ? 430 : 360;
  const minWidth = root ? 180 : 110;
  node.width = clamp(Math.max(minWidth, approximate + 42), minWidth, maxWidth);
  const lines = Math.max(1, Math.ceil((approximate + 24) / Math.max(1, node.width - 28)));
  node.height = clamp(lines * fontSize * 1.35 + 24, root ? 64 : 44, 220);
}

function isCollapsed(node) {
  if (!node) return false;
  if (state.view.tempRevealed.includes(node.id)) return false;
  const toggled = state.view.tempCollapseOverrides.includes(node.id);
  return toggled ? !node.collapsed : node.collapsed;
}

const MAP_MUTATION_ACTION_SET = new Set(MAP_MUTATION_ACTIONS);

async function runAction(name) {
  try {
    if (state.screen === "editor" && MAP_MUTATION_ACTION_SET.has(name) && !canMutateMap()) return;
    switch (name) {
      case "new-map": await newMap(); break;
      case "library": await returnToLibrary(); break;
      case "add-child": addChild(); break;
      case "duplicate-node": duplicateSelectedNode(); break;
      case "delete-node": requestDeleteNode(); break;
      case "collapse": toggleCollapse(state.selected); break;
      case "link": beginCrossLink(); break;
      case "cancel-link": state.linkSource = null; render(); break;
      case "tidy": tidyBranch(); break;
      case "fit": fitMap(); break;
      case "zoom-out": stepZoom(1 / 1.15); break;
      case "zoom-reset": resetZoom(); break;
      case "zoom-in": stepZoom(1.15); break;
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "read": toggleReadMode(); break;
      case "preview-import-edit": requestPreviewImport("edit"); break;
      case "preview-import-view": await importPreviewMap("view"); break;
      case "preview-start": await startPreviewOnly(state.modal.map, state.modal.sourceName); break;
      case "import-map-view": await importMapChoice("view"); break;
      case "import-map-edit": await importMapChoice("edit"); break;
      case "outline":
        state.outlineOpen = !state.outlineOpen;
        if (state.outlineOpen && window.innerWidth < 1280) state.inspectorOpen = false;
        saveViewSoon();
        render();
        break;
      case "close-inspector": state.inspectorOpen = false; saveViewSoon(); render(); break;
      case "open-inspector": state.inspectorOpen = true; state.modal = null; saveViewSoon(); render(); break;
      case "search": state.modal = { type: "search" }; state.searchIndex = 0; render(); break;
      case "settings": state.modal = { type: "settings" }; render(); break;
      case "library-menu": state.modal = { type: "library-menu" }; render(); break;
      case "editor-more": state.modal = { type: "export" }; render(); break;
      case "node-more": state.modal = { type: "node-menu" }; render(); break;
      case "backup": if (state.records.length) { state.modal = { type: "backup" }; render(); } break;
      case "import": await chooseImport(); break;
      case "rename-map": state.modal = { type: "rename", title: "Rename map", value: state.map.title, mode: "map" }; render(); break;
      case "modal-cancel": state.modal = null; render(); break;
      case "modal-save": saveModalName(); break;
      case "modal-confirm": await state.modal?.onConfirm?.(); break;
      case "move": state.modal = { type: "move" }; render(); break;
      case "move-confirm": confirmMove(); break;
      case "move-up": moveSelectedBy(-1); break;
      case "move-down": moveSelectedBy(1); break;
      case "persistent": await requestPersistentStorage(); break;
      case "sync-save-token": await syncSaveToken(); break;
      case "sync-clear-token": await syncClearToken(); break;
      case "sync-now": await syncNow(); break;
      case "sync-backup": await syncBackupNow(); break;
      case "journal-backfill": await journalBackfill(); break;
      case "journal-clear-activity": {
        state.modal = {
          type: "confirm",
          title: "Clear captured activity?",
          message: "This clears Grove's 90-day local activity history on this device. Maps and remote Journal records are unchanged.",
          confirm: "Clear activity",
          onConfirm: async () => { journal.clearActivityLedger(); state.modal = { type: "settings" }; render(); setJournalStatus("Captured activity cleared on this device."); },
        };
        render();
        break;
      }
      case "reset-ui-size": preferences.uiSize = 12; savePreferences(); applyTheme(); render(); break;
      case "reset": requestReset(); break;
      case "retry-save": await flushSave(); break;
      case "recovery-export": exportRecoveryCopy(); break;
      case "toggle-size-mode": toggleSizeMode(); break;
      case "backup-download": await exportBackup("download"); break;
      case "backup-share": await exportBackup("share"); break;
      case "import-keep-both": await resolveMapImport("keep-both"); break;
      case "import-replace": await resolveMapImport("replace"); break;
      case "restore-merge": await applyRestore("merge"); break;
      case "restore-replace-request": requestReplaceAll(); break;
      case "conflict-reload": await resolveRevisionConflict("reload"); break;
      case "conflict-keep-both": await resolveRevisionConflict("keep-both"); break;
      case "edit-selected": state.modal = null; render(); requestAnimationFrame(() => editNode(state.selected)); break;
      default: break;
    }
  } catch (error) {
    toast(error?.message || "Grove could not complete that action.", "error");
  }
}

async function newMap() {
  const map = createMap("Untitled map");
  map.canvasDefaults.spacing = preferences.spacing;
  const record = await putRecord({ id: map.id, revision: 0, map, thumbnail: null });
  journal.recordActivity(map, "created", { at: map.createdAt }).catch(() => {});
  // One event per map. Renaming updates this same entry rather than adding one.
  sync.queueEvent(sync.mapToEvent(map));
  syncRunner.schedulePush();
  state.records.unshift(record);
  state.map = map;
  state.record = record;
  state.screen = "editor";
  state.selected = map.rootNodeId;
  state.inspectorOpen = false;
  state.view = defaultView();
  state.history.clear();
  state.dirty = false;
  state.saveError = null;
  render();
  requestAnimationFrame(() => editNode(map.rootNodeId));
}

async function returnToLibrary() {
  usageSessions.clearItem();
  if (state.previewOnly) {
    clearTimeout(viewTimer);
    clearTimeout(saveTimer);
    state.previewOnly = false;
    state.previewSourceName = null;
    state.map = null;
    state.record = null;
    state.modal = null;
    state.dirty = false;
    state.screen = "library";
    render();
    return;
  }
  await flushSave();
  if (state.saveError) {
    toast("Resolve the save failure or export a recovery copy before leaving.", "error");
    return;
  }
  await saveView();
  state.screen = "library";
  state.map = null;
  state.record = null;
  state.selected = null;
  state.modal = null;
  await refreshLibrary();
  render();
}

function addChild() {
  if (state.view.read || !state.selected) return;
  let newNode = null;
  mutateMap("Add child", () => { newNode = addNode(state.map, state.selected); });
  if (newNode) {
    state.selected = newNode.id;
    render();
    requestAnimationFrame(() => editNode(newNode.id));
  }
}

function addSibling() {
  const selected = nodeById(state.map, state.selected);
  if (!selected?.parentId || !canMutateMap()) return;
  let newNode = null;
  mutateMap("Add sibling", () => { newNode = addNode(state.map, selected.parentId, selected.id); });
  if (newNode) {
    state.selected = newNode.id;
    render();
    requestAnimationFrame(() => editNode(newNode.id));
  }
}

function duplicateSelectedNode() {
  if (!canMutateMap()) return;
  let copy = null;
  mutateMap("Duplicate node", () => { copy = duplicateNode(state.map, state.selected); });
  if (copy) state.selected = copy.id;
}

function requestDeleteNode() {
  const node = nodeById(state.map, state.selected);
  if (!node || node.id === state.map.rootNodeId || !canMutateMap()) return;
  state.modal = {
    type: "confirm",
    title: "Delete node?",
    message: `Delete “${node.text || "Untitled"}” and everything below it?`,
    confirm: "Delete",
    onConfirm: async () => {
      const parentId = node.parentId;
      mutateMap("Delete node", () => removeNode(state.map, node.id));
      state.selected = parentId;
      state.modal = null;
      render();
    },
  };
  render();
}

function toggleCollapse(id) {
  const node = nodeById(state.map, id);
  if (!node) return;
  if (state.view.read) {
    state.view.tempCollapseOverrides = state.view.tempCollapseOverrides.includes(id)
      ? state.view.tempCollapseOverrides.filter((nodeId) => nodeId !== id)
      : [...state.view.tempCollapseOverrides, id];
    saveViewSoon();
    render();
    return;
  }
  mutateMap(node.collapsed ? "Expand branch" : "Collapse branch", () => { node.collapsed = !node.collapsed; });
}

function beginCrossLink() {
  if (!canMutateMap() || !state.selected) return;
  state.linkSource = state.selected;
  render();
}

function tidyBranch() {
  if (!state.selected || !canMutateMap()) return;
  mutateMap("Tidy branch", () => {
    const root = nodeById(state.map, state.selected);
    const spacing = preferences.spacing;
    const horizontal = spacing === "tight" ? 165 : spacing === "airy" ? 235 : 200;
    const vertical = spacing === "tight" ? 66 : spacing === "airy" ? 112 : 86;
    const layout = (id, inheritedSign = 1) => {
      const parent = nodeById(state.map, id);
      const children = childrenOf(state.map, id);
      children.forEach((child, index) => {
        const sign = parent.id === state.map.rootNodeId ? (child.side === "left" ? -1 : 1) : inheritedSign;
        child.x = parent.x + sign * horizontal;
        child.y = parent.y + (index - (children.length - 1) / 2) * vertical;
        layout(child.id, sign);
      });
    };
    layout(root.id, root.x < nodeById(state.map, state.map.rootNodeId).x ? -1 : 1);
  });
}

function fitMap() {
  const canvas = $("#canvas");
  const nodes = state.map.nodes;
  if (!canvas || !nodes.length) return;
  const frame = canvasFrame(canvas);
  const minX = Math.min(...nodes.map((node) => node.x - node.width / 2));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width / 2));
  const minY = Math.min(...nodes.map((node) => node.y - node.height / 2));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height / 2));
  state.view.zoom = clamp(Math.min((frame.width - 96) / Math.max(1, maxX - minX), (frame.usableHeight - 96) / Math.max(1, maxY - minY)), 0.2, 1.2);
  state.view.panX = -(minX + maxX) / 2 * state.view.zoom;
  state.view.panY = -(minY + maxY) / 2 * state.view.zoom;
  saveViewSoon();
  render();
}

function resetZoom() {
  const selected = nodeById(state.map, state.selected) || nodeById(state.map, state.map.rootNodeId);
  state.view.zoom = 1;
  centerNode(selected);
  saveViewSoon();
  render();
}

function undo() {
  if (!state.history.canUndo || !canMutateMap()) return;
  state.map = state.history.undo(state.map);
  if (!nodeById(state.map, state.selected)) state.selected = state.map.rootNodeId;
  markDirty();
  render();
}

function redo() {
  if (!state.history.canRedo || !canMutateMap()) return;
  state.map = state.history.redo(state.map);
  if (!nodeById(state.map, state.selected)) state.selected = state.map.rootNodeId;
  markDirty();
  render();
}

function toggleReadMode() {
  // Finalize the active text editor before the mode flag changes. Pointerdown
  // can blur an input before the Read button's click handler runs; without this
  // boundary its delayed blur callback can mutate the map after Read begins.
  if (!state.view.read) pendingInlineEdit?.commit();
  state.view.read = !state.view.read;
  state.linkSource = null;
  state.view.tempCollapseOverrides = [];
  state.view.tempRevealed = [];
  saveViewSoon();
  render();
}

function toggleSizeMode() {
  const node = nodeById(state.map, state.selected);
  if (!node || !canMutateMap()) return;
  mutateMap("Change size mode", () => {
    node.sizeMode = node.sizeMode === "auto" ? "manual" : "auto";
    if (node.sizeMode === "auto") autoSizeNode(node);
  });
}

function mutateMap(label, mutation, { success = null } = {}) {
  if (!canMutateMap()) return false;
  const before = clone(state.map);
  try {
    const result = mutation();
    if (result === false) return false;
    state.map.updatedAt = now();
    state.history.commit(before, state.map, label);
    markDirty();
    render();
    if (success) toast(success);
    return true;
  } catch (error) {
    state.map = before;
    render();
    throw error;
  }
}

function markDirty() {
  if (!canMutateMap()) return false;
  state.dirty = true;
  scheduleSave();
  updateSaveState();
  return true;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void flushSave(); }, 500);
}

function updateSaveState() {
  const element = $(".save-state");
  if (!element) return;
  element.textContent = state.saveError ? "Save failed" : state.saving || state.dirty ? "Saving…" : "Saved";
  element.classList.toggle("error", Boolean(state.saveError));
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (state.previewOnly) return !state.saveError;
  if (state.saving && activeSave) return activeSave;
  if (!state.map || !state.dirty) return !state.saveError;
  state.saving = true;
  updateSaveState();
  activeSave = (async () => { try {
    const result = await putRecord({ id: state.map.id, map: clone(state.map), thumbnail: null }, state.record?.revision ?? 0);
    state.record = result;
    const index = state.records.findIndex((record) => record.id === result.id);
    if (index >= 0) state.records[index] = result;
    else state.records.unshift(result);
    state.dirty = false;
    state.saveError = null;
    broadcast({ type: "map-saved", id: result.id, revision: result.revision });
    journal.recordActivity(result.map, "edited").catch(() => {});
    syncRunner.schedulePush();
    return true;
  } catch (error) {
    state.saveError = error;
    if (error.code === "REVISION_CONFLICT") {
      state.modal = { type: "revision-conflict", external: error.current };
      render();
    } else {
      toast(error.code === "QUOTA_EXCEEDED" ? "Local storage is full. Export a recovery copy." : "Save failed. Export a recovery copy before closing.", "error");
      render();
    }
    return false;
  } finally {
    state.saving = false;
    activeSave = null;
    updateSaveState();
  } })();
  return activeSave;
}

function exportRecoveryCopy() {
  if (!state.map) return;
  journal.recordActivity(state.map, "export-requested").catch(() => {});
  const file = mapJsonFile(state.map, "grove-recovery");
  file.filename = `grove-recovery-${safeFilename(state.map.title)}-${new Date().toISOString().slice(0, 10)}.json`;
  downloadFile(file);
  toast("Recovery copy download started.");
}

async function saveView() {
  if (!canPersistViewState(state)) return;
  try {
    await putView({
      id: state.map.id,
      panX: state.view.panX,
      panY: state.view.panY,
      zoom: state.view.zoom,
      read: state.view.read,
      selected: state.selected,
      panel: state.panel,
      inspectorOpen: state.inspectorOpen,
      outlineOpen: state.outlineOpen,
      noteMode: state.view.noteMode || "edit",
      tempCollapseOverrides: state.view.tempCollapseOverrides,
      tempRevealed: state.view.tempRevealed,
    });
  } catch {
    // Device view failure never blocks map content saving.
  }
}

function saveViewSoon() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => { void saveView(); }, 250);
}

async function openMap(id, { read = null, fit = false } = {}) {
  usageSessions.clearItem();
  const record = await getRecord(id);
  if (!record) return;
  state.record = record;
  state.map = sanitizeMap(record.map, { strict: false });
  state.record = { ...record, map: clone(state.map) };
  state.previewOnly = false;
  state.previewSourceName = null;
  state.screen = "editor";
  state.history.clear();
  state.dirty = false;
  state.saveError = null;
  state.modal = null;
  const savedView = await getView(id);
  const selected = nodeById(state.map, savedView?.selected) ? savedView.selected : state.map.rootNodeId;
  state.selected = selected;
  state.panel = ["style", "memo", "note"].includes(savedView?.panel) ? savedView.panel : "style";
  state.inspectorOpen = savedView?.inspectorOpen === true;
  state.outlineOpen = Boolean(savedView?.outlineOpen);
  state.view = {
    ...defaultView(),
    panX: Number.isFinite(savedView?.panX) ? savedView.panX : 0,
    panY: Number.isFinite(savedView?.panY) ? savedView.panY : 0,
    zoom: clamp(Number(savedView?.zoom) || 1, 0.2, 2.5),
    read: read == null ? Boolean(savedView?.read) : Boolean(read),
    noteMode: savedView?.noteMode === "preview" ? "preview" : "edit",
    tempCollapseOverrides: Array.isArray(savedView?.tempCollapseOverrides) ? savedView.tempCollapseOverrides.filter((nodeId) => nodeById(state.map, nodeId)) : [],
    tempRevealed: [],
  };
  render();
  usageSessions.start({ id: state.map.id, title: state.map.title || "Untitled map", itemType: "mind-map" });
  journal.recordActivity(state.map, "opened").catch(() => {});
  if (fit) requestAnimationFrame(() => fitMap());
}

function searchNodes(query) {
  const normalized = String(query || "").normalize("NFC").toLocaleLowerCase().trim();
  if (!normalized || !state.map) return [];
  return state.map.nodes
    .filter((node) => [node.text, node.memo, node.noteMarkdown].some((value) => value.normalize("NFC").toLocaleLowerCase().includes(normalized)))
    .slice(0, 100)
    .map((node) => ({
      id: node.id,
      text: node.text,
      path: nodePath(node.id),
      snippet: matchingSnippet(node, normalized),
    }));
}

function matchingSnippet(node, query) {
  const value = [node.text, node.memo, node.noteMarkdown].find((text) => text.normalize("NFC").toLocaleLowerCase().includes(query)) || node.text;
  const index = value.normalize("NFC").toLocaleLowerCase().indexOf(query);
  return value.slice(Math.max(0, index - 32), index + query.length + 68).replace(/\s+/g, " ");
}

function nodePath(id) {
  const path = [];
  let node = nodeById(state.map, id);
  const visited = new Set();
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    path.unshift(node.text || "Untitled");
    node = node.parentId ? nodeById(state.map, node.parentId) : null;
  }
  return path.join(" › ");
}

function navigateSearch(delta) {
  const results = searchNodes(state.mapSearch);
  if (!results.length) return;
  state.searchIndex = (state.searchIndex + delta + results.length) % results.length;
  render();
}

function focusSearchResult(result) {
  if (!result) return;
  state.modal = null;
  const node = nodeById(state.map, result.id);
  if (node) {
    state.selected = node.id;
    centerNode(node, true);
    saveViewSoon();
  }
  render();
}

function openRowMenu(id, anchor) {
  $(".row-menu")?.remove();
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  const menu = document.createElement("div");
  menu.className = "row-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<button data-menu-open>Open / Edit</button><button data-menu-view>View (Read Mode)</button><button data-menu-rename>Rename</button><button data-menu-duplicate>Duplicate</button><button data-menu-export>Export JSON</button><button class="danger" data-menu-delete>Delete</button>`;
  const close = () => menu.remove();
  $("[data-menu-open]", menu).onclick = () => { close(); void openMap(id); };
  $("[data-menu-view]", menu).onclick = () => { close(); void openMap(id, { read: true, fit: true }); };
  $("[data-menu-rename]", menu).onclick = () => {
    close();
    state.modal = { type: "rename", title: "Rename map", value: record.map.title, mode: "library", id };
    render();
  };
  $("[data-menu-duplicate]", menu).onclick = async () => {
    close();
    const map = cloneWithNewMapId(record.map, uniqueCopyTitle(record.map.title));
    const saved = await putRecord({ id: map.id, revision: 0, map, thumbnail: null });
    journal.recordActivity(saved.map, "created", { at: saved.map.createdAt }).catch(() => {});
    state.records.unshift(saved);
    render();
    toast("Map duplicated.");
  };
  $("[data-menu-export]", menu).onclick = () => {
    close();
    journal.recordActivity(record.map, "export-requested").catch(() => {});
    downloadFile(mapJsonFile(record.map));
    toast("Map JSON download started.");
  };
  $("[data-menu-delete]", menu).onclick = () => {
    close();
    state.modal = {
      type: "confirm",
      title: "Delete map?",
      message: `Delete “${record.map.title}”? This cannot be undone.`,
      confirm: "Delete",
      onConfirm: async () => {
        await deleteRecord(id);
        // A delete mark is written ONLY here, where the user asked for it.
        // It is never inferred from "this map is missing locally" — that
        // inference is what erased data in focus on 2026-08-09.
        sync.markDeleted(record.map);
        sync.queueEvent(sync.mapToEvent(record.map, { deleted: true }));
        syncRunner.schedulePush();
        state.records = state.records.filter((item) => item.id !== id);
        state.modal = null;
        render();
      },
    };
    render();
  };
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const left = clamp(rect.right - 180, 8, window.innerWidth - 188);
  const top = clamp(rect.bottom + 6, 8, window.innerHeight - 282);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  setTimeout(() => document.addEventListener("pointerdown", function outside(event) {
    if (!menu.contains(event.target)) close();
  }, { once: true }), 0);
}

function uniqueCopyTitle(title) {
  let count = 1;
  let value = `${title} copy`;
  const titles = new Set(state.records.map((record) => record.map.title.normalize("NFC").toLocaleLowerCase()));
  while (titles.has(value.normalize("NFC").toLocaleLowerCase())) value = `${title} copy ${++count}`;
  return value.slice(0, 200);
}

function saveModalName() {
  const input = $("#modal-name");
  const value = input?.value.normalize("NFC").trim().slice(0, 200) || "Untitled map";
  if (state.modal.mode === "map") {
    const changed = mutateMap("Rename map", () => { state.map.title = value; });
    if (!changed) return;
    // Refresh the map's single event so Atlas finds it under the current title.
    sync.queueEvent(sync.mapToEvent(state.map));
    syncRunner.schedulePush();
    state.modal = null;
    render();
    return;
  }
  const record = state.records.find((item) => item.id === state.modal.id);
  if (!record) return;
  const nextMap = clone(record.map);
  nextMap.title = value;
  nextMap.updatedAt = now();
  void putRecord({ id: record.id, map: nextMap, thumbnail: record.thumbnail }, record.revision).then((saved) => {
    Object.assign(record, saved);
    journal.recordActivity(saved.map, "edited").catch(() => {});
    sync.queueEvent(sync.mapToEvent(nextMap));
    syncRunner.schedulePush();
    state.modal = null;
    render();
  }).catch((error) => toast(error.message, "error"));
}

async function chooseImport() {
  if (state.saveError) {
    toast("Resolve the save failure before importing.", "error");
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) throw new Error("Import files must be 25 MB or smaller.");
    let raw;
    try { raw = JSON.parse(await file.text()); }
    catch { throw new Error("This file is not valid Grove JSON. Use Folio for HTML, standalone SVG, and HTML+asset ZIP packages."); }
    const parsed = parseGroveFile(raw);
    if (parsed.type === "map") {
      state.modal = { type: "map-import-choice", map: parsed.map, sourceName: file.name };
      render();
    }
    else previewBackupRestore(parsed);
  }, { once: true });
  input.click();
}

async function startPreviewOnly(map, sourceName = "") {
  state.map = sanitizeMap(clone(map), { strict: true });
  state.record = null;
  state.previewOnly = true;
  state.previewSourceName = sourceName || null;
  state.screen = "editor";
  state.selected = state.map.rootNodeId;
  state.inspectorOpen = false;
  state.outlineOpen = false;
  state.view = { ...defaultView(), read: true, noteMode: "preview" };
  state.history.clear();
  state.dirty = false;
  state.saveError = null;
  state.modal = null;
  render();
  requestAnimationFrame(() => fitMap());
}

async function importMapChoice(intent) {
  const map = clone(state.modal.map);
  await importPreviewMap(intent, map);
}

function requestPreviewImport(intent) {
  const map = clone(state.map);
  state.modal = {
    type: "confirm",
    title: "Import this preview?",
    message: intent === "edit" ? "Grove will add this map to the Library once, then enable editing." : "Grove will add this map to the Library once and keep Read Mode on.",
    confirm: intent === "edit" ? "Import & Edit" : "Import & View",
    onConfirm: async () => importPreviewMap(intent, map),
  };
  render();
}

async function importPreviewMap(intent, map = clone(state.map)) {
  const existing = await getRecord(map.id);
  if (existing && canonicalMap(existing.map) !== canonicalMap(map)) {
    state.modal = { type: "map-import", map, existing, intent };
    render();
    return;
  }
  if (existing) {
    state.previewOnly = false;
    state.previewSourceName = null;
    await openMap(existing.id, { read: intent === "view", fit: true });
    toast("This exact map is already in the Library.", "warn");
    return;
  }
  const saved = await putRecord({ id: map.id, revision: 0, map, thumbnail: null });
  sync.queueEvent(sync.mapToEvent(saved.map));
  syncRunner.schedulePush();
  await refreshLibrary();
  state.previewOnly = false;
  state.previewSourceName = null;
  await openMap(saved.id, { read: intent === "view", fit: true });
  toast(intent === "view" ? "Map imported in Read Mode." : "Map imported for editing.");
}

async function resolveMapImport(mode) {
  const { map, existing, intent = "edit" } = state.modal;
  let saved;
  if (mode === "keep-both") {
    const copy = cloneWithNewMapId(map, uniqueCopyTitle(map.title));
    saved = await putRecord({ id: copy.id, revision: 0, map: copy, thumbnail: null });
    state.records.unshift(saved);
  } else {
    saved = await putRecord({ id: map.id, map, thumbnail: null }, existing.revision);
    const index = state.records.findIndex((record) => record.id === saved.id);
    if (index >= 0) state.records[index] = saved;
  }
  sync.queueEvent(sync.mapToEvent(saved.map));
  syncRunner.schedulePush();
  state.modal = null;
  await refreshLibrary();
  state.previewOnly = false;
  state.previewSourceName = null;
  await openMap(saved.id, { read: intent === "view", fit: true });
  toast(mode === "keep-both" ? "Both maps were kept." : "Map replaced.");
}

function previewBackupRestore(parsed) {
  const journalActivity = parsed.journalActivity === undefined
    ? undefined
    : journal.validateActivityLedger(parsed.journalActivity);
  const journalSessions = parsed.journalSessions === undefined
    ? undefined
    : journal.validateSessionLedger(parsed.journalSessions);
  const byId = new Map(state.records.map((record) => [record.id, record]));
  const conflicts = parsed.maps.filter((map) => {
    const local = byId.get(map.id);
    return local && canonicalMap(local.map) !== canonicalMap(map);
  });
  state.modal = {
    type: "restore",
    maps: parsed.maps,
    portablePreferences: parsed.portablePreferences,
    journalActivity,
    journalSessions,
    conflicts,
  };
  render();
}

async function applyRestore(mode) {
  if (state.saveError) {
    toast("Resolve the save failure before restoring.", "error");
    return;
  }
  const modal = state.modal;
  const restorePreferences = modal.restorePreferencesChoice ?? Boolean($("#restore-preferences")?.checked);
  if (mode === "replace") {
    await replaceAll(modal.maps.map((map) => ({ id: map.id, revision: 0, map, thumbnail: null })));
  } else {
    const conflictChoice = $("#restore-conflicts")?.value || "keep-both";
    const localById = new Map(state.records.map((record) => [record.id, record]));
    const records = [];
    for (const original of modal.maps) {
      const local = localById.get(original.id);
      if (!local) {
        records.push({ id: original.id, revision: 0, map: original, thumbnail: null });
        continue;
      }
      if (canonicalMap(local.map) === canonicalMap(original)) continue;
      if (conflictChoice === "keep-local") continue;
      if (conflictChoice === "replace") records.push({ id: original.id, revision: 0, map: original, thumbnail: null });
      else {
        const copy = cloneWithNewMapId(original, uniqueCopyTitle(original.title));
        records.push({ id: copy.id, revision: 0, map: copy, thumbnail: null });
      }
    }
    if (records.length) await putMany(records);
  }
  if (restorePreferences && modal.portablePreferences) {
    preferences = { ...preferences, ...modal.portablePreferences };
    savePreferences();
    applyTheme();
  }
  if (modal.journalActivity !== undefined) journal.replaceActivityLedger(modal.journalActivity, { merge: mode !== "replace" });
  if (modal.journalSessions !== undefined) journal.replaceSessionLedger(modal.journalSessions, { merge: mode !== "replace" });
  state.modal = null;
  await refreshLibrary();
  render();
  toast("Backup restored.");
}

function requestReplaceAll() {
  const restore = state.modal;
  restore.restorePreferencesChoice = Boolean($("#restore-preferences")?.checked);
  state.modal = {
    type: "confirm",
    title: "Replace all maps?",
    message: "Every current map and device view will be removed. Export a full backup first if needed.",
    confirm: "Replace all",
    onConfirm: async () => {
      state.modal = restore;
      await applyRestore("replace");
    },
  };
  render();
}

async function exportBackup(action) {
  const includePreferences = Boolean($("#backup-preferences")?.checked);
  const portable = includePreferences ? {
    theme: preferences.theme,
    uiSize: preferences.uiSize,
    spacing: preferences.spacing,
  } : null;
  const file = backupJsonFile(state.records.map((record) => record.map), portable, journal.exportActivityLedger(), journal.exportSessionLedger());
  if (action === "share") {
    if (!canShareFile(file)) {
      toast("File sharing is not supported here. Use Download instead.", "warn");
      return;
    }
    try { await shareFile(file, "Grove full backup"); }
    catch (error) {
      if (error?.name === "AbortError") return;
      throw error;
    }
  } else {
    downloadFile(file);
  }
  preferences.lastBackupAt = now();
  savePreferences();
  state.modal = null;
  render();
  toast(action === "share" ? "Backup shared. Keep the file in a safe location." : "Backup download started. Keep the file in a safe location.");
}

async function exportMap(kind, action) {
  if (state.map && !state.previewOnly) journal.recordActivity(state.map, "export-requested").catch(() => {});
  const margin = clamp(Number($("#export-margin")?.value) || 48, 0, 300);
  const includeBackground = $("#export-background")?.checked !== false;
  let file;
  if (kind === "json") file = mapJsonFile(state.map);
  else if (kind === "svg") file = createSvgFile(state.map, { margin, includeBackground });
  else file = await createPngFile(state.map, { margin, includeBackground, scale: 2 });

  if (action === "share") {
    if (!canShareFile(file)) {
      toast("File sharing is not supported here. Use Download instead.", "warn");
      return;
    }
    try { await shareFile(file, `${state.map.title} — Grove`); }
    catch (error) {
      if (error?.name === "AbortError") return;
      throw error;
    }
    toast("File shared.");
  } else {
    downloadFile(file);
    toast(`${kind.toUpperCase()} download started.`);
  }
}

function confirmMove() {
  const placement = $("#move-placement")?.value || "child";
  mutateMap("Move node", () => {
    if (placement === "child") {
      if (!reparentNode(state.map, state.selected, $("#move-parent").value)) throw new Error("That move would create a cycle.");
    } else {
      const reference = nodeById(state.map, $("#move-reference").value);
      const order = reference ? insertionIndexForReference(reference, placement === "after", state.selected) : null;
      if (!reference || !reparentNode(state.map, state.selected, reference.parentId, order)) {
        throw new Error("That move is not available.");
      }
    }
  });
  state.modal = null;
  render();
}

function insertionIndexForReference(reference, after, movingId) {
  const siblings = childrenOf(state.map, reference.parentId).filter((node) => node.id !== movingId);
  const index = siblings.findIndex((node) => node.id === reference.id);
  return Math.max(0, index + (after ? 1 : 0));
}

function moveSelectedBy(delta) {
  const moved = mutateMap(delta < 0 ? "Move node up" : "Move node down", () => reorderNode(state.map, state.selected, delta));
  if (moved) {
    state.modal = null;
    render();
  }
}

function requestReset() {
  if (state.saveError) {
    toast("Resolve the save failure before deleting data.", "error");
    return;
  }
  state.modal = {
    type: "confirm",
    title: "Delete all data?",
    message: "This permanently removes every Grove map and device view from this browser. Export a backup first.",
    confirm: "Delete all",
    onConfirm: async () => {
      usageSessions.clearItem();
      await clearAll();
      state.records = [];
      state.screen = "library";
      state.map = null;
      state.record = null;
      state.selected = null;
      state.history.clear();
      state.dirty = false;
      state.saveError = null;
      state.modal = null;
      preferences.lastBackupAt = null;
      savePreferences();
      $("#toasts")?.replaceChildren();
      render();
      toast("All Grove data was deleted.");
    },
  };
  render();
}

async function resolveRevisionConflict(choice) {
  const external = state.modal?.external || await getRecord(state.map.id);
  if (!external) return;
  if (choice === "reload") {
    state.map = clone(external.map);
    state.record = external;
    state.dirty = false;
    state.saveError = null;
    state.history.clear();
    if (!nodeById(state.map, state.selected)) state.selected = state.map.rootNodeId;
  } else {
    const map = cloneWithNewMapId(state.map, uniqueCopyTitle(state.map.title));
    const record = await putRecord({ id: map.id, revision: 0, map, thumbnail: null });
    journal.recordActivity(map, "created", { at: map.createdAt }).catch(() => {});
    state.map = map;
    state.record = record;
    state.records.unshift(record);
    state.dirty = false;
    state.saveError = null;
    state.history.clear();
  }
  state.modal = null;
  render();
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    toast("Persistent storage is not supported here.", "warn");
    return;
  }
  const granted = await navigator.storage.persist();
  toast(granted ? "Persistent storage granted." : "Persistent storage was not granted.", granted ? "" : "warn");
  await loadStorageDetails();
}

async function loadStorageDetails() {
  const [estimate, persistence] = await Promise.all([storageEstimate(), persistentStorageStatus()]);
  const usage = $("#storage-use");
  const persist = $("#storage-persist");
  if (usage) usage.textContent = estimate
    ? `${formatBytes(estimate.usage || 0)} used of ${formatBytes(estimate.quota || 0)} estimated`
    : "Storage estimate not supported";
  if (persist) persist.textContent = `Persistent storage: ${persistence}`;
}

function keyHandler(event) {
  if (state.screen !== "editor" || composing || event.isComposing) return;
  const active = document.activeElement;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(active?.tagName) || active?.isContentEditable) return;
  const key = event.key;
  if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === "f") {
    event.preventDefault();
    state.modal = { type: "search" };
    render();
    return;
  }
  if (key === "Escape") {
    state.modal = null;
    state.linkSource = null;
    render();
    return;
  }
  if (!state.selected) return;
  if (key === "Tab") { event.preventDefault(); addChild(); }
  else if (key === "Enter") {
    event.preventDefault();
    state.selected === state.map.rootNodeId ? addChild() : addSibling();
  } else if ((key === "Delete" || key === "Backspace") && !state.view.read) {
    event.preventDefault();
    requestDeleteNode();
  } else if (key === "F2" || key === " ") {
    event.preventDefault();
    editNode(state.selected);
  } else if (key.startsWith("Arrow")) {
    event.preventDefault();
    navigateTree(key);
  } else if (key === "ContextMenu" || (event.shiftKey && key === "F10")) {
    event.preventDefault();
    state.modal = { type: "node-menu" };
    render();
  }
}

function navigateTree(key) {
  const node = nodeById(state.map, state.selected);
  if (!node) return;
  let target = null;
  if (key === "ArrowLeft") target = node.parentId ? nodeById(state.map, node.parentId) : null;
  if (key === "ArrowRight") target = childrenOf(state.map, node.id)[0] || null;
  if (key === "ArrowUp" || key === "ArrowDown") {
    const siblings = node.parentId ? childrenOf(state.map, node.parentId) : [node];
    const index = siblings.findIndex((item) => item.id === node.id);
    target = siblings[index + (key === "ArrowUp" ? -1 : 1)] || null;
  }
  if (target) selectNode(target.id, true);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    state.updateRegistration = registration;
    if (registration.waiting) showUpdate(registration);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdate(registration);
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!window.__groveReloaded) {
        window.__groveReloaded = true;
        location.reload();
      }
    });
  } catch {
    toast("Offline installation is unavailable in this preview.", "warn");
  }
}

function showUpdate(registration) {
  if ($(".update-bar")) return;
  const bar = document.createElement("section");
  bar.className = "update-bar";
  bar.setAttribute("role", "status");
  bar.innerHTML = `<span><b>Update available</b><small>Reload when your work is saved.</small></span><button data-update-later>Later</button><button data-update-now>Reload</button>`;
  $("[data-update-later]", bar).onclick = () => bar.remove();
  $("[data-update-now]", bar).onclick = async () => {
    await flushSave();
    if (state.saveError) {
      toast("Resolve the save failure before updating.", "error");
      return;
    }
    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  };
  document.body.append(bar);
}

const channel = "BroadcastChannel" in window ? new BroadcastChannel("grove") : null;
function broadcast(value) { channel?.postMessage(value); }
channel?.addEventListener("message", async (event) => {
  if (event.data?.type !== "map-saved" || event.data.id !== state.map?.id) return;
  const latest = await getRecord(event.data.id);
  if (!latest || latest.revision === state.record?.revision) return;
  state.modal = { type: "revision-conflict", external: latest };
  render();
});

async function checkExternalRevision() {
  if (!state.map || state.saving) return;
  const latest = await getRecord(state.map.id);
  if (latest && latest.revision !== state.record?.revision) {
    state.modal = { type: "revision-conflict", external: latest };
    render();
  }
}

function ensureSelectedVisible() {
  if (state.screen !== "editor" || !state.map) return;
  const node = nodeById(state.map, state.selected) || nodeById(state.map, state.map.rootNodeId);
  const canvas = $("#canvas");
  if (!node || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const frame = canvasFrame(canvas);
  const x = rect.left + frame.centerX + state.view.panX + node.x * state.view.zoom;
  const y = rect.top + frame.centerY + state.view.panY + node.y * state.view.zoom;
  const padding = 20;
  const halfWidth = Math.min(node.width * state.view.zoom / 2, Math.max(0, (frame.width - padding * 2) / 2));
  const halfHeight = Math.min(node.height * state.view.zoom / 2, Math.max(0, (frame.usableHeight - padding * 2) / 2));
  const visibleLeft = rect.left + padding;
  const visibleRight = rect.right - padding;
  const visibleTop = rect.top + padding;
  const usableBottom = rect.top + frame.usableHeight;
  const visibleBottom = usableBottom - padding;
  if (x - halfWidth < visibleLeft) state.view.panX += visibleLeft - (x - halfWidth);
  else if (x + halfWidth > visibleRight) state.view.panX -= x + halfWidth - visibleRight;
  if (y - halfHeight < visibleTop) state.view.panY += visibleTop - (y - halfHeight);
  else if (y + halfHeight > visibleBottom) state.view.panY -= y + halfHeight - visibleBottom;
  applyWorld();
  positionMiniToolbar();
}

function formatDate(value) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function daysAgoText(date) {
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 864e5));
  return days === 0 ? "Backed up today" : `Last backup ${days} day${days === 1 ? "" : "s"} ago`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function titleCase(value) { return String(value).replace(/(^|\s)\S/g, (character) => character.toUpperCase()); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function pointDistance([a, b]) { return Math.hypot(a.x - b.x, a.y - b.y); }
function pointCenter([a, b]) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

const themeMedia = matchMedia("(prefers-color-scheme: dark)");
themeMedia.addEventListener?.("change", applyTheme);
document.addEventListener("keydown", keyHandler);
document.addEventListener("keydown", () => { if (state.screen === "editor") usageSessions.signal(); });
document.addEventListener("pointerdown", () => { if (state.screen === "editor") usageSessions.signal(); }, { passive: true });
document.addEventListener("wheel", () => { if (state.screen === "editor") usageSessions.signal(); }, { passive: true });
document.addEventListener("compositionstart", () => { composing = true; });
document.addEventListener("compositionend", () => { composing = false; });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { usageSessions.stop(); void flushSave(); void saveView(); }
  else { if (state.screen === "editor" && state.map) usageSessions.start({ id: state.map.id, title: state.map.title || "Untitled map", itemType: "mind-map" }); void checkExternalRevision(); }
});
window.addEventListener("focus", () => { void checkExternalRevision(); });
window.addEventListener("pagehide", () => { usageSessions.stop(); void flushSave(); void saveView(); });
window.addEventListener("resize", () => {
  applyTheme();
  requestAnimationFrame(ensureSelectedVisible);
});
window.visualViewport?.addEventListener("resize", () => {
  applyTheme();
  requestAnimationFrame(ensureSelectedVisible);
});
window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  toast(event.reason?.message || "An unexpected error occurred.", "error");
});

void init();
