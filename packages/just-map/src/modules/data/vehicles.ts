import maplibregl from 'maplibre-gl'
import type {
  FilterSpecification,
  GeoJSONSource,
  MapLayerMouseEvent,
  SymbolLayerSpecification,
} from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import { FONT } from '../../core/style'
import { matchColor } from '../../utils/colors'
import { distKm, lerpAngle, lerpCoord } from '../../utils/geo'
import { arrowSprite, keepImage, pillSprite } from '../../utils/images'
import type { Coord } from '../../utils/types'

export type Vehicle = {
  id: string
  coord: Coord
  /** degrees, 0 = north; arrow statuses without a heading fall back to a dot */
  heading?: number
  /** key into `colors` */
  status: string
  /** label text; defaults to the id */
  label?: string
}

/** `auto` = the selected vehicle, plus everyone from `labelMinZoom` on */
export type VehicleLabels = 'auto' | 'always' | 'selected' | 'none'

export type VehicleFit = { padding?: number; maxZoom?: number; duration?: number }

export type VehiclesOptions = {
  data: Vehicle[]
  /** status → color; unknown statuses render grey */
  colors: Record<string, string>
  /** statuses drawn as a heading arrow instead of a dot */
  arrowStatuses: string[]
  selectedId?: string
  labels: VehicleLabels
  labelMinZoom: number
  font: string[]
  /** ms to glide between positions on `data` changes; 0 jumps, moves over 5 km always jump */
  tween: number
  onSelect?(id: string): void
}

/** imperative handle for `Vehicles` (`engine.module<VehiclesHandle>('Vehicles')`) */
export type VehiclesHandle = {
  setData(data: Vehicle[]): void
  select(id?: string): void
  /** fit the camera to these vehicles, or all of them */
  fit(ids?: string[], options?: VehicleFit): void
  flyTo(id: string, zoom?: number): void
}

type State = VehiclesHandle & {
  options: VehiclesOptions
  /** positions currently drawn, mid-tween included */
  shown: Vehicle[]
  raf: number
  render(vehicles: Vehicle[]): void
  cleanup(): void
}

const FALLBACK_COLOR = '#a1a1aa'
const MAX_TWEEN_KM = 5
const ARROW = 'vehicles-arrow'
const PILL = 'vehicles-pill'
const LAYERS = ['vehicles-halo', 'vehicles-dot', 'vehicles-arrow', 'vehicles-label', 'vehicles-label-selected']
const CLICK_LAYERS = LAYERS.slice(1)

const isSel = (id: string | undefined): FilterSpecification => ['==', ['get', 'id'], id ?? '']
const notSel = (id: string | undefined): FilterSpecification => ['!=', ['get', 'id'], id ?? '']

export function vehicleCollection(vehicles: Vehicle[], arrowStatuses: string[]) {
  return {
    type: 'FeatureCollection' as const,
    features: vehicles.map(v => ({
      type: 'Feature' as const,
      properties: {
        id: v.id,
        status: v.status,
        label: v.label ?? v.id,
        heading: v.heading ?? 0,
        arrow: v.heading !== undefined && arrowStatuses.includes(v.status),
      },
      geometry: { type: 'Point' as const, coordinates: v.coord },
    })),
  }
}

const tweens = (from: Vehicle, to: Vehicle) => distKm(from.coord, to.coord) <= MAX_TWEEN_KM

function between(from: Vehicle, to: Vehicle, u: number): Vehicle {
  const heading =
    from.heading === undefined || to.heading === undefined ? to.heading : lerpAngle(from.heading, to.heading, u)
  return { ...to, coord: lerpCoord(from.coord, to.coord, u), heading }
}

function applySelection(map: maplibregl.Map, id: string | undefined) {
  map.setFilter('vehicles-halo', isSel(id))
  map.setFilter('vehicles-label', notSel(id))
  map.setFilter('vehicles-label-selected', isSel(id))
}

function applyLabels(map: maplibregl.Map, options: VehiclesOptions) {
  const { labels, labelMinZoom } = options
  const visibility = (on: boolean) => (on ? 'visible' : 'none')

  map.setLayerZoomRange('vehicles-label', labels === 'always' ? 0 : labelMinZoom, 24)
  map.setLayoutProperty('vehicles-label', 'visibility', visibility(labels === 'auto' || labels === 'always'))
  map.setLayoutProperty('vehicles-label-selected', 'visibility', visibility(labels !== 'none'))
}

function applyColors(map: maplibregl.Map, colors: Record<string, string>) {
  const color = matchColor('status', colors, FALLBACK_COLOR)
  map.setPaintProperty('vehicles-halo', 'circle-color', color)
  map.setPaintProperty('vehicles-halo', 'circle-stroke-color', color)
  map.setPaintProperty('vehicles-dot', 'circle-color', color)
  map.setPaintProperty('vehicles-arrow', 'icon-color', color)
}

