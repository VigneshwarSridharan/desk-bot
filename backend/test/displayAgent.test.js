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
    addToHistory: (type, summary) => addToHistoryCalls.push({ type, summary }),
    getHistory: () => [],
  },
});

mock.module("../src/agent/modelProvider.js", {
  namedExports: { getModelForRole: () => "fake-model" },
});

let renderAgentImpl = async () => VALID_HTML;
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
    renderAgentImpl = async () => VALID_HTML;
    await runDisplayAgent();
    assert.equal(saveDisplayCalls.length, 1);
    assert.equal(saveDisplayCalls[0].html, VALID_HTML);
  });

  test("invalid render succeeds on the retry with failure reasons appended", async () => {
    let calls = 0;
    renderAgentImpl = async (_model, _ctx, _settings, retryContext) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(retryContext, undefined);
        return BROKEN_HTML;
      }
      assert.ok(retryContext?.reasons?.length > 0);
      return VALID_HTML;
    };
    await runDisplayAgent();
    assert.equal(calls, 2);
    assert.equal(saveDisplayCalls.length, 1);
    assert.equal(saveDisplayCalls[0].html, VALID_HTML);
  });

  test("broken HTML twice keeps the previous display and doesn't crash", async () => {
    renderAgentImpl = async () => BROKEN_HTML;
    await assert.doesNotReject(() => runDisplayAgent());
    assert.equal(saveDisplayCalls.length, 0);
    assert.equal(dbState.html, "previous-cached-html");
    assert.equal(addToHistoryCalls.length, 0);
    assert.equal(setGeneratingCalls.at(-1), false);
  });
});
