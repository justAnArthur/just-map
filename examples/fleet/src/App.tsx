import { useCallback, useMemo, useRef, useState } from 'react'
import type { Fix } from 'just-map'
import type { JustMapEngine } from 'just-map/core'
import { Breadcrumbs, Tracks } from 'just-map/modules/data'
import type { BreadcrumbsOptions, TracksOptions } from 'just-map/modules/data'
import { FollowCam, Playback } from 'just-map/modules/animation'
import type { PlaybackHandle, PlaybackOptions } from 'just-map/modules/animation'
import { Navigation, Gestures } from 'just-map/modules/navigation'
import { Render } from 'just-map/modules/render'
import { Terrain } from 'just-map/modules/terrain'
import { JustMap } from 'just-map/react'
import { breadcrumbs, gpsTrip } from './data/gps'
import { trips } from './data/trips'
import { HISTORY_GROUPS, LIVE_VEHICLE } from './data/fleet'

const LIVE_DATA = [gpsTrip]
const HISTORY_DATA = trips
const NO_FIXES: Fix[] = []
const TRACK_COLOR = '#38bdf8'
const FIX_COLOR = '#fb923c'
const LIVE_STYLING = { glow: true, width: 6.5, dash: false }
const HISTORY_STYLING = { glow: true, width: 6.5, dash: true }
const FIT = { padding: 90, pitch: 58, maxZoom: 13.5, duration: 2000 }
const CAMERA = { center: gpsTrip.coords[0], zoom: 15.4, pitch: 62, bearing: -18 }

