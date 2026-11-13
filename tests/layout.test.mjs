import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("foldable/Mac layout contract: no overscroll bounce, fast taps, canvas keeps its own touch handling, Mac-only hover", () => {
  const css = read("assets/app.css");
  assert.match(css, /overscroll-behavior: none/);
  assert.match(css, /button, input, select, textarea, label, summary, a \{ touch-action: manipulation; \}/);
  assert.match(css, /touch-action: none;/, "canvas/node dragging must keep touch-action: none");
  assert.match(css, /\.node:hover/);
});

test("folded and unfolded-portrait widths (<=720px, incl. 669): zoom controls are lifted above the node toolbar so they do not overlap", () => {
  const css = read("assets/app.css");
  assert.match(css, /@media \(max-width: 720px\) \{\s*\.editor:not\(\.has-inspector\) \.canvas-controls \{ bottom: calc\(/);
});

test("the build stamp in version.js matches VERSION in sw.js and is the foldable build", () => {
  const stamp = read("src/version.js").match(/APP_BUILD = "([^"]+)"/)[1];
  assert.equal(read("sw.js").match(/const VERSION = "([^"]+)"/)[1], stamp);
  assert.equal(stamp, "2026.11.12-foldable2");
});
