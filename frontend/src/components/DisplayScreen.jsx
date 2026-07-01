import { useState, useEffect, useRef, useCallback, memo } from 'react'
import FallbackClock from './FallbackClock'

// ─── Status Bar ──────────────────────────────────────────────────────────────

function StatusBar({ visible, lastUpdated, isFromCache, onRefresh, onOpenManage }) {
  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      display: 'flex', justifyContent: 'center',
      paddingBottom: 12,
      pointerEvents: 'none',
      opacity: visible ? 1 : 0,
      transition: 'opacity 1s ease',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        padding: '6px 16px', borderRadius: 20,
        pointerEvents: 'auto',
      }}>
        {isFromCache && (
          <>
            <span style={{ fontSize: 12, color: 'rgba(255,200,0,0.75)', whiteSpace: 'nowrap' }}>
              ⚡ Offline cache
            </span>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>·</span>
          </>
        )}
        {timeStr && !isFromCache && (
          <>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>
              ◷ Updated: {timeStr}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>·</span>
          </>
        )}
        <button
          onClick={e => { e.stopPropagation(); onRefresh() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'rgba(255,255,255,0.6)', padding: '0 2px', lineHeight: 1 }}
        >
          ↻
        </button>
        <button
          onClick={e => { e.stopPropagation(); onOpenManage() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'rgba(255,255,255,0.6)', padding: '0 2px', lineHeight: 1 }}
        >
          ⚙
        </button>
      </div>
    </div>
  )
}

// ─── Display Content (agent loop active) ─────────────────────────────────────

function DisplayContent({ loop, onOpenManage }) {
  const { html, status, lastUpdated, error, refresh, isFromCache } = loop

  // Iframe content — updated with crossfade delay
  const [shownHtml, setShownHtml] = useState(html)
  const [shownKey, setShownKey] = useState(0)
  const [iframeOpacity, setIframeOpacity] = useState(0)
  const shownHtmlRef = useRef(html)
  const iframeRef = useRef(null)
  const transitionTimerRef = useRef(null)

  // Fade in on initial mount if cached html is available
  useEffect(() => {
    if (shownHtml) {
      requestAnimationFrame(() => requestAnimationFrame(() => setIframeOpacity(1)))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Crossfade when new html arrives from agent loop
  useEffect(() => {
    if (!html || html === shownHtmlRef.current) return
    clearTimeout(transitionTimerRef.current)
    setIframeOpacity(0)
    transitionTimerRef.current = setTimeout(() => {
      // Clear old iframe content to help GC before remounting
      if (iframeRef.current) iframeRef.current.srcdoc = ''
      shownHtmlRef.current = html
      setShownHtml(html)
      setShownKey(k => k + 1)
      requestAnimationFrame(() => requestAnimationFrame(() => setIframeOpacity(1)))
    }, 650)
  }, [html])

  useEffect(() => () => clearTimeout(transitionTimerRef.current), [])

  // Progress bar — reset animation key each new loading cycle
  const [progressKey, setProgressKey] = useState(0)
  const showProgress = status === 'loading' && shownHtml !== null
  useEffect(() => {
    if (status === 'loading' && shownHtmlRef.current !== null) {
      setProgressKey(k => k + 1)
    }
  }, [status])

  // Status bar visibility — always on when showing cache, show 5s on update/tap
  const [statusBarVisible, setStatusBarVisible] = useState(isFromCache)
  const statusTimerRef = useRef(null)
  const showStatusBar = useCallback(() => {
    setStatusBarVisible(true)
    clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => setStatusBarVisible(isFromCache), 5000)
  }, [isFromCache])

  // Keep status bar pinned while isFromCache; release pin when cache is superseded
  useEffect(() => {
    setStatusBarVisible((prev) => prev || isFromCache)
    if (!isFromCache) {
      clearTimeout(statusTimerRef.current)
      statusTimerRef.current = setTimeout(() => setStatusBarVisible(false), 5000)
    }
  }, [isFromCache])

  useEffect(() => {
    if (lastUpdated) showStatusBar()
  }, [lastUpdated, showStatusBar])

  useEffect(() => () => clearTimeout(statusTimerRef.current), [])

  // ── Render ──

  // STATE 1: No content yet — show loading animation (covers idle + loading)
  if (shownHtml === null && status !== 'error') {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#000',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: '#fff',
          animation: 'desk-bot-pulse 2s ease-in-out infinite',
        }} />
        <p style={{ color: '#fff', fontSize: 16, opacity: 0.6, marginTop: 16 }}>
          Desk Bot is thinking...
        </p>
      </div>
    )
  }

  // STATE 2: Error with no content to fall back on
  if (shownHtml === null && status === 'error') {
    return (
      <div
        onClick={refresh}
        style={{
          position: 'fixed', inset: 0, background: '#000', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 48, color: '#f59e0b' }}>⚠</span>
        <p style={{ color: '#fff', fontSize: 18, margin: '16px 0 0' }}>Something went wrong</p>
        <p style={{ color: '#fff', fontSize: 14, opacity: 0.5, margin: '8px 0 0' }}>{error}</p>
        <p style={{ color: '#fff', fontSize: 14, opacity: 0.4, margin: '24px 0 0' }}>Tap to retry</p>
      </div>
    )
  }

  // FALLBACK: Should not normally be reached, but guard anyway
  if (shownHtml === null) {
    return <FallbackClock onRetry={refresh} />
  }

  // STATE 3: Display
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: '#000' }}
      onClick={showStatusBar}
    >
      {/* Loading progress bar — overlaid on existing content */}
      {showProgress && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, zIndex: 10, overflow: 'hidden' }}>
          <div
            key={progressKey}
            style={{ height: '100%', background: 'rgba(255,255,255,0.35)', animation: 'progress-bar-fill 30s linear forwards' }}
          />
        </div>
      )}

      {/* AI-generated content iframe */}
      <iframe
        ref={iframeRef}
        key={shownKey}
        srcDoc={shownHtml}
        scrolling="no"
        sandbox="allow-scripts"
        title="desk-bot-display"
        style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          border: 'none', margin: 0, padding: 0,
          opacity: iframeOpacity,
          transition: 'opacity 0.6s ease-in-out',
        }}
      />

      {/* Invisible tap zone at bottom — catches taps through the iframe boundary */}
      <div
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, zIndex: 50 }}
        onClick={e => { e.stopPropagation(); showStatusBar() }}
      />

      <StatusBar
        visible={statusBarVisible}
        lastUpdated={lastUpdated}
        isFromCache={isFromCache}
        onRefresh={refresh}
        onOpenManage={onOpenManage}
      />
    </div>
  )
}

// ─── Display Screen (root) ───────────────────────────────────────────────────

const DisplayScreen = memo(function DisplayScreen({ onOpenManage, loop }) {
  return <DisplayContent loop={loop} onOpenManage={onOpenManage} />
})

export default DisplayScreen
