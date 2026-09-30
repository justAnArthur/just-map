import maplibregl from 'maplibre-gl'
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  MapLayerMouseEvent,
} from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import { paletteSampler } from '../../utils/colors'
import type { Palette } from '../../utils/colors'
import { distanceFractions } from '../../utils/geo'
import type { Coord, Track } from '../../utils/types'

/** how each track's gradient is colored */
export type ColorBy = {
  /** `'speed'` reads `track.speeds`; anything else reads `track.properties[i][property]` */
  property: string | 'speed'
  /** `'viridis'` or a list of hex colors */
  palette: Palette
  /** values are clamped to this before sampling the palette (default 130) */
  max?: number
}

type Fit = { padding: number; pitch: number; maxZoom: number; duration: number }

const DEFAULT_FIT: Fit = { padding: 90, pitch: 58, maxZoom: 13.5, duration: 2000 }

/** options for `Tracks` */
export type TracksOptions = {
  data: Track[]
  /** omit for a single uniform color */
  colorBy?: ColorBy
  /** used when no `colorBy` */
  color: string
  selectedId?: string
  styling: { glow: boolean; width: number; dash: boolean }
  /** camera fit on selection; `false` disables */
  fit: Fit | false
  onSelect?(id: string): void
}

/** imperative handle for `Tracks` (`engine.module<TracksHandle>('Tracks')`) */
export type TracksHandle = {
  select(id: string): void
  setData(data: Track[]): void
  fit(id?: string): void
}

type TracksState = TracksHandle & {
  options: TracksOptions
  timer: number
  onClick(e: MapLayerMouseEvent): void
  onMove(): void
}

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] }
const CLICK_LAYERS = ['tracks-idle', 'tracks-active']
const DASH_FRAMES = [
  [0, 4, 3],
  [0.5, 3.5, 3],
  [1, 3, 3],
  [0.5, 3.5, 3],
]

const isSel = (id: string): FilterSpecification => ['==', ['get', 'trackId'], id]
const notSel = (id: string): FilterSpecification => ['!=', ['get', 'trackId'], id]

const glowLayer = (sel: string): LineLayerSpecification => ({
  id: 'tracks-glow',
  type: 'line',
  source: 'tracks',
  filter: isSel(sel),
  paint: { 'line-color': '#38bdf8', 'line-width': 18, 'line-blur': 12, 'line-opacity': 0.5 },
  layout: { 'line-cap': 'round', 'line-join': 'round' },
})

const dashLayer = (sel: string): LineLayerSpecification => ({
  id: 'tracks-dash',
  type: 'line',
  source: 'tracks',
  filter: isSel(sel),
  paint: { 'line-color': '#f8fafc', 'line-width': 2.2, 'line-opacity': 0.9, 'line-dasharray': [0, 4, 3] },
})

const collection = (tracks: Track[]) => ({
  type: 'FeatureCollection' as const,
  features: tracks.map(t => ({
    type: 'Feature' as const,
    properties: { trackId: t.id },
    geometry: { type: 'LineString' as const, coordinates: t.coords },
  })),
})

const endpointsData = (t: Track | undefined) => {
  if (!t?.coords.length) return EMPTY_FC
  const point = (kind: string, coord: Coord) => ({
    type: 'Feature' as const,
    properties: { kind },
    geometry: { type: 'Point' as const, coordinates: coord },
  })
  return {
    type: 'FeatureCollection' as const,
    features: [point('start', t.coords[0]), point('end', t.coords[t.coords.length - 1])],
  }
}

// line-gradient needs strictly increasing progress stops with a color per vertex,
// strided to <=300 stops and rounded to 1e-6 so no two positions collide
function gradient(t: Track, colorBy: ColorBy): ExpressionSpecification {
  const sample = paletteSampler(colorBy.palette)
  const max = colorBy.max ?? 130
  const value = (i: number) =>
    colorBy.property === 'speed' ? t.speeds?.[i] ?? 0 : t.properties?.[i]?.[colorBy.property] ?? 0
  const color = (i: number) => sample(Math.min(1, Math.max(0, value(i) / max)))

  const fracs = distanceFractions(t.coords)
  const stride = Math.max(1, Math.ceil(t.coords.length / 300))
  const stops: unknown[] = [0, color(0)]
  let last = 0
  for (let i = stride; i < t.coords.length; i += stride) {
    const f = Math.round(fracs[i] * 1e6) / 1e6
    if (f <= last || f >= 1) continue
    last = f
    stops.push(f, color(i))
  }
  stops.push(1, color(t.coords.length - 1))
  return ['interpolate', ['linear'], ['line-progress'], ...stops] as ExpressionSpecification
}

function fitTrack(map: maplibregl.Map, t: Track, fit: Fit | false) {
  const f = fit === false ? DEFAULT_FIT : fit
  const bounds = t.coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds())
  map.fitBounds(bounds, { padding: f.padding, pitch: f.pitch, bearing: -18, maxZoom: f.maxZoom, duration: f.duration })
}