// the module set never changes after mount — only the options of Tracks/Breadcrumbs/Playback do
const RENDER = Render({ provider: 'satellite', dim: true })
const TERRAIN = Terrain({ exaggeration: 1.5, hillshade: true })
const FOLLOW_CAM = FollowCam({ pitch: 60, zoomFloor: 14 })
const GESTURES = Gestures({ rotate3d: { speed: 0.3, pitchStep: 0.25 } })
const NAVIGATION = Navigation()

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function App() {
  const [tab, setTab] = useState<'live' | 'history'>('live')
  const [selectedId, setSelectedId] = useState(HISTORY_DATA[0].id)
  const [playing, setPlaying] = useState(false)
  const [hist, setHist] = useState({ progress: 0, speed: 0 })
  const [live, setLive] = useState({ progress: 0, speed: 0 })

  const engineRef = useRef<JustMapEngine | null>(null)
  const lastEmit = useRef(0)

  const selectedTrip = HISTORY_DATA.find(t => t.id === selectedId) ?? HISTORY_DATA[0]

  const onLiveProgress = useCallback((progress: number, speed: number) => {
    const now = performance.now()
    if (now - lastEmit.current < 500) return
    lastEmit.current = now
    setLive({ progress, speed })
  }, [])

  const onLiveEnded = useCallback(() => {
    engineRef.current?.module<PlaybackHandle>('Playback')?.play()
  }, [])

  const onHistoryProgress = useCallback((progress: number, speed: number) => setHist({ progress, speed }), [])
  const onHistoryEnded = useCallback(() => setPlaying(false), [])

  const selectTrip = useCallback((id: string) => {
    setSelectedId(id)
    setPlaying(false)
    setHist({ progress: 0, speed: 0 })
  }, [])

  // fixes "reported so far" — sparse GPS fixes whose t is behind the vehicle
  const liveFixCount = breadcrumbs.filter(b => b.t <= live.progress * gpsTrip.durationSec).length
  const liveFixes = useMemo(() => breadcrumbs.slice(0, liveFixCount), [liveFixCount])
  const snapped = Math.floor(liveFixes.length / 10) * 10

  const tracksOptions = useMemo<TracksOptions>(
    () =>
      tab === 'live'
        ? { data: LIVE_DATA, color: TRACK_COLOR, selectedId: gpsTrip.id, styling: LIVE_STYLING, fit: false }
        : { data: HISTORY_DATA, color: TRACK_COLOR, selectedId, styling: HISTORY_STYLING, fit: FIT, onSelect: selectTrip },
    [tab, selectedId, selectTrip],
  )

  const crumbsOptions = useMemo<BreadcrumbsOptions>(
    () =>
      tab === 'live'
        ? { fixes: liveFixes, color: FIX_COLOR, visible: true }
        : { fixes: NO_FIXES, color: FIX_COLOR, visible: false },
    [tab, liveFixes],
  )

  const playbackOptions = useMemo<PlaybackOptions>(
    () =>
      tab === 'live'
        ? { track: gpsTrip, playing: true, progress: 0, follow: true, wallTime: 20, onProgress: onLiveProgress, onEnded: onLiveEnded }
        : { track: selectedTrip, playing, progress: hist.progress, follow: false, wallTime: 60, onProgress: onHistoryProgress, onEnded: onHistoryEnded },
    [tab, selectedTrip, playing, hist.progress, onLiveProgress, onLiveEnded, onHistoryProgress, onHistoryEnded],
  )

  const modules = useMemo(
    () => [
      RENDER,
      TERRAIN,
      { def: Tracks.def, options: tracksOptions },
      { def: Breadcrumbs.def, options: crumbsOptions },
      { def: Playback.def, options: playbackOptions },
      FOLLOW_CAM,
      GESTURES,
      NAVIGATION,
    ],
    [tracksOptions, crumbsOptions, playbackOptions],
  )

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          just-map <em>fleet</em>
        </span>
        <nav className="tabs">
          <button className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>
            Live
          </button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
            History
          </button>
        </nav>
        <span className="hint">Cmd/Ctrl + drag — rotate &amp; tilt</span>
      </header>

      <div className="body">
        {tab === 'history' && (
          <aside className="sidebar">
            <div className="scroll">
              {HISTORY_GROUPS.map(g => (
                <section key={g.id} className="vehicle">
                  <h3>
                    {g.plate} <span>{g.model}</span>
                  </h3>
                  {g.trips.map(t => (
                    <button
                      key={t.id}
                      className={'trip' + (t.id === selectedId ? ' on' : '')}
                      onClick={() => selectTrip(t.id)}
                    >
                      <strong>{t.name}</strong>
                      <span>
                        {t.startedLabel} · {t.distanceKm} km · {mmss(t.durationSec)}
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>

            <div className="transport">
              <div className="meta">
                <strong>{selectedTrip.name}</strong>
                <span>
                  {selectedTrip.plate} · {selectedTrip.startedLabel} · {selectedTrip.distanceKm} km
                </span>
              </div>
              <div className="controls">
                <button className="play" onClick={() => setPlaying(p => !p)}>
                  {playing ? 'Pause' : 'Play'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={hist.progress}
                  onChange={e => {
                    setPlaying(false)
                    setHist(h => ({ ...h, progress: +e.target.value }))
                  }}
                />
              </div>
              <div className="row">
                <span>{Math.round(hist.speed)} km/h</span>
                <span>
                  {mmss(hist.progress * selectedTrip.durationSec)} / {mmss(selectedTrip.durationSec)}
                </span>
              </div>
            </div>
          </aside>
        )}

        <main className="map">
          <JustMap modules={modules} camera={CAMERA} onReady={e => (engineRef.current = e)} />

          {tab === 'live' && (
            <div className="telemetry">
              <div className="head">
                <span className="plate">{LIVE_VEHICLE.plate}</span>
                <span className="model">{LIVE_VEHICLE.model}</span>
                <span className="live-dot">LIVE</span>
              </div>
              <dl>
                <div>
                  <dt>GPS fixes</dt>
                  <dd>{liveFixes.length}</dd>
                </div>
                <div>
                  <dt>Elapsed</dt>
                  <dd>{mmss(live.progress * gpsTrip.durationSec)}</dd>
                </div>
                <div>
                  <dt>Speed</dt>
                  <dd>{Math.round(live.speed)} km/h</dd>
                </div>
              </dl>
              <p className="snap">
                last snap: {snapped} fixes · match {Math.round(gpsTrip.confidence * 100)}%
              </p>
              <p className="legend">orange — raw fixes · cyan — road-matched</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
