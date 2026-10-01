import { useCallback, useMemo, useState } from 'react'
import type { CameraOptions, Coord } from '@justanarthur/just-map'
import { JustMap } from '@justanarthur/just-map/react'
import { Render } from '@justanarthur/just-map/modules/render'
import { Terrain } from '@justanarthur/just-map/modules/terrain'
import { Tracks } from '@justanarthur/just-map/modules/data'
import { FollowCam, Playback } from '@justanarthur/just-map/modules/animation'
import { Gestures, Navigation } from '@justanarthur/just-map/modules/navigation'
import { trips } from './data/trips'

const trip = trips.find(t => t.id === 'TR-2414')!

const CAMERA: CameraOptions = {
  center: [20.055, 49.115],
  zoom: 12.6,
  pitch: 70,
  bearing: -32,
  projection: 'globe',
}

const DATA = [trip]
const COLOR_BY = { property: 'speed', palette: ['#7c3aed', '#2563eb', '#06b6d4', '#22c55e', '#facc15'], max: 130 }
const STYLING = { glow: true, width: 6, dash: false }
const ROTATE3D = { speed: 0.3, pitchStep: 0.25 }

const distKm = (a: Coord, b: Coord) => {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
const lengthKm = (coords: Coord[]) => coords.reduce((sum, c, i) => sum + (i ? distKm(coords[i - 1], c) : 0), 0)

const KM = Math.round(lengthKm(trip.coords))
const SEC = trip.times[trip.times.length - 1]
const DURATION = `${Math.floor(SEC / 3600)} h ${String(Math.round((SEC % 3600) / 60)).padStart(2, '0')} min`

export function App() {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [follow, setFollow] = useState(true)
  const [exaggeration, setExaggeration] = useState(2.2)

  const onProgress = useCallback((p: number) => setProgress(p), [])
  const onEnded = useCallback(() => setPlaying(false), [])

  const modules = useMemo(
    () => [
      Render({ provider: 'satellite', dim: true }),
      Terrain({ exaggeration, hillshade: true, hillshadeExaggeration: 0.45 }),
      Tracks({ data: DATA, colorBy: COLOR_BY, selectedId: trip.id, styling: STYLING }),
      Playback({ track: trip, playing, progress, follow, onProgress, onEnded }),
      FollowCam({ pitch: 62, zoomFloor: 13 }),
      Gestures({ rotate3d: ROTATE3D }),
      Navigation(),
    ],
    [playing, progress, follow, exaggeration, onProgress, onEnded],
  )

  const scrub = (p: number) => {
    setPlaying(false)
    setProgress(p)
  }

  return (
    <>
      <JustMap modules={modules} camera={CAMERA} sky="day" />

      <div className="card">
        <header>
          <h1>{trip.name}</h1>
          <span className="sub">
            {trip.id} · {trip.model}
          </span>
        </header>

        <div className="stats">
          <span>
            <b>{KM}</b> km
          </span>
          <span>
            <b>{DURATION}</b>
          </span>
        </div>

        <div className="row">
          <button onClick={() => setPlaying(p => !p)}>{playing ? '❚❚' : '▶'}</button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={progress}
            onChange={e => scrub(+e.target.value)}
          />
          <button className={follow ? 'on' : ''} onClick={() => setFollow(f => !f)}>
            Follow
          </button>
        </div>

        <div className="row relief">
          <span>
            relief <b>×{exaggeration.toFixed(1)}</b>
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={exaggeration}
            onChange={e => setExaggeration(+e.target.value)}
          />
        </div>
      </div>

      <div className="hint">⌘ + drag — rotate &amp; tilt the mountains</div>
    </>
  )
}
