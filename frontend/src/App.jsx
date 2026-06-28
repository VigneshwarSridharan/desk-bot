import { useState, useEffect } from 'react'
import DisplayScreen from './components/DisplayScreen'
import ManagePanel from './components/ManagePanel'
import { useWakeLock } from './hooks/useWakeLock'
import { useAgentLoop } from './hooks/useAgentLoop'

export default function App() {
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  useWakeLock(!isPanelOpen)
  const loop = useAgentLoop()

  useEffect(() => {
    if (isPanelOpen) {
      loop.pause()
    } else {
      loop.resume()
    }
  }, [isPanelOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <DisplayScreen onOpenManage={() => setIsPanelOpen(true)} loop={loop} />
      {isPanelOpen && <ManagePanel onClose={() => setIsPanelOpen(false)} />}
    </>
  )
}
