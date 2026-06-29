import { tool } from 'ai';
import { z } from 'zod';
import { getPortfolio } from '../store/db.js';

export const getPortfolioTool = tool({
  description: "Get the user's stock portfolio — holdings (with quantity and average price) and watchlist symbols.",
  inputSchema: z.object({}),
  execute: async () => {
    const portfolio = getPortfolio();
    return {
      holdings: portfolio.holdings.map((h) => ({
        symbol: h.symbol,
        name: h.name,
        type: h.type,
        quantity: h.quantity,
        avgPrice: h.avgPrice,
        exchange: h.exchange,
      })),
      watchlist: portfolio.watchlist.map((w) => ({
        symbol: w.symbol,
        name: w.name,
        exchange: w.exchange,
      })),
    };
  },
});
