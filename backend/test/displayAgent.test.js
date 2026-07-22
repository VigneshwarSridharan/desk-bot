import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const SETTINGS = { screenWidth: 412, screenHeight: 892 };
const VALID_HTML = `<!DOCTYPE html><html><head><style>body{width:100vw;height:100vh;margin:0}</style></head><body><div>ambient</div></body></html>`;
const BROKEN_HTML = `<!DOCTYPE html><html><head><style>body{width:100vw;height:100vh;margin:0}</style></head><body><form></form></body></html>`;

const dbState = {
  html: "previous-cached-html",
  contentType: "ambient",
  decision: "previous decision",
  generating: 0,
};
const saveDisplayCalls = [];
const setGeneratingCalls = [];
const addToHistoryCalls = [];

mock.module("../src/store/db.js", {
  namedExports: {
    getAllSettings: () => SETTINGS,
    setGenerating: (flag) => {
      setGeneratingCalls.push(flag);
      dbState.generating = flag ? 1 : 0;
    },
    saveDisplay: ({ html, contentType, decision }) => {
      saveDisplayCalls.push({ html, contentType, decision });
      dbState.html = html;
      dbState.contentType = contentType;
      dbState.decision = decision;
    },
    addToHistory: (type, summary, layoutFingerprint) =>
      addToHistoryCalls.push({ type, summary, layoutFingerprint }),
    getHistory: () => [],
  },
});

mock.module("../src/agent/modelProvider.js", {
  namedExports: { getModelForRole: () => "fake-model" },
});

let renderAgentImpl = async () => ({ html: VALID_HTML, usage: undefined });
mock.module("../src/agent/contextAgent.js", {
  namedExports: {
    runContextAgent: async () => ({
      contentType: "ambient",
      decision: "showing ambient content",
      contextData: {},
    }),
  },
});
mock.module("../src/agent/renderAgent.js", {
  namedExports: {
    runRenderAgent: (...args) => renderAgentImpl(...args),
  },
});

const { runDisplayAgent } = await import("../src/agent/displayAgent.js");

beforeEach(() => {
  saveDisplayCalls.length = 0;
  setGeneratingCalls.length = 0;
  addToHistoryCalls.length = 0;
  dbState.html = "previous-cached-html";
  dbState.contentType = "ambient";
  dbState.decision = "previous decision";
});

describe("runDisplayAgent — validator hook", () => {
  test("valid render on first try is saved", async () => {
    renderAgentImpl = async () => ({ html: VALID_HTML, usage: undefined });
    await runDisplayAgent();
    assert.equal(saveDisplayCalls.length, 1);
    assert.equal(saveDisplayCalls[0].html, VALID_HTML);
    assert.equal(addToHistoryCalls.length, 1);
    assert.ok(addToHistoryCalls[0].layoutFingerprint);
  });

  test("invalid render succeeds on the retry with failure reasons appended", async () => {
    let calls = 0;
    renderAgentImpl = async (_model, _ctx, _settings, options) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(options.retryContext, undefined);
        return { html: BROKEN_HTML, usage: undefined };
      }
      assert.ok(options.retryContext?.reasons?.length > 0);
      return { html: VALID_HTML, usage: undefined };
    };
    await runDisplayAgent();
    assert.equal(calls, 2);
    assert.equal(saveDisplayCalls.length, 1);
    assert.equal(saveDisplayCalls[0].html, VALID_HTML);
  });

  test("broken HTML twice keeps the previous display and doesn't crash", async () => {
    renderAgentImpl = async () => ({ html: BROKEN_HTML, usage: undefined });
    await assert.doesNotReject(() => runDisplayAgent());
    assert.equal(saveDisplayCalls.length, 0);
    assert.equal(dbState.html, "previous-cached-html");
    assert.equal(addToHistoryCalls.length, 0);
    assert.equal(setGeneratingCalls.at(-1), false);
  });
});
