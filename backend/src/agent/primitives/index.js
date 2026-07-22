// UI primitive library (ENGINEERING §5.4): a vocabulary of small, parameterized
// HTML/CSS snippets injected into the render agent's prompt. The agent composes
// any subset, may override styles, and may still write custom HTML — primitives
// are optional building blocks, not a fixed template.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRIMITIVE_FILES = [
  "statCard.html",
  "listRow.html",
  "timeline.html",
  "chartMacro.html",
  "progressBar.html",
  "badge.html",
  "bigNumber.html",
  "weatherStrip.html",
];

function parsePrimitive(filename) {
  const raw = readFileSync(join(__dirname, filename), "utf8").trim();
  const nameMatch = raw.match(/data-prim="([^"]+)"/);
  const purposeMatch = raw.match(/<!--\s*([^:]+):\s*(.+?)\s*-->/);
  return {
    file: filename,
    name: nameMatch ? nameMatch[1] : filename.replace(/\.html$/, ""),
    purpose: purposeMatch ? purposeMatch[2].trim() : "",
    snippet: raw,
  };
}

let cached;

// Loaded once per process — the snippet files are static assets, not per-cycle state.
export function loadPrimitives() {
  if (!cached) cached = PRIMITIVE_FILES.map(parsePrimitive);
  return cached;
}

export function buildPrimitivesPromptBlock() {
  const blocks = loadPrimitives().map(
    (p) => `### ${p.name}\n${p.purpose ? `Purpose: ${p.purpose}\n` : ""}${p.snippet}`
  );
  return `UI PRIMITIVE LIBRARY (vocabulary, not a cage):
You have the following reusable HTML/CSS primitives available. Use any subset, in any arrangement, quantity, and color accent — compose freely and vary the composition every cycle. You may override any style inline and may write entirely custom HTML where no primitive fits. If you use a primitive (verbatim or adapted), keep its data-prim="name" attribute on the element so its use can be detected.

${blocks.join("\n\n")}`;
}

export function extractUsedPrimitiveNames(html) {
  const names = new Set();
  const re = /data-prim="([^"]+)"/g;
  let match;
  while ((match = re.exec(html))) names.add(match[1]);
  return [...names].sort();
}

// A crude structural signature (grid/flex containers, element count, and total
// primitive instance count) so that two cycles using the same primitives in a
// different arrangement or quantity still hash differently — the fingerprint
// captures composition, not just vocabulary. Instance count matters on its own
// because some primitives (e.g. badge) don't contribute <div>s, so repeat
// count alone can otherwise go undetected by the div/grid/flex counts.
export function computeGridSignature(html) {
  const gridCount = (html.match(/display\s*:\s*grid/gi) || []).length;
  const flexCount = (html.match(/display\s*:\s*flex/gi) || []).length;
  const divCount = (html.match(/<div/gi) || []).length;
  const primInstanceCount = (html.match(/data-prim="/g) || []).length;
  return `g${gridCount}f${flexCount}d${divCount}p${primInstanceCount}`;
}

export function computeLayoutFingerprint(html) {
  const names = extractUsedPrimitiveNames(html);
  const gridSignature = computeGridSignature(html);
  const basis = `${names.join(",")}|${gridSignature}`;
  return createHash("sha1").update(basis).digest("hex");
}
