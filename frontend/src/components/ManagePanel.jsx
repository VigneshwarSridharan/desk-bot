import { useState, useEffect, useCallback, memo } from 'react'
import {
  getPortfolio, addHolding, removeHolding, addToWatchlist, removeFromWatchlist,
} from '../api/portfolio.js'
import {
  getReminders, addReminder, removeReminder, toggleReminder,
} from '../api/reminders.js'
import {
  getEvents, addEvent, removeEvent,
} from '../api/events.js'
import {
  getTasks, addTask, removeTask, toggleTask,
} from '../api/tasks.js'
import { getSettings, saveSettings } from '../api/settings.js'
import {
  getConnections, startGoogleConnect, disconnectAccount, getAllowlist, saveAllowlist,
} from '../api/connections.js'
import {
  getIngestActivity, runIngestNow, rejectFact, getLockedQueue, submitLockedPassword,
} from '../api/ingest.js'
import { getBills, markBillPaid } from '../api/bills.js'
import { getVault, saveVault, deleteVault } from '../api/vault.js'

// ─── Shared primitives ───────────────────────────────────────────────────────

const C = {
  bg: '#0f0f0f',
  card: '#1c1c1c',
  border: '#2a2a2a',
  accent: '#3b82f6',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.4)',
  danger: '#ef4444',
}

function Btn({ children, onClick, variant = 'primary', small, disabled, className = '' }) {
  const base = `inline-flex items-center justify-center rounded-lg font-medium transition-colors cursor-pointer border-0 ${small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'} ${className}`
  const styles = {
    primary: { backgroundColor: disabled ? '#1e3a5f' : C.accent, color: '#fff', opacity: disabled ? 0.6 : 1 },
    ghost: { backgroundColor: 'transparent', color: C.muted, border: `1px solid ${C.border}` },
    danger: { backgroundColor: 'transparent', color: C.danger, border: `1px solid ${C.danger}` },
  }
  return (
    <button onClick={onClick} className={base} style={styles[variant]} disabled={disabled}>
      {children}
    </button>
  )
}

function Input({ label, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label style={{ color: C.muted, fontSize: 12 }}>{label}</label>}
      <input
        {...props}
        className="rounded-lg px-3 py-2 text-sm outline-none"
        style={{ backgroundColor: '#111', border: `1px solid ${C.border}`, color: C.text }}
      />
    </div>
  )
}

function Select({ label, children, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label style={{ color: C.muted, fontSize: 12 }}>{label}</label>}
      <select
        {...props}
        className="rounded-lg px-3 py-2 text-sm outline-none"
        style={{ backgroundColor: '#111', border: `1px solid ${C.border}`, color: C.text }}
      >
        {children}
      </select>
    </div>
  )
}

function Badge({ children, color }) {
  const colors = {
    STOCK: '#1d4ed8', MF: '#7c3aed', EVENT: '#065f46', TASK: '#92400e',
    CONNECTED: '#065f46', ERROR: '#7f1d1d', REVOKED: '#374151',
    TRANSACTIONAL: '#1d4ed8', NEWSLETTER: '#7c3aed',
  }
  return (
    <span
      className="text-xs font-semibold rounded px-1.5 py-0.5 uppercase tracking-wide"
      style={{ backgroundColor: colors[color] || '#333', color: '#fff' }}
    >
      {children}
    </span>
  )
}

function Card({ children, className = '' }) {
  return (
    <div
      className={`rounded-xl p-4 ${className}`}
      style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}
    >
      {children}
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: C.muted }}>
      {children}
    </h2>
  )
}

// ─── Portfolio Tab ────────────────────────────────────────────────────────────

const BLANK_HOLDING = { name: '', symbol: '', type: 'stock', quantity: '', avgPrice: '', exchange: '' }

function HoldingRow({ item, onRemove }) {
  return (
    <div className="flex items-center justify-between py-2.5" style={{ borderBottom: `1px solid ${C.border}` }}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-white">{item.symbol}</span>
          <Badge color={item.type === 'stock' ? 'STOCK' : 'MF'}>
            {item.type === 'stock' ? 'STOCK' : 'MF'}
          </Badge>
          {item.exchange && (
            <span className="text-xs" style={{ color: C.muted }}>{item.exchange}</span>
          )}
        </div>
        <span className="text-sm truncate" style={{ color: C.muted }}>{item.name}</span>
        {!item.watchlistOnly && item.quantity && (
          <span className="text-xs" style={{ color: C.muted }}>
            {item.quantity} × ₹{item.avgPrice}
          </span>
        )}
      </div>
      <Btn variant="danger" small onClick={onRemove}>✕</Btn>
    </div>
  )
}

