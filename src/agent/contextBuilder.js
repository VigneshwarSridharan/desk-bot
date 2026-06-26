import { getSettings } from '../store/settings'
import { getPortfolio } from '../store/portfolio'
import { getReminders } from '../store/reminders'
import { getUpcomingEvents } from '../store/events'
import { getLastN } from '../store/history'
import { getActiveTasks } from '../store/tasks'

const DAY_MAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function formatTime(date) {
  let hours = date.getHours()
  const minutes = date.getMinutes()
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12 || 12
  return `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`
}

export function formatDate(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

export function isReminderDueToday(reminder) {
  const todayKey = DAY_MAP[new Date().getDay()]
  return reminder.days === 'daily' || (Array.isArray(reminder.days) && reminder.days.includes(todayKey))
}

export function buildContext() {
  const now = new Date()
  const settings = getSettings()
  const portfolio = getPortfolio()
  const allReminders = getReminders()
  const upcoming = getUpcomingEvents(7)
  const history = getLastN(3)

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const windowEnd = nowMinutes + 180

  const allToday = allReminders.filter((r) => r.active && isReminderDueToday(r))

  const urgentNext3Hours = allToday.filter((r) => {
    const [h, m] = r.time.split(':').map(Number)
    const reminderMinutes = h * 60 + m
    return reminderMinutes >= nowMinutes && reminderMinutes <= windowEnd
  })

  const todayStr = now.toISOString().split('T')[0]
  const todayCount = upcoming.filter((e) => e.date === todayStr).length

  return {
    currentTime: formatTime(now),
    currentDate: formatDate(now),
    dayOfWeek: DAY_NAMES[now.getDay()],
    timestamp: Date.now(),
    screen: {
      width: settings.screenWidth || window.innerWidth,
      height: settings.screenHeight || window.innerHeight,
    },
    portfolio: {
      holdings: portfolio.holdings,
      watchlist: portfolio.watchlist,
    },
    reminders: {
      urgentNext3Hours,
      allToday,
    },
    events: {
      upcoming,
      todayCount,
    },
    tasks: getActiveTasks().sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 }
      return (priority[a.priority] ?? 1) - (priority[b.priority] ?? 1)
    }),
    recentHistory: history.map((h) => ({ type: h.type, summary: h.summary })),
  }
}
