import { useCallback, useMemo, useState } from 'react'
import { JustMap } from 'just-map/react'
import type { JustMapEngine } from 'just-map/core'
import type { Track } from 'just-map'
import { fromGpsFixes } from 'just-map/matching'
import { Render } from 'just-map/modules/render'
import { Terrain } from 'just-map/modules/terrain'
import { Breadcrumbs, Tracks } from 'just-map/modules/data'
import { Gestures, Navigation } from 'just-map/modules/navigation'
import type { NavigationHandle } from 'just-map/modules/navigation'
import { breadcrumbs, GPS_TRIP_ID, gpsTrip, matchFocus } from './data/gps'

const COLOR_BY = { property: 'speed', palette: 'viridis' } as const
const STYLING = { glow: true, width: 6.5, dash: true }

type MatchState = {
  status: 'idle' | 'matching' | 'done' | 'error'
  confidence: number
  track: Track & { confidence: number }
  error: string
}

export default function App() {
  const [match, setMatch] = useState<MatchState>({
    status: 'idle',
    confidence: gpsTrip.confidence,
    track: gpsTrip,
    error: '',
  })
  const [showRaw, setShowRaw] = useState(true)

  const rematch = async () => {
    setMatch(m => ({ ...m, status: 'matching', error: '' }))
    try {
      const track = await fromGpsFixes(breadcrumbs, { id: GPS_TRIP_ID })
      setMatch({ status: 'done', confidence: track.confidence, track, error: '' })
    } catch (e) {
      setMatch(m => ({ ...m, status: 'error', error: e instanceof Error ? e.message : String(e) }))
    }
  }

  const tracks = useMemo(() => [match.track], [match.track])
  const modules = useMemo(
    () => [
      Render({ provider: 'satellite', dim: true }),
      Terrain({ exaggeration: 1.5 }),
      Tracks({ data: tracks, colorBy: COLOR_BY, selectedId: GPS_TRIP_ID, styling: STYLING }),
      Breadcrumbs({ fixes: breadcrumbs, visible: showRaw }),
      Navigation(),
      Gestures(),
    ],
    [tracks, showRaw],
  )

  const onReady = useCallback((engine: JustMapEngine) => {
    setTimeout(
      () =>
        engine
          .module<NavigationHandle>('Navigation')
          .easeTo({ center: matchFocus, zoom: 14.8, pitch: 62, duration: 2400 }),
      1200,
    )
  }, [])

  return (
    <div className="app">
      <JustMap modules={modules} onReady={onReady} />
      <aside className="card">
        <h1>From GPS dots to roads</h1>
        <p className="fixes">{breadcrumbs.length} fixes · one every ~20–35 s</p>
        <span className="badge">road-snapped · match {Math.round(match.confidence * 100)}%</span>
        <button onClick={rematch} disabled={match.status === 'matching'}>
          {match.status === 'matching' ? 'Matching…' : 'Re-match live (OSRM)'}
        </button>
        <label className="toggle">
          <input type="checkbox" checked={showRaw} onChange={e => setShowRaw(e.target.checked)} />
          show raw GPS fixes
        </label>
        {match.error && <p className="error">{match.error}</p>}
        <p className="note">
          Straight orange lines are what the tracker stored; the colored route is OSRM /match on the same fixes.
        </p>
      </aside>
    </div>
  )
}
