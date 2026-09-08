import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const saveCode = source.slice(source.indexOf('function markDirty()'), source.indexOf('function exportRecoveryCopy()'));
function harness(write) {
  const state = { map: { id: 'map', text: 'first' }, records: [], record: { revision: 0 }, dirty: true, saving: false, saveError: null };
  const context = vm.createContext({
    state, putRecord: write, clone: structuredClone, clearTimeout() {}, setTimeout() {},
    canMutateMap: () => true, $: () => null, broadcast() {}, toast() {}, render() {},
    journal: { recordActivity: async () => {} }, syncRunner: { schedulePush() {} },
  });
  vm.runInContext(`let saveTimer, activeSave = null, editGeneration = 0, pendingInlineEdit = null; ${saveCode}`, context);
  return { state, flush: () => vm.runInContext('flushSave()', context), edit: text => { state.map.text = text; vm.runInContext('markDirty()', context); } };
}

test('edits during a pending write are drained before every save caller resolves', async () => {
  const writes = [];
  const pending = [];
  const h = harness((record, revision) => new Promise(resolve => {
    writes.push({ record, revision });
    pending.push(() => resolve({ ...record, revision: revision + 1 }));
  }));
  const first = h.flush();
  h.edit('latest 한글');
  const backgroundFlush = h.flush();
  pending.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 2);
  assert.equal(writes[0].record.map.text, 'first');
  assert.equal(writes[1].record.map.text, 'latest 한글');
  assert.equal(writes[1].revision, 1);
  assert.equal(h.state.dirty, true);
  pending.shift()();
  assert.deepEqual(await Promise.all([first, backgroundFlush]), [true, true]);
  assert.equal(h.state.dirty, false);
  assert.equal(h.state.record.map.text, 'latest 한글');
});

test('a failed follow-up save keeps the latest changes dirty for retry', async () => {
  let release;
  let fail = false;
  const h = harness((record, revision) => {
    if (fail) return Promise.reject(Object.assign(new Error('full'), { code: 'QUOTA_EXCEEDED' }));
    return new Promise(resolve => { release = () => resolve({ ...record, revision: revision + 1 }); });
  });
  const save = h.flush();
  h.edit('must survive');
  fail = true;
  release();
  assert.equal(await save, false);
  assert.equal(h.state.dirty, true);
  assert.equal(h.state.map.text, 'must survive');
  assert.equal(h.state.saveError.code, 'QUOTA_EXCEEDED');
});

test('startup never clears maps or preferences when an old reset marker is absent', () => {
  assert.doesNotMatch(source, /deleteDatabase|runFreshStartOnce/);
});
