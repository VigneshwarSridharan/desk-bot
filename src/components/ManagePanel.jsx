import { useState, useEffect, useCallback, memo } from 'react'
import {
  getPortfolio, addHolding, removeHolding, addToWatchlist, removeFromWatchlist,
} from '../store/portfolio'
import {
  getReminders, addReminder, removeReminder, toggleReminder,
} from '../store/reminders'
import {
  getEvents, addEvent, removeEvent,
} from '../store/events'
import { getSettings, saveSettings } from '../store/settings'

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

function Btn({ children, onClick, variant = 'primary', small, className = '' }) {
  const base = `inline-flex items-center justify-center rounded-lg font-medium transition-colors cursor-pointer border-0 ${small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'} ${className}`
  const styles = {
    primary: { backgroundColor: C.accent, color: '#fff' },
    ghost: { backgroundColor: 'transparent', color: C.muted, border: `1px solid ${C.border}` },
    danger: { backgroundColor: 'transparent', color: C.danger, border: `1px solid ${C.danger}` },
  }
  return (
    <button onClick={onClick} className={base} style={styles[variant]}>
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
  const colors = { STOCK: '#1d4ed8', MF: '#7c3aed', EVENT: '#065f46', TASK: '#92400e' }
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
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function submit() {
    if (!form.symbol.trim()) return
    const payload = { ...form, quantity: Number(form.quantity) || 0, avgPrice: Number(form.avgPrice) || 0 }
    if (watchlistOnly) {
      addToWatchlist(payload)
    } else {
      addHolding(payload)
    }
    onAdd()
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
        <Btn onClick={submit}>Add</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  )
}

function PortfolioTab() {
  const [data, setData] = useState({ holdings: [], watchlist: [] })
  const [showHoldingForm, setShowHoldingForm] = useState(false)
  const [showWatchlistForm, setShowWatchlistForm] = useState(false)

  const refresh = useCallback(() => setData(getPortfolio()), [])
  useEffect(refresh, [refresh])

  return (
    <div className="flex flex-col gap-6">
      {/* Holdings */}
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
          <HoldingRow key={h.id} item={h} onRemove={() => { removeHolding(h.id); refresh() }} />
        ))}
        {showHoldingForm && (
          <AddHoldingForm
            watchlistOnly={false}
            onAdd={() => { setShowHoldingForm(false); refresh() }}
            onCancel={() => setShowHoldingForm(false)}
          />
        )}
      </div>

      {/* Watchlist */}
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
          <HoldingRow key={w.id} item={w} onRemove={() => { removeFromWatchlist(w.id); refresh() }} />
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
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function toggleDay(d) {
    setForm((f) => {
      const sel = f.selectedDays.includes(d)
        ? f.selectedDays.filter((x) => x !== d)
        : [...f.selectedDays, d]
      return { ...f, selectedDays: sel }
    })
  }

  function submit() {
    if (!form.title.trim() || !form.time) return
    addReminder({
      title: form.title.trim(),
      time: form.time,
      days: form.daysMode === 'daily' ? 'daily' : form.selectedDays,
      note: form.note.trim(),
    })
    onAdd()
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
        <Btn onClick={submit}>Add</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  )
}

function RemindersTab() {
  const [reminders, setReminders] = useState([])
  const [showForm, setShowForm] = useState(false)

  const refresh = useCallback(() => setReminders(getReminders()), [])
  useEffect(refresh, [refresh])

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
          onRemove={() => { removeReminder(r.id); refresh() }}
          onToggle={() => { toggleReminder(r.id); refresh() }}
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

function isSameDay(dateStr, ref) {
  return dateStr === ref.toISOString().slice(0, 10)
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', weekday: 'short',
  })
}

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
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function submit() {
    if (!form.title.trim() || !form.date) return
    addEvent({ ...form, title: form.title.trim(), time: form.time || null })
    onAdd()
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
        <Btn onClick={submit}>Add</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </Card>
  )
}

function EventsTab() {
  const [events, setEvents] = useState([])
  const [showForm, setShowForm] = useState(false)

  const refresh = useCallback(() => setEvents(getEvents().sort((a, b) => a.date.localeCompare(b.date))), [])
  useEffect(refresh, [refresh])

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
          <EventRow key={ev.id} ev={ev} onRemove={() => { removeEvent(ev.id); refresh() }} />
        ))}
      </div>
    )
  }

  const total = events.length

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle>Events ({total})</SectionTitle>
        {!showForm && <Btn small onClick={() => setShowForm(true)}>+ Add Event</Btn>}
      </div>
      {total === 0 && !showForm && (
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

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function PasswordInput({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <label style={{ color: C.muted, fontSize: 12 }}>{label}</label>
      <div className="flex items-center rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: '#111', color: C.text, border: 'none' }}
        />
        <button
          onClick={() => setShow((s) => !s)}
          className="px-3 text-xs"
          style={{ backgroundColor: '#111', color: C.muted, border: 'none', cursor: 'pointer', height: '100%' }}
          type="button"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  )
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
  const [form, setForm] = useState(() => getSettings())
  const [saved, setSaved] = useState(false)
  const [detectedSize, setDetectedSize] = useState(null)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function detectScreen() {
    const w = window.innerWidth
    const h = window.innerHeight
    setForm((f) => ({ ...f, screenWidth: w, screenHeight: h }))
    setDetectedSize({ w, h })
  }

  function handleSave() {
    saveSettings(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-5 max-w-lg">
      <PasswordInput
        label="OpenAI API Key"
        value={form.openaiApiKey}
        onChange={(e) => set('openaiApiKey', e.target.value)}
        placeholder="sk-..."
      />
      <PasswordInput
        label="NewsAPI Key (newsapi.org)"
        value={form.newsApiKey}
        onChange={(e) => set('newsApiKey', e.target.value)}
        placeholder="Your NewsAPI key"
      />
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

const TABS = ['Portfolio', 'Reminders', 'Events', 'Settings']

const TAB_COMPONENTS = {
  Portfolio: PortfolioTab,
  Reminders: RemindersTab,
  Events: EventsTab,
  Settings: SettingsTab,
}

const ManagePanel = memo(function ManagePanel({ onClose }) {
  const [visible, setVisible] = useState(false)
  const [activeTab, setActiveTab] = useState('Portfolio')

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 280)
  }

  const TabContent = TAB_COMPONENTS[activeTab]

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: C.bg }}>
      <div
        className="flex flex-col h-full transition-transform duration-300 ease-out"
        style={{ transform: visible ? 'translateY(0)' : 'translateY(100%)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: `1px solid ${C.border}` }}
        >
          <h1 className="text-white text-lg font-semibold tracking-wide">Desk Bot</h1>
          <button
            onClick={handleClose}
            className="text-2xl leading-none transition-colors"
            style={{ color: C.muted, background: 'none', border: 'none', cursor: 'pointer' }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <TabContent />
        </div>
      </div>
    </div>
  )
})

export default ManagePanel
