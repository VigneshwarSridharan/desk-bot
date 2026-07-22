import { test, describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const RSS_ARTICLES = [
  { title: "RSS headline", description: "", url: "https://example.com/rss", publishedAt: null, source: "example.com" },
];

let rssMock;
let axiosGetMock;
let originalNewsApiKey;

beforeEach(() => {
  originalNewsApiKey = process.env.NEWS_API_KEY;
  rssMock = mock.fn(async () => RSS_ARTICLES);
  axiosGetMock = mock.fn(async () => ({ data: { articles: [] } }));
  mock.module("../src/news/rss.js", {
    namedExports: { fetchRssArticles: rssMock },
  });
  mock.module("axios", { defaultExport: { get: axiosGetMock } });
});

afterEach(() => {
  if (originalNewsApiKey === undefined) delete process.env.NEWS_API_KEY;
  else process.env.NEWS_API_KEY = originalNewsApiKey;
  mock.reset();
});

async function loadTool() {
  const mod = await import(`../src/tools/fetchNews.js?t=${Date.now()}-${Math.random()}`);
  return mod.fetchNewsTool;
}

describe("fetchNewsTool — RSS fallback", () => {
  test("falls back to RSS when NEWS_API_KEY is unset", async () => {
    delete process.env.NEWS_API_KEY;
    const tool = await loadTool();
    const result = await tool.execute({ topics: ["finance"] });

    assert.equal(axiosGetMock.mock.callCount(), 0);
    assert.equal(rssMock.mock.callCount(), 1);
    assert.deepEqual(result.articles, RSS_ARTICLES);
  });

  test("falls back to RSS transparently when NewsAPI errors", async () => {
    process.env.NEWS_API_KEY = "test-key";
    axiosGetMock.mock.mockImplementation(async () => {
      const err = new Error("Request failed with status code 429");
      err.response = { status: 429 };
      throw err;
    });
    const tool = await loadTool();
    const result = await tool.execute({ topics: ["finance"] });

    assert.equal(axiosGetMock.mock.callCount(), 1);
    assert.equal(rssMock.mock.callCount(), 1);
    assert.deepEqual(result.articles, RSS_ARTICLES);
  });

  test("never calls RSS when NewsAPI is healthy", async () => {
    process.env.NEWS_API_KEY = "test-key";
    axiosGetMock.mock.mockImplementation(async () => ({
      data: {
        articles: [
          { title: "Real headline", description: "d", url: "https://newsapi.example/a", publishedAt: "2026-07-22T00:00:00Z", source: { name: "NewsAPI" } },
        ],
      },
    }));
    const tool = await loadTool();
    const result = await tool.execute({ topics: ["finance"] });

    assert.equal(axiosGetMock.mock.callCount(), 1);
    assert.equal(rssMock.mock.callCount(), 0);
    assert.equal(result.articles.length, 1);
    assert.equal(result.articles[0].title, "Real headline");
  });
});
