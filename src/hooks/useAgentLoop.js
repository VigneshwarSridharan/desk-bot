import { useState, useEffect, useRef } from 'react'
import { startLoop, runCycle } from '../agent/agentLoop'
import { getSettings } from '../store/settings'

const STORAGE_KEY = 'deskbot_last_html'

export function useAgentLoop() {
  const [state, setState] = useState(() => {
    const cached = localStorage.getItem(STORAGE_KEY)
    return {
      html: cached || null,
      decision: null,
      contentType: null,
      status: 'idle',
      lastUpdated: null,
      error: null,
      isFromCache: !!cached,
    }
  })

  const isPausedRef = useRef(false)
  const [isPaused, setIsPaused] = useState(false)
  const stopRef = useRef(null)

  // Always-current callbacks held in refs so the loop never closes over stale state
  const onResultRef = useRef(null)
  const onErrorRef = useRef(null)

  onResultRef.current = ({ html, decision, contentType }) => {
    if (isPausedRef.current) return
    localStorage.setItem(STORAGE_KEY, html)
    setState({ html, decision, contentType, status: 'success', lastUpdated: new Date(), error: null, isFromCache: false })
  }

  onErrorRef.current = (error) => {
    setState((prev) => ({ ...prev, status: 'error', error: error?.message || String(error) }))
  }

  useEffect(() => {
    setState((prev) => ({ ...prev, status: 'loading' }))
    const settings = getSettings()
    stopRef.current = startLoop(
      (...args) => onResultRef.current(...args),
      (...args) => onErrorRef.current(...args),
      settings.cycleIntervalMinutes || 10,
    )
    return () => stopRef.current?.()
  }, [])

  const refresh = () => {
    setState((prev) => ({ ...prev, status: 'loading' }))
    runCycle(
      (...args) => onResultRef.current(...args),
      (...args) => onErrorRef.current(...args),
    )
  }

  const pause = () => {
    isPausedRef.current = true
    setIsPaused(true)
  }

  const resume = () => {
    if (!isPausedRef.current) return
    isPausedRef.current = false
    setIsPaused(false)
    // Restart the interval loop so any interval change saved in Settings takes effect
    stopRef.current?.()
    const settings = getSettings()
    setState((prev) => ({ ...prev, status: 'loading' }))
    stopRef.current = startLoop(
      (...args) => onResultRef.current(...args),
      (...args) => onErrorRef.current(...args),
      settings.cycleIntervalMinutes || 10,
    )
  }

  return { ...state, refresh, pause, resume, isPaused }
}
