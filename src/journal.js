import * as sync from "./sync.js";
import { localDate, localIso, mergeMapActivity } from "./journal-record.js";
import { createSessionLedger } from "./activity-session.js";

const ENABLED_KEY = "grove.journalEnabled.v1";
const ACTIVITY_KEY = "grove.journalActivity.v1";
const HOSTNAME = globalThis.location?.hostname || "";
const REPO = Object.freeze({
  owner: HOSTNAME.endsWith(".github.io")
    ? HOSTNAME.slice(0, -".github.io".length)
    : "",
  repo: "webapp-data",
  branch: "main",
});
let clientPromise = null;
let lastState = { status: "not reported", pendingCount: 0, errorCode: "" };
const sessionLedger = createSessionLedger("grove.journalSessions.v1");

function readItem(key) { try { return localStorage.getItem(key) || ""; } catch { return ""; } }
function writeItem(key, value) { try { localStorage.setItem(key, value); } catch { /* local app remains usable */ } }
function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function safeCode(error, fallback) { return typeof error?.code === "string" && /^[A-Z0-9_-]{1,64}$/.test(error.code) ? error.code : fallback; }

function activityMap() {
  const value = parse(readItem(ACTIVITY_KEY), {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function saveActivityMap(value) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffDate = localDate(cutoff);
  writeItem(ACTIVITY_KEY, JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => key.slice(0, 10) >= cutoffDate))));
}

function normalizedActivityMap(rows) {
  if (!Array.isArray(rows)) throw new Error("Invalid Grove Journal activity ledger.");
  const next = {};
  for (const record of rows) {
    if (!record || record.kind !== "map-activity" || typeof record.id !== "string" || !record.data?.itemId || !Array.isArray(record.data?.actions)) {
      throw new Error("Invalid Grove Journal activity ledger record.");
    }
    const date = localDate(record.at);
    next[`${date}:${record.data.itemId}`] = record;
  }
  return next;
}

export function validateActivityLedger(rows) { return Object.values(normalizedActivityMap(rows)); }
export function exportActivityLedger() { return Object.values(activityMap()); }
export function replaceActivityLedger(rows, { merge = false } = {}) {
  const next = normalizedActivityMap(rows);
  saveActivityMap(merge ? { ...activityMap(), ...next } : next);
  return exportActivityLedger();
}
export function clearActivityLedger() {
  try { localStorage.removeItem(ACTIVITY_KEY); return true; } catch { return false; }
}
export const exportSessionLedger = () => sessionLedger.read();
export const validateSessionLedger = (rows) => sessionLedger.validate(rows);
export const replaceSessionLedger = (rows, options = {}) => sessionLedger.replace(rows, options);
export async function recordSession(record) {
  if (!record?.id || record.kind !== "usage-session") return false;
  sessionLedger.replace([record], { merge: true });
  if (!isJournalEnabled()) return false;
  const client = await getClient(); if (!client) return false;
  try {
    const module = await import("../../shared/v2/journal.js");
    if (!module.JOURNAL_KINDS?.grove?.includes("usage-session")) { lastState = { ...lastState, status: "error", errorCode: "CONTRACT_STALE" }; return false; }
    await client.enqueue(record, { date: record.at.slice(0, 10) }); return true;
  } catch { return false; }
}

export function isJournalEnabled() { return readItem(ENABLED_KEY) === "1"; }
export function getJournalState() { return { enabled: isJournalEnabled(), ...lastState }; }

async function getClient() {
  if (clientPromise) {
    const existing = await clientPromise;
    if (existing) return existing;
    clientPromise = null;
  }
  clientPromise = (async () => {
    const context = sync.getContextId();
    if (!context) return null;
    const module = await import("../../shared/v2/journal.js");
    return module.createJournalClient({
      app: "grove", context, namespace: "grove-journal", isEnabled: isJournalEnabled,
      resolveConfig: async () => {
        const token = sync.getToken();
        if (!token) throw Object.assign(new Error("Journal authentication unavailable"), { code: "AUTH" });
        return { ...REPO, token };
      },
      onState: state => { lastState = { ...lastState, status: state.status, pendingCount: state.pendingCount, errorCode: state.errorCode || "", lastSuccessfulWriteAt: state.lastSuccessfulWriteAt }; },
    });
  })().catch(() => null);
  return clientPromise;
}

export async function toggleJournal(enabled, preferredName = "") {
  if (enabled) {
    if (!sync.getToken()) return { ok: false, reason: "token" };
    try {
      if (!sync.getContextId()) await sync.ensureContext(preferredName);
      if (preferredName) sync.setContextLabel(preferredName);
    } catch { return { ok: false, reason: "context" }; }
  }
  writeItem(ENABLED_KEY, enabled ? "1" : "0");
  clientPromise = null;
  lastState = { ...lastState, status: enabled ? "ready" : "disabled", errorCode: "" };
  await reportStatus({ enabledAt: enabled ? localIso() : undefined });
  return { ok: true };
}

export async function reportStatus(extra = {}) {
  const client = await getClient();
  if (!client) return false;
  try { await client.reportStatus({ journalEnabled: isJournalEnabled(), ...extra }); return true; }
  catch (error) { lastState = { ...lastState, status: "error", errorCode: safeCode(error, "STATUS_FAILED") }; return false; }
}

export async function recordActivity(map, action, { at = new Date(), importedHistory = false } = {}) {
  if (!map?.id) return false;
  const date = localDate(at);
  const key = `${date}:${map.id}`;
  const saved = activityMap();
  const record = mergeMapActivity(saved[key], map, action, at, { importedHistory });
  saved[key] = record;
  saveActivityMap(saved);
  if (!isJournalEnabled()) return false;
  const client = await getClient();
  if (!client) { lastState = { ...lastState, status: "error", errorCode: "MODULE_UNAVAILABLE" }; return false; }
  try { await client.enqueue(record, { date }); return true; }
  catch (error) { lastState = { ...lastState, status: "error", errorCode: safeCode(error, "QUEUE_FAILED") }; return false; }
}

export async function backfillJournal(records, { from, to }) {
  const client = await getClient();
  if (!client) return { written: 0, error: new Error("Journal unavailable") };
  const projected = [];
  for (const record of records) {
    const map = record?.map;
    if (!map?.id) continue;
    const created = localDate(map.createdAt);
    const updated = localDate(map.updatedAt);
    if (created >= from && created <= to) projected.push(mergeMapActivity(null, map, "created", map.createdAt, { importedHistory: true }));
    if (updated !== created && updated >= from && updated <= to) projected.push(mergeMapActivity(null, map, "edited", map.updatedAt, { importedHistory: true }));
  }
  const dates = new Set(projected.map(record => localDate(record.at)));
  await reportStatus({ backfill: { status: "running", from, to, processedDates: 0, totalDates: dates.size, updatedAt: localIso() } });
  for (const record of projected) await client.enqueue(record, { date: localDate(record.at) });
  for (const record of sessionLedger.read().filter((row) => row.at.slice(0, 10) >= from && row.at.slice(0, 10) <= to)) await client.enqueue(record, { date: record.at.slice(0, 10) });
  const result = await client.flush();
  await reportStatus({ backfill: { status: result.error ? "partial" : "complete", from, to, processedDates: result.error ? 0 : dates.size, totalDates: dates.size, updatedAt: localIso() } });
  return { ...result, records: projected.length, dates: dates.size };
}

export async function refreshJournalState() {
  const client = await getClient();
  if (client) { try { lastState.pendingCount = await client.pendingCount(); } catch { /* status only */ } }
  return getJournalState();
}
