import { tool } from 'ai';
import { z } from 'zod';
import { getTasks } from '../store/db.js';

export const getTasksTool = tool({
  description: "Get the user's pending tasks, sorted by priority. Includes overdue flags.",
  parameters: z.object({}),
  execute: async () => {
    const tasks = getTasks();
    const today = new Date().toISOString().slice(0, 10);
    const active = tasks.filter((t) => !t.done).map((t) => ({
      ...t,
      isOverdue: t.due && t.due < today,
      isDueToday: t.due === today,
    }));

    return {
      high: active.filter((t) => t.priority === 'high'),
      medium: active.filter((t) => t.priority === 'medium'),
      low: active.filter((t) => t.priority === 'low'),
      overdue: active.filter((t) => t.isOverdue),
      dueToday: active.filter((t) => t.isDueToday),
      totalActive: active.length,
    };
  },
});
