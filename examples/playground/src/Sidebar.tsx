import { type TripData } from './data/trips'
import type { LayerSettings } from './App'

// Viridis-like speed scale for the sidebar chrome (the map gradient lives in the Tracks module).
const UI_STOPS: Array<[number, string]> = [
  [0, '#b07cd8'],
  [25, '#7f9ce0'],
  [50, '#3ec4bf'],
  [80, '#6fd36f'],
  [110, '#fde725'],
  [135, '#fde725'],
]

function speedUiColor(speedKmh: number): string {
  const v = Math.min(UI_STOPS[UI_STOPS.length - 1][0], Math.max(0, speedKmh))
  let i = 1
  while (i < UI_STOPS.length - 1 && UI_STOPS[i][0] < v) i++
  const [v0, c0] = UI_STOPS[i - 1]
  const [v1, c1] = UI_STOPS[i]
  const u = (v - v0) / (v1 - v0 || 1)
  const [r0, g0, b0] = [1, 3, 5].map(k => parseInt(c0.slice(k, k + 2), 16))
  const [r1, g1, b1] = [1, 3, 5].map(k => parseInt(c1.slice(k, k + 2), 16))
  const ch = (a: number, b: number) => Math.round(a + (b - a) * u)
  return `rgb(${ch(r0, r1)}, ${ch(g0, g1)}, ${ch(b0, b1)})`
}

function cssGradient(colors: string[]): string {
  return `linear-gradient(to right, ${colors.map((c, i) => `${c} ${(i / (colors.length - 1)) * 100}%`).join(', ')})`
}

type Props = {
  trips: Array<TripData & { confidence?: number }>
  selectedId: string
  onSelect: (id: string) => void
  playing: boolean
  onTogglePlay: () => void
  follow: boolean
  onToggleFollow: () => void
  progress: number
  onSeek: (p: number) => void
  curSpeed: number
  layers: LayerSettings
  onLayers: (l: LayerSettings) => void
  onFlyToPeaks: () => void
  showRaw: boolean
  onToggleRaw: () => void
}

function fmtDur(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function tripGradient(trip: TripData) {
  const stride = Math.max(1, Math.ceil(trip.speeds.length / 24))
  const colors: string[] = []
  for (let i = 0; i < trip.speeds.length; i += stride) colors.push(speedUiColor(trip.speeds[i]))
  colors.push(speedUiColor(trip.speeds[trip.speeds.length - 1]))
  return cssGradient(colors)
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="switch-track" />
      <span className="switch-label">{label}</span>
    </label>
  )
}

export function Sidebar(p: Props) {
  const selected = p.trips.find(t => t.id === p.selectedId) ?? p.trips[0]

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <h1>Fleet trips · just-map playground</h1>
        <p>
          Satellite imagery on 3D terrain · real road geometry (OSRM) · GPS-style telemetry ·
          raw tracker dots road-snapped via map matching. The trips demo rebuilt from
          just-map modules.
        </p>
      </header>

      <section className="trips">
        {p.trips.map(t => (
          <button
            key={t.id}
            className={`trip-card ${t.id === p.selectedId ? 'selected' : ''}`}
            onClick={() => p.onSelect(t.id)}
          >
            <div className="trip-top">
              <span className="trip-id">{t.id}</span>
              <span className="trip-date">{t.startedLabel}</span>
            </div>
            <div className="trip-name">{t.name}</div>
            <div className="trip-plate">
              {t.plate} · {t.model}
            </div>
            <div className="trip-stats">
              <span>{t.distanceKm} km</span>
              <span>{Math.round(t.durationSec / 60)} min</span>
              <span>Ø {t.avgSpeed} km/h</span>
              <span>max {Math.round(t.maxSpeed)}</span>
            </div>
            <div className="trip-spark" style={{ background: tripGradient(t) }} />
            {t.confidence !== undefined && (
              <div className="trip-conf">road-snapped · OSRM match {Math.round(t.confidence * 100)}%</div>
            )}
          </button>
        ))}
      </section>

      <section className="panel">
        <h2>Playback</h2>
        <div className="playback-row">
          <button className="play-btn" onClick={p.onTogglePlay} title={p.playing ? 'Pause' : 'Play'}>
            {p.playing ? '❚❚' : '▶'}
          </button>
          <div className="speed-badge">
            <span className="speed-value" style={{ color: speedUiColor(p.curSpeed) }}>
              {Math.round(p.curSpeed)}
            </span>
            <span className="speed-unit">km/h</span>
          </div>
          <button
            className={`follow-btn ${p.follow ? 'on' : ''}`}
            onClick={p.onToggleFollow}
            title="Camera follows the vehicle"
          >
            ⦿ Follow
          </button>
        </div>
        <input
          className="slider"
          type="range"
          min={0}
          max={1000}
          value={Math.round(p.progress * 1000)}
          onChange={e => p.onSeek(Number(e.target.value) / 1000)}
        />
        <div className="time-row">
          <span>{fmtDur(p.progress * selected.durationSec)}</span>
          <span>{fmtDur(selected.durationSec)}</span>
        </div>
      </section>

      <section className="panel">
        <h2>Layers</h2>
        <Switch checked={p.showRaw} onChange={p.onToggleRaw} label="Raw GPS track (camasys today)" />
        <button className="fly-btn" onClick={p.onFlyToPeaks}>
          🏔 Fly to Tatras peaks — see the 3D terrain
        </button>
        <Switch
          checked={p.layers.globe}
          onChange={v => p.onLayers({ ...p.layers, globe: v })}
          label="Globe projection"
        />
        <Switch
          checked={p.layers.terrain}
          onChange={v => p.onLayers({ ...p.layers, terrain: v })}
          label="3D terrain"
        />
        <Switch
          checked={p.layers.buildings}
          onChange={v => p.onLayers({ ...p.layers, buildings: v })}
          label="3D buildings (OSM)"
        />
        <Switch
          checked={p.layers.dim}
          onChange={v => p.onLayers({ ...p.layers, dim: v })}
          label="Dim imagery"
        />
        <div className={`exag-row ${p.layers.terrain ? '' : 'disabled'}`}>
          <span>Relief ×{p.layers.exaggeration.toFixed(1)}</span>
          <input
            className="slider"
            type="range"
            min={5}
            max={25}
            value={Math.round(p.layers.exaggeration * 10)}
            disabled={!p.layers.terrain}
            onChange={e => p.onLayers({ ...p.layers, exaggeration: Number(e.target.value) / 10 })}
          />
        </div>
      </section>

      <section className="panel legend">
        <h2>Speed along route</h2>
        <div
          className="legend-bar"
          style={{ background: cssGradient(['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']) }}
        />
        <div className="legend-ticks">
          <span>0</span>
          <span>50</span>
          <span>100</span>
          <span>130+ km/h</span>
        </div>
      </section>

      <footer className="sidebar-footer">
        Map data © OpenStreetMap contributors · Tiles: OpenFreeMap · Routing &amp; map matching:
        OSRM · Imagery: Esri · Terrain: AWS Open Data
      </footer>
    </aside>
  )
}
