// Render-output sanity gate — no LLM, pure checks against the HTML a render
// cycle produced. Runs before a display is ever persisted to display_cache.

import { parse } from "node-html-parser";

const SCRIPT_SRC_ALLOWLIST = ["https://cdn.jsdelivr.net/npm/chart.js"];

export function validateDisplayHtml(html, settings = {}) {
  const reasons = [];

  if (typeof html !== "string" || !html.trim()) {
    return { valid: false, reasons: ["empty or non-string HTML"] };
  }

  let root;
  try {
    root = parse(html);
  } catch (err) {
    return { valid: false, reasons: [`unparseable HTML: ${err.message}`] };
  }

  const bodyTag = root.querySelector("body");
  if (!root.querySelector("html")) reasons.push("missing <html> root element");
  if (!root.querySelector("head")) reasons.push("missing <head>");
  if (!bodyTag) reasons.push("missing <body>");

  if (root.querySelectorAll("form").length > 0) {
    reasons.push("contains a <form> element");
  }

  for (const el of root.querySelectorAll("*")) {
    const inlineHandler = Object.keys(el.attributes || {}).find((name) =>
      /^on/i.test(name)
    );
    if (inlineHandler) {
      reasons.push(`inline event handler found: ${inlineHandler}`);
      break;
    }
  }

  for (const link of root.querySelectorAll("link[href]")) {
    const href = link.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      reasons.push(`disallowed external <link> reference: ${href}`);
    }
  }

  for (const script of root.querySelectorAll("script")) {
    const src = script.getAttribute("src");
    if (src) {
      if (!SCRIPT_SRC_ALLOWLIST.some((allowed) => src.startsWith(allowed))) {
        reasons.push(`disallowed external <script> src: ${src}`);
      }
    } else if (!(script.text || "").includes("Chart(")) {
      reasons.push(
        "inline <script> without src must reference Chart( for chart initialization"
      );
    }
  }

  const styleText = root
    .querySelectorAll("style")
    .map((s) => s.text || "")
    .join("\n");
  const bodyStyleAttr = bodyTag?.getAttribute("style") || "";
  const combinedStyle = `${styleText}\n${bodyStyleAttr}`;

  const hasViewportUnits = /100vw/.test(combinedStyle) && /100vh/.test(combinedStyle);
  const { screenWidth, screenHeight } = settings;
  const hasExplicitDims =
    screenWidth &&
    screenHeight &&
    combinedStyle.includes(String(screenWidth)) &&
    combinedStyle.includes(String(screenHeight));

  if (!hasViewportUnits && !hasExplicitDims) {
    reasons.push(
      "document dimensions don't match settings (expected 100vw/100vh or explicit screen width/height in styles)"
    );
  }

  return { valid: reasons.length === 0, reasons };
}
