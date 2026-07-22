import { tool } from 'ai';
import { z } from 'zod';
import { getBillsDueSoon } from '../store/db.js';

export const getBillsTool = tool({
  description:
    "Get bills due soon (within 14 days), overdue, or with an unknown due date — for surfacing payment reminders.",
  inputSchema: z.object({}),
  execute: async () => {
    const bills = getBillsDueSoon(14);
    const today = new Date().toISOString().slice(0, 10);

    const withFlags = bills.map((b) => {
      if (!b.dueDate) return { ...b, isOverdue: false, isDueWithin3Days: false };
      const diffDays = Math.round(
        (new Date(b.dueDate) - new Date(today)) / (24 * 60 * 60 * 1000),
      );
      return {
        ...b,
        isOverdue: diffDays < 0,
        isDueWithin3Days: diffDays >= 0 && diffDays <= 3,
      };
    });

    return {
      dueWithin3Days: withFlags.filter((b) => b.isDueWithin3Days),
      overdue: withFlags.filter((b) => b.isOverdue),
      dueSoon: withFlags.filter((b) => !b.isOverdue && !b.isDueWithin3Days && b.dueDate),
      unknown: withFlags.filter((b) => !b.dueDate),
      total: withFlags.length,
    };
  },
});
