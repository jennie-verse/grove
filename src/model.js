export const APP_VERSION = "1.0.0";
export const DB_VERSION = 2;
export const MAP_SCHEMA_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = 1;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_MAPS_PER_BACKUP = 1000;
export const MAX_NODES = 5000;
export const MAX_TITLE = 200;
export const MAX_NODE_TEXT = 10000;
export const MAX_MEMO = 2000;
export const MAX_NOTE = 200000;

export const PALETTE = [
  "#EFB3C1",
  "#B9D8EE",
  "#F7E3A8",
  "#CBE5B4",
  "#F8D2A8",
  "#CFC6E8",
];

export const FONT_OPTIONS = ["Lexend", "Verdana", "Trebuchet MS", "System Sans"];
export const SHAPES = ["rounded", "pill", "rectangle", "ellipse"];
export const ALIGNMENTS = ["left", "center", "right"];
export const EDGE_TYPES = ["curve", "straight"];
export const EDGE_DASHES = ["solid", "dashed"];

const DEFAULT_EDGE = Object.freeze({
  color: "#B59AA3",
  width: 2,
  type: "curve",
  dash: "solid",
});

export function uid() {
  return globalThis.crypto?.randomUUID?.()
    || `grove-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function now() {
  return new Date().toISOString();
}

export function clone(value) {
  return structuredClone(value);
}

export function normalizeText(value, max = MAX_NODE_TEXT) {
  return String(value ?? "").normalize("NFC").slice(0, max);
}

export function defaultNodeStyle(index = 0, root = false) {
  const color = PALETTE[index % PALETTE.length];
  return {
    fill: root ? "#FBE4EA" : color,
    border: root ? "#EF7294" : color,
    text: "#4A3A40",
    shape: root ? "pill" : "rounded",
    font: "Lexend",
    fontSize: root ? 22 : 16,
    fontWeight: root ? 650 : 500,
    align: "center",
  };
}

export function defaultEdgeStyle(overrides = {}) {
  return { ...DEFAULT_EDGE, ...overrides };
}

export function createMap(title = "Untitled map") {
  const id = uid();
  const rootNodeId = uid();
  const timestamp = now();
  const safeTitle = normalizeText(title, MAX_TITLE).trim() || "Untitled map";

  return {
    id,
    title: safeTitle,
    rootNodeId,
    createdAt: timestamp,
    updatedAt: timestamp,
    canvasDefaults: {
      nodeStyle: defaultNodeStyle(0),
      edgeStyle: defaultEdgeStyle(),
      background: "#FDF7F8",
      spacing: "normal",
    },
    nodes: [{
      id: rootNodeId,
      parentId: null,
      order: 0,
      side: null,
      text: safeTitle,
      x: 0,
      y: 0,
      width: 220,
      height: 84,
      sizeMode: "auto",
      collapsed: false,
      memo: "",
      noteMarkdown: "",
      style: defaultNodeStyle(0, true),
      parentEdgeStyle: defaultEdgeStyle(),
    }],
    crossLinks: [],
  };
}

export function nodeById(map, id) {
  return map?.nodes?.find((node) => node.id === id) || null;
}

export function childrenOf(map, id) {
  return map.nodes
    .filter((node) => node.parentId === id)
    .sort((a, b) => a.order - b.order);
}

export function descendantsOf(map, id) {
  const result = [];
  const queue = [id];
  const visited = new Set();

  while (queue.length) {
    const parentId = queue.shift();
    if (visited.has(parentId)) continue;
    visited.add(parentId);
    const children = childrenOf(map, parentId);
    result.push(...children);
    queue.push(...children.map((node) => node.id));
  }
  return result;
}

export function isDescendant(map, possibleDescendantId, ancestorId) {
  let current = nodeById(map, possibleDescendantId);
  const visited = new Set();
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    if (visited.has(current.parentId)) return false;
    visited.add(current.parentId);
    current = nodeById(map, current.parentId);
  }
  return false;
}

export function normalizeOrders(map) {
  const byParent = new Map();
  for (const node of map.nodes) {
    const key = node.parentId ?? "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(node);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    list.forEach((node, index) => {
      node.order = index;
      if (node.parentId !== map.rootNodeId) node.side = null;
    });
  }

  const root = nodeById(map, map.rootNodeId);
  if (root) {
    root.parentId = null;
    root.order = 0;
    root.side = null;
  }
  return map;
}

export function branchSide(map, nodeId) {
  let current = nodeById(map, nodeId);
  const visited = new Set();
  while (current?.parentId && current.parentId !== map.rootNodeId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    current = nodeById(map, current.parentId);
  }
  return current?.side || "right";
}

export function nextNodePosition(map, parent) {
  const siblings = childrenOf(map, parent.id);
  const rootChild = parent.id === map.rootNodeId;
  const sign = rootChild
    ? (siblings.filter((node) => node.side === "right").length
      <= siblings.filter((node) => node.side === "left").length ? 1 : -1)
    : (branchSide(map, parent.id) === "left" ? -1 : 1);
  const spacing = map.canvasDefaults?.spacing || "normal";
  const horizontal = spacing === "tight" ? 155 : spacing === "airy" ? 225 : 185;
  const vertical = spacing === "tight" ? 66 : spacing === "airy" ? 112 : 88;
  const sameSide = siblings.filter((node) => (node.side === "left" ? -1 : 1) === sign);

  return {
    x: parent.x + sign * (parent.width / 2 + horizontal),
    y: parent.y + (sameSide.length - (Math.max(1, sameSide.length) - 1) / 2) * vertical,
  };
}

export function addNode(map, parentId, afterId = null, text = "New idea") {
  const parent = nodeById(map, parentId);
  if (!parent || map.nodes.length >= MAX_NODES) return null;
  const siblings = childrenOf(map, parentId);
  const offset = afterId
    ? Math.max(0, siblings.findIndex((node) => node.id === afterId) + 1)
    : siblings.length;
  const position = nextNodePosition(map, parent);
  const index = map.nodes.length;
  const defaults = map.canvasDefaults || {};

  siblings.filter((node) => node.order >= offset).forEach((node) => { node.order += 1; });
  const node = {
    id: uid(),
    parentId,
    order: offset,
    side: parentId === map.rootNodeId ? (position.x < parent.x ? "left" : "right") : null,
    text: normalizeText(text),
    x: position.x,
    y: position.y,
    width: 156,
    height: 48,
    sizeMode: "auto",
    collapsed: false,
    memo: "",
    noteMarkdown: "",
    style: sanitizeNodeStyle(defaults.nodeStyle || defaultNodeStyle(index), index),
    parentEdgeStyle: sanitizeEdgeStyle(defaults.edgeStyle || DEFAULT_EDGE),
  };
  map.nodes.push(node);
  normalizeOrders(map);
  return node;
}

export function duplicateNode(map, id) {
  const source = nodeById(map, id);
  if (!source || source.id === map.rootNodeId || map.nodes.length >= MAX_NODES) return null;
  const copy = clone(source);
  copy.id = uid();
  copy.order += 1;
  copy.x += 28;
  copy.y += 28;
  copy.text = normalizeText(`${copy.text} copy`);
  childrenOf(map, source.parentId)
    .filter((node) => node.order >= copy.order && node.id !== source.id)
    .forEach((node) => { node.order += 1; });
  map.nodes.push(copy);
  normalizeOrders(map);
  return copy;
}

export function removeNode(map, id) {
  if (!nodeById(map, id) || id === map.rootNodeId) return null;
  const removedIds = new Set([id, ...descendantsOf(map, id).map((node) => node.id)]);
  map.nodes = map.nodes.filter((node) => !removedIds.has(node.id));
  map.crossLinks = map.crossLinks.filter(
    (link) => !removedIds.has(link.sourceId) && !removedIds.has(link.targetId),
  );
  normalizeOrders(map);
  return [...removedIds];
}

export function reparentNode(map, id, parentId, order = null) {
  if (id === map.rootNodeId || id === parentId || isDescendant(map, parentId, id)) return false;
  const node = nodeById(map, id);
  const parent = nodeById(map, parentId);
  if (!node || !parent) return false;

  const oldParentId = node.parentId;
  const targetSiblings = childrenOf(map, parentId).filter((item) => item.id !== id);
  const targetIndex = Number.isInteger(order)
    ? Math.max(0, Math.min(targetSiblings.length, order))
    : targetSiblings.length;
  node.parentId = parentId;
  node.side = parentId === map.rootNodeId ? (node.x < parent.x ? "left" : "right") : null;
  targetSiblings.splice(targetIndex, 0, node);
  targetSiblings.forEach((item, index) => { item.order = index; });
  if (oldParentId !== parentId && oldParentId) {
    childrenOf(map, oldParentId).forEach((item, index) => { item.order = index; });
  }
  normalizeOrders(map);
  return true;
}

export function reorderNode(map, id, delta) {
  const node = nodeById(map, id);
  if (!node || node.id === map.rootNodeId) return false;
  const siblings = childrenOf(map, node.parentId);
  const index = siblings.findIndex((item) => item.id === id);
  const targetIndex = Math.max(0, Math.min(siblings.length - 1, index + delta));
  if (index < 0 || targetIndex === index) return false;
  const target = siblings[targetIndex];
  const order = node.order;
  node.order = target.order;
  target.order = order;
  normalizeOrders(map);
  return true;
}

export function addCrossLink(map, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return null;
  if (!nodeById(map, sourceId) || !nodeById(map, targetId)) return null;
  const pair = [sourceId, targetId].sort().join(":");
  if (map.crossLinks.some((link) => [link.sourceId, link.targetId].sort().join(":") === pair)) {
    return null;
  }
  const link = {
    id: uid(),
    sourceId,
    targetId,
    style: sanitizeEdgeStyle({ color: "#C38196", width: 2, type: "curve", dash: "dashed" }),
  };
  map.crossLinks.push(link);
  return link;
}

export function removeCrossLink(map, linkId) {
  const before = map.crossLinks.length;
  map.crossLinks = map.crossLinks.filter((link) => link.id !== linkId);
  return map.crossLinks.length !== before;
}

export function connectedCrossLinks(map, nodeId) {
  return map.crossLinks.filter((link) => link.sourceId === nodeId || link.targetId === nodeId);
}

export function sanitizeMap(input, { strict = true } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("This file does not contain a Grove map.");
  }
  if (!Array.isArray(input.nodes) || !Array.isArray(input.crossLinks)) {
    throw new Error("The map is missing nodes or cross-links.");
  }
  if (input.nodes.length < 1 || input.nodes.length > MAX_NODES) {
    throw new Error("The map has an unsupported number of nodes.");
  }
  if (strict) assertTextLimits(input);

  const map = {
    id: requiredId(input.id, "map"),
    title: normalizeText(input.title, MAX_TITLE).trim() || "Untitled map",
    rootNodeId: requiredId(input.rootNodeId, "root node"),
    createdAt: sanitizeTimestamp(input.createdAt, "createdAt"),
    updatedAt: sanitizeTimestamp(input.updatedAt, "updatedAt"),
    canvasDefaults: sanitizeCanvasDefaults(input.canvasDefaults),
    nodes: input.nodes.map((node, index) => sanitizeNode(node, index)),
    crossLinks: input.crossLinks.map(sanitizeCrossLink),
  };

  validateTree(map, { strictOrders: strict });
  validateCrossLinks(map);
  return strict ? map : normalizeOrders(map);
}

function sanitizeNode(node, index) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("The map contains an invalid node.");
  }
  const legacyEdge = {
    color: node.style?.edgeColor,
    width: node.style?.edgeWidth,
    type: node.style?.edgeType,
    dash: node.style?.edgeDash,
  };
  return {
    id: requiredId(node.id, "node"),
    parentId: node.parentId == null ? null : requiredId(node.parentId, "parent node"),
    order: Number.isInteger(node.order) ? node.order : index,
    side: node.side === "left" || node.side === "right" ? node.side : null,
    text: normalizeText(node.text, MAX_NODE_TEXT),
    x: finiteInRange(node.x, -1_000_000, 1_000_000, "node x"),
    y: finiteInRange(node.y, -1_000_000, 1_000_000, "node y"),
    width: finiteInRange(node.width, 80, 1600, "node width", 156),
    height: finiteInRange(node.height, 44, 1200, "node height", 48),
    sizeMode: node.sizeMode === "manual" ? "manual" : "auto",
    collapsed: Boolean(node.collapsed),
    memo: normalizeText(node.memo, MAX_MEMO),
    noteMarkdown: normalizeText(node.noteMarkdown, MAX_NOTE),
    style: sanitizeNodeStyle(node.style, index),
    parentEdgeStyle: sanitizeEdgeStyle(node.parentEdgeStyle || legacyEdge),
  };
}

function sanitizeCrossLink(link) {
  if (!link || typeof link !== "object" || Array.isArray(link)) {
    throw new Error("The map contains an invalid cross-link.");
  }
  return {
    id: requiredId(link.id, "cross-link"),
    sourceId: requiredId(link.sourceId, "cross-link source"),
    targetId: requiredId(link.targetId, "cross-link target"),
    style: sanitizeEdgeStyle(link.style, { color: "#C38196", dash: "dashed" }),
  };
}

function sanitizeCanvasDefaults(value = {}) {
  return {
    nodeStyle: sanitizeNodeStyle(value.nodeStyle || defaultNodeStyle(0), 0),
    edgeStyle: sanitizeEdgeStyle(value.edgeStyle || DEFAULT_EDGE),
    background: hex(value.background, "#FDF7F8"),
    spacing: ["tight", "normal", "airy"].includes(value.spacing) ? value.spacing : "normal",
  };
}

export function sanitizeNodeStyle(style = {}, index = 0) {
  const fallback = defaultNodeStyle(index);
  return {
    fill: hex(style.fill, fallback.fill),
    border: hex(style.border, fallback.border),
    text: hex(style.text, fallback.text),
    shape: SHAPES.includes(style.shape) ? style.shape : fallback.shape,
    font: FONT_OPTIONS.includes(style.font) ? style.font : fallback.font,
    fontSize: finiteInRange(style.fontSize, 8, 96, "font size", fallback.fontSize),
    fontWeight: finiteInRange(style.fontWeight, 400, 800, "font weight", fallback.fontWeight),
    align: ALIGNMENTS.includes(style.align) ? style.align : fallback.align,
  };
}

export function sanitizeEdgeStyle(style = {}, fallbackOverrides = {}) {
  const fallback = { ...DEFAULT_EDGE, ...fallbackOverrides };
  return {
    color: hex(style?.color, fallback.color),
    width: finiteInRange(style?.width, 1, 12, "edge width", fallback.width),
    type: EDGE_TYPES.includes(style?.type) ? style.type : fallback.type,
    dash: EDGE_DASHES.includes(style?.dash) ? style.dash : fallback.dash,
  };
}

function validateTree(map, { strictOrders }) {
  const ids = new Set(map.nodes.map((node) => node.id));
  if (ids.size !== map.nodes.length) throw new Error("The map contains duplicate node IDs.");
  if (!ids.has(map.rootNodeId)) throw new Error("The root node does not exist.");

  const roots = map.nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1 || roots[0].id !== map.rootNodeId) {
    throw new Error("The map must contain exactly one root node.");
  }

  for (const node of map.nodes) {
    if (node.id === map.rootNodeId) {
      if (node.order !== 0 || node.side !== null) throw new Error("The root node is invalid.");
      continue;
    }
    if (!ids.has(node.parentId)) throw new Error("A node has a missing parent.");
    if (node.parentId === map.rootNodeId && !["left", "right"].includes(node.side)) {
      throw new Error("A root branch is missing its side.");
    }
    if (node.parentId !== map.rootNodeId && node.side !== null) {
      throw new Error("Only root branches may store a side.");
    }

    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error("The map contains a tree cycle.");
      visited.add(parentId);
      parentId = nodeById(map, parentId)?.parentId ?? null;
    }
  }

  if (strictOrders) {
    const parentIds = new Set(map.nodes.map((node) => node.parentId).filter(Boolean));
    for (const parentId of parentIds) {
      const orders = childrenOf(map, parentId).map((node) => node.order);
      if (orders.some((order, index) => order !== index)) {
        throw new Error("Sibling order values must be continuous.");
      }
    }
  }
}

function validateCrossLinks(map) {
  const nodeIds = new Set(map.nodes.map((node) => node.id));
  const linkIds = new Set();
  const pairs = new Set();
  for (const link of map.crossLinks) {
    if (linkIds.has(link.id)) throw new Error("The map contains duplicate cross-link IDs.");
    linkIds.add(link.id);
    if (!nodeIds.has(link.sourceId) || !nodeIds.has(link.targetId)) {
      throw new Error("A cross-link has a missing endpoint.");
    }
    if (link.sourceId === link.targetId) throw new Error("A cross-link cannot connect a node to itself.");
    const pair = [link.sourceId, link.targetId].sort().join(":");
    if (pairs.has(pair)) throw new Error("The map contains a duplicate cross-link.");
    pairs.add(pair);
  }
}

function assertTextLimits(map) {
  if (String(map.title ?? "").normalize("NFC").length > MAX_TITLE) {
    throw new Error(`Map titles may contain at most ${MAX_TITLE} characters.`);
  }
  for (const node of map.nodes) {
    if (String(node?.text ?? "").normalize("NFC").length > MAX_NODE_TEXT) {
      throw new Error(`Node text may contain at most ${MAX_NODE_TEXT} characters.`);
    }
    if (String(node?.memo ?? "").normalize("NFC").length > MAX_MEMO) {
      throw new Error(`Memos may contain at most ${MAX_MEMO} characters.`);
    }
    if (String(node?.noteMarkdown ?? "").normalize("NFC").length > MAX_NOTE) {
      throw new Error(`Notes may contain at most ${MAX_NOTE} characters.`);
    }
  }
}

function requiredId(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new Error(`The ${label} ID is invalid.`);
  }
  return value;
}

function sanitizeTimestamp(value, label) {
  if (typeof value !== "string" || !value.endsWith("Z") || !Number.isFinite(Date.parse(value))) {
    throw new Error(`The ${label} timestamp is invalid.`);
  }
  return value;
}

function finiteInRange(value, min, max, label, fallback = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    if (fallback !== null) return fallback;
    throw new Error(`The ${label} value is invalid.`);
  }
  return Math.min(max, Math.max(min, number));
}

function hex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value.toUpperCase() : fallback;
}

export function mapEnvelope(map) {
  return {
    format: "grove-map",
    schemaVersion: MAP_SCHEMA_VERSION,
    exportedAt: now(),
    map: clone(map),
  };
}

export function backupEnvelope(maps, portablePreferences = null, journalActivity = [], journalSessions = []) {
  return {
    format: "grove-backup",
    schemaVersion: BACKUP_SCHEMA_VERSION,
    mapSchemaVersion: MAP_SCHEMA_VERSION,
    backupId: uid(),
    createdAt: now(),
    appVersion: APP_VERSION,
    maps: maps.map(clone),
    journalActivity: clone(journalActivity),
    journalSessions: clone(journalSessions),
    ...(portablePreferences ? { portablePreferences: clone(portablePreferences) } : {}),
  };
}

export function parseGroveFile(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("This is not a Grove JSON file.");
  }

  if (raw.format === "grove-map") {
    if (raw.schemaVersion > MAP_SCHEMA_VERSION) {
      throw new Error("This map was created by a newer version of Grove.");
    }
    if (raw.schemaVersion !== MAP_SCHEMA_VERSION) {
      throw new Error("This map uses an unsupported schema version.");
    }
    return { type: "map", map: sanitizeMap(raw.map, { strict: true }) };
  }

  if (raw.format === "grove-backup") {
    if (raw.schemaVersion > BACKUP_SCHEMA_VERSION || raw.mapSchemaVersion > MAP_SCHEMA_VERSION) {
      throw new Error("This backup was created by a newer version of Grove.");
    }
    if (raw.schemaVersion !== BACKUP_SCHEMA_VERSION || raw.mapSchemaVersion !== MAP_SCHEMA_VERSION) {
      throw new Error("This backup uses an unsupported schema version.");
    }
    if (!Array.isArray(raw.maps) || raw.maps.length > MAX_MAPS_PER_BACKUP) {
      throw new Error("The backup contains an unsupported number of maps.");
    }
    if (raw.journalActivity !== undefined && !Array.isArray(raw.journalActivity)) {
      throw new Error("The backup contains an invalid Journal activity ledger.");
    }
    if (raw.journalSessions !== undefined && !Array.isArray(raw.journalSessions)) throw new Error("The backup contains an invalid Journal session ledger.");
    const maps = raw.maps.map((map) => sanitizeMap(map, { strict: true }));
    const ids = new Set(maps.map((map) => map.id));
    if (ids.size !== maps.length) throw new Error("The backup contains duplicate map IDs.");
    return {
      type: "backup",
      maps,
      portablePreferences: sanitizePortablePreferences(raw.portablePreferences),
      journalActivity: raw.journalActivity === undefined ? undefined : clone(raw.journalActivity),
      journalSessions: raw.journalSessions === undefined ? undefined : clone(raw.journalSessions),
    };
  }

  throw new Error("This file is not a Grove map or backup.");
}

function sanitizePortablePreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  if (["system", "light", "dark"].includes(value.theme)) result.theme = value.theme;
  if ([6, 8, 10, 12, 14, 17].includes(Number(value.uiSize))) result.uiSize = Number(value.uiSize);
  if (["tight", "normal", "airy"].includes(value.spacing)) result.spacing = value.spacing;
  return Object.keys(result).length ? result : null;
}

export function canonicalMap(map) {
  const copy = clone(map);
  delete copy.updatedAt;
  return stableStringify(copy);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function safeFilename(title) {
  return normalizeText(title, 80)
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "untitled";
}
