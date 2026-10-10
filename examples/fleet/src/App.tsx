import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Fix } from '@justanarthur/just-map'
import type { JustMapEngine } from '@justanarthur/just-map/core'
import { Breadcrumbs, Pins, Tracks, Vehicles, Zones } from '@justanarthur/just-map/modules/data'
import type { BreadcrumbsOptions, TracksOptions, VehiclesHandle } from '@justanarthur/just-map/modules/data'
import { FollowCam, Playback } from '@justanarthur/just-map/modules/animation'
import type { PlaybackHandle, PlaybackOptions } from '@justanarthur/just-map/modules/animation'
import { Navigation, Gestures } from '@justanarthur/just-map/modules/navigation'
import { Render } from '@justanarthur/just-map/modules/render'
import { Terrain } from '@justanarthur/just-map/modules/terrain'
import { JustMap } from '@justanarthur/just-map/react'
import { breadcrumbs, gpsTrip } from './data/gps'
import { trips } from './data/trips'
import { HISTORY_GROUPS, LIVE_VEHICLE } from './data/fleet'
import { FLEET_TRACKS, fleetAt, PINS, ZONES } from './data/overview'

const LIVE_DATA = [gpsTrip]
const HISTORY_DATA = trips
const NO_FIXES: Fix[] = []
const TRACK_COLOR = '#38bdf8'
const FIX_COLOR = '#fb923c'
const LIVE_STYLING = { glow: true, width: 6.5, dash: false }
const HISTORY_STYLING = { glow: true, width: 6.5, dash: true }
const FIT = { padding: 90, pitch: 58, maxZoom: 13.5, duration: 2000 }
const FLEET_IDLE = { width: 3, opacity: 0.75 }
const FLEET_TICK_MS = 2000
const CAMERA = { center: gpsTrip.coords[0], zoom: 15.4, pitch: 62, bearing: -18 }

// the module set never changes after mount — only the options of Tracks/Breadcrumbs/Playback do
const RENDER = Render({ provider: 'satellite', dim: true })
const TERRAIN = Terrain({ exaggeration: 1.5, hillshade: true })
const FOLLOW_CAM = FollowCam({ pitch: 60, zoomFloor: 14 })
const GESTURES = Gestures({ rotate3d: { speed: 0.3, pitchStep: 0.25 } })
const NAVIGATION = Navigation()

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function App() {
  const [tab, setTab] = useState<'live' | 'fleet' | 'history'>('live')
  const [selectedId, setSelectedId] = useState(HISTORY_DATA[0].id)
  const [playing, setPlaying] = useState(false)
  const [hist, setHist] = useState({ progress: 0, speed: 0 })
  const [live, setLive] = useState({ progress: 0, speed: 0 })
  const [tick, setTick] = useState(0)
  const [vehicleId, setVehicleId] = useState<string>()

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

  // the simulated fleet reports a new position every couple of seconds; Vehicles glides between them
  useEffect(() => {
    if (tab !== 'fleet') return
    engineRef.current?.module<VehiclesHandle>('Vehicles')?.fit(undefined, { padding: 120, maxZoom: 13 })
    const timer = window.setInterval(() => setTick(t => t + 1), FLEET_TICK_MS)
    return () => window.clearInterval(timer)
  }, [tab])

  const selectVehicle = useCallback((id: string) => {
    setVehicleId(id)
    engineRef.current?.module<VehiclesHandle>('Vehicles')?.flyTo(id, 15)
  }, [])

  const fleet = useMemo(() => fleetAt(tick), [tick])
  const selectedVehicle = fleet.find(v => v.id === vehicleId)

  // fixes "reported so far" — sparse GPS fixes whose t is behind the vehicle
  const liveFixCount = breadcrumbs.filter(b => b.t <= live.progress * gpsTrip.durationSec).length
  const liveFixes = useMemo(() => breadcrumbs.slice(0, liveFixCount), [liveFixCount])
  const snapped = Math.floor(liveFixes.length / 10) * 10

  const tracksOptions = useMemo<TracksOptions>(() => {
    if (tab === 'live')
      return { data: LIVE_DATA, color: TRACK_COLOR, selectedId: gpsTrip.id, styling: LIVE_STYLING, fit: false }
    if (tab === 'fleet')
      return { data: FLEET_TRACKS, color: TRACK_COLOR, styling: LIVE_STYLING, idle: FLEET_IDLE, fit: false }
    return { data: HISTORY_DATA, color: TRACK_COLOR, selectedId, styling: HISTORY_STYLING, fit: FIT, onSelect: selectTrip }
  }, [tab, selectedId, selectTrip])

  const vehicles = useMemo(
    () => Vehicles({ data: tab === 'fleet' ? fleet : [], selectedId: vehicleId, tween: 1800, onSelect: selectVehicle }),
    [tab, fleet, vehicleId, selectVehicle],
  )
  const zones = useMemo(() => Zones({ data: ZONES, visible: tab === 'fleet' }), [tab])
  const pins = useMemo(() => Pins({ data: PINS, visible: tab === 'fleet' }), [tab])

  const crumbsOptions = useMemo<BreadcrumbsOptions>(
    () =>
      tab === 'live'
        ? { fixes: liveFixes, color: FIX_COLOR, visible: true }
        : { fixes: NO_FIXES, color: FIX_COLOR, visible: false },
    [tab, liveFixes],
  )

  // the live vehicle keeps driving on the fleet tab, just without the follow camera
  const playbackOptions = useMemo<PlaybackOptions>(
    () =>
      tab !== 'history'
        ? {
            track: gpsTrip,
            playing: true,
            progress: 0,
            follow: tab === 'live',
            wallTime: 20,
            marker: 'arrow',
            onProgress: onLiveProgress,
            onEnded: onLiveEnded,
          }
        : { track: selectedTrip, playing, progress: hist.progress, follow: false, wallTime: 60, onProgress: onHistoryProgress, onEnded: onHistoryEnded },
    [tab, selectedTrip, playing, hist.progress, onLiveProgress, onLiveEnded, onHistoryProgress, onHistoryEnded],
  )

  const modules = useMemo(
    () => [
      RENDER,
      TERRAIN,
      zones,
      { def: Tracks.def, options: tracksOptions },
      { def: Breadcrumbs.def, options: crumbsOptions },
      pins,
      { def: Playback.def, options: playbackOptions },
      vehicles,
      FOLLOW_CAM,
      GESTURES,
      NAVIGATION,
    ],
    [zones, tracksOptions, crumbsOptions, pins, playbackOptions, vehicles],
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
          <button className={tab === 'fleet' ? 'on' : ''} onClick={() => setTab('fleet')}>
            Fleet
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
              <div className="jm-bar">
                <button className="jm-btn" onClick={() => setPlaying(p => !p)}>
                  {playing ? 'Pause' : 'Play'}
                </button>
                <input
                  className="jm-range"
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

          {tab === 'fleet' && (
            <div className="telemetry">
              <div className="head">
                <span className="plate">{selectedVehicle?.label ?? 'Fleet'}</span>
                <span className="model">{selectedVehicle?.status ?? `${fleet.length} vehicles`}</span>
              </div>
              <p className="legend">click a vehicle · dashed — zones · dots — stops &amp; alerts</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
