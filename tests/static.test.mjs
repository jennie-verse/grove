import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

assert.ok(existsSync(join(root, ".nojekyll")), ".nojekyll is required");

const manifest = JSON.parse(read("manifest.webmanifest"));
assert.equal(manifest.id, "./");
assert.equal(manifest.start_url, "./");
assert.equal(manifest.scope, "./");
for (const icon of manifest.icons) {
  assert.ok(icon.src.startsWith("./"), `manifest path must be relative: ${icon.src}`);
  assert.ok(existsSync(join(root, icon.src.slice(2))), `missing manifest icon: ${icon.src}`);
}

const index = read("index.html");
for (const [, attribute, path] of index.matchAll(/\b(href|src)="([^"]+)"/g)) {
  assert.ok(!path.startsWith("/") && !/^https?:/i.test(path), `${attribute} must be relative: ${path}`);
  const clean = path.replace(/^\.\//, "").split(/[?#]/)[0];
  assert.ok(existsSync(join(root, clean)), `missing index asset: ${path}`);
}

const app = read("src/app.js");
const css = read("assets/app.css");
for (const path of ["src/sync.js", "src/journal.js"]) {
  const portable = read(path);
  assert.match(portable, /globalThis\.location\?\.hostname/);
  assert.match(portable, /HOSTNAME\.endsWith\(["']\.github\.io["']\)/);
  assert.doesNotMatch(portable, /owner:\s*["']jennie-verse["']/);
}
// Import/Backup/Settings moved into the "..." library menu (2026-09-03) to
// de-clutter the header; they keep a stable accessible name via visible
// text instead of aria-label now. "Create a new map" stayed a standalone
// header button (primary action), so it still needs the aria-label check.
for (const label of ["Import a map", "Back up all maps"]) {
  assert.match(app, new RegExp(`<span>${label}</span>`), `library menu item needs a stable name: ${label}`);
}
assert.match(app, /aria-label="Create a new map"/, "mobile library control needs a stable name: Create a new map");
assert.match(app, /data-action="edit-selected" title="Edit text"/, "selected nodes need a visible edit action");
assert.match(app, /data-action="node-more" title="More node actions"/, "selected nodes need a visible More action");
assert.match(app, /data-action="zoom-out"[\s\S]*data-action="zoom-in"/, "canvas needs step zoom controls");
assert.match(app, /if \(!event\.ctrlKey && !event\.metaKey\)/, "plain wheel input must pan instead of zoom");
assert.match(app, /Note \(Markdown\)/, "the Note tab must explain Markdown support");
assert.match(css, /\.editor\.has-inspector \{ grid-template-columns: minmax\(0, 1fr\); \}/, "inspector must not resize the canvas");
const pointerSelection = app.slice(app.indexOf("function startNodeDrag"), app.indexOf("function handlePointerMove"));
const clickSelection = app.slice(app.indexOf("function selectNode"), app.indexOf("function centerNode"));
assert.doesNotMatch(pointerSelection, /inspectorOpen\s*=\s*true/, "pointerdown must not open the inspector");
assert.doesNotMatch(clickSelection, /inspectorOpen\s*=\s*true/, "node selection must not open the inspector");

const sw = read("sw.js");
// The cache name is assembled from VERSION so one edit keeps sw.js and
// src/version.js in step. Checking for a literal "grove-v13" would fail on a
// correct file, which is exactly the false alarm this project hit on 2026-08-10.
assert.match(sw, /const VERSION = "[\w.-]+";/, "sw.js needs a VERSION stamp");
assert.match(sw, /const CACHE_NAME = `grove-\$\{VERSION\}`;/, "the cache name must carry the version");
const swVersion = /const VERSION = "([\w.-]+)";/.exec(sw)[1];
const appBuild = /APP_BUILD = "([\w.-]+)"/.exec(read("src/version.js"))[1];
assert.equal(swVersion, appBuild, "sw.js VERSION and src/version.js APP_BUILD must match");
// Without this line every GitHub API read is answered from the cache and fails,
// while writes still go through — an upload then overwrites the remote list.
assert.match(sw, /origin !== self\.location\.origin\) return;/, "sw.js must not intercept cross-origin requests");
const shellPaths = [...sw.matchAll(/"(\.\/[^"]+)"/g)].map((match) => match[1]);
for (const path of shellPaths) {
  if (path === "./") continue;
  assert.ok(existsSync(join(root, path.slice(2))), `missing app-shell asset: ${path}`);
}

for (const [path, width, height] of [
  ["icons/apple-touch-icon.png", 180, 180],
  ["icons/icon-192.png", 192, 192],
  ["icons/icon-512.png", 512, 512],
]) {
  const png = readFileSync(join(root, path));
  assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a", `${path} is not PNG`);
  assert.equal(png.readUInt32BE(16), width, `${path} width`);
  assert.equal(png.readUInt32BE(20), height, `${path} height`);
}

assert.ok(statSync(join(root, "assets/fonts/lexend-400.woff2")).size > 1_000, "local font is missing");
assert.equal(readdirSync(root).some((name) => /^grove-(map|backup|recovery)-.*\.json$/i.test(name)), false, "user map data must not be committed");

const workflow = read(".github/workflows/test-and-deploy.yml");
for (const action of [
  "actions/checkout@v6",
  "actions/setup-node@v6",
  "actions/configure-pages@v6",
  "actions/upload-pages-artifact@v5",
  "actions/deploy-pages@v5",
]) {
  assert.ok(workflow.includes(action), `deployment workflow must use ${action}`);
}
assert.match(workflow, /npm test[\s\S]*npm run test:syntax[\s\S]*Stage allowlisted Pages artifact/,
  "tests and syntax checks must finish before the Pages artifact is staged");

console.log(`Grove static tests passed (${shellPaths.length} app-shell entries).`);
