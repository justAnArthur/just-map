import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { JustMap } from '@justanarthur/just-map/react'
import { themeVars, type JustMapTheme } from '@justanarthur/just-map/core'
import { flat } from '@justanarthur/just-map/presets'
import { Markers, ZoneEditor } from '@justanarthur/just-map/modules/data'
import type { Coord } from '@justanarthur/just-map'

const OFFICE: Coord = [17.1077, 48.1486]
const DEPOT: Coord = [17.146, 48.175]
const PARKING: Coord = [17.071, 48.121]

// one accent drives the theme AND the zone color — everything follows
const ACCENTS = ['#2563eb', '#dc2626', '#16a34a']

// reference-stable option blobs (module options are diffed by reference)
const POINTS = [
  { coord: OFFICE, label: 'Office', popup: 'HQ — Obchodná 1' },
  { coord: DEPOT, color: ACCENTS[1], label: 'Depot', popup: 'Service depot' },
  { coord: PARKING, color: ACCENTS[2], label: 'Parking', popup: 'Long-term parking' },
]
const MARKERS = Markers({ points: POINTS, fit: { padding: 60, maxZoom: 14 } })
const BASE = flat().modules
const CAMERA = { ...flat().camera, center: OFFICE, zoom: 12.6 }

const INITIAL_RING: Coord[] = [
  [17.098, 48.156],
  [17.121, 48.158],
  [17.124, 48.141],
  [17.104, 48.138],
]

type History = { past: Coord[][]; ring: Coord[]; future: Coord[][] }

export default function App() {
  const [{ past, ring, future }, setHist] = useState<History>({
    past: [],
    ring: INITIAL_RING,
    future: [],
  })
  const [readonly, setReadonly] = useState(false)
  const [accent, setAccent] = useState(ACCENTS[0])

  const theme = useMemo<JustMapTheme>(() => ({ accent }), [accent])
  // the engine themes the map container; hoisting the same vars themes the sidebar bars too
  const pageVars = themeVars(theme) as CSSProperties

  // one history entry per editor commit (drag end / insert / delete)
  const commit = useCallback((next: Coord[]) => {
    setHist(h => ({ past: [...h.past, h.ring], ring: next, future: [] }))
  }, [])

  const undo = useCallback(() => {
    setHist(h =>
      h.past.length
        ? { past: h.past.slice(0, -1), ring: h.past[h.past.length - 1], future: [h.ring, ...h.future] }
        : h,
    )
  }, [])

  const redo = useCallback(() => {
    setHist(h =>
      h.future.length ? { past: [...h.past, h.ring], ring: h.future[0], future: h.future.slice(1) } : h,
    )
  }, [])

  const removeLast = useCallback(() => {
    setHist(h => ({ past: [...h.past, h.ring], ring: h.ring.slice(0, -1), future: [] }))
  }, [])

  const clear = useCallback(() => commit([]), [commit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) undo()
      else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) redo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const modules = useMemo(
    () => [...BASE, MARKERS, { def: ZoneEditor.def, options: { ring, readonly, color: accent, onChange: commit } }],
    [ring, readonly, accent, commit],
  )

  return (
    <div className="app" style={pageVars}>
      <div className="sidebar">
        <h1>Geofence zone</h1>
        <p>
          Click the map to insert a vertex into the nearest edge, drag vertices to reshape, click a
          vertex to delete it. ⌘/Ctrl+Z / Y for undo &amp; redo.
        </p>

        <div className="jm-bar">
          <button className="jm-btn" onClick={undo} disabled={!past.length} aria-label="Undo">
            ↶
          </button>
          <button className="jm-btn" onClick={redo} disabled={!future.length} aria-label="Redo">
            ↷
          </button>
          <button className="jm-btn" onClick={removeLast} disabled={!ring.length || readonly}>
            Remove last
          </button>
          <button className="jm-btn" onClick={clear} disabled={!ring.length || readonly}>
            Clear
          </button>
        </div>

        <div className="jm-bar">
          <button
            className={readonly ? 'jm-btn active' : 'jm-btn'}
            onClick={() => setReadonly(v => !v)}
          >
            Readonly
          </button>
        </div>

        <div className="jm-bar">
          {ACCENTS.map(c => (
            <button
              key={c}
              className={accent === c ? 'jm-btn active' : 'jm-btn'}
              style={{ color: c }}
              onClick={() => setAccent(c)}
              aria-label={`accent ${c}`}
            >
              ●
            </button>
          ))}
        </div>

        <p>
          {ring.length} vertices — {ring.length >= 3 ? 'valid polygon' : 'click 3+ points to close a zone'}
        </p>
      </div>

      <div className="map-wrap">
        <JustMap className="map-container" modules={modules} camera={CAMERA} theme={theme} />
        <div className="map-hint jm-pill">dots open popups — try them</div>
      </div>
    </div>
  )
}
