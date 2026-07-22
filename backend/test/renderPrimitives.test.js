import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  loadPrimitives,
  buildPrimitivesPromptBlock,
  extractUsedPrimitiveNames,
  computeGridSignature,
  computeLayoutFingerprint,
} from "../src/agent/primitives/index.js";
import { validateDisplayHtml } from "../src/agent/validator.js";
import { runAB, renderPrimitivesHtml } from "../scripts/render-token-ab.js";

const SETTINGS = { screenWidth: 412, screenHeight: 892 };
const EXPECTED_PRIMITIVES = [
  "statCard",
  "listRow",
  "timeline",
  "chartMacro",
  "progressBar",
  "badge",
  "bigNumber",
  "weatherStrip",
];

describe("primitives library", () => {
  test("loads all shipped primitives with a name and snippet", () => {
    const primitives = loadPrimitives();
    assert.equal(primitives.length, EXPECTED_PRIMITIVES.length);
    for (const name of EXPECTED_PRIMITIVES) {
      const found = primitives.find((p) => p.name === name);
      assert.ok(found, `missing primitive: ${name}`);
      assert.ok(found.snippet.includes(`data-prim="${name}"`));
    }
  });

  test("prompt block mentions every primitive by name", () => {
    const block = buildPrimitivesPromptBlock();
    for (const name of EXPECTED_PRIMITIVES) {
      assert.ok(block.includes(name), `prompt block missing ${name}`);
    }
  });
});

describe("extractUsedPrimitiveNames / computeGridSignature", () => {
  test("extracts and sorts distinct data-prim names", () => {
    const html = `<div data-prim="listRow"></div><div data-prim="badge"></div><div data-prim="listRow"></div>`;
    assert.deepEqual(extractUsedPrimitiveNames(html), ["badge", "listRow"]);
  });

  test("returns empty array when no primitives are used", () => {
    assert.deepEqual(extractUsedPrimitiveNames("<div>custom</div>"), []);
  });

  test("grid signature reflects grid/flex/div counts", () => {
    const html = `<div style="display:grid"></div><div style="display:flex"></div><div></div>`;
    assert.equal(computeGridSignature(html), "g1f1d3p0");
  });

  test("grid signature differs by primitive instance count even with identical div/grid/flex counts", () => {
    const few = `<span data-prim="badge"></span><span data-prim="badge"></span>`;
    const many = `<span data-prim="badge"></span><span data-prim="badge"></span><span data-prim="badge"></span>`;
    assert.notEqual(computeGridSignature(few), computeGridSignature(many));
  });
});

describe("computeLayoutFingerprint", () => {
  test("is deterministic for identical composition", () => {
    const html = `<div data-prim="statCard" style="display:flex"></div>`;
    assert.equal(computeLayoutFingerprint(html), computeLayoutFingerprint(html));
  });

  test("differs when primitive set differs", () => {
    const a = `<div data-prim="statCard"></div>`;
    const b = `<div data-prim="badge"></div>`;
    assert.notEqual(computeLayoutFingerprint(a), computeLayoutFingerprint(b));
  });

  test("differs when arrangement (grid signature) differs even with the same primitives", () => {
    const a = `<div data-prim="statCard" style="display:flex"></div>`;
    const b = `<div data-prim="statCard" style="display:grid"></div>`;
    assert.notEqual(computeLayoutFingerprint(a), computeLayoutFingerprint(b));
  });
});

describe("10-cycle loop with a stubbed model", () => {
  test("produces 10 distinct fingerprints and every output passes the validator", () => {
    const fingerprints = new Set();
    for (let cycle = 0; cycle < 10; cycle++) {
      const html = renderPrimitivesHtml(cycle);
      const validation = validateDisplayHtml(html, SETTINGS);
      assert.equal(validation.valid, true, `cycle ${cycle} failed validation: ${validation.reasons.join("; ")}`);
      fingerprints.add(computeLayoutFingerprint(html));
    }
    assert.equal(fingerprints.size, 10);
  });
});

describe("render token A/B", () => {
  test("100-cycle A/B shows at least a 40% reduction in render output size", () => {
    const { reduction, baselineTotal, primitivesTotal } = runAB(100);
    assert.ok(baselineTotal > 0 && primitivesTotal > 0);
    assert.ok(
      reduction >= 0.4,
      `expected >= 40% reduction, got ${(reduction * 100).toFixed(1)}%`
    );
  });
});
