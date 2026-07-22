import { test, describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseRssFeed } from "../src/news/rss.js";

const RSS_FIXTURE = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example Finance</title>
  <item>
    <title>Nifty 50 closes higher</title>
    <link>https://example.com/nifty-50</link>
    <description><![CDATA[Markets rallied on <b>strong</b> earnings.]]></description>
    <pubDate>Wed, 22 Jul 2026 09:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Sensex &amp; Nifty update</title>
    <link>https://example.com/sensex</link>
    <description>Plain text summary.</description>
    <pubDate>Wed, 22 Jul 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <link>https://example.com/no-title</link>
    <description>Missing title should be skipped.</description>
  </item>
</channel></rss>`;

const ATOM_FIXTURE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Tech</title>
  <entry>
    <title>New AI model released</title>
    <link href="https://example.com/ai-model" rel="alternate"/>
    <summary>A new model was announced.</summary>
    <updated>2026-07-22T08:00:00Z</updated>
  </entry>
</feed>`;

describe("parseRssFeed", () => {
  test("normalizes RSS 2.0 items to the NewsAPI article shape", () => {
    const articles = parseRssFeed(RSS_FIXTURE, "example.com");
    assert.equal(articles.length, 2);
    assert.deepEqual(Object.keys(articles[0]).sort(), [
      "description", "publishedAt", "source", "title", "url",
    ]);
    assert.equal(articles[0].title, "Nifty 50 closes higher");
    assert.equal(articles[0].url, "https://example.com/nifty-50");
    assert.equal(articles[0].description, "Markets rallied on strong earnings.");
    assert.equal(articles[0].source, "example.com");
    assert.equal(articles[0].publishedAt, new Date("Wed, 22 Jul 2026 09:00:00 GMT").toISOString());
  });

  test("decodes HTML entities in titles", () => {
    const articles = parseRssFeed(RSS_FIXTURE, "example.com");
    assert.equal(articles[1].title, "Sensex & Nifty update");
  });

  test("skips items with no title", () => {
    const articles = parseRssFeed(RSS_FIXTURE, "example.com");
    assert.ok(!articles.some((a) => a.url === "https://example.com/no-title"));
  });

  test("normalizes Atom entries the same way", () => {
    const articles = parseRssFeed(ATOM_FIXTURE, "example.com");
    assert.equal(articles.length, 1);
    assert.equal(articles[0].title, "New AI model released");
    assert.equal(articles[0].url, "https://example.com/ai-model");
    assert.equal(articles[0].description, "A new model was announced.");
  });

  test("returns an empty array for empty or non-string input", () => {
    assert.deepEqual(parseRssFeed("", "x"), []);
    assert.deepEqual(parseRssFeed(null, "x"), []);
  });
});

describe("getFeedUrls", () => {
  let originalFeeds;

  beforeEach(() => {
    originalFeeds = process.env.RSS_FEEDS;
  });

  afterEach(() => {
    if (originalFeeds === undefined) delete process.env.RSS_FEEDS;
    else process.env.RSS_FEEDS = originalFeeds;
  });

  test("falls back to shipped defaults when RSS_FEEDS is unset", async () => {
    delete process.env.RSS_FEEDS;
    const { getFeedUrls } = await import("../src/news/rss.js");
    const feeds = getFeedUrls();
    assert.ok(feeds.length > 0);
  });

  test("honors a comma-separated RSS_FEEDS override", async () => {
    process.env.RSS_FEEDS = "https://a.example.com/feed, https://b.example.com/feed";
    const { getFeedUrls } = await import("../src/news/rss.js");
    assert.deepEqual(getFeedUrls(), [
      "https://a.example.com/feed",
      "https://b.example.com/feed",
    ]);
  });
});

describe("fetchRssArticles", () => {
  beforeEach(() => {
    process.env.RSS_FEEDS = "https://a.example.com/feed,https://b.example.com/feed";
  });

  afterEach(() => {
    delete process.env.RSS_FEEDS;
    mock.reset();
  });

  test("fetches and merges articles across all configured feeds", async (t) => {
    const getMock = t.mock.fn(async (url) => {
      if (url.includes("a.example.com")) return { data: RSS_FIXTURE };
      return { data: ATOM_FIXTURE };
    });
    mock.module("axios", { defaultExport: { get: getMock } });
    const { fetchRssArticles } = await import(`../src/news/rss.js?t=${Date.now()}`);

    const articles = await fetchRssArticles();
    assert.equal(getMock.mock.callCount(), 2);
    assert.equal(articles.length, 3);
  });

  test("filters by topic when a match exists", async () => {
    mock.module("axios", {
      defaultExport: {
        get: async (url) => ({ data: url.includes("a.example.com") ? RSS_FIXTURE : ATOM_FIXTURE }),
      },
    });
    const { fetchRssArticles } = await import(`../src/news/rss.js?t=${Date.now()}`);

    const articles = await fetchRssArticles(["AI model"]);
    assert.equal(articles.length, 1);
    assert.equal(articles[0].title, "New AI model released");
  });

  test("falls back to all articles when no topic matches", async () => {
    mock.module("axios", {
      defaultExport: {
        get: async (url) => ({ data: url.includes("a.example.com") ? RSS_FIXTURE : ATOM_FIXTURE }),
      },
    });
    const { fetchRssArticles } = await import(`../src/news/rss.js?t=${Date.now()}`);

    const articles = await fetchRssArticles(["nonexistent topic zzz"]);
    assert.equal(articles.length, 3);
  });

  test("ignores feeds that fail to fetch", async () => {
    mock.module("axios", {
      defaultExport: {
        get: async (url) => {
          if (url.includes("a.example.com")) throw new Error("network error");
          return { data: ATOM_FIXTURE };
        },
      },
    });
    const { fetchRssArticles } = await import(`../src/news/rss.js?t=${Date.now()}`);

    const articles = await fetchRssArticles();
    assert.equal(articles.length, 1);
  });
});
