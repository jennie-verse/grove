/* sync.js — webapp-data(비공개 저장소)와 주고받는 부분만 모아 둔 모듈.
   화면 코드는 여기 함수만 부르고 GitHub API 를 직접 다루지 않습니다.

   다루는 것 세 가지입니다.
     A. grove/index.<ctx>.json           맵 목록·메타 (제목, 시각, tombstone)
        grove/maps/<mapId>.<ctx>.json    맵 본문 1개당 1파일
     B. events/grove.<ctx>.YYYY-MM.json  공용 활동 기록 (atlas·trace 가 읽음)
     C. backups/grove/YYYY-MM-DD.json    복원용 스냅샷 (최근 12개 유지)

   동기화는 기본으로 꺼져 있습니다. 꺼진 상태에서도 앱은 완전히 동작해야 하고,
   로컬 저장이 언제나 먼저입니다.

   맵 본문을 파일로 나눈 이유는 두 가지입니다. 하나로 묶으면 맵 하나만 고쳐도
   전부를 다시 올려야 하고, 두 기기가 서로 다른 맵을 고쳤을 때 파일 단위로
   덮어씁니다. 대신 파일 수가 늘어나므로 **바뀐 맵만** 올립니다. */

/* ── 공용 모듈은 필요할 때만 부릅니다 ──────────────────────────────────────

   정적 `import` 로 부르면 그 파일 하나를 못 받는 순간 app.js 부터 모듈 그래프가
   통째로 실패해 **앱 전체가 빈 화면이 됩니다.** grove 는 저장소 밖 파일 없이도
   완전히 동작해야 합니다. (2026-08-10 loom 에서 실제로 재현한 문제) */

let sharedPromise = null;

async function api() {
  if (!sharedPromise) {
    sharedPromise = import("../../shared/v1/sync.js").catch((cause) => {
      sharedPromise = null; // 다음에 다시 시도합니다.
      const error = new Error("The shared sync module could not be loaded.");
      error.type = "network";
      error.cause = cause;
      throw error;
    });
  }
  return sharedPromise;
}

const NAMESPACE = "grove";
const HOSTNAME = globalThis.location?.hostname || "";

const REPO = Object.freeze({
  owner: HOSTNAME.endsWith(".github.io")
    ? HOSTNAME.slice(0, -".github.io".length)
    : "",
  repo: "webapp-data",
  branch: "main",
});

export const KEYS = Object.freeze({
  token: "sync.token.v1",
  enabled: "grove.syncEnabled",
  lastSyncAt: "grove.lastSyncAt",
  lastRemoteBackupAt: "grove.lastRemoteBackupAt",
  pendingEvents: "grove.pendingEvents",
  tombstones: "grove.deletedMaps",
});

const BACKUP_KEEP = 12;
// GitHub Contents API 는 1MB 를 넘으면 읽기가 느려지고 커밋도 무거워집니다.
// grove 는 맵 하나가 노드 5,000개까지 갈 수 있어 실제로 넘길 수 있습니다.
export const MAX_FILE_BYTES = 1000000;
// 오프라인 중 쌓인 변경은 오래된 sha 로 재전송되므로 충돌이 정상적으로 납니다.
const CONFLICT_RETRY = 3;
const EPOCH = "1970-01-01T00:00:00.000Z";

/* ── localStorage 도우미 ───────────────────────────────────────────────── */

function readItem(key, fallback = "") {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/* ── 토큰과 켜짐 여부 ──────────────────────────────────────────────────── */

export function getToken() {
  return readItem(KEYS.token, "");
}

export function saveToken(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) return false;
  return writeItem(KEYS.token, trimmed);
}

export function clearToken() {
  removeItem(KEYS.token);
}

/** 화면에는 마지막 네 자리만 보여 줍니다. */
export function tokenHint() {
  const token = getToken();
  return token ? `••••${token.slice(-4)}` : "";
}

export function isEnabled() {
  return readItem(KEYS.enabled) === "1";
}

export function setEnabled(enabled) {
  writeItem(KEYS.enabled, enabled ? "1" : "0");
}

/* 컨텍스트 값은 localStorage 만 읽고 씁니다. 통신이 없으므로 공용 모듈을 부르지
   않고 여기서 처리합니다 — 앱이 뜨는 데 필요한 값이라 공용 모듈이 없는 상황에서도
   읽을 수 있어야 합니다. shared/v1 은 고정이라 키 이름이 바뀌지 않고, 검사
   스크립트가 실제 shared/v1 소스와 대조해 어긋나면 실패합니다. */

