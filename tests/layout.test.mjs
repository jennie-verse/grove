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
  assert.equal(stamp, "2026.11.12-foldable3");
});

test("Tier A below 900px (e.g. 669x951): Outline and Settings are shown in the editor header, phone sizes keep them hidden", () => {
  const css = read("assets/app.css");
  assert.match(css, /@media \(min-width: 640px\) and \(min-height: 560px\) and \(max-width: 899px\) \{\s*\.editor-actions \{ max-width: none; flex-wrap: nowrap; \}\s*\.editor-actions \.icon-btn:nth-of-type\(4\),\s*\.editor-actions \.icon-btn:nth-of-type\(5\) \{ display: flex; \}/);
  assert.match(css, /\.editor-actions \.icon-btn:nth-of-type\(4\),\s*\.editor-actions \.icon-btn:nth-of-type\(5\) \{ display: none; \}/, "phone widths still hide them");
});

test("safe-area insets: dialogs, desktop header/panels and the row menu stay clear of the top/bottom insets", () => {
  const css = read("assets/app.css");
  assert.match(css, /\.modal-backdrop \{[^}]*padding: max\(20px, env\(safe-area-inset-top\)\) max\(20px, env\(safe-area-inset-right\)\) max\(20px, env\(safe-area-inset-bottom\)\) max\(20px, env\(safe-area-inset-left\)\);/);
  assert.match(css, /\.dialog \{[^}]*max-height: calc\(var\(--visual-height\) - max\(20px, env\(safe-area-inset-top\)\) - max\(20px, env\(safe-area-inset-bottom\)\)\);/);
  assert.match(css, /grid-template-rows: calc\(74px \+ env\(safe-area-inset-top\)\) minmax\(0, 1fr\);/, "desktop editor header must grow by the top inset");
  assert.match(css, /\.search-backdrop \{ padding-top: max\(12vh, env\(safe-area-inset-top\)\)/);
  assert.match(css, /\.outline-panel \{ max-height: calc\(var\(--visual-height\) - max\(70px, env\(safe-area-inset-top\) \+ 8px\)\)/, "landscape side sheet must not start under the top inset");
  assert.match(read("src/app.js"), /safeAreaInsets\(\)/);
});

test("folded landscape (678x466): the logo is lifted above the title so there is a way back to the library", () => {
  const css = read("assets/app.css");
  assert.match(css, /\.maps-btn \{ display: none; \}[\s\S]*?\.brand\.compact \{ position: relative; z-index: 1; \}/);
});
