import { useState, useEffect } from 'react'

export default function FallbackClock({ onRetry }) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div
      onClick={onRetry}
      style={{
        position: 'fixed', inset: 0, background: '#000',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <div style={{ fontFamily: 'monospace', fontSize: 72, fontWeight: 300, color: '#fff', letterSpacing: '0.05em' }}>
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 18, color: 'rgba(255,255,255,0.5)', marginTop: 12 }}>
        {now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', marginTop: 48 }}>
        Tap to retry
      </div>
    </div>
  )
}
