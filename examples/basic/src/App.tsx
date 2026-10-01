import { useEffect, useState } from 'react'
import type { CameraOptions } from 'just-map'
import type { JustMapEngine } from 'just-map/core'
import { JustMap } from 'just-map/react'
import { Render, Style, type StyleTweak } from 'just-map/modules/render'
import { Terrain } from 'just-map/modules/terrain'
import { Navigation } from 'just-map/modules/navigation'

type MapType = 'map' | 'hybrid' | 'satellite'
type Base = 'positron' | 'liberty' | 'bright'

const CAMERA: CameraOptions = { center: [17.1077, 48.1486], zoom: 12.4, projection: 'mercator', pitch: 0 }

const Btn = ({ on, onClick, children }: { on?: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button className={on ? 'btn on' : 'btn'} onClick={onClick}>
    {children}
  </button>
)

export default function App() {
  const [mapType, setMapType] = useState<MapType>('map')
  const [base, setBase] = useState<Base>('positron')
  const [hideLabels, setHideLabels] = useState(false)
  const [blueWater, setBlueWater] = useState(false)
  const [is3d, setIs3d] = useState(false)
  const [engine, setEngine] = useState<JustMapEngine | null>(null)

  const tweaks = [
    hideLabels && { match: /label|name/, visibility: 'none' as const },
    blueWater && { match: 'water', paint: { 'fill-color': '#aadaff' } },
  ].filter(Boolean) as StyleTweak[]

  // fixed module set — Map/Hybrid/Satellite/3D are pure option changes
  const modules = [
    Render({ provider: 'satellite', dim: true, visible: mapType !== 'map' }),
    Style({
      base,
      hybrid: mapType === 'hybrid',
      visible: mapType !== 'satellite',
      tweaks,
    }),
    Terrain({ enabled: is3d, exaggeration: 1.6, hillshade: true }),
    Navigation(),
  ]

  useEffect(() => {
    if (!engine) return
    ;(window as any).__map = engine
    engine.module<{ easeTo(v: { pitch: number; duration: number }): void }>('Navigation')?.easeTo({
      pitch: is3d ? 58 : 0,
      duration: 1200,
    })
  }, [engine, is3d])

  return (
    <div className="app">
      <JustMap modules={modules} camera={CAMERA} sky={false} onReady={setEngine} onRemove={() => setEngine(null)} />

      <div className="card">
        <h1>just-map · styles</h1>

        <div className="row">
          {(['map', 'hybrid', 'satellite'] as MapType[]).map(t => (
            <Btn key={t} on={mapType === t} onClick={() => setMapType(t)}>
              {t}
            </Btn>
          ))}
        </div>

        <div className="row">
          {(['positron', 'liberty', 'bright'] as Base[]).map(b => (
            <Btn key={b} on={base === b} onClick={() => setBase(b)}>
              {b}
            </Btn>
          ))}
        </div>

        <label>
          <input type="checkbox" checked={hideLabels} onChange={e => setHideLabels(e.target.checked)} /> hide labels
        </label>
        <label>
          <input type="checkbox" checked={blueWater} onChange={e => setBlueWater(e.target.checked)} /> blue water
        </label>
        <label>
          <input type="checkbox" checked={is3d} onChange={e => setIs3d(e.target.checked)} /> 3D terrain
        </label>
      </div>
    </div>
  )
}
