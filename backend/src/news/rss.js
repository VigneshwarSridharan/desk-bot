// RSS fallback for news — used transparently by tools/fetchNews.js when
// NewsAPI is rate-limited, errored, or unconfigured. Normalizes RSS 2.0/Atom
// feed items to the exact article shape NewsAPI returns.

import axios from 'axios';

const DEFAULT_FEEDS = [
  'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
  'https://techcrunch.com/feed/',
  'https://www.artificialintelligence-news.com/feed/',
];

export function getFeedUrls() {
  const override = process.env.RSS_FEEDS;
  if (override && override.trim()) {
    return override
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
  }
  return DEFAULT_FEEDS;
}

function sourceNameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function stripCdata(raw) {
  const match = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return match ? match[1] : raw;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'");
}

function cleanText(raw) {
  if (!raw) return '';
  return decodeEntities(stripCdata(raw))
    .replace(/<[^>]+>/g, '')
    .trim();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1] : '';
}

function extractAtomLink(block) {
  const match = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
  return match ? match[1] : '';
}

function toIsoDate(raw) {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Parses RSS 2.0 <item> and Atom <entry> feed XML into normalized articles. */
export function parseRssFeed(xml, sourceName) {
  if (typeof xml !== 'string' || !xml.trim()) return [];

  const articles = [];
  const blockRegex = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockRegex.exec(xml))) {
    const [, tagName, block] = match;
    const title = cleanText(extractTag(block, 'title'));
    if (!title) continue;

    const link = tagName === 'entry'
      ? extractAtomLink(block)
      : cleanText(extractTag(block, 'link'));
    const description = cleanText(
      extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content')
    );
    const publishedAt = toIsoDate(
      cleanText(extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated'))
    );

    articles.push({
      title,
      description,
      url: link,
      publishedAt,
      source: sourceName,
    });
  }
  return articles;
}

function matchesTopics(article, topics) {
  if (!topics || topics.length === 0) return true;
  const haystack = `${article.title} ${article.description}`.toLowerCase();
  return topics.some((topic) => haystack.includes(String(topic).toLowerCase()));
}

/** Fetches all configured RSS feeds and returns normalized, topic-filtered articles. */
export async function fetchRssArticles(topics = []) {
  const feeds = getFeedUrls();
  const results = await Promise.allSettled(
    feeds.map((url) => axios.get(url, { timeout: 10000, responseType: 'text' }))
  );

  const articles = [];
  results.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    const sourceName = sourceNameFromUrl(feeds[i]);
    articles.push(...parseRssFeed(result.value.data, sourceName));
  });

  const filtered = articles.filter((article) => matchesTopics(article, topics));
  return (filtered.length ? filtered : articles).slice(0, 10);
}
