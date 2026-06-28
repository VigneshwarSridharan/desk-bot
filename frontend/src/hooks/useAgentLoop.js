import { useState, useEffect, useRef, useCallback } from 'react'
import { triggerCycle, getLatestDisplay } from '../api/agent.js'

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000
const POLL_INTERVAL_MS = 3000

export function useAgentLoop() {
  const [state, setState] = useState({
    html: null,
    decision: null,
    contentType: null,
    status: 'idle',
    lastUpdated: null,
    error: null,
    isFromCache: false,
  })

  const isPausedRef = useRef(false)
  const [isPaused, setIsPaused] = useState(false)
  const pollTimerRef = useRef(null)
  const cycleTimerRef = useRef(null)
  const mountedRef = useRef(true)

  // Fetch latest from backend and update state
  const fetchLatest = useCallback(async () => {
    try {
      const data = await getLatestDisplay()
      if (!mountedRef.current || isPausedRef.current) return data

      if (data.html) {
        setState({
          html: data.html,
          decision: data.decision,
          contentType: data.contentType,
          status: data.generating ? 'loading' : 'success',
          lastUpdated: data.timestamp ? new Date(data.timestamp) : new Date(),
          error: null,
          isFromCache: !data.generating && !!data.html,
        })
      }
      return data
    } catch (err) {
      if (!mountedRef.current) return null
      setState((prev) => ({ ...prev, status: 'error', error: err.message }))
      return null
    }
  }, [])

  // Poll while generating, stop when done
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return
    pollTimerRef.current = setInterval(async () => {
      const data = await fetchLatest()
      if (!data?.generating) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }, POLL_INTERVAL_MS)
  }, [fetchLatest])

  // Kick off one cycle: set loading, trigger, then poll
  const runCycle = useCallback(async () => {
    if (isPausedRef.current) return
    setState((prev) => ({ ...prev, status: 'loading' }))
    try {
      await triggerCycle()
      startPolling()
    } catch (err) {
      if (!mountedRef.current) return
      setState((prev) => ({ ...prev, status: 'error', error: err.message }))
    }
  }, [startPolling])

  // Schedule the next regular cycle after intervalMs
  const scheduleNext = useCallback((intervalMs) => {
    cycleTimerRef.current = setTimeout(() => {
      runCycle().then(() => scheduleNext(intervalMs))
    }, intervalMs)
  }, [runCycle])

  useEffect(() => {
    mountedRef.current = true

    async function init() {
      // Show cached display immediately if one exists
      const data = await fetchLatest()

      // If backend is currently generating, start polling right away
      if (data?.generating) {
        startPolling()
      }

      // Kick off the first cycle (will skip if backend already in progress)
      if (!data?.generating) {
        await runCycle()
      }

      // Fetch cycle interval from settings (best-effort; default 10 min)
      let intervalMs = DEFAULT_INTERVAL_MS
      try {
        const { getSettings } = await import('../api/settings.js')
        const s = await getSettings()
        if (s?.cycleIntervalMinutes) intervalMs = Number(s.cycleIntervalMinutes) * 60 * 1000
      } catch { /* use default interval if settings unavailable */ }

      scheduleNext(intervalMs)
    }

    init()

    return () => {
      mountedRef.current = false
      clearInterval(pollTimerRef.current)
      clearTimeout(cycleTimerRef.current)
      pollTimerRef.current = null
      cycleTimerRef.current = null
    }
  }, [fetchLatest, runCycle, scheduleNext, startPolling])

  const refresh = useCallback(() => {
    clearTimeout(cycleTimerRef.current)
    cycleTimerRef.current = null
    runCycle()
  }, [runCycle])

  const pause = useCallback(() => {
    isPausedRef.current = true
    setIsPaused(true)
  }, [])

  const resume = useCallback(() => {
    if (!isPausedRef.current) return
    isPausedRef.current = false
    setIsPaused(false)
    refresh()
  }, [refresh])

  return { ...state, refresh, pause, resume, isPaused }
}
