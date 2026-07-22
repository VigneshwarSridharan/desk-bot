import { tool } from 'ai';
import { z } from 'zod';
import { getActiveDigestItems } from '../store/db.js';

export const getDigestTool = tool({
  description:
    "Get unexpired inbox digest headlines (from newsletters) for the ambient 'from your inbox' band.",
  inputSchema: z.object({}),
  execute: async () => {
    const items = getActiveDigestItems();
    return {
      items: items.map((i) => ({
        headline: i.headline,
        sourceSender: i.sourceSender,
        receivedAt: i.receivedAt,
      })),
      count: items.length,
    };
  },
});