function addLayers(map: maplibregl.Map, options: VehiclesOptions) {
  const color = matchColor('status', options.colors, FALLBACK_COLOR)
  const label: SymbolLayerSpecification['layout'] = {
    'text-field': ['get', 'label'],
    'text-font': options.font,
    'text-size': 11,
    'text-anchor': 'bottom',
    'text-offset': [0, -1.1],
    'icon-image': PILL,
    'icon-text-fit': 'both',
    'icon-text-fit-padding': [1, 4, 1, 4],
  }

  map.addLayer({
    id: 'vehicles-halo',
    type: 'circle',
    source: 'vehicles',
    filter: isSel(options.selectedId),
    paint: {
      'circle-radius': 16,
      'circle-color': color,
      'circle-opacity': 0.22,
      'circle-stroke-color': color,
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.6,
    },
  })
  map.addLayer({
    id: 'vehicles-dot',
    type: 'circle',
    source: 'vehicles',
    filter: ['!', ['get', 'arrow']],
    paint: { 'circle-radius': 6, 'circle-color': color, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  })
  map.addLayer({
    id: 'vehicles-arrow',
    type: 'symbol',
    source: 'vehicles',
    filter: ['get', 'arrow'],
    layout: {
      'icon-image': ARROW,
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-color': color, 'icon-halo-color': '#ffffff', 'icon-halo-width': 1.5 },
  })
  map.addLayer({
    id: 'vehicles-label',
    type: 'symbol',
    source: 'vehicles',
    filter: notSel(options.selectedId),
    layout: label,
    paint: { 'text-color': '#0f172a' },
  })
  map.addLayer({
    id: 'vehicles-label-selected',
    type: 'symbol',
    source: 'vehicles',
    filter: isSel(options.selectedId),
    layout: { ...label, 'text-allow-overlap': true, 'icon-allow-overlap': true },
    paint: { 'text-color': '#0f172a' },
  })
}

/**
 * Many live vehicles as GL layers: status-colored dots, heading arrows,
 * pill labels, selection halo, and a glide between position updates.
 */
export const Vehicles = module<VehiclesOptions>({
  name: 'Vehicles',
  defaults: {
    data: [],
    colors: { driving: '#16a34a', idle: '#f59e0b', stopped: '#64748b', offline: '#a1a1aa' },
    arrowStatuses: ['driving'],
    labels: 'auto',
    labelMinZoom: 13,
    font: FONT,
    tween: 800,
  },

  create(engine: JustMapEngine, options: VehiclesOptions) {
    const map = engine.map
    const offArrow = keepImage(map, ARROW, arrowSprite)
    const offPill = keepImage(map, PILL, pillSprite)

    map.addSource('vehicles', { type: 'geojson', data: vehicleCollection(options.data, options.arrowStatuses) })
    addLayers(map, options)
    applyLabels(map, options)

    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'string') state.options.onSelect?.(id)
    }
    const onEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
    }
    map.on('click', CLICK_LAYERS, onClick)
    map.on('mouseenter', CLICK_LAYERS, onEnter)
    map.on('mouseleave', CLICK_LAYERS, onLeave)

    const state: State = {
      options,
      shown: options.data,
      raf: 0,

      render(vehicles) {
        state.shown = vehicles
        const source = map.getSource('vehicles') as GeoJSONSource
        source.setData(vehicleCollection(vehicles, state.options.arrowStatuses))
      },

      setData(data) {
        state.options = { ...state.options, data }
        cancelAnimationFrame(state.raf)
        state.raf = 0

        const previous = new Map(state.shown.map(v => [v.id, v]))
        const moves = data.map(to => ({ to, from: previous.get(to.id) }))
        const { tween } = state.options
        const animate = tween > 0 && moves.some(m => m.from && tweens(m.from, m.to))
        if (!animate) {
          state.render(data)
          return
        }

        const start = performance.now()
        const step = (now: number) => {
          const u = Math.min(1, (now - start) / tween)
          state.render(moves.map(({ from, to }) => (from && tweens(from, to) ? between(from, to, u) : to)))
          state.raf = u < 1 ? requestAnimationFrame(step) : 0
        }
        state.raf = requestAnimationFrame(step)
      },

      select(id) {
        state.options = { ...state.options, selectedId: id }
        applySelection(map, id)
      },

      fit(ids, { padding = 80, maxZoom = 15, duration = 1000 } = {}) {
        const wanted = ids ? state.options.data.filter(v => ids.includes(v.id)) : state.options.data
        if (!wanted.length) return
        const bounds = wanted.reduce((b, v) => b.extend(v.coord), new maplibregl.LngLatBounds())
        map.fitBounds(bounds, { padding, maxZoom, duration })
      },

      flyTo(id, zoom) {
        const v = state.options.data.find(vehicle => vehicle.id === id)
        if (v) map.flyTo({ center: v.coord, zoom: zoom ?? Math.max(map.getZoom(), 15) })
      },

      cleanup() {
        cancelAnimationFrame(state.raf)
        map.off('click', CLICK_LAYERS, onClick)
        map.off('mouseenter', CLICK_LAYERS, onEnter)
        map.off('mouseleave', CLICK_LAYERS, onLeave)
        for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource('vehicles')) map.removeSource('vehicles')
        offArrow()
        offPill()
      },
    }
    return state
  },

  update(state: State, options: VehiclesOptions, prev: VehiclesOptions, engine: JustMapEngine) {
    const map = engine.map
    state.options = options

    if (options.data !== prev.data) state.setData(options.data)
    else if (options.arrowStatuses !== prev.arrowStatuses) state.render(state.shown)

    if (options.selectedId !== prev.selectedId) applySelection(map, options.selectedId)
    if (options.labels !== prev.labels || options.labelMinZoom !== prev.labelMinZoom) applyLabels(map, options)
    if (options.colors !== prev.colors) applyColors(map, options.colors)

    if (options.font !== prev.font) {
      map.setLayoutProperty('vehicles-label', 'text-font', options.font)
      map.setLayoutProperty('vehicles-label-selected', 'text-font', options.font)
    }
  },

  destroy(state: State) {
    state.cleanup()
  },
})