const CONTEXT_KEY = `${NAMESPACE}.syncContextId`;
const CONTEXT_LABEL_KEY = `${NAMESPACE}.syncContextLabel`;

export function getContextId() {
  return readItem(CONTEXT_KEY, "");
}

export function getContextLabel() {
  return readItem(CONTEXT_LABEL_KEY, "");
}

function contextFilePath(basePath, contextId) {
  const dot = basePath.lastIndexOf(".");
  if (dot === -1) return `${basePath}.${contextId}`;
  return `${basePath.slice(0, dot)}.${contextId}${basePath.slice(dot)}`;
}

/** 컨텍스트 ID 를 만듭니다.

    **ID 는 만들 때 정해지고 이후 바뀌지 않습니다.** 파일 이름에 들어가기 때문입니다.
    그래서 동기화를 켜기 전에 받은 이름을 여기로 넘겨 ID 에 반영합니다.
    이름 없이 만들면 `context-3f2a1b9c` 처럼 되어 어느 기기 파일인지 알아볼 수 없습니다.
    공용 모듈은 이름에서 영문 소문자와 숫자만 남깁니다. */
export async function ensureContext(preferredName) {
  const Shared = await api();
  return Shared.ensureContextId(NAMESPACE, () => String(preferredName || "").trim());
}

/** 사용자가 붙이는 이름입니다. 한글도 그대로 저장됩니다. 파일 이름과는 무관합니다. */
export function setContextLabel(label) {
  writeItem(CONTEXT_LABEL_KEY, String(label || "").trim());
}

export function getLastSyncAt() {
  return Number(readItem(KEYS.lastSyncAt, "0")) || 0;
}

export function getLastRemoteBackupAt() {
  return Number(readItem(KEYS.lastRemoteBackupAt, "0")) || 0;
}

/** 동기화가 실제로 동작할 수 있는 상태인지. 셋 중 하나라도 없으면 조용히 쉽니다. */
export function isReady() {
  return Boolean(isEnabled() && getToken() && getContextId());
}

function config() {
  return { ...REPO, token: getToken() };
}

/** 화면에 그대로 보여 줄 수 있는 영문 한 줄로 바꿉니다. */
export function describeError(error) {
  if (!error) return "Sync failed.";
  if (error.type === "auth") return "Token may be expired or lacks permission.";
  if (error.type === "network") return "Network unavailable. Changes are queued.";
  if (error.type === "notfound") return "The repository path was not found.";
  if (error.type === "conflict") return "Another device wrote first. Queued to send again.";
  if (error.type === "toolarge") return "That map is too large to sync. Export it to Files instead.";
  return "Sync failed. Check the token and repository access.";
}

function tooLarge(message) {
  const error = new Error(message);
  error.type = "toolarge";
  return error;
}

/* ── B. 공용 활동 기록 ─────────────────────────────────────────────────── */

function pad2(value) {
  return String(value).padStart(2, "0");
}

/** 로컬 오프셋을 살린 ISO 문자열. 하루 경계를 보는 앱들이 있어 UTC 로 바꾸지 않습니다. */
export function localIso(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const pad = (value) => String(Math.abs(value)).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    + `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`;
}

function monthKey(isoLocal) {
  return String(isoLocal).slice(0, 7);
}

/** 맵 하나를 공용 이벤트 모양으로 바꿉니다.

    **맵당 이벤트는 하나입니다.** `at` 은 만든 시각이라 Trace 타임라인에서 제자리에
    남고, 이름을 바꾸면 같은 id 의 `detail` 만 갱신되어 Atlas 에서 항상 현재 제목으로
    찾힙니다. 편집할 때마다 남기지 않는 것은, 같은 맵이 여러 날에 중복해 보이면
    타임라인이 읽기 어려워지기 때문입니다. */
