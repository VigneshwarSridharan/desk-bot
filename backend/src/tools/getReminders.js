import { tool } from 'ai';
import { z } from 'zod';
import { getReminders } from '../store/db.js';

function isReminderActiveToday(reminder) {
  if (!reminder.active) return false;
  if (reminder.days === 'daily') return true;
  const days = Array.isArray(reminder.days) ? reminder.days : [];
  const dayAbbrs = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const todayAbbr = dayAbbrs[new Date().getDay()];
  return days.includes(todayAbbr);
}

function minutesFromTimeStr(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export const getRemindersTool = tool({
  description: "Get the user's reminders for today, with urgency flags for reminders due soon.",
  parameters: z.object({}),
  execute: async () => {
    const reminders = getReminders();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const todayReminders = reminders.filter(isReminderActiveToday);

    const categorized = todayReminders.map((r) => {
      const rMin = minutesFromTimeStr(r.time);
      const diffMin = rMin - nowMinutes;
      let urgency = 'later';
      if (diffMin >= -5 && diffMin <= 30) urgency = 'urgent'; // within 30 min or just passed
      else if (diffMin > 30 && diffMin <= 180) urgency = 'soon'; // in 1-3 hours
      return { ...r, minutesFromNow: diffMin, urgency };
    });

    return {
      urgentNext30Min: categorized.filter((r) => r.urgency === 'urgent'),
      soonNext3Hours: categorized.filter((r) => r.urgency === 'soon'),
      allToday: categorized,
    };
  },
});
