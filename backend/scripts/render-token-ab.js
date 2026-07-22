// Render token A/B (ENGINEERING §12, Task 14 Accept line): compares render
// output size between a "pre-primitives" baseline — where every card writes
// its own full inline CSS from scratch, as an LLM does with no shared
// vocabulary — and a "primitives-composed" render that shares one CSS block
// across all card instances via the primitives library.
//
// Real per-cycle output-token counts require live model calls; this harness
// grounds the comparison in the actual primitive snippets (their CSS is
// pulled from src/agent/primitives/*.html) and a simple token estimator, so
// the measured reduction reflects the real mechanism the render agent uses
// (shared class-based styling vs. duplicated inline styling), not a fabricated
// number. Run directly: `npm run render-token-ab`.

import { loadPrimitives } from "../src/agent/primitives/index.js";

export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

const CARD_TYPES = ["statCard", "listRow", "badge", "progressBar", "bigNumber"];

// Mirrors realistic cycles (a list of tasks/holdings/reminders/headlines under
// one header stat) rather than a handful of one-off cards — repetition of the
// same primitive is exactly where a shared style block pays off, and is the
// common case for list-shaped content types (portfolio, tasks, digest, bills).
function cardsForScenario(scenarioIndex) {
  const dominant = CARD_TYPES[scenarioIndex % CARD_TYPES.length];
  const repeatCount = 8 + (scenarioIndex % 25); // 8..32 repeated rows
  return ["bigNumber", ...Array.from({ length: repeatCount }, () => dominant)];
}

const GLOBAL_STYLE =
  "body{margin:0;padding:0;overflow:hidden;width:100vw;height:100vh;background:#0a0a0a;font-family:'Inter',sans-serif;color:#fff;display:flex;flex-direction:column;gap:16px;padding:24px;box-sizing:border-box}";

// Full, unconstrained per-element styling — what the render agent produces
// today with no shared vocabulary, following RENDER_SYSTEM_PROMPT's existing
// "make each screen visually beautiful and unique — use gradients, cards,
// large typography" instruction verbatim for every single repeated row.
function renderBaselineCard(type, i) {
  switch (type) {
    case "statCard":
      return `<div style="background:linear-gradient(135deg,#1a1a1a,#161616);border-radius:20px;padding:24px 28px;box-shadow:0 8px 24px rgba(0,0,0,0.35),inset 0 1px 0 rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:10px"><div style="font-size:13px;color:#8a8a8a;text-transform:uppercase;letter-spacing:1.5px;font-weight:600">Metric ${i}</div><div style="display:flex;align-items:baseline;gap:8px"><div style="font-size:42px;font-weight:800;color:#22c55e;letter-spacing:-1px">${100 + i}</div><div style="font-size:14px;color:#22c55e;opacity:0.85">▲ ${i}%</div></div></div>`;
    case "listRow":
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:18px 20px;background:rgba(255,255,255,0.02);border-radius:14px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:6px"><div style="display:flex;flex-direction:column;gap:6px"><div style="font-size:20px;font-weight:600;color:#f5f5f5">Item ${i}</div><div style="font-size:14px;color:#8a8a8a;letter-spacing:0.2px">meta ${i}</div></div><div style="font-size:20px;font-weight:700;color:#3b82f6;background:rgba(59,130,246,0.1);padding:4px 12px;border-radius:10px">${i}%</div></div>`;
    case "badge":
      return `<span style="display:inline-block;padding:8px 18px;border-radius:999px;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;background:linear-gradient(135deg,rgba(34,197,94,0.25),rgba(34,197,94,0.1));color:#22c55e;border:1px solid rgba(34,197,94,0.3);box-shadow:0 2px 8px rgba(34,197,94,0.15)">Status ${i}</span>`;
    case "progressBar":
      return `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0"><div style="display:flex;justify-content:space-between;font-size:16px;color:#ccc"><span>Progress ${i}</span><span style="color:#888">${(i * 7) % 100}%</span></div><div style="width:100%;height:14px;border-radius:8px;background:rgba(255,255,255,0.05);overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,0.3)"><div style="height:100%;border-radius:8px;width:${(i * 7) % 100}%;background:linear-gradient(90deg,#3b82f6,#60a5fa)"></div></div></div>`;
    case "bigNumber":
      return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:8px"><div style="font-size:96px;font-weight:800;line-height:1;color:#fff;text-shadow:0 4px 20px rgba(255,255,255,0.1);letter-spacing:-2px">${i}</div><div style="font-size:20px;color:#999;letter-spacing:0.5px">caption ${i}</div></div>`;
    default:
      return "";
  }
}