export function mapToEvent(map, { deleted = false } = {}) {
  if (!map || typeof map.id !== "string" || !map.id) return null;
  const created = new Date(map.createdAt || Date.now());
  const event = {
    v: 1,
    id: `${NAMESPACE}:${map.id}`,
    app: NAMESPACE,
    kind: "map.created",
    at: localIso(Number.isNaN(created.getTime()) ? new Date() : created),
    title: "Created a mind map",
    // 사용자가 적은 제목입니다. 한글 그대로 두고, HTML 은 넣지 않습니다.
    detail: String(map.title || "").trim().slice(0, 200),
    ref: "../grove/",
  };
  if (deleted) event.deleted = true;
  return event;
}

function pendingEvents() {
  const value = parseJson(readItem(KEYS.pendingEvents, "[]"), []);
  return Array.isArray(value) ? value : [];
}

/** 아직 보내지 못한 이벤트를 로컬에 쌓아 둡니다.
    공용 outbox 는 보낼 본문을 통째로 저장하는데, 이벤트 파일은 보낼 때마다
    원격과 다시 합쳐야 해서 본문을 미리 굳히면 안 됩니다. 그래서 이벤트만 모읍니다. */
export function queueEvent(event) {
  if (!event) return;
  const queue = pendingEvents().filter((item) => item.id !== event.id);
  queue.push(event);
  writeItem(KEYS.pendingEvents, JSON.stringify(queue));
}

export function pendingEventCount() {
  return pendingEvents().length;
}

function mergeEventsById(current, incoming) {
  const merged = new Map();
  current.forEach((event) => { if (event && event.id) merged.set(event.id, event); });
  let changed = false;
  incoming.forEach((event) => {
    if (!event || !event.id) return;
    const previous = merged.get(event.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(event)) return;
    merged.set(event.id, event);
    changed = true;
  });
  return { list: [...merged.values()], changed };
}

async function writeEventMonth(cfg, path, incoming) {
  const Shared = await api();
  for (let attempt = 0; attempt < CONFLICT_RETRY; attempt += 1) {
    const existing = await Shared.readFile(cfg, path);
    const current = existing.exists ? parseJson(existing.content, []) : [];
    const merged = mergeEventsById(Array.isArray(current) ? current : [], incoming);
    if (!merged.changed) return;

    const body = `${JSON.stringify(merged.list, null, 2)}\n`;
    if (body.length > MAX_FILE_BYTES) {
      throw tooLarge("The monthly event file is too large.");
    }

    try {
      await Shared.writeFile(cfg, path, body, {
        sha: existing.sha || undefined,
        message: `grove: add ${incoming.length} event(s) to ${path}`,
      });
      return;
    } catch (error) {
      // 다른 기기가 먼저 썼습니다. 최신 sha 로 다시 읽어 합친 뒤 재시도합니다.
      if (error && error.type === "conflict" && attempt < CONFLICT_RETRY - 1) continue;
      throw error;
    }
  }
}

/** 쌓인 이벤트를 달별로 나눠 보냅니다. 성공한 달의 것만 큐에서 뺍니다. */
export async function flushEvents() {
  if (!isReady()) return { sent: 0, remaining: pendingEventCount() };
  const queue = pendingEvents();
  if (queue.length === 0) return { sent: 0, remaining: 0 };

  const cfg = config();
  const contextId = getContextId();
  const byMonth = new Map();
  queue.forEach((event) => {
    const key = monthKey(event.at);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(event);
  });

  let sent = 0;
  let firstError = null;
  const stillPending = [];

  for (const [month, events] of byMonth) {
    // 이름 순서가 <앱>.<기기>.<YYYY-MM>.json 이어야 atlas·trace 파서가 알아봅니다.
    // contextFilePath() 는 마지막 점 앞에 기기 ID 를 넣어 순서가 어긋나므로 직접 만듭니다.
    const path = `events/${NAMESPACE}.${contextId}.${month}.json`;
    try {
      await writeEventMonth(cfg, path, events);
      sent += events.length;
    } catch (error) {
      if (!firstError) firstError = error;
      stillPending.push(...events);
    }
  }

  writeItem(KEYS.pendingEvents, JSON.stringify(stillPending));
  if (firstError && sent === 0) throw firstError;
  return { sent, remaining: stillPending.length };
}

/* ── 삭제 표시(tombstone) ──────────────────────────────────────────────────

   grove 는 focus·loom 과 달리 삭제를 기기 간에 맞춥니다. 목록 파일이 이미 우리가
   관리하는 메타라서 표시를 남기기에 자연스럽기 때문입니다.

   **표시는 사용자가 직접 지웠을 때만 찍습니다.** "로컬에 없으니 지워진 것"이라고
   절대 추론하지 않습니다. 그 추론이 2026-08-09 focus 사고의 본질이었습니다.
   맵 본문 파일은 지우지 않고 남겨 둡니다 — 표시가 잘못됐을 때 되돌릴 수 있게. */