function AddHoldingForm({ watchlistOnly, onAdd, onCancel }) {
  const [form, setForm] = useState(BLANK_HOLDING)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.symbol.trim()) return
    setSaving(true)
    try {
      const payload = { ...form, quantity: Number(form.quantity) || 0, avgPrice: Number(form.avgPrice) || 0 }
      if (watchlistOnly) {
        await addToWatchlist(payload)
      } else {
        await addHolding(payload)
      }
      onAdd()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mt-3">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Input label="Symbol *" value={form.symbol} onChange={(e) => set('symbol', e.target.value.toUpperCase())} placeholder="RELIANCE" />
        <Input label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Reliance Industries" />
        <Select label="Type" value={form.type} onChange={(e) => set('type', e.target.value)}>
          <option value="stock">Stock</option>
          <option value="mutual_fund">Mutual Fund</option>
        </Select>
        <Input label="Exchange" value={form.exchange} onChange={(e) => set('exchange', e.target.value)} placeholder="NSE" />
        {!watchlistOnly && (
          <>
            <Input label="Quantity" type="number" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="10" />
            <Input label="Avg Price (₹)" type="number" value={form.avgPrice} onChange={(e) => set('avgPrice', e.target.value)} placeholder="2450" />
          </>
        )}
      </div>
      <div className="flex gap-2">
        <Btn onClick={submit} disabled={saving}>{saving ? 'Adding…' : 'Add'}</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  )
}

