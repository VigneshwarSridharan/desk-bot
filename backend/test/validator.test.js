import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateDisplayHtml } from "../src/agent/validator.js";

const SETTINGS = { screenWidth: 412, screenHeight: 892 };

function weatherPage({ style = "" } = {}) {
  return `<!DOCTYPE html>
<html>
<head>
<style>
  body { margin:0; padding:0; overflow:hidden; width:100vw; height:100vh; background:#0a0a0a; }
  .temp { font-size: 64px; color: #fff; }
  ${style}
</style>
</head>
<body>
  <div class="temp">28°C</div>
  <div>Chennai — Partly cloudy</div>
</body>
</html>`;
}

describe("validateDisplayHtml — accept", () => {
  test("a valid weather page passes", () => {
    const result = validateDisplayHtml(weatherPage(), SETTINGS);
    assert.equal(result.valid, true);
    assert.deepEqual(result.reasons, []);
  });

  test("passes with explicit screen width/height instead of viewport units", () => {
    const html = `<!DOCTYPE html>
<html><head><style>
  body { margin:0; padding:0; width:412px; height:892px; background:#0a0a0a; }
</style></head>
<body><div>28°C</div></body></html>`;
    const result = validateDisplayHtml(html, SETTINGS);
    assert.equal(result.valid, true);
  });

  test("allows Chart.js from the CDN allowlist with a Chart( init call", () => {
    const html = `<!DOCTYPE html>
<html><head><style>body{width:100vw;height:100vh;margin:0}</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <canvas id="c"></canvas>
  <script>new Chart(document.getElementById('c'), { type: 'line', data: {} });</script>
</body></html>`;
    const result = validateDisplayHtml(html, SETTINGS);
    assert.equal(result.valid, true);
  });
});

describe("validateDisplayHtml — reject", () => {
  test("a fixture with an inline onclick is rejected", () => {
    const html = weatherPage().replace(
      "<div class=\"temp\">28°C</div>",
      "<div class=\"temp\" onclick=\"doThing()\">28°C</div>"
    );
    const result = validateDisplayHtml(html, SETTINGS);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes("inline event handler")));
  });

  test("rejects a <form> element", () => {
    const html = weatherPage().replace("<body>", "<body><form></form>");
    const result = validateDisplayHtml(html, SETTINGS);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes("<form>")));
  });

  test("rejects an external script outside the Chart.js allowlist", () => {
    const html = weatherPage().replace(
      "</head>",
      '<script src="https://evil.example.com/tracker.js"></script></head>'
    );
    const result = validateDisplayHtml(html, SETTINGS);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes("disallowed external <script>")));
  });

  test("rejects an external <link> reference", () => {
    const html = weatherPage().replace(
      "</head>",
      '<link rel="stylesheet" href="https://example.com/styles.css"></head>'
    );
    const result = validateDisplayHtml(html, SETTINGS);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes("disallowed external <link>")));
  });

  test("rejects an inline script that doesn't initialize a chart", () => {
    const html = weatherPage().replace(
      "</body>",
      "<script>console.log('hi')</script></body>"
    );
    const result = validateDisplayHtml(html, SETTINGS);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes("Chart(")));
  });

  test("rejects dimensions that don't match settings", () => {
    const html = `<!DOCTYPE html><html><head><style>body{width:200px;height:200px}</style></head><body>hi</body></html>`;
    const result = validateDisplayHtml(html, SETTINGS);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.some((r) => r.includes("dimensions")));
  });

  test("rejects empty HTML", () => {
    const result = validateDisplayHtml("", SETTINGS);
    assert.equal(result.valid, false);
  });

  test("rejects non-string input", () => {
    const result = validateDisplayHtml(null, SETTINGS);
    assert.equal(result.valid, false);
  });
});
