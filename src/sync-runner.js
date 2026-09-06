/* sync-runner.js — 언제 동기화를 돌릴지, 무엇을 올릴지 정하는 곳.
   실제 GitHub 통신은 sync.js 가 합니다.

   순서를 어기면 데이터가 사라집니다. 2026-08-09 focus 에서 실제로 겪었습니다.

     1. 목록 받아오기 (pullIndex)
     2. 원격이 더 최신인 맵만 본문 받아오기
     3. 올리기 — 올릴 목록은 **저장소에서 새로 읽습니다.** 화면 상태를 쓰지 않습니다.
     4. 목록 올리기 (합집합 + 삭제 표시)
     5. 이벤트 큐 보내기

   올리기가 받아오기보다 먼저 돌면, 아직 아무것도 못 받은 빈 상태가 원격을 덮습니다. */

import * as sync from "./sync.js";
import { listRecords, putRecord, deleteRecord } from "./store.js";

// 공용 모듈과 같은 4초 디바운스입니다. 노드를 연달아 고칠 때 요청이 쌓이지 않게 합니다.
const PUSH_DEBOUNCE_MS = 4000;
const EPOCH = "1970-01-01T00:00:00.000Z";

let pushTimer = null;
let inFlight = null;
let listener = null;
let readPreferences = () => null;

function stamp(value) {
  return String(value || EPOCH);
}

function notify(state, detail) {
  if (listener) {
    try { listener(state, detail); } catch { /* UI 갱신 실패가 동기화를 막지 않습니다. */ }
  }
}

/** 설정 화면이 상태 줄을 갱신할 수 있도록 등록합니다. */
export function onSyncState(fn) {
  listener = typeof fn === "function" ? fn : null;
}

/** 앱이 시작할 때 한 번 부릅니다. 표시 설정은 백업용으로만 올립니다. */
export function attach({ getPreferences } = {}) {
  if (typeof getPreferences === "function") readPreferences = getPreferences;
}

export function schedulePush() {
  if (!sync.isReady()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { runSync().catch(() => {}); }, PUSH_DEBOUNCE_MS);
}

/* ── 한 바퀴 ───────────────────────────────────────────────────────────── */

/** @returns {Promise<{skipped?:boolean, pulled?:number, removed?:number, tooLarge?:string[], error?:Error}>} */
export function runSync() {
  if (inFlight) return inFlight;
  inFlight = runSyncOnce().finally(() => { inFlight = null; });
  return inFlight;
}

async function runSyncOnce() {
  if (!sync.isReady()) return { skipped: true };
  clearTimeout(pushTimer);
  notify("syncing");

  const tooLarge = [];

  try {
    const result = await runSyncCycle({ tooLarge });
    notify("idle", result);
    return result;
  } catch (error) {
    notify("error", { error });
    return { error, tooLarge };
  }
}

/**
 * One deterministic pull-before-push cycle. Dependencies are injectable so the
 * ordering, tombstone, and large-map rules can be regression-tested without a
 * GitHub token or IndexedDB mutation.
 */
export async function runSyncCycle({
  syncApi = sync,
  listRecordsFn = listRecords,
  putRecordFn = putRecord,
  deleteRecordFn = deleteRecord,
  getPreferences = readPreferences,
  tooLarge = [],
} = {}) {
    // 1. 목록 받아오기
    const remoteEntries = (await syncApi.pullIndex()) || [];
    const remoteById = new Map(remoteEntries.map((entry) => [entry.id, entry]));

    const local = await listRecordsFn();
    const localById = new Map(local.map((record) => [record.map.id, record]));

    // 2. 원격이 더 최신인 것만 본문을 받습니다. 목록만 보고 정하므로 요청이 적습니다.
    let pulled = 0;
    let removed = 0;
    for (const entry of remoteEntries) {
      const current = localById.get(entry.id);

      if (entry.deleted) {
        // 삭제 표시. 지운 뒤에 다른 기기에서 더 늦게 고쳤다면 편집이 이깁니다.
        if (current && stamp(entry.updatedAt) >= stamp(current.map.updatedAt)) {
          await deleteRecordFn(entry.id);
          removed += 1;
        }
        continue;
      }

      if (current && stamp(entry.updatedAt) <= stamp(current.map.updatedAt)) continue;

      const map = await syncApi.pullMap(entry.id);
      if (!map) continue;
      // expectedRevision 을 넘기지 않아 원격 판을 그대로 씁니다.
      await putRecordFn({ id: map.id, map, thumbnail: null });
      pulled += 1;
    }

    // 3. 올리기 — 저장소에서 새로 읽습니다. 화면 상태(state.records)는 쓰지 않습니다.
    const after = await listRecordsFn();
    for (const record of after) {
      const map = record.map;
      if (!map || typeof map.id !== "string") continue;
      const entry = remoteById.get(map.id);
      // 바뀌지 않은 맵은 다시 올리지 않습니다. 맵이 많을 때 요청 수를 가릅니다.
      if (entry && !entry.deleted && stamp(map.updatedAt) <= stamp(entry.updatedAt)) continue;
      try {
        await syncApi.pushMap(map);
      } catch (error) {
        // 큰 맵 하나 때문에 나머지가 멈추면 안 됩니다. 그 맵만 건너뜁니다.
        if (error && error.type === "toolarge") { tooLarge.push(map.title || map.id); continue; }
        throw error;
      }
    }

    // 4. 목록 올리기 — 합집합이라 어떤 경우에도 항목이 사라지지 않습니다.
    await syncApi.pushIndex(after.map((record) => syncApi.entryFor(record)), {
      preferences: getPreferences(),
    });

    // 5. 밀린 이벤트
    await syncApi.flushEvents();

    return { pulled, removed, tooLarge };
}
