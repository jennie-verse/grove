import {
  backupEnvelope,
  clone,
  mapEnvelope,
  nodeById,
  now,
  safeFilename,
} from "./model.js";

const filenameCounts = new Map();

export function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function mapJsonFile(map, prefix = "grove-map") {
  return makeJsonFile(mapEnvelope(map), `${prefix}-${safeFilename(map.title)}-${dateStamp()}.json`);
}

export function backupJsonFile(maps, preferences = null, journalActivity = [], journalSessions = []) {
  return makeJsonFile(
    backupEnvelope(maps, preferences, journalActivity, journalSessions),
    `grove-backup-${dateStamp()}.json`,
  );
}

export function makeJsonFile(data, filename) {
  return {
    blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    filename: uniqueFilename(filename),
  };
}

export function canShareFile(file) {
  if (!navigator.share || !navigator.canShare || typeof File === "undefined") return false;
  try {
    const shareFile = new File([file.blob], file.filename, { type: file.blob.type });
    return navigator.canShare({ files: [shareFile] });
  } catch {
    return false;
  }
}

export async function shareFile(file, title = "Grove export") {
  const shareFile = new File([file.blob], file.filename, { type: file.blob.type });
  if (!navigator.canShare?.({ files: [shareFile] })) throw new Error("File sharing is not supported here.");
  await navigator.share({ files: [shareFile], title });
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function createSvgFile(map, options = {}) {
  const svg = renderMapSvg(map, options);
  return {
    blob: new Blob([svg], { type: "image/svg+xml" }),
    filename: uniqueFilename(`grove-map-${safeFilename(map.title)}-${dateStamp()}.svg`),
  };
}

export async function createPngFile(map, options = {}) {
  await document.fonts?.ready?.catch?.(() => {});
  const svg = renderMapSvg(map, options);
  const bounds = contentBounds(map, options.margin ?? 48);
  const scale = Math.max(2, Math.min(4, Number(options.scale) || 2));
  const image = new Image();
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  image.src = svgUrl;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("PNG rendering failed."));
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(bounds.width * scale));
  canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PNG export is not supported here.");
  context.scale(scale, scale);
  context.drawImage(image, 0, 0, bounds.width, bounds.height);
  URL.revokeObjectURL(svgUrl);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("PNG export failed.")),
    "image/png",
  ));
  return {
    blob,
    filename: uniqueFilename(`grove-map-${safeFilename(map.title)}-${dateStamp()}.png`),
  };
}