function tombstones() {
  const value = parseJson(readItem(KEYS.tombstones, "[]"), []);
  return Array.isArray(value) ? value : [];
}

/** 사용자가 맵을 지웠습니다. 다음 동기화에서 목록에 표시로 올라갑니다. */
export function markDeleted(map) {
  if (!map || typeof map.id !== "string") return;
  const list = tombstones().filter((item) => item.id !== map.id);
  list.push({
    id: map.id,
    title: String(map.title || ""),
    createdAt: map.createdAt || EPOCH,
    deletedAt: new Date().toISOString(),
  });
  writeItem(KEYS.tombstones, JSON.stringify(list));
}

export function tombstoneCount() {
  return tombstones().length;
}

/* ── A. 기기 간 동기화 ─────────────────────────────────────────────────── */

function indexPath(contextId) {
  return contextFilePath(`${NAMESPACE}/index.json`, contextId);
}

function mapPath(mapId, contextId) {
  return contextFilePath(`${NAMESPACE}/maps/${mapId}.json`, contextId);
}

function stamp(entry) {
  return String(entry && entry.updatedAt ? entry.updatedAt : EPOCH);
}

/** 목록 항목 하나. 본문 없이 이것만 보고 무엇을 받아올지 정합니다. */
export function entryFor(record) {
  const map = record.map || record;
  return {
    id: map.id,
    title: String(map.title || ""),
    createdAt: map.createdAt || EPOCH,
    updatedAt: map.updatedAt || EPOCH,
    revision: Number(record.revision ?? 0),
  };
}

/** 같은 id 는 updatedAt 이 최신인 쪽이 이깁니다. **항목은 절대 사라지지 않습니다.** */
function mergeEntries(base, incoming) {
  const merged = new Map();
  (Array.isArray(base) ? base : []).forEach((item) => {
    if (item && typeof item.id === "string") merged.set(item.id, item);
  });
  (Array.isArray(incoming) ? incoming : []).forEach((item) => {
    if (!item || typeof item.id !== "string") return;
    const previous = merged.get(item.id);
    if (!previous || stamp(item) >= stamp(previous)) merged.set(item.id, item);
  });
  return [...merged.values()];
}

/** 모든 기기의 목록 파일을 읽어 합칩니다. 본문은 아직 받지 않습니다. */
export async function pullIndex() {
  if (!isReady()) return null;
  const Shared = await api();
  const cfg = config();
  const entries = await Shared.listDir(cfg, NAMESPACE);
  const files = entries.filter((entry) => (
    entry.type === "file" && /^index\.[a-z0-9-]+\.json$/i.test(entry.name)
  ));

  let merged = [];
  for (const file of files) {
    const read = await Shared.readFile(cfg, file.path);
    if (!read.exists) continue;
    const payload = parseJson(read.content, null);
    const list = payload && payload.data ? payload.data.maps : null;
    merged = mergeEntries(merged, list);
  }
  return merged;
}

/** 맵 본문 하나를 받아옵니다. 어느 기기가 마지막으로 썼는지 모르므로 전부 보고
    updatedAt 이 가장 최신인 것을 씁니다. */
export async function pullMap(mapId) {
  if (!isReady()) return null;
  const Shared = await api();
  const cfg = config();
  const entries = await Shared.listDir(cfg, `${NAMESPACE}/maps`);
  const pattern = new RegExp(`^${mapId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[a-z0-9-]+\\.json$`, "i");
  const files = entries.filter((entry) => entry.type === "file" && pattern.test(entry.name));

  let newest = null;
  for (const file of files) {
    const read = await Shared.readFile(cfg, file.path);
    if (!read.exists) continue;
    const payload = parseJson(read.content, null);
    const map = payload && payload.data ? payload.data.map : null;
    if (!map || typeof map.id !== "string") continue;
    if (!newest || String(map.updatedAt || EPOCH) > String(newest.updatedAt || EPOCH)) newest = map;
  }
  return newest;
}

