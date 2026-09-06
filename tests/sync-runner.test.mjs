import assert from "node:assert/strict";
import { runSyncCycle } from "../src/sync-runner.js";

function record(id, updatedAt, title = id) {
  return { id, revision: 0, map: { id, title, updatedAt }, thumbnail: null };
}

function harness({ local = [], remote = [], remoteMaps = {}, largeIds = [] } = {}) {
  const calls = [];
  const records = new Map(local.map((item) => [item.id, structuredClone(item)]));
  const syncApi = {
    async pullIndex() { calls.push("pullIndex"); return structuredClone(remote); },
    async pullMap(id) { calls.push(`pullMap:${id}`); return structuredClone(remoteMaps[id] || null); },
    async pushMap(map) {
      calls.push(`pushMap:${map.id}`);
      if (largeIds.includes(map.id)) throw Object.assign(new Error("too large"), { type: "toolarge" });
    },
    entryFor(item) { return { id: item.id, updatedAt: item.map.updatedAt, deleted: false }; },
    async pushIndex(entries) { calls.push(`pushIndex:${entries.map((entry) => entry.id).join(",")}`); },
    async flushEvents() { calls.push("flushEvents"); },
  };
  const adapters = {
    syncApi,
    async listRecordsFn() { calls.push("listRecords"); return [...records.values()].map((item) => structuredClone(item)); },
    async putRecordFn(item) { calls.push(`putRecord:${item.id}`); records.set(item.id, structuredClone(item)); },
    async deleteRecordFn(id) { calls.push(`deleteRecord:${id}`); records.delete(id); },
    getPreferences: () => ({ theme: "light" }),
  };
  return { calls, records, adapters };
}

{
  const remoteMap = { id: "remote-new", title: "Remote", updatedAt: "2026-08-10T12:00:00.000Z" };
  const test = harness({
    local: [record("local-new", "2026-08-10T13:00:00.000Z")],
    remote: [{ id: "remote-new", updatedAt: remoteMap.updatedAt, deleted: false }],
    remoteMaps: { "remote-new": remoteMap },
  });
  const result = await runSyncCycle(test.adapters);
  assert.deepEqual(result, { pulled: 1, removed: 0, tooLarge: [] });
  assert.ok(test.calls.indexOf("pullIndex") < test.calls.indexOf("pushMap:local-new"), "index pull must precede every push");
  assert.ok(test.calls.indexOf("putRecord:remote-new") < test.calls.indexOf("pushMap:local-new"), "remote map pull must be stored before push");
  assert.ok(test.calls.indexOf("pushIndex:local-new,remote-new") < test.calls.indexOf("flushEvents"), "events flush last");
}

{
  const test = harness({
    local: [
      record("remove-me", "2026-08-10T10:00:00.000Z"),
      record("keep-me", "2026-08-10T14:00:00.000Z"),
    ],
    remote: [
      { id: "remove-me", updatedAt: "2026-08-10T11:00:00.000Z", deleted: true },
      { id: "keep-me", updatedAt: "2026-08-10T13:00:00.000Z", deleted: true },
    ],
  });
  const result = await runSyncCycle(test.adapters);
  assert.equal(result.removed, 1, "newer tombstone must remove its local map");
  assert.equal(test.records.has("remove-me"), false);
  assert.equal(test.records.has("keep-me"), true, "newer local edit must beat an older tombstone");
}

{
  const test = harness({
    local: [
      record("large", "2026-08-10T14:00:00.000Z", "Large map"),
      record("small", "2026-08-10T14:00:00.000Z", "Small map"),
    ],
    largeIds: ["large"],
  });
  const result = await runSyncCycle(test.adapters);
  assert.deepEqual(result.tooLarge, ["Large map"]);
  assert.ok(test.calls.includes("pushMap:small"), "a large map must not block later map uploads");
  assert.ok(test.calls.some((call) => call.startsWith("pushIndex:")), "index upload must continue after a large map is skipped");
  assert.equal(test.calls.at(-1), "flushEvents");
}

console.log("Grove sync ordering, tombstone, and large-map tests passed.");