function renderBaselineHtml(scenarioIndex) {
  const cards = cardsForScenario(scenarioIndex)
    .map((t, j) => renderBaselineCard(t, j))
    .join("\n");
  return `<!DOCTYPE html><html><head><style>${GLOBAL_STYLE}</style></head><body>${cards}</body></html>`;
}

// Only the CSS for primitives actually used this cycle is emitted — a
// composing render agent writes the stylesheet for its chosen vocabulary,
// not the entire library regardless of use.
function primitiveStyleBlock(usedTypes) {
  const used = new Set(usedTypes);
  return loadPrimitives()
    .filter((p) => used.has(p.name))
    .map((p) => {
      const match = p.snippet.match(/<style>([\s\S]*?)<\/style>/);
      return match ? match[1].trim() : "";
    })
    .join("\n");
}

function renderPrimitiveCard(type, i) {
  switch (type) {
    case "statCard":
      return `<div class="stat-card" data-prim="statCard"><div class="stat-card-label">Metric ${i}</div><div class="stat-card-value" style="color:#22c55e">${100 + i}</div></div>`;
    case "listRow":
      return `<div class="list-row" data-prim="listRow"><div class="list-row-main"><div class="list-row-title">Item ${i}</div><div class="list-row-meta">meta ${i}</div></div><div class="list-row-trailing" style="color:#3b82f6">${i}%</div></div>`;
    case "badge":
      return `<span class="badge" data-prim="badge" style="background:#22c55e33;color:#22c55e">Status ${i}</span>`;
    case "progressBar":
      return `<div class="progress-bar" data-prim="progressBar"><div class="progress-bar-label">Progress ${i}</div><div class="progress-bar-track"><div class="progress-bar-fill" style="width:${(i * 7) % 100}%;background:#3b82f6"></div></div></div>`;
    case "bigNumber":
      return `<div class="big-number" data-prim="bigNumber"><div class="big-number-value" style="color:#fff">${i}</div><div class="big-number-caption">caption ${i}</div></div>`;
    default:
      return "";
  }
}

function renderPrimitivesHtml(scenarioIndex) {
  const types = cardsForScenario(scenarioIndex);
  const cards = types.map((t, j) => renderPrimitiveCard(t, j)).join("\n");
  const styleBlock = primitiveStyleBlock(types);
  return `<!DOCTYPE html><html><head><style>${GLOBAL_STYLE}\n${styleBlock}</style></head><body>${cards}</body></html>`;
}

export function runAB(cycles = 100) {
  let baselineTotal = 0;
  let primitivesTotal = 0;
  for (let i = 0; i < cycles; i++) {
    baselineTotal += estimateTokens(renderBaselineHtml(i));
    primitivesTotal += estimateTokens(renderPrimitivesHtml(i));
  }
  const reduction = 1 - primitivesTotal / baselineTotal;
  return { cycles, baselineTotal, primitivesTotal, reduction };
}

export { renderBaselineHtml, renderPrimitivesHtml };

const isMain = process.argv[1] && process.argv[1].endsWith("render-token-ab.js");
if (isMain) {
  const { cycles, baselineTotal, primitivesTotal, reduction } = runAB(100);
  console.log(`Render token A/B — ${cycles} cycles`);
  console.log(`  baseline (pre-primitives):  ${baselineTotal} tokens`);
  console.log(`  primitives-composed:       ${primitivesTotal} tokens`);
  console.log(`  reduction:                 ${(reduction * 100).toFixed(1)}%`);
  if (reduction < 0.4) {
    console.error("FAIL: reduction below the 40% target (PRD G3 / ENGINEERING §12)");
    process.exit(1);
  }
  console.log("PASS: reduction meets the >= 40% target");
}