export function renderMapSvg(map, { margin = 48, includeBackground = true, background = "#FDF7F8" } = {}) {
  const bounds = contentBounds(map, margin);
  const edges = [];
  for (const node of map.nodes) {
    if (!node.parentId) continue;
    const parent = nodeById(map, node.parentId);
    if (parent) edges.push(edgeSvg(parent, node, node.parentEdgeStyle));
  }
  for (const link of map.crossLinks) {
    const source = nodeById(map, link.sourceId);
    const target = nodeById(map, link.targetId);
    if (source && target) edges.push(edgeSvg(source, target, link.style));
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(bounds.width)}" height="${round(bounds.height)}" viewBox="${round(bounds.minX)} ${round(bounds.minY)} ${round(bounds.width)} ${round(bounds.height)}" role="img" aria-label="${escapeXml(map.title)}">`,
    includeBackground ? `<rect x="${round(bounds.minX)}" y="${round(bounds.minY)}" width="${round(bounds.width)}" height="${round(bounds.height)}" fill="${escapeXml(background)}"/>` : "",
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${edges.join("")}</g>`,
    `<g>${map.nodes.map(nodeSvg).join("")}</g>`,
    "</svg>",
  ].join("");
}

export function contentBounds(map, margin = 48) {
  const nodes = map.nodes.length ? map.nodes : [{ x: 0, y: 0, width: 1, height: 1 }];
  const minX = Math.min(...nodes.map((node) => node.x - node.width / 2)) - margin;
  const maxX = Math.max(...nodes.map((node) => node.x + node.width / 2)) + margin;
  const minY = Math.min(...nodes.map((node) => node.y - node.height / 2)) - margin;
  const maxY = Math.max(...nodes.map((node) => node.y + node.height / 2)) + margin;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function edgeSvg(source, target, style) {
  const direction = target.x >= source.x ? 1 : -1;
  const x1 = source.x + direction * source.width / 2;
  const y1 = source.y;
  const x2 = target.x - direction * target.width / 2;
  const y2 = target.y;
  const path = style.type === "straight"
    ? `M${round(x1)} ${round(y1)}L${round(x2)} ${round(y2)}`
    : `M${round(x1)} ${round(y1)}C${round(x1 + direction * 70)} ${round(y1)} ${round(x2 - direction * 70)} ${round(y2)} ${round(x2)} ${round(y2)}`;
  return `<path d="${path}" stroke="${escapeXml(style.color)}" stroke-width="${round(style.width)}"${style.dash === "dashed" ? ' stroke-dasharray="7 7"' : ""}/>`;
}

function nodeSvg(node) {
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  const style = node.style;
  const shape = nodeShape(node, x, y);
  const lines = wrapText(node.text, node.width, style.fontSize);
  const lineHeight = style.fontSize * 1.24;
  const firstY = node.y - (lines.length - 1) * lineHeight / 2 + style.fontSize * 0.35;
  const anchor = style.align === "left" ? "start" : style.align === "right" ? "end" : "middle";
  const textX = style.align === "left" ? x + 16 : style.align === "right" ? x + node.width - 16 : node.x;
  const text = lines.map((line, index) => `<tspan x="${round(textX)}" y="${round(firstY + index * lineHeight)}">${escapeXml(line)}</tspan>`).join("");
  return `<g>${shape}<text text-anchor="${anchor}" font-family="${escapeXml(fontStack(style.font))}" font-size="${round(style.fontSize)}" font-weight="${round(style.fontWeight)}" fill="${escapeXml(style.text)}">${text}</text></g>`;
}

function nodeShape(node, x, y) {
  const common = `fill="${escapeXml(node.style.fill)}" stroke="${escapeXml(node.style.border)}" stroke-width="1.5"`;
  if (node.style.shape === "ellipse") {
    return `<ellipse cx="${round(node.x)}" cy="${round(node.y)}" rx="${round(node.width / 2)}" ry="${round(node.height / 2)}" ${common}/>`;
  }
  const radius = node.style.shape === "pill" ? node.height / 2 : node.style.shape === "rectangle" ? 3 : 12;
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(node.width)}" height="${round(node.height)}" rx="${round(radius)}" ${common}/>`;
}

function wrapText(text, width, fontSize) {
  const safe = String(text || "Untitled");
  const maxChars = Math.max(5, Math.floor((width - 28) / Math.max(5, fontSize * 0.58)));
  const words = safe.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= maxChars) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.slice(0, 5).map((line, index, all) => (
    index === all.length - 1 && lines.length > 5 ? `${line.slice(0, Math.max(1, maxChars - 1))}…` : line
  ));
}

function fontStack(font) {
  if (font === "System Sans") return "system-ui, -apple-system, sans-serif";
  return `${font}, Verdana, Trebuchet MS, sans-serif`;
}

function uniqueFilename(filename) {
  const normalized = filename.normalize("NFC");
  const count = (filenameCounts.get(normalized) || 0) + 1;
  filenameCounts.set(normalized, count);
  if (count === 1) return normalized;
  const dot = normalized.lastIndexOf(".");
  return dot > 0 ? `${normalized.slice(0, dot)}-${count}${normalized.slice(dot)}` : `${normalized}-${count}`;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character]));
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

export function cloneWithNewMapId(map, title) {
  const copy = clone(map);
  copy.id = globalThis.crypto?.randomUUID?.() || `grove-${Date.now()}-${Math.random()}`;
  copy.title = title;
  copy.createdAt = now();
  copy.updatedAt = copy.createdAt;
  return copy;
}