function applySelection(map: maplibregl.Map, options: TracksOptions, id: string | undefined, withFit: boolean) {
  const sel = id ?? ''
  map.setFilter('tracks-idle', notSel(sel))
  for (const layer of ['tracks-glow', 'tracks-active', 'tracks-dash'])
    if (map.getLayer(layer)) map.setFilter(layer, isSel(sel))

  const t = options.data.find(track => track.id === id)
  map.setPaintProperty('tracks-active', 'line-gradient', t && options.colorBy ? gradient(t, options.colorBy) : null)
  ;(map.getSource('tracks-endpoints') as GeoJSONSource).setData(endpointsData(t))

  if (withFit && t && options.fit !== false) fitTrack(map, t, options.fit)
}

/**
 * Colored route tracks with selection, gradient speed/property coloring,
 * start/end markers and an animated marching-dash overlay.
 */
export const Tracks = module<TracksOptions>({
  name: 'Tracks',
  defaults: {
    data: [],
    color: '#38bdf8',
    styling: { glow: true, width: 6.5, dash: true },
    fit: DEFAULT_FIT,
  },

  create(engine: JustMapEngine, options: TracksOptions) {
    const map = engine.map

    map.addSource('tracks', { type: 'geojson', lineMetrics: true, data: collection(options.data) })
    map.addSource('tracks-endpoints', { type: 'geojson', data: EMPTY_FC })

    const sel = options.selectedId ?? ''
    map.addLayer({
      id: 'tracks-idle',
      type: 'line',
      source: 'tracks',
      filter: notSel(sel),
      paint: { 'line-color': '#cbd5e1', 'line-width': 2.5, 'line-opacity': 0.55 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    })
    if (options.styling.glow) map.addLayer(glowLayer(sel))
    map.addLayer({
      id: 'tracks-active',
      type: 'line',
      source: 'tracks',
      filter: isSel(sel),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': options.color, 'line-width': options.styling.width },
    })
    if (options.styling.dash) map.addLayer(dashLayer(sel))
    map.addLayer({
      id: 'tracks-endpoints',
      type: 'circle',
      source: 'tracks-endpoints',
      paint: {
        'circle-radius': 6.5,
        'circle-color': ['match', ['get', 'kind'], 'start', '#22c55e', '#ef4444'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
      },
    })

    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.trackId
      if (typeof id === 'string') state.options.onSelect?.(id)
    }
    map.on('click', CLICK_LAYERS, onClick)

    // every setPaintProperty is a full-canvas repaint, so the dashes only march
    // while something else already pays for repaints; idle settles to a static frame
    let frame = 0
    let wasActive = true
    let lastMove = performance.now()
    const onMove = () => {
      lastMove = performance.now()
    }
    map.on('move', onMove)
    const timer = window.setInterval(() => {
      if (document.hidden) return
      if (performance.now() - lastMove >= 700) {
        if (!wasActive) return
        wasActive = false
        if (map.getLayer('tracks-dash')) map.setPaintProperty('tracks-dash', 'line-dasharray', DASH_FRAMES[0])
        return
      }
      wasActive = true
      if (map.getLayer('tracks-dash'))
        map.setPaintProperty('tracks-dash', 'line-dasharray', DASH_FRAMES[frame++ % DASH_FRAMES.length])
    }, 90)

    const state: TracksState = {
      options,
      timer,
      onClick,
      onMove,
      select(id) {
        state.options = { ...state.options, selectedId: id }
        applySelection(map, state.options, id, true)
      },
      setData(data) {
        state.options = { ...state.options, data }
        ;(map.getSource('tracks') as GeoJSONSource).setData(collection(data))
        applySelection(map, state.options, state.options.selectedId, false)
      },
      fit(id) {
        const t = state.options.data.find(track => track.id === (id ?? state.options.selectedId))
        if (t) fitTrack(map, t, state.options.fit)
      },
    }

    applySelection(map, options, options.selectedId, true)
    return state
  },

  update(state: TracksState, options: TracksOptions, prev: TracksOptions, engine: JustMapEngine) {
    const map = engine.map
    state.options = options

    if (options.data !== prev.data)
      (map.getSource('tracks') as GeoJSONSource).setData(collection(options.data))

    if (options.data !== prev.data || options.selectedId !== prev.selectedId || options.colorBy !== prev.colorBy)
      applySelection(map, options, options.selectedId, options.selectedId !== prev.selectedId)

    const { styling } = options
    if (styling.glow !== prev.styling.glow) {
      if (styling.glow) map.addLayer(glowLayer(options.selectedId ?? ''), 'tracks-active')
      else map.removeLayer('tracks-glow')
    }
    if (styling.width !== prev.styling.width) map.setPaintProperty('tracks-active', 'line-width', styling.width)
    if (styling.dash !== prev.styling.dash) {
      if (styling.dash) map.addLayer(dashLayer(options.selectedId ?? ''), 'tracks-endpoints')
      else map.removeLayer('tracks-dash')
    }

    if (options.color !== prev.color) map.setPaintProperty('tracks-active', 'line-color', options.color)
  },

  destroy(state: TracksState, engine: JustMapEngine) {
    window.clearInterval(state.timer)
    engine.map.off('move', state.onMove)
    engine.map.off('click', CLICK_LAYERS, state.onClick)
  },
})
