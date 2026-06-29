import { tool } from 'ai';
import { z } from 'zod';
import { getUpcomingEvents } from '../store/db.js';

export const getEventsTool = tool({
  description: "Get the user's upcoming calendar events and appointments for the next 7 days.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(30).default(7).describe('Number of days ahead to look'),
  }),
  execute: async ({ days }) => {
    const events = getUpcomingEvents(days);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    return {
      todayEvents: events
        .filter((e) => e.date === today)
        .map((e) => {
          let minutesFromNow = null;
          if (e.time) {
            const [h, m] = e.time.split(':').map(Number);
            minutesFromNow = h * 60 + m - nowMinutes;
          }
          return { ...e, minutesFromNow };
        }),
      upcomingEvents: events.filter((e) => e.date > today),
      totalCount: events.length,
    };
  },
});
