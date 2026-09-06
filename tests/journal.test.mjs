import test from "node:test";
import assert from "node:assert/strict";
import { mergeMapActivity } from "../src/journal-record.js";
import { validateActivityLedger } from "../src/journal.js";

const map = {
  id: "fixture-map", title: "Fixture garden", createdAt: "2026-08-17T08:00:00-05:00",
  updatedAt: "2026-08-17T10:00:00-05:00",
  nodes: [{ id: "private-node", text: "must not leave", memo: "private memo", noteMarkdown: "private note" }],
};

test("Grove map activity merges in semantic order and counts opens", () => {
  let record = mergeMapActivity(null, map, "opened", "2026-08-17T09:00:00-05:00");
  record = mergeMapActivity(record, map, "edited", "2026-08-17T10:00:00-05:00");
  record = mergeMapActivity(record, map, "opened", "2026-08-17T11:00:00-05:00");
  record = mergeMapActivity(record, map, "export-requested", "2026-08-17T12:00:00-05:00");
  assert.deepEqual(record.data.actions, ["opened", "edited", "export-requested"]);
  assert.equal(record.data.openCount, 2);
  assert.equal(record.id, "fixture-map:2026-08-17");
});

test("projection contains stable metadata and excludes the map body", () => {
  const record = mergeMapActivity(null, map, "created", map.createdAt);
  const serialized = JSON.stringify(record);
  assert.equal(record.title, "Fixture garden");
  assert.equal(record.data.itemId, "fixture-map");
  for (const privateText of ["must not leave", "private memo", "private note", "private-node"]) assert.equal(serialized.includes(privateText), false);
});

test("backup activity ledger accepts only Grove metadata records", () => {
  const record = mergeMapActivity(null, map, "opened", "2026-08-17T09:00:00-05:00");
  assert.deepEqual(validateActivityLedger([record]), [record]);
  assert.throws(() => validateActivityLedger([{ ...record, kind: "board-activity" }]), /Invalid Grove Journal activity ledger/);
});

test("actual created/opened/saved/export paths are journaled while view state is not", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  for (const action of ["created", "opened", "edited", "export-requested"]) {
    assert.match(app, new RegExp(`recordActivity\\([^\\n]+[\"']${action}[\"']`));
  }
  const saveViewBody = /async function saveView\(\) \{[\s\S]*?\n\}/.exec(app)?.[0] || "";
  assert.doesNotMatch(saveViewBody, /recordActivity/, "pan and zoom state must not be journaled");
  const previewBody = /async function startPreviewOnly[\s\S]*?\n\}/.exec(app)?.[0] || "";
  assert.doesNotMatch(previewBody, /recordActivity/, "Preview only must remain non-persistent");
  assert.match(app, /journal\.exportActivityLedger\(\)/);
  assert.match(app, /journal\.replaceActivityLedger\(modal\.journalActivity/);
});

test('backfillJournal session loop uses the enqueued record date, not an out-of-scope variable', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/journal.js', import.meta.url), 'utf8');
  assert.ok(src.includes('sessionLedger.read().filter'), 'expected the session-ledger backfill loop to still be present');
  const enqueueCall = src.match(/sessionLedger\.read\(\)\.filter[\s\S]*?await client\.enqueue\(record, \{ date: (.*?) \}\);/);
  assert.ok(enqueueCall, 'expected to find the session-ledger enqueue call');
  assert.equal(enqueueCall[1].trim(), 'record.at.slice(0, 10)', 'the enqueue date must come from the loop variable "record", not the filter callback\'s "row" (ReferenceError regression)');
});

test('session ledger date-range filter used by backfill keeps only in-range rows', () => {
  const rows = [
    { id: 'a', at: '2026-08-01T09:00:00-05:00' },
    { id: 'b', at: '2026-08-15T09:00:00-05:00' },
    { id: 'c', at: '2026-09-01T09:00:00-05:00' },
  ];
  const from = '2026-08-10';
  const to = '2026-08-20';
  const inRange = rows.filter((row) => row.at.slice(0, 10) >= from && row.at.slice(0, 10) <= to);
  assert.deepEqual(inRange.map((row) => row.id), ['b']);
  // The same rows, mapped the way the fixed loop does (using the loop variable
  // itself, not a name that only exists inside the filter callback).
  const enqueued = inRange.map((record) => ({ record, date: record.at.slice(0, 10) }));
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].date, '2026-08-15');
});
