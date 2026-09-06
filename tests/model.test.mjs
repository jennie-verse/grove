import assert from "node:assert/strict";
import {
  addCrossLink,
  addNode,
  backupEnvelope,
  canonicalMap,
  clone,
  createMap,
  mapEnvelope,
  parseGroveFile,
  removeNode,
  reorderNode,
  reparentNode,
  sanitizeMap,
} from "../src/model.js";
import { HistoryManager } from "../src/history.js";
import { renderMarkdown } from "../src/markdown.js";

const map = createMap("한글 Grove");
const first = addNode(map, map.rootNodeId, null, "First");
const second = addNode(map, map.rootNodeId, first.id, "Second");
const grandchild = addNode(map, first.id, null, "Grandchild");

assert.equal(map.nodes.length, 4);
assert.equal(reparentNode(map, first.id, grandchild.id), false, "tree cycles must be rejected");
assert.equal(reparentNode(map, grandchild.id, second.id), true, "valid reparent must succeed");
assert.equal(reorderNode(map, second.id, -1), true, "sibling reorder must succeed");
assert.equal(map.nodes.find((node) => node.id === second.id).order, 0);

const ordered = createMap("Ordered siblings");
const orderA = addNode(ordered, ordered.rootNodeId, null, "A");
const orderB = addNode(ordered, ordered.rootNodeId, null, "B");
const orderC = addNode(ordered, ordered.rootNodeId, null, "C");
assert.equal(reparentNode(ordered, orderA.id, ordered.rootNodeId, 1), true);
assert.deepEqual(
  ordered.nodes.filter((node) => node.parentId === ordered.rootNodeId).sort((a, b) => a.order - b.order).map((node) => node.text),
  ["B", "A", "C"],
  "before/after insertion must use the final sibling index",
);
assert.equal(reparentNode(ordered, orderC.id, ordered.rootNodeId, 0), true);
assert.deepEqual(
  ordered.nodes.filter((node) => node.parentId === ordered.rootNodeId).sort((a, b) => a.order - b.order).map((node) => node.text),
  ["C", "B", "A"],
);

assert.ok(addCrossLink(map, first.id, second.id));
assert.equal(addCrossLink(map, second.id, first.id), null, "duplicate undirected link must be rejected");

const roundTrip = parseGroveFile(mapEnvelope(map));
assert.equal(roundTrip.type, "map");
assert.equal(canonicalMap(roundTrip.map), canonicalMap(map));

const backup = parseGroveFile(backupEnvelope([map], { theme: "dark", uiSize: 14 }, []));
assert.equal(backup.type, "backup");
assert.equal(backup.maps.length, 1);
assert.equal(backup.portablePreferences.theme, "dark");
assert.deepEqual(backup.journalActivity, []);

assert.throws(() => parseGroveFile({ ...mapEnvelope(map), schemaVersion: 999 }), /newer version/i);
assert.throws(() => sanitizeMap({ ...clone(map), nodes: map.nodes.map((node) => ({ ...node, parentId: null })) }), /exactly one root/i);

const removable = addNode(map, first.id, null, "Remove me");
addCrossLink(map, removable.id, second.id);
removeNode(map, removable.id);
assert.equal(map.nodes.some((node) => node.id === removable.id), false);
assert.equal(map.crossLinks.some((link) => link.sourceId === removable.id || link.targetId === removable.id), false);

const history = new HistoryManager({ limit: 100, memoryCap: 32 * 1024 * 1024 });
const before = clone(map);
map.title = "Changed";
history.commit(before, map, "Rename map");
const undone = history.undo(map);
assert.equal(undone.title, before.title);
const redone = history.redo(undone);
assert.equal(redone.title, "Changed");

const safeMarkdown = renderMarkdown('<script>alert(1)</script> [bad](javascript:alert(1)) [good](https://example.com)');
assert.equal(safeMarkdown.includes("<script>"), false);
assert.equal(safeMarkdown.includes('href="javascript:'), false);
assert.equal(safeMarkdown.includes('rel="noopener noreferrer"'), true);

const large = createMap("500 node fixture");
const start = performance.now();
let parentId = large.rootNodeId;
for (let index = 1; index < 500; index += 1) {
  const node = addNode(large, parentId, null, `Node ${index}`);
  if (index % 6 === 0) parentId = large.rootNodeId;
  else parentId = node.id;
}
const elapsed = performance.now() - start;
assert.equal(large.nodes.length, 500);
assert.ok(elapsed < 1500, `500-node fixture creation took ${elapsed.toFixed(1)}ms`);

console.log(`Grove model tests passed (${elapsed.toFixed(1)}ms fixture creation).`);
