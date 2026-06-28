import { useState, useEffect, useRef } from 'react'

export function useWakeLock(active) {
  const [isSupported] = useState(() => 'wakeLock' in navigator)
  const [isActive, setIsActive] = useState(false)
  const lockRef = useRef(null)

  async function acquire() {
    if (!isSupported) return
    try {
      lockRef.current = await navigator.wakeLock.request('screen')
      lockRef.current.addEventListener('release', () => setIsActive(false))
      setIsActive(true)
    } catch {
      setIsActive(false)
    }
  }

  async function release() {
    if (lockRef.current) {
      await lockRef.current.release()
      lockRef.current = null
    }
    setIsActive(false)
  }

  useEffect(() => {
    if (active) {
      acquire()
    } else {
      release()
    }
    return () => { release() }
  }, [active])

  useEffect(() => {
    if (!isSupported || !active) return
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [isSupported, active])

  return { isSupported, isActive }
}