/** 맵 본문 하나를 올립니다. 1MB 를 넘으면 그 맵만 건너뜁니다. */
export async function pushMap(map) {
  if (!isReady()) return false;
  const Shared = await api();
  const cfg = config();
  const path = mapPath(map.id, getContextId());
  const body = `${JSON.stringify({
    v: 1,
    app: NAMESPACE,
    context: getContextId(),
    mapId: map.id,
    updatedAt: map.updatedAt || new Date().toISOString(),
    data: { map },
  }, null, 2)}\n`;

  if (body.length > MAX_FILE_BYTES) {
    throw tooLarge(`"${map.title}" is too large to sync.`);
  }

  const existing = await Shared.readFile(cfg, path);
  await Shared.writeFile(cfg, path, body, {
    sha: existing.sha || undefined,
    message: `grove: update ${path}`,
  });
  return true;
}

/** 목록 파일을 올립니다.

    **올리기는 절대로 목록을 줄이지 않습니다.** 원격에 이미 있던 항목과 합집합을
    만들어 씁니다. 화면 상태가 아직 안 채워졌거나 IndexedDB 가 잠깐 안 열리는 등
    어떤 이유로든 빈 목록이 들어와도 원격 기록이 지워지지 않게 하기 위한 안전장치입니다.
    (2026-08-09: focus 에서 빈 목록이 올라가 원격 세션 3건이 실제로 사라졌습니다.)

    지운 맵은 목록에서 빼는 것이 아니라 `deleted: true` 로 **표시**합니다. */
export async function pushIndex(entries, { preferences = null } = {}) {
  if (!isReady()) return false;
  const Shared = await api();
  const cfg = config();
  const contextId = getContextId();
  const path = indexPath(contextId);

  const existing = await Shared.readFile(cfg, path);
  let previous = [];
  if (existing.exists) {
    const payload = parseJson(existing.content, null);
    if (payload && payload.data && Array.isArray(payload.data.maps)) previous = payload.data.maps;
  }

  const deletions = tombstones().map((item) => ({
    id: item.id,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.deletedAt,
    deleted: true,
  }));

  const body = `${JSON.stringify({
    v: 1,
    app: NAMESPACE,
    context: contextId,
    updatedAt: new Date().toISOString(),
    data: {
      preferences,
      maps: mergeEntries(mergeEntries(previous, entries), deletions),
    },
  }, null, 2)}\n`;

  if (body.length > MAX_FILE_BYTES) {
    throw tooLarge("The map list is too large to sync.");
  }

  await Shared.writeFile(cfg, path, body, {
    sha: existing.sha || undefined,
    message: `grove: update ${path}`,
  });
  writeItem(KEYS.lastSyncAt, String(Date.now()));
  return true;
}

/* ── C. 백업 ───────────────────────────────────────────────────────────── */

function backupDayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 백업 본문은 기기 파일 내보내기와 같은 모양입니다. 기존 복원이 그대로 읽습니다. */
export async function backupNow(backupPayload) {
  if (!isReady()) return false;
  const Shared = await api();
  const cfg = config();
  const path = `backups/${NAMESPACE}/${backupDayKey(Date.now())}.json`;
  const body = `${JSON.stringify(backupPayload, null, 2)}\n`;

  if (body.length > MAX_FILE_BYTES) {
    throw tooLarge("The backup is too large to upload. Export it to Files instead.");
  }

  const existing = await Shared.readFile(cfg, path);
  await Shared.writeFile(cfg, path, body, {
    sha: existing.sha || undefined,
    message: `grove: back up ${path}`,
  });
  writeItem(KEYS.lastRemoteBackupAt, String(Date.now()));
  await pruneBackups(cfg);
  return true;
}

/** 최근 12개만 남기고 오래된 것부터 지웁니다. 실패해도 백업 자체는 성공으로 둡니다. */
async function pruneBackups(cfg) {
  try {
    const Shared = await api();
    const entries = await Shared.listDir(cfg, `backups/${NAMESPACE}`);
    const files = entries
      .filter((entry) => entry.type === "file" && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const extra = files.slice(0, Math.max(0, files.length - BACKUP_KEEP));
    for (const entry of extra) {
      await Shared.deleteFile(cfg, entry.path, entry.sha, `grove: prune ${entry.path}`);
    }
  } catch {
    // 정리는 부가 작업입니다. 실패해도 다음 백업에서 다시 시도합니다.
  }
}
