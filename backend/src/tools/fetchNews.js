import { tool } from 'ai';
import { z } from 'zod';
import axios from 'axios';
import { getAllSettings } from '../store/db.js';

async function doFetchNews(topics) {
  const settings = getAllSettings();
  const apiKey = process.env.NEWS_API_KEY || settings.newsApiKey;
  if (!apiKey) return { articles: [], error: 'No NewsAPI key configured' };

  const query = topics.join(' OR ');
  try {
    const { data } = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: query,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 10,
        apiKey,
      },
      timeout: 10000,
    });
    const articles = (data.articles || [])
      .filter((a) => a.title && a.title !== '[Removed]')
      .map((a) => ({
        title: a.title,
        description: a.description || '',
        url: a.url,
        publishedAt: a.publishedAt,
        source: a.source?.name || '',
      }));
    return { articles };
  } catch (err) {
    return { articles: [], error: err.message };
  }
}

export const fetchNewsTool = tool({
  description: 'Fetch recent news articles for given topics. Use topics like stock symbols, company names, or themes (e.g. "RELIANCE NSE", "AI artificial intelligence", "India economy").',
  parameters: z.object({
    topics: z.array(z.string()).min(1).max(5).describe('List of search topics or keywords'),
  }),
  execute: async ({ topics }) => doFetchNews(topics),
});
