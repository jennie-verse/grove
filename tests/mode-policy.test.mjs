import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAP_MUTATION_ACTIONS, canMutateMapState, canPersistViewState } from "../src/mode-policy.js";

const editable = { map: { id: "map-1" }, view: { read: false }, previewOnly: false };
assert.equal(canMutateMapState(editable), true);
assert.equal(canMutateMapState({ ...editable, view: { read: true } }), false, "Read Mode must reject canonical mutation");
assert.equal(canMutateMapState({ ...editable, previewOnly: true }), false, "Preview only must reject canonical mutation");
assert.equal(canPersistViewState(editable), true);
assert.equal(canPersistViewState({ ...editable, previewOnly: true }), false, "Preview only must not persist a device view");

for (const action of ["rename-map", "add-child", "delete-node", "move-confirm", "undo", "redo", "tidy", "edit-selected"]) {
  assert.ok(MAP_MUTATION_ACTIONS.includes(action), `${action} must be centrally guarded`);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "src/app.js"), "utf8");
const previewBody = app.slice(app.indexOf("async function startPreviewOnly"), app.indexOf("async function importMapChoice"));
assert.doesNotMatch(previewBody, /putRecord|putMany|replaceAll|queueEvent|schedulePush|putView/, "Preview only entry must not write or sync");
const importBody = app.slice(app.indexOf("async function importPreviewMap"), app.indexOf("async function resolveMapImport"));
assert.equal((importBody.match(/putRecord\(/g) || []).length, 1, "new Preview → Import must write exactly once");
assert.match(app, /if \(state\.previewOnly\) \{[\s\S]*state\.map = null;/, "Library return must discard the temporary map");
assert.match(app, /if \(!canMutateMap\(\)\) \{ event\.target\.value/, "Branch spacing handler needs a function guard");
assert.match(app, /function startNodeDrag[\s\S]*?if \(!canMutateMap\(\)/, "node drag must be blocked by the central policy");
assert.match(app, /function handlePointerMove[\s\S]*?state\.map = clone\(drag\.before\)/, "an in-flight drag must roll back after a mode transition");
assert.match(app, /if \(commit && canMutateMap\(\)\)/, "a delayed text-edit commit must recheck the central policy");
assert.match(app, /function toggleReadMode\(\) \{[\s\S]*?pendingInlineEdit\?\.commit\(\);[\s\S]*?state\.view\.read = !state\.view\.read;/, "Read Mode must settle an inline editor before changing modes");
for (const functionName of ["bindInspector", "editNode", "addSibling", "duplicateSelectedNode", "requestDeleteNode", "beginCrossLink", "tidyBranch", "undo", "redo", "toggleSizeMode"]) {
  const start = app.indexOf(`function ${functionName}`);
  const end = app.indexOf("\nfunction ", start + 10);
  assert.ok(start >= 0 && app.slice(start, end < 0 ? undefined : end).includes("canMutateMap()"), `${functionName} must recheck the central mutation policy`);
}

console.log("Grove Read/Preview policy tests passed.");
