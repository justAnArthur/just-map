import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { JustMap } from 'just-map/react'
import type { JustMapEngine, Projection } from 'just-map/core'
import { Render } from 'just-map/modules/render'
import { Buildings, Terrain } from 'just-map/modules/terrain'
import { Breadcrumbs, Tracks } from 'just-map/modules/data'
import type { ColorBy } from 'just-map/modules/data'
import { FollowCam, Playback } from 'just-map/modules/animation'
import { Gestures, Navigation } from 'just-map/modules/navigation'
import type { NavigationHandle } from 'just-map/modules/navigation'
import { Sidebar } from './Sidebar'
import { trips, type TripData } from './data/trips'
import { GPS_TRIP_ID, breadcrumbs, gpsTrip, matchFocus } from './data/gps'

// The map-matching demo trip opens the show: raw GPS dots vs. road-snapped route.
const ALL_TRIPS: Array<TripData & { confidence?: number }> = [...trips, gpsTrip]

// reference-stable option blobs (module options are diffed by reference)
const COLOR_BY: ColorBy = { property: 'speed', palette: 'viridis', max: 130 }
const TRACK_STYLING = { glow: true, width: 6.5, dash: true }
const TRACK_FIT = { padding: 90, pitch: 58, maxZoom: 13.5, duration: 2000 }
const ROTATE3D = { speed: 0.3, pitchStep: 0.25 }

const HERO: [number, number] = [20.055, 49.115]
const PEAKS = { center: HERO, zoom: 12.6, pitch: 70, bearing: -32, duration: 3200 }
const MATCH_FOCUS_VIEW = { center: matchFocus, zoom: 14.8, pitch: 62, duration: 2400 }

export type LayerSettings = {
  globe: boolean
  terrain: boolean
  buildings: boolean
  dim: boolean
  exaggeration: number
}

export default function App() {
  const [selectedId, setSelectedId] = useState(GPS_TRIP_ID)
  const [playing, setPlaying] = useState(false)
  const [follow, setFollow] = useState(true)
  const [progress, setProgress] = useState(0)
  const [curSpeed, setCurSpeed] = useState(0)
  const [showRaw, setShowRaw] = useState(true)
  const [flyNonce, setFlyNonce] = useState(0)
  const [layers, setLayers] = useState<LayerSettings>({
    globe: true,
    terrain: true,
    buildings: true,
    dim: true,
    exaggeration: 1.8,
  })
  const [engine, setEngine] = useState<JustMapEngine | null>(null)

  const onSelect = useCallback((id: string) => {
    setSelectedId(id)
    setPlaying(false)
    setProgress(0)
  }, [])
  const onProgress = useCallback((p: number, s: number) => {
    setProgress(p)
    setCurSpeed(s)
  }, [])
  const onEnded = useCallback(() => setPlaying(false), [])

  const selected = ALL_TRIPS.find(t => t.id === selectedId) ?? ALL_TRIPS[0]
  const crumbsVisible = showRaw && selectedId === GPS_TRIP_ID

  const camera = useMemo(
    () => ({
      center: HERO,
      zoom: 12.6,
      pitch: 70,
      bearing: -32,
      projection: (layers.globe ? 'globe' : 'mercator') as Projection,
    }),
    [layers.globe],
  )

  const modules = useMemo(
    () => [
      Render({ dim: layers.dim }),
      Terrain({ exaggeration: layers.exaggeration, hillshade: layers.terrain }),
      Buildings(),
      Tracks({
        data: ALL_TRIPS,
        colorBy: COLOR_BY,
        selectedId,
        onSelect,
        styling: TRACK_STYLING,
        fit: TRACK_FIT,
      }),
      Breadcrumbs({ fixes: breadcrumbs, visible: crumbsVisible }),
      Playback({ track: selected, playing, progress, follow, onProgress, onEnded }),
      FollowCam(),
      Gestures({ rotate3d: ROTATE3D }),
      Navigation(),
    ],
    [layers.dim, layers.exaggeration, layers.terrain, selectedId, onSelect, crumbsVisible, selected, playing, progress, follow, onProgress, onEnded],
  )

  // For the GPS trip, glide in on the worst corner-cut once the selection fit settles.
  useEffect(() => {
    if (!engine || selectedId !== GPS_TRIP_ID) return
    const timer = window.setTimeout(
      () => engine.module<NavigationHandle>('Navigation')?.easeTo(MATCH_FOCUS_VIEW),
      1700,
    )
    return () => window.clearTimeout(timer)
  }, [engine, selectedId])

  useEffect(() => {
    if (!engine || !flyNonce) return
    engine.module<NavigationHandle>('Navigation')?.flyTo(PEAKS)
  }, [engine, flyNonce])

  // Toggles the module options don't cover: terrain elevation and building extrusions.
  const prevLayers = useRef(layers)
  useEffect(() => {
    if (!engine) return
    const prev = prevLayers.current
    prevLayers.current = layers
    if (prev.terrain !== layers.terrain)
      engine.map.setTerrain(layers.terrain ? { source: 'terrain', exaggeration: layers.exaggeration } : null)
    if (prev.buildings !== layers.buildings)
      engine.map.setLayoutProperty('terrain-buildings', 'visibility', layers.buildings ? 'visible' : 'none')
  }, [engine, layers])

  return (
    <div className="app">
      <Sidebar
        trips={ALL_TRIPS}
        selectedId={selectedId}
        onSelect={onSelect}
        playing={playing}
        onTogglePlay={() => setPlaying(v => !v)}
        follow={follow}
        onToggleFollow={() => setFollow(v => !v)}
        progress={progress}
        onSeek={p => {
          setPlaying(false)
          setProgress(p)
        }}
        curSpeed={curSpeed}
        layers={layers}
        onLayers={setLayers}
        onFlyToPeaks={() => setFlyNonce(n => n + 1)}
        showRaw={showRaw}
        onToggleRaw={() => setShowRaw(v => !v)}
      />
      <div className="map-wrap">
        <JustMap
          className="map-container"
          modules={modules}
          camera={camera}
          onReady={setEngine}
          onRemove={() => setEngine(null)}
        />
        <div className="map-hint">⌘ + drag — rotate &amp; tilt</div>
      </div>
    </div>
  )
}
