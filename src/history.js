import { clone } from "./model.js";

const DEFAULT_LIMIT = 100;
const DEFAULT_MEMORY_CAP = 32 * 1024 * 1024;
const META_KEYS = ["title", "rootNodeId", "createdAt", "updatedAt", "canvasDefaults"];

export class HistoryManager {
  constructor({ limit = DEFAULT_LIMIT, memoryCap = DEFAULT_MEMORY_CAP } = {}) {
    this.limit = limit;
    this.memoryCap = memoryCap;
    this.undoStack = [];
    this.redoStack = [];
    this.memoryBytes = 0;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get size() { return this.undoStack.length; }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.memoryBytes = 0;
  }

  commit(before, after, label = "Edit") {
    const patch = buildPatch(before, after, label);
    if (!patch) return false;
    this.undoStack.push(patch);
    this.redoStack = [];
    this.memoryBytes += patch.bytes;
    while (this.undoStack.length > this.limit || this.memoryBytes > this.memoryCap) {
      const removed = this.undoStack.shift();
      this.memoryBytes -= removed.bytes;
    }
    return true;
  }

  undo(map) {
    const patch = this.undoStack.pop();
    if (!patch) return map;
    this.memoryBytes -= patch.bytes;
    this.redoStack.push(patch);
    return applyPatch(map, patch, "before");
  }

  redo(map) {
    const patch = this.redoStack.pop();
    if (!patch) return map;
    this.undoStack.push(patch);
    this.memoryBytes += patch.bytes;
    return applyPatch(map, patch, "after");
  }
}

function buildPatch(before, after, label) {
  const meta = {};
  for (const key of META_KEYS) {
    if (!same(before[key], after[key])) meta[key] = { before: clone(before[key]), after: clone(after[key]) };
  }
  const nodes = diffById(before.nodes, after.nodes);
  const crossLinks = diffById(before.crossLinks, after.crossLinks);
  if (!Object.keys(meta).length && !nodes.length && !crossLinks.length) return null;
  const patch = { label, meta, nodes, crossLinks };
  patch.bytes = JSON.stringify(patch).length * 2;
  return patch;
}

function diffById(beforeItems, afterItems) {
  const beforeMap = new Map(beforeItems.map((item, index) => [item.id, { item, index }]));
  const afterMap = new Map(afterItems.map((item, index) => [item.id, { item, index }]));
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes = [];
  for (const id of ids) {
    const before = beforeMap.get(id);
    const after = afterMap.get(id);
    if (same(before?.item, after?.item)) continue;
    changes.push({
      id,
      before: before ? clone(before.item) : null,
      after: after ? clone(after.item) : null,
      beforeIndex: before?.index ?? -1,
      afterIndex: after?.index ?? -1,
    });
  }
  return changes;
}

function applyPatch(map, patch, direction) {
  const result = clone(map);
  for (const [key, change] of Object.entries(patch.meta)) result[key] = clone(change[direction]);
  result.nodes = applyCollectionPatch(result.nodes, patch.nodes, direction);
  result.crossLinks = applyCollectionPatch(result.crossLinks, patch.crossLinks, direction);
  return result;
}

function applyCollectionPatch(items, changes, direction) {
  const target = new Map(items.map((item) => [item.id, clone(item)]));
  for (const change of changes) {
    const value = change[direction];
    if (value === null) target.delete(change.id);
    else target.set(change.id, clone(value));
  }
  const indexKey = direction === "before" ? "beforeIndex" : "afterIndex";
  const preferred = new Map(changes.map((change) => [change.id, change[indexKey]]));
  return [...target.values()].sort((a, b) => {
    const aIndex = preferred.has(a.id) ? preferred.get(a.id) : items.findIndex((item) => item.id === a.id);
    const bIndex = preferred.has(b.id) ? preferred.get(b.id) : items.findIndex((item) => item.id === b.id);
    return aIndex - bIndex;
  });
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