function PortfolioTab() {
  const [data, setData] = useState({ holdings: [], watchlist: [] })
  const [showHoldingForm, setShowHoldingForm] = useState(false)
  const [showWatchlistForm, setShowWatchlistForm] = useState(false)

  const refresh = useCallback(async () => {
    const d = await getPortfolio()
    setData(d)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <SectionTitle>Holdings ({data.holdings.length})</SectionTitle>
          {!showHoldingForm && (
            <Btn small onClick={() => { setShowWatchlistForm(false); setShowHoldingForm(true) }}>+ Add Holding</Btn>
          )}
        </div>
        {data.holdings.length === 0 && !showHoldingForm && (
          <p className="text-sm py-4" style={{ color: C.muted }}>No holdings yet.</p>
        )}
        {data.holdings.map((h) => (
          <HoldingRow key={h.id} item={h} onRemove={async () => { await removeHolding(h.id); refresh() }} />
        ))}
        {showHoldingForm && (
          <AddHoldingForm
            watchlistOnly={false}
            onAdd={() => { setShowHoldingForm(false); refresh() }}
            onCancel={() => setShowHoldingForm(false)}
          />
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <SectionTitle>Watchlist ({data.watchlist.length})</SectionTitle>
          {!showWatchlistForm && (
            <Btn small onClick={() => { setShowHoldingForm(false); setShowWatchlistForm(true) }}>+ Add to Watchlist</Btn>
          )}
        </div>
        {data.watchlist.length === 0 && !showWatchlistForm && (
          <p className="text-sm py-4" style={{ color: C.muted }}>Nothing in watchlist.</p>
        )}
        {data.watchlist.map((w) => (
          <HoldingRow key={w.id} item={w} onRemove={async () => { await removeFromWatchlist(w.id); refresh() }} />
        ))}
        {showWatchlistForm && (
          <AddHoldingForm
            watchlistOnly
            onAdd={() => { setShowWatchlistForm(false); refresh() }}
            onCancel={() => setShowWatchlistForm(false)}
          />
        )}
      </div>
    </div>
  )
}

// ─── Reminders Tab ────────────────────────────────────────────────────────────

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const BLANK_REMINDER = { title: '', time: '', daysMode: 'daily', selectedDays: [], note: '' }

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center rounded-full transition-colors w-10 h-6 flex-shrink-0"
      style={{ backgroundColor: checked ? C.accent : C.border }}
      aria-label={checked ? 'Active' : 'Inactive'}
    >
      <span
        className="inline-block w-4 h-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(3px)' }}
      />
    </button>
  )
}

function ReminderRow({ r, onRemove, onToggle }) {
  const daysLabel = r.days === 'daily' ? 'Daily' : (Array.isArray(r.days) ? r.days.join(', ') : r.days)
  return (
    <Card className="mb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold font-mono" style={{ color: C.text }}>{r.time}</span>
            <span className="font-medium" style={{ color: C.text }}>{r.title}</span>
          </div>
          <span className="text-xs" style={{ color: C.muted }}>{daysLabel}</span>
          {r.note && <span className="text-xs mt-0.5" style={{ color: C.muted }}>{r.note}</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Toggle checked={r.active} onChange={onToggle} />
          <Btn variant="danger" small onClick={onRemove}>✕</Btn>
        </div>
      </div>
    </Card>
  )
}

function AddReminderForm({ onAdd, onCancel }) {
  const [form, setForm] = useState(BLANK_REMINDER)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function toggleDay(d) {
    setForm((f) => {
      const sel = f.selectedDays.includes(d)
        ? f.selectedDays.filter((x) => x !== d)
        : [...f.selectedDays, d]
      return { ...f, selectedDays: sel }
    })
  }

  async function submit() {
    if (!form.title.trim() || !form.time) return
    setSaving(true)
    try {
      await addReminder({
        title: form.title.trim(),
        time: form.time,
        days: form.daysMode === 'daily' ? 'daily' : form.selectedDays,
        note: form.note.trim(),
      })
      onAdd()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mt-3">
      <div className="flex flex-col gap-3 mb-3">
        <Input label="Title *" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Take medicine" />
        <Input label="Time * (HH:MM)" type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />
        <div className="flex flex-col gap-1">
          <label style={{ color: C.muted, fontSize: 12 }}>Days</label>
          <div className="flex gap-2">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer" style={{ color: C.text }}>
              <input type="radio" checked={form.daysMode === 'daily'} onChange={() => set('daysMode', 'daily')} />
              Daily
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer" style={{ color: C.text }}>
              <input type="radio" checked={form.daysMode === 'custom'} onChange={() => set('daysMode', 'custom')} />
              Select days
            </label>
          </div>
          {form.daysMode === 'custom' && (
            <div className="flex gap-1.5 flex-wrap mt-1">
              {DAYS.map((d) => {
                const sel = form.selectedDays.includes(d)
                return (
                  <button
                    key={d}
                    onClick={() => toggleDay(d)}
                    className="px-2 py-1 rounded text-xs font-medium capitalize transition-colors"
                    style={{
                      backgroundColor: sel ? C.accent : '#111',
                      border: `1px solid ${sel ? C.accent : C.border}`,
                      color: sel ? '#fff' : C.muted,
                    }}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <Input label="Note (optional)" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Optional note" />
      </div>
      <div className="flex gap-2">
        <Btn onClick={submit} disabled={saving}>{saving ? 'Adding…' : 'Add'}</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  )
}

function RemindersTab() {
  const [reminders, setReminders] = useState([])
  const [showForm, setShowForm] = useState(false)

  const refresh = useCallback(async () => setReminders(await getReminders()), [])
  useEffect(() => { refresh() }, [refresh])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>Reminders ({reminders.length})</SectionTitle>
        {!showForm && <Btn small onClick={() => setShowForm(true)}>+ Add Reminder</Btn>}
      </div>
      {reminders.length === 0 && !showForm && (
        <p className="text-sm py-4" style={{ color: C.muted }}>No reminders yet.</p>
      )}
      {reminders.map((r) => (
        <ReminderRow
          key={r.id}
          r={r}
          onRemove={async () => { await removeReminder(r.id); refresh() }}
          onToggle={async () => { await toggleReminder(r.id); refresh() }}
        />
      ))}
      {showForm && (
        <AddReminderForm
          onAdd={() => { setShowForm(false); refresh() }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

// ─── Events Tab ───────────────────────────────────────────────────────────────

const BLANK_EVENT = { title: '', date: '', time: '', description: '', type: 'event' }

function EventRow({ ev, onRemove }) {
  const today = new Date().toISOString().slice(0, 10)
  const isPast = ev.date < today
  return (
    <div
      className="flex items-start justify-between py-3"
      style={{ borderBottom: `1px solid ${C.border}`, opacity: isPast ? 0.45 : 1 }}
    >
      <div className="flex gap-3 min-w-0">
        <div
          className="rounded-lg px-2 py-1 text-center flex-shrink-0"
          style={{ backgroundColor: '#111', border: `1px solid ${C.border}`, minWidth: 52 }}
        >
          <span className="block text-xs" style={{ color: C.muted }}>
            {new Date(ev.date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' })}
          </span>
          <span className="block text-lg font-bold leading-none" style={{ color: C.text }}>
            {new Date(ev.date + 'T00:00:00').getDate()}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium" style={{ color: C.text }}>{ev.title}</span>
            <Badge color={ev.type === 'event' ? 'EVENT' : 'TASK'}>
              {ev.type === 'event' ? 'EVENT' : 'TASK'}
            </Badge>
          </div>
          {ev.time && <span className="text-xs" style={{ color: C.muted }}>{ev.time}</span>}
          {ev.description && (
            <span className="text-xs mt-0.5 truncate" style={{ color: C.muted }}>{ev.description}</span>
          )}
        </div>
      </div>
      <Btn variant="danger" small onClick={onRemove} className="flex-shrink-0">✕</Btn>
    </div>
  )
}

function AddEventForm({ onAdd, onCancel }) {
  const [form, setForm] = useState(BLANK_EVENT)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.title.trim() || !form.date) return
    setSaving(true)
    try {
      await addEvent({ ...form, title: form.title.trim(), time: form.time || null })
      onAdd()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mt-3">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="col-span-2">
          <Input label="Title *" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Doctor appointment" />
        </div>
        <Input label="Date *" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        <Input label="Time (optional)" type="time" value={form.time} onChange={(e) => set('time', e.target.value)} />
        <div className="col-span-2">
          <Select label="Type" value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option value="event">Event</option>
            <option value="task">Task</option>
          </Select>
        </div>
        <div className="col-span-2">
          <Input label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional details" />
        </div>
      </div>
      <div className="flex gap-2">
        <Btn onClick={submit} disabled={saving}>{saving ? 'Adding…' : 'Add'}</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  )
}

function EventsTab() {
  const [events, setEvents] = useState([])
  const [showForm, setShowForm] = useState(false)

  const refresh = useCallback(async () => {
    const evs = await getEvents()
    setEvents(evs.sort((a, b) => a.date.localeCompare(b.date)))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const today = new Date().toISOString().slice(0, 10)
  const weekEnd = new Date()
  weekEnd.setDate(weekEnd.getDate() + 7)
  const weekEndStr = weekEnd.toISOString().slice(0, 10)

  const grouped = events.reduce(
    (acc, ev) => {
      if (ev.date === today) acc.today.push(ev)
      else if (ev.date > today && ev.date <= weekEndStr) acc.week.push(ev)
      else acc.later.push(ev)
      return acc
    },
    { today: [], week: [], later: [] },
  )

  function Group({ label, items }) {
    if (items.length === 0) return null
    return (
      <div className="mb-4">
        <SectionTitle>{label}</SectionTitle>
        {items.map((ev) => (
          <EventRow key={ev.id} ev={ev} onRemove={async () => { await removeEvent(ev.id); refresh() }} />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>Events ({events.length})</SectionTitle>
        {!showForm && <Btn small onClick={() => setShowForm(true)}>+ Add Event</Btn>}
      </div>
      {events.length === 0 && !showForm && (
        <p className="text-sm py-4" style={{ color: C.muted }}>No events yet.</p>
      )}
      <Group label="Today" items={grouped.today} />
      <Group label="This Week" items={grouped.week} />
      <Group label="Later" items={grouped.later} />
      {showForm && (
        <AddEventForm
          onAdd={() => { setShowForm(false); refresh() }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

// ─── Tasks Tab ────────────────────────────────────────────────────────────────

const PRIORITY_COLORS = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' }
const PRIORITY_LABELS = { high: 'HIGH', medium: 'MED', low: 'LOW' }

function PriorityDot({ priority }) {
  return (
    <span
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        backgroundColor: PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium,
        flexShrink: 0, marginTop: 2,
      }}
    />
  )
}

function TaskRow({ task, onRemove, onToggle }) {
  const dueStr = task.due
    ? new Date(task.due + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null
  const isOverdue = task.due && task.due < new Date().toISOString().slice(0, 10)

  return (
    <div
      className="flex items-start justify-between py-2.5"
      style={{ borderBottom: `1px solid ${C.border}`, opacity: task.done ? 0.45 : 1 }}
    >
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <button
          onClick={onToggle}
          style={{
            width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
            border: `2px solid ${task.done ? C.accent : C.border}`,
            background: task.done ? C.accent : 'transparent', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label={task.done ? 'Mark incomplete' : 'Mark complete'}
        >
          {task.done && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
        </button>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span
            className="text-sm font-medium"
            style={{ color: C.text, textDecoration: task.done ? 'line-through' : 'none' }}
          >
            {task.title}
          </span>
          <div className="flex items-center gap-2">
            <PriorityDot priority={task.priority} />
            <span className="text-xs" style={{ color: PRIORITY_COLORS[task.priority] || C.muted }}>
              {PRIORITY_LABELS[task.priority] || 'MED'}
            </span>
            {dueStr && (
              <span className="text-xs" style={{ color: isOverdue ? '#ef4444' : C.muted }}>
                {isOverdue ? '⚠ ' : ''}Due {dueStr}
              </span>
            )}
          </div>
        </div>
      </div>
      <Btn variant="danger" small onClick={onRemove}>✕</Btn>
    </div>
  )
}

const BLANK_TASK = { title: '', priority: 'medium', due: '' }

function AddTaskForm({ onAdd, onCancel }) {
  const [form, setForm] = useState(BLANK_TASK)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await addTask({ title: form.title.trim(), priority: form.priority, due: form.due || null })
      onAdd()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mt-3">
      <div className="flex flex-col gap-3 mb-3">
        <Input label="Task *" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Review PR #42" />
        <Select label="Priority" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <Input label="Due date (optional)" type="date" value={form.due} onChange={(e) => set('due', e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Btn onClick={submit} disabled={saving}>{saving ? 'Adding…' : 'Add'}</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  )
}

function TasksTab() {
  const [tasks, setTasks] = useState([])
  const [showForm, setShowForm] = useState(false)

  const refresh = useCallback(async () => setTasks(await getTasks()), [])
  useEffect(() => { refresh() }, [refresh])

  const active = tasks.filter((t) => !t.done)
  const done = tasks.filter((t) => t.done)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>Tasks ({active.length} active)</SectionTitle>
        {!showForm && <Btn small onClick={() => setShowForm(true)}>+ Add Task</Btn>}
      </div>
      {tasks.length === 0 && !showForm && (
        <p className="text-sm py-4" style={{ color: C.muted }}>No tasks yet.</p>
      )}
      {active.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          onRemove={async () => { await removeTask(t.id); refresh() }}
          onToggle={async () => { await toggleTask(t.id); refresh() }}
        />
      ))}
      {showForm && (
        <AddTaskForm
          onAdd={() => { setShowForm(false); refresh() }}
          onCancel={() => setShowForm(false)}
        />
      )}
      {done.length > 0 && (
        <div className="mt-4">
          <SectionTitle>Completed ({done.length})</SectionTitle>
          {done.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onRemove={async () => { await removeTask(t.id); refresh() }}
              onToggle={async () => { await toggleTask(t.id); refresh() }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Connections Tab ──────────────────────────────────────────────────────────

const STATUS_LABELS = { connected: 'CONNECTED', error: 'ERROR', revoked: 'REVOKED' }
const BLANK_ALLOWLIST_ENTRY = { pattern: '', kind: 'sender', type: 'transactional' }

function AllowlistEditor({ accountId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(BLANK_ALLOWLIST_ENTRY)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(await getAllowlist(accountId))
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { refresh() }, [refresh])

  async function persist(next) {
    setSaving(true)
    try {
      setEntries(await saveAllowlist(accountId, next))
    } finally {
      setSaving(false)
    }
  }

  async function addEntry() {
    if (!form.pattern.trim()) return
    const next = [...entries, { ...form, pattern: form.pattern.trim() }]
    setForm(BLANK_ALLOWLIST_ENTRY)
    await persist(next)
  }

  async function removeEntry(idx) {
    await persist(entries.filter((_, i) => i !== idx))
  }

  if (loading) return <p className="text-sm" style={{ color: C.muted }}>Loading allowlist…</p>

  return (
    <div className="mt-3 flex flex-col gap-3">
      {entries.length === 0 && (
        <p className="text-sm" style={{ color: C.muted }}>No allowlist entries yet — nothing will be ingested for this account.</p>
      )}
      {entries.map((entry, idx) => (
        <div
          key={`${entry.pattern}-${idx}`}
          className="flex items-center justify-between gap-2 py-2"
          style={{ borderBottom: `1px solid ${C.border}` }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-sm truncate" style={{ color: C.text }}>{entry.pattern}</span>
            <span className="text-xs uppercase" style={{ color: C.muted }}>{entry.kind}</span>
            <Badge color={entry.type === 'newsletter' ? 'NEWSLETTER' : 'TRANSACTIONAL'}>
              {entry.type === 'newsletter' ? 'NEWSLETTER' : 'TRANSACTIONAL'}
            </Badge>
          </div>
          <Btn variant="danger" small disabled={saving} onClick={() => removeEntry(idx)}>✕</Btn>
        </div>
      ))}
      <div className="grid grid-cols-3 gap-2 items-end">
        <Input
          label="Sender / label"
          value={form.pattern}
          onChange={(e) => set('pattern', e.target.value)}
          placeholder="noreply@zerodha.com"
        />
        <Select label="Kind" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
          <option value="sender">Sender</option>
          <option value="label">Gmail label</option>
        </Select>
        <Select label="Type" value={form.type} onChange={(e) => set('type', e.target.value)}>
          <option value="transactional">Transactional</option>
          <option value="newsletter">Newsletter</option>
        </Select>
      </div>
      <Btn small disabled={saving || !form.pattern.trim()} onClick={addEntry}>
        {saving ? 'Saving…' : '+ Add entry'}
      </Btn>
    </div>
  )
}

function AccountCard({ account, onChanged }) {
  const [expanded, setExpanded] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  async function handleDisconnect(purge) {
    const verb = purge ? 'permanently delete all data for' : 'disconnect'
    if (!window.confirm(`Are you sure you want to ${verb} ${account.emailAddress}?`)) return
    setDisconnecting(true)
    try {
      await disconnectAccount(account.id, purge)
      onChanged()
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Card className="mb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate" style={{ color: C.text }}>{account.emailAddress}</span>
            {account.label && (
              <span className="text-xs" style={{ color: C.muted }}>{account.label}</span>
            )}
            <Badge color={STATUS_LABELS[account.status] || 'REVOKED'}>
              {STATUS_LABELS[account.status] || account.status.toUpperCase()}
            </Badge>
          </div>
          <span className="text-xs" style={{ color: C.muted }}>
            Connected {new Date(account.connectedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          {account.status === 'error' && account.lastError && (
            <span className="text-xs" style={{ color: '#ef4444' }}>{account.lastError}</span>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0 items-end">
          <Btn variant="ghost" small onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Hide allowlist' : 'Manage allowlist'}
          </Btn>
          <div className="flex gap-2">
            <Btn variant="ghost" small disabled={disconnecting} onClick={() => handleDisconnect(false)}>Disconnect</Btn>
            <Btn variant="danger" small disabled={disconnecting} onClick={() => handleDisconnect(true)}>Delete data</Btn>
          </div>
        </div>
      </div>
      {expanded && <AllowlistEditor accountId={account.id} />}
    </Card>
  )
}

function ConnectAccountForm({ onConnected, onCancel }) {
  const [label, setLabel] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  async function connect() {
    setConnecting(true)
    setError('')
    try {
      const { url } = await startGoogleConnect(label.trim())
      window.open(url, '_blank', 'noopener,noreferrer')
      onConnected()
    } catch (err) {
      setError(err.message || 'Failed to start Google connection.')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Card className="mt-3">
      <div className="flex flex-col gap-3 mb-3">
        <Input
          label="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="personal, work, ..."
        />
        {error && <span className="text-xs" style={{ color: '#ef4444' }}>{error}</span>}
        <span className="text-xs" style={{ color: C.muted }}>
          Opens Google's consent screen in a new tab. Once you approve access, come back here and refresh.
        </span>
      </div>
      <div className="flex gap-2">
        <Btn onClick={connect} disabled={connecting}>{connecting ? 'Opening…' : 'Connect with Google'}</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  )
}

function ConnectionsTab() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setAccounts(await getConnections())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>Connected Accounts ({accounts.length})</SectionTitle>
        <div className="flex gap-2">
          <Btn variant="ghost" small onClick={refresh}>Refresh</Btn>
          {!showForm && <Btn small onClick={() => setShowForm(true)}>+ Connect Google Account</Btn>}
        </div>
      </div>
      {loading && <p className="text-sm py-4" style={{ color: C.muted }}>Loading connections…</p>}
      {!loading && accounts.length === 0 && !showForm && (
        <p className="text-sm py-4" style={{ color: C.muted }}>No accounts connected yet.</p>
      )}
      {accounts.map((account) => (
        <AccountCard key={account.id} account={account} onChanged={refresh} />
      ))}
      {showForm && (
        <ConnectAccountForm
          onConnected={() => setShowForm(false)}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  )
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────

function BillRow({ bill, sourceEmail, onMarkPaid }) {
  const today = new Date().toISOString().slice(0, 10)
  const isOverdue = bill.dueDate && bill.dueDate < today && bill.status !== 'paid'
  return (
    <div className="flex items-start justify-between py-2.5" style={{ borderBottom: `1px solid ${C.border}` }}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium" style={{ color: C.text }}>{bill.vendor}</span>
          <span className="text-sm" style={{ color: C.text }}>{bill.currency} {bill.amount}</span>
          {bill.status === 'paid' && <Badge color="CONNECTED">PAID</Badge>}
        </div>
        <span className="text-xs" style={{ color: isOverdue ? '#ef4444' : C.muted }}>
          {bill.dueDate
            ? `${isOverdue ? '⚠ Overdue ' : 'Due '}${new Date(bill.dueDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
            : 'Due date unknown'}
        </span>
        {sourceEmail && (
          <span className="text-xs truncate" style={{ color: C.muted }}>
            From: {sourceEmail.sender}{sourceEmail.subject ? ` — "${sourceEmail.subject}"` : ''}
          </span>
        )}
      </div>
      {bill.status !== 'paid' && (
        <Btn variant="ghost" small onClick={onMarkPaid} className="flex-shrink-0">Mark Paid</Btn>
      )}
    </div>
  )
}

function ActivityRow({ item, onReject }) {
  return (
    <Card className="mb-3">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate" style={{ color: C.text }}>{item.sender || 'unknown sender'}</span>
          <Badge color={item.outcome === 'extracted' ? 'CONNECTED' : 'ERROR'}>
            {item.outcome?.toUpperCase()}
          </Badge>
        </div>
        {item.subject && <span className="text-sm truncate" style={{ color: C.muted }}>{item.subject}</span>}
        {item.reason && <span className="text-xs" style={{ color: '#ef4444' }}>Reason: {item.reason}</span>}
        <span className="text-xs" style={{ color: C.muted }}>
          {item.processedAt ? new Date(item.processedAt).toLocaleString('en-IN') : ''}
        </span>
      </div>
      {item.factRefs?.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {item.factRefs.map((ref) => (
            <div
              key={ref}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1"
              style={{ backgroundColor: '#111', border: `1px solid ${C.border}` }}
            >
              <span className="text-xs" style={{ color: C.muted }}>{ref}</span>
              <button
                onClick={() => onReject(ref)}
                className="text-xs cursor-pointer"
                style={{ color: '#ef4444', background: 'none', border: 'none' }}
                aria-label={`Reject ${ref}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function LockedRow({ item, onUnlock }) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!password.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await onUnlock(item.gmailMessageId, password.trim())
      setPassword('')
    } catch (err) {
      setError(err.message || 'Failed to unlock')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="mb-3">
      <div className="flex flex-col gap-1 mb-2">
        <span className="font-medium" style={{ color: C.text }}>{item.sender || 'unknown sender'}</span>
        {item.subject && <span className="text-sm" style={{ color: C.muted }}>{item.subject}</span>}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter document password"
          className="rounded-lg px-3 py-2 text-sm outline-none flex-1"
          style={{ backgroundColor: '#111', border: `1px solid ${C.border}`, color: C.text }}
        />
        <Btn small onClick={submit} disabled={submitting || !password.trim()}>
          {submitting ? 'Unlocking…' : 'Unlock'}
        </Btn>
      </div>
      {error && <span className="text-xs mt-1 block" style={{ color: '#ef4444' }}>{error}</span>}
    </Card>
  )
}

function ActivityTab() {
  const [activity, setActivity] = useState([])
  const [bills, setBills] = useState([])
  const [locked, setLocked] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [a, b, l] = await Promise.all([getIngestActivity(), getBills(), getLockedQueue()])
      setActivity(a)
      setBills(b)
      setLocked(l)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const emailById = Object.fromEntries(activity.map((a) => [a.gmailMessageId, a]))

  async function handleRun() {
    setRunning(true)
    try {
      await runIngestNow()
    } finally {
      setTimeout(() => { setRunning(false); refresh() }, 1500)
    }
  }

  async function handleReject(ref) {
    await rejectFact(ref)
    refresh()
  }

  async function handleMarkPaid(id) {
    await markBillPaid(id)
    refresh()
  }

  async function handleUnlock(emailId, password) {
    await submitLockedPassword(emailId, password)
    refresh()
  }

  if (loading) return <p style={{ color: C.muted }}>Loading activity…</p>

  return (
    <div className="flex flex-col gap-6">
      {locked.length > 0 && (
        <div>
          <SectionTitle>Locked Documents ({locked.length})</SectionTitle>
          {locked.map((item) => (
            <LockedRow key={item.gmailMessageId} item={item} onUnlock={handleUnlock} />
          ))}
        </div>
      )}

      <div>
        <SectionTitle>Bills ({bills.filter((b) => b.status !== 'paid').length} due)</SectionTitle>
        {bills.length === 0 && (
          <p className="text-sm py-4" style={{ color: C.muted }}>No bills tracked yet.</p>
        )}
        {bills.map((bill) => (
          <BillRow
            key={bill.id}
            bill={bill}
            sourceEmail={emailById[bill.sourceEmailId]}
            onMarkPaid={() => handleMarkPaid(bill.id)}
          />
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Recent Ingestion Activity ({activity.length})</SectionTitle>
          <Btn small onClick={handleRun} disabled={running}>{running ? 'Running…' : 'Run Now'}</Btn>
        </div>
        {activity.length === 0 && (
          <p className="text-sm py-4" style={{ color: C.muted }}>No emails processed yet.</p>
        )}
        {activity.map((item) => (
          <ActivityRow key={item.gmailMessageId} item={item} onReject={handleReject} />
        ))}
      </div>
    </div>
  )
}

// ─── Vault Tab ────────────────────────────────────────────────────────────────

const VAULT_FIELD_LABELS = {
  name: 'Full name',
  dob: 'Date of birth (YYYY-MM-DD)',
  mobile: 'Mobile number',
  pan: 'PAN',
  accountNumbers: 'Account numbers',
}

function VaultTab() {
  const [fields, setFields] = useState({})
  const [form, setForm] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setFields(await getVault())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleSave() {
    setSaving(true)
    try {
      await saveVault(form)
      setForm({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteAll() {
    if (!window.confirm('Permanently delete all vault data — identity fields, saved document passwords, and connected account tokens?')) return
    await deleteVault()
    refresh()
  }

  if (loading) return <p style={{ color: C.muted }}>Loading vault…</p>

  return (
    <div className="flex flex-col gap-5 max-w-lg">
      <p className="text-xs" style={{ color: C.muted }}>
        Used to auto-unlock password-protected statements from your inbox (ENGINEERING §4.2).
        Values are encrypted at rest and never shown in full.
      </p>
      {Object.entries(VAULT_FIELD_LABELS).map(([key, label]) => (
        <Input
          key={key}
          label={fields[key]?.set ? `${label} — currently ${fields[key].masked}` : label}
          value={form[key] ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          placeholder={fields[key]?.set ? 'Enter a new value to replace it' : label}
        />
      ))}
      <div className="flex items-center gap-3">
        <Btn onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
        {saved && <span className="text-sm font-medium" style={{ color: '#22c55e' }}>Saved ✓</span>}
      </div>
      <div className="pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
        <Btn variant="danger" onClick={handleDeleteAll}>Delete all vault data</Btn>
      </div>
    </div>
  )
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  weatherLat: '', weatherLon: '', weatherCity: '', cycleIntervalMinutes: 10,
  screenWidth: 412, screenHeight: 892,
}

const ANDROID_STEPS = [
  'Open this app in Chrome on your Android device',
  'Tap the ⋮ menu → "Add to Home screen"',
  'Open the app from home screen (it will be fullscreen)',
  'Go to Android Settings → Display → Screen timeout → Set to "Never" (or use a keep-awake app)',
  'Optionally enable "Stay awake" in Developer Options',
]

function AndroidSetupGuide() {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: C.card, border: 'none', cursor: 'pointer',
          color: C.text, fontSize: 14, fontWeight: 500,
        }}
      >
        <span>Android Setup Guide</span>
        <span style={{ color: C.muted, fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', backgroundColor: C.card }}>
          <ol style={{ margin: 0, paddingLeft: 20, color: C.muted, fontSize: 13, lineHeight: 1.8 }}>
            {ANDROID_STEPS.map((step, i) => (
              <li key={i} style={{ marginTop: 6 }}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function SettingsTab() {
  const [form, setForm] = useState(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [detectedSize, setDetectedSize] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSettings().then((s) => {
      setForm(s)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function detectScreen() {
    const w = window.innerWidth
    const h = window.innerHeight
    setForm((f) => ({ ...f, screenWidth: w, screenHeight: h }))
    setDetectedSize({ w, h })
  }

  async function handleSave() {
    await saveSettings(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) return <p style={{ color: C.muted }}>Loading settings…</p>

  return (
    <div className="flex flex-col gap-5 max-w-lg">
      <div className="flex flex-col gap-3">
        <label style={{ color: C.muted, fontSize: 12 }}>Weather Location (Open-Meteo — free, no key needed)</label>
        <Input
          label="City name (display only)"
          value={form.weatherCity || ''}
          onChange={(e) => set('weatherCity', e.target.value)}
          placeholder="Chennai"
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Latitude"
            type="number"
            step="0.0001"
            value={form.weatherLat || ''}
            onChange={(e) => set('weatherLat', e.target.value)}
            placeholder="13.0827"
          />
          <Input
            label="Longitude"
            type="number"
            step="0.0001"
            value={form.weatherLon || ''}
            onChange={(e) => set('weatherLon', e.target.value)}
            placeholder="80.2707"
          />
        </div>
        <span style={{ color: C.muted, fontSize: 11 }}>
          Find your coordinates at{' '}
          <a
            href="https://www.latlong.net"
            target="_blank"
            rel="noreferrer"
            style={{ color: C.accent }}
          >
            latlong.net
          </a>
        </span>
      </div>

      <Input
        label="Refresh every X minutes"
        type="number"
        min="1"
        value={form.cycleIntervalMinutes}
        onChange={(e) => set('cycleIntervalMinutes', Number(e.target.value))}
      />

      <div className="flex flex-col gap-2">
        <label style={{ color: C.muted, fontSize: 12 }}>Screen Size</label>
        <div className="flex items-center gap-3">
          <Btn variant="ghost" onClick={detectScreen}>Detect Screen Size</Btn>
          {detectedSize && (
            <span className="text-sm" style={{ color: C.muted }}>
              {detectedSize.w} × {detectedSize.h}
            </span>
          )}
          {!detectedSize && form.screenWidth > 0 && (
            <span className="text-sm" style={{ color: C.muted }}>
              {form.screenWidth} × {form.screenHeight}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Btn onClick={handleSave}>Save Settings</Btn>
        {saved && (
          <span className="text-sm font-medium" style={{ color: '#22c55e' }}>Saved ✓</span>
        )}
      </div>

      <AndroidSetupGuide />
    </div>
  )
}

// ─── ManagePanel root ─────────────────────────────────────────────────────────

const TABS = ['Portfolio', 'Reminders', 'Events', 'Tasks', 'Connections', 'Activity', 'Vault', 'Settings']

const TAB_COMPONENTS = {
  Portfolio: PortfolioTab,
  Reminders: RemindersTab,
  Events: EventsTab,
  Tasks: TasksTab,
  Connections: ConnectionsTab,
  Activity: ActivityTab,
  Vault: VaultTab,
  Settings: SettingsTab,
}

const ManagePanel = memo(function ManagePanel({ onClose }) {
  const [visible, setVisible] = useState(false)
  const [activeTab, setActiveTab] = useState('Portfolio')

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  const TabContent = TAB_COMPONENTS[activeTab]

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: C.bg }}>
      <div
        className="flex flex-col h-full transition-transform duration-300 ease-out"
        style={{ transform: visible ? 'translateY(0)' : 'translateY(100%)' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: `1px solid ${C.border}` }}
        >
          <h1 className="text-white text-lg font-semibold tracking-wide">Desk Bot</h1>
          <button
            onClick={onClose}
            className="text-2xl leading-none transition-colors"
            style={{ color: C.muted, background: 'none', border: 'none', cursor: 'pointer' }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-3 text-sm font-medium transition-colors"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: activeTab === tab ? C.text : C.muted,
                borderBottom: activeTab === tab ? `2px solid ${C.accent}` : '2px solid transparent',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <TabContent />
        </div>
      </div>
    </div>
  )
})

export default ManagePanel
