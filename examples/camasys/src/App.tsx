import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JustMapEngine } from '@justanarthur/just-map/core'
import { Tracks } from '@justanarthur/just-map/modules/data'
import { Cars } from '@justanarthur/just-map/modules/models'
import type { CarsHandle } from '@justanarthur/just-map/modules/models'
import { Gestures, Navigation } from '@justanarthur/just-map/modules/navigation'
import { Drawing } from '@justanarthur/just-map/modules/render'
import { JustMap } from '@justanarthur/just-map/react'
import { FLEET, fleetAt, type VehicleState } from './data/fleet'
import { trips } from './data/trips'

const CAMERA = { center: [17.1062, 48.1428] as [number, number], zoom: 16.5, pitch: 52, bearing: -24, projection: 'mercator' as const }
const SPEEDS = [1, 3, 10]
const STATUS_LABEL = { driving: 'Driving', idle: 'Idle', stopped: 'Parked' }
const ROUTE_STYLING = { glow: false, width: 4, dash: false }
const ROUTE_IDLE = { opacity: 0 }

const GESTURES = Gestures({ rotate3d: { speed: 0.3, pitchStep: 0.25 } })
const NAVIGATION = Navigation()

const lerpAngle = (a: number, b: number, u: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * u

export default function App() {
  const [selectedId, setSelectedId] = useState<string>()
  const [follow, setFollow] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(0)
  const [edges, setEdges] = useState(true)
  const [grid, setGrid] = useState(true)
  const [outline, setOutline] = useState(true)
  const [fleet, setFleet] = useState<VehicleState[]>(() => fleetAt(0))

  const engineRef = useRef<JustMapEngine | null>(null)
  const live = useRef({ seconds: 0, speed: SPEEDS[0], follow: false, selectedId: undefined as string | undefined })
  live.current.speed = SPEEDS[speedIdx]
  live.current.follow = follow
  live.current.selectedId = selectedId

  // simulation loop: cars move every frame through the Cars handle, React only refreshes the panel at 4 Hz
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastPanel = 0
    let camBearing = CAMERA.bearing

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const s = live.current
      s.seconds += dt * s.speed

      const state = fleetAt(s.seconds)
      const engine = engineRef.current
      const cars = engine?.module<CarsHandle>('Cars')
      cars?.setData(state.map(v => v.car))

      const target = s.follow && state.find(v => v.vehicle.id === s.selectedId)
      if (engine && target) {
        camBearing = lerpAngle(camBearing, target.car.heading ?? 0, Math.min(1, dt * 2.5))
        engine.map.jumpTo({ center: target.car.coord, bearing: camBearing })
      } else if (engine) camBearing = engine.map.getBearing()

      if (now - lastPanel > 250) {
        lastPanel = now
        setFleet(state)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const select = useCallback((id: string | undefined) => {
    setSelectedId(id)
    if (!id) setFollow(false)
  }, [])

  const startFollow = useCallback(() => {
    if (!selectedId) return
    const car = engineRef.current?.module<CarsHandle>('Cars')?.get(selectedId)
    if (!car) return
    engineRef.current!.map.flyTo({ center: car.coord, zoom: 18.2, pitch: 64, bearing: car.heading, duration: 1400 })
    window.setTimeout(() => setFollow(true), 1400)
  }, [selectedId])

  const overview = useCallback(() => {
    setFollow(false)
    engineRef.current?.module<CarsHandle>('Cars')?.fit(undefined, { padding: 140, maxZoom: 15.5, duration: 1600 })
  }, [])

  const selected = fleet.find(v => v.vehicle.id === selectedId)

  const drawing = useMemo(() => Drawing({ edges, waterGrid: grid }), [edges, grid])
  const cars = useMemo(
    () => Cars({ tween: 0, selectedId, outline: outline ? '#2e353d' : false, labels: 'all', onSelect: select }),
    [selectedId, outline, select],
  )
  const tracks = useMemo(
    () =>
      Tracks({
        data: trips,
        color: '#1769e0',
        selectedId: selected?.vehicle.trip.id ?? '',
        styling: ROUTE_STYLING,
        idle: ROUTE_IDLE,
        fit: false,
      }),
    [selected?.vehicle.trip.id],
  )
  const modules = useMemo(() => [drawing, tracks, cars, GESTURES, NAVIGATION], [drawing, tracks, cars])

  const driving = fleet.filter(v => v.status === 'driving').length

  return (
    <div className="app">
      <JustMap modules={modules} camera={CAMERA} sky={false} antialias onReady={e => (engineRef.current = e)} />

      <aside className="panel">
        <header>
          <div className="brand">
            camasys<span>3D fleet · preview</span>
          </div>
          <div className="summary">
            <strong>{driving}</strong> driving · {FLEET.length} vehicles
          </div>
        </header>

        <ul className="list">
          {fleet.map(v => (
            <li key={v.vehicle.id}>
              <button className={v.vehicle.id === selectedId ? 'on' : ''} onClick={() => select(v.vehicle.id === selectedId ? undefined : v.vehicle.id)}>
                <i className={`dot ${v.status}`} />
                <span className="plate">{v.vehicle.plate}</span>
                <span className="model">{v.vehicle.model}</span>
                <span className="speed">{v.status === 'driving' ? `${Math.round(v.speed)} km/h` : STATUS_LABEL[v.status]}</span>
              </button>
            </li>
          ))}
        </ul>

        <footer>
          <div className="seg">
            {SPEEDS.map((s, i) => (
              <button key={s} className={i === speedIdx ? 'on' : ''} onClick={() => setSpeedIdx(i)}>
                {s}×
              </button>
            ))}
          </div>
          <button className="ghost" onClick={overview}>
            Overview
          </button>
        </footer>
      </aside>

      {selected && (
        <section className="card">
          <div className="head">
            <div>
              <div className="plate">{selected.vehicle.plate}</div>
              <div className="sub">
                {selected.vehicle.model} · {selected.vehicle.driver}
              </div>
            </div>
            <button className="close" onClick={() => select(undefined)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="speedo">
            <strong>{Math.round(selected.speed)}</strong>
            <span>km/h</span>
            <em className={selected.status}>{STATUS_LABEL[selected.status]}</em>
          </div>
          <div className="trip">
            <span>{selected.vehicle.trip.name}</span>
            <span>{Math.round(selected.progress * selected.vehicle.trip.distanceKm)} / {selected.vehicle.trip.distanceKm} km</span>
          </div>
          <div className="bar">
            <i style={{ width: `${selected.progress * 100}%` }} />
          </div>
          <div className="actions">
            {follow ? (
              <button onClick={() => setFollow(false)}>Stop following</button>
            ) : (
              <button className="primary" onClick={startFollow}>
                Follow
              </button>
            )}
          </div>
        </section>
      )}

      <div className="toggles">
        <label>
          <input type="checkbox" checked={edges} onChange={e => setEdges(e.target.checked)} /> Building edges
        </label>
        <label>
          <input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} /> Water grid
        </label>
        <label>
          <input type="checkbox" checked={outline} onChange={e => setOutline(e.target.checked)} /> Car outline
        </label>
      </div>
    </div>
  )
}
