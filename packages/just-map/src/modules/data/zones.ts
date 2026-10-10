import maplibregl from 'maplibre-gl'
import type { ExpressionSpecification, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import { FONT } from '../../core/style'
import { ringCentroid } from '../../utils/geo'
import type { Coord } from '../../utils/types'

export type Zone = {
  id: string
  name?: string
  /** vertices in draw order; closed automatically */
  ring: Coord[]
  /** overrides the module `color` */
  color?: string
}

export type ZonesOptions = {
  data: Zone[]
  visible: boolean
  color: string
  fillOpacity: number
  /** name labels at each zone's centroid */
  labels: boolean
  labelMinZoom: number
  font: string[]
  onClick?(id: string): void
}

/** imperative handle for `Zones` (`engine.module<ZonesHandle>('Zones')`) */
export type ZonesHandle = {
  setData(data: Zone[]): void
  setVisible(v: boolean): void
  /** fit the camera to one zone, or all of them */
  fit(id?: string): void
}

type State = ZonesHandle & {
  options: ZonesOptions
  cleanup(): void
}

const LAYERS = ['zones-fill', 'zones-line', 'zones-label']

const polygonal = (zones: Zone[]) => zones.filter(z => z.ring.length >= 3)

const closed = (ring: Coord[]) => {
  const [first] = ring
  const last = ring[ring.length - 1]
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
}

export function zoneCollection(zones: Zone[]) {
  return {
    type: 'FeatureCollection' as const,
    features: polygonal(zones).map(z => ({
      type: 'Feature' as const,
      properties: { id: z.id, color: z.color ?? null },
      geometry: { type: 'Polygon' as const, coordinates: [closed(z.ring)] },
    })),
  }
}

export function zoneLabelCollection(zones: Zone[]) {
  return {
    type: 'FeatureCollection' as const,
    features: polygonal(zones)
      .filter(z => z.name)
      .map(z => ({
        type: 'Feature' as const,
        properties: { id: z.id, name: z.name, color: z.color ?? null },
        geometry: { type: 'Point' as const, coordinates: ringCentroid(z.ring) },
      })),
  }
}

const zoneColor = (fallback: string): ExpressionSpecification => ['coalesce', ['get', 'color'], fallback]

function applyData(map: maplibregl.Map, zones: Zone[]) {
  ;(map.getSource('zones') as GeoJSONSource).setData(zoneCollection(zones))
  ;(map.getSource('zones-labels') as GeoJSONSource).setData(zoneLabelCollection(zones))
}

function applyVisibility(map: maplibregl.Map, options: ZonesOptions) {
  const visibility = (on: boolean) => (on ? 'visible' : 'none')
  map.setLayoutProperty('zones-fill', 'visibility', visibility(options.visible))
  map.setLayoutProperty('zones-line', 'visibility', visibility(options.visible))
  map.setLayoutProperty('zones-label', 'visibility', visibility(options.visible && options.labels))
}

function applyColor(map: maplibregl.Map, color: string) {
  map.setPaintProperty('zones-fill', 'fill-color', zoneColor(color))
  map.setPaintProperty('zones-line', 'line-color', zoneColor(color))
  map.setPaintProperty('zones-label', 'text-color', zoneColor(color))
}

/** Read-only overlay of many named polygons — geofences, service areas, depots. */
export const Zones = module<ZonesOptions>({
  name: 'Zones',
  defaults: {
    data: [],
    visible: true,
    color: '#1769e0',
    fillOpacity: 0.08,
    labels: true,
    labelMinZoom: 11.5,
    font: FONT,
  },

  create(engine: JustMapEngine, options: ZonesOptions) {
    const map = engine.map

    map.addSource('zones', { type: 'geojson', data: zoneCollection(options.data) })
    map.addSource('zones-labels', { type: 'geojson', data: zoneLabelCollection(options.data) })
    map.addLayer({
      id: 'zones-fill',
      type: 'fill',
      source: 'zones',
      paint: { 'fill-color': zoneColor(options.color), 'fill-opacity': options.fillOpacity },
    })
    map.addLayer({
      id: 'zones-line',
      type: 'line',
      source: 'zones',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': zoneColor(options.color), 'line-width': 1.8, 'line-dasharray': [2, 1.5] },
    })
    map.addLayer({
      id: 'zones-label',
      type: 'symbol',
      source: 'zones-labels',
      minzoom: options.labelMinZoom,
      layout: { 'text-field': ['get', 'name'], 'text-font': options.font, 'text-size': 12 },
      paint: { 'text-color': zoneColor(options.color), 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    })
    applyVisibility(map, options)

    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'string') state.options.onClick?.(id)
    }
    map.on('click', 'zones-fill', onClick)

    const state: State = {
      options,

      setData(data) {
        state.options = { ...state.options, data }
        applyData(map, data)
      },

      setVisible(v) {
        state.options = { ...state.options, visible: v }
        applyVisibility(map, state.options)
      },

      fit(id) {
        const zones = polygonal(state.options.data).filter(z => !id || z.id === id)
        if (!zones.length) return
        const bounds = new maplibregl.LngLatBounds()
        for (const z of zones) for (const c of z.ring) bounds.extend(c)
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 })
      },

      cleanup() {
        map.off('click', 'zones-fill', onClick)
        for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id)
        for (const id of ['zones', 'zones-labels']) if (map.getSource(id)) map.removeSource(id)
      },
    }
    return state
  },

  update(state: State, options: ZonesOptions, prev: ZonesOptions, engine: JustMapEngine) {
    const map = engine.map
    state.options = options

    if (options.data !== prev.data) applyData(map, options.data)
    if (options.visible !== prev.visible || options.labels !== prev.labels) applyVisibility(map, options)
    if (options.color !== prev.color) applyColor(map, options.color)
    if (options.fillOpacity !== prev.fillOpacity) map.setPaintProperty('zones-fill', 'fill-opacity', options.fillOpacity)
    if (options.labelMinZoom !== prev.labelMinZoom) map.setLayerZoomRange('zones-label', options.labelMinZoom, 24)
    if (options.font !== prev.font) map.setLayoutProperty('zones-label', 'text-font', options.font)
  },

  destroy(state: State) {
    state.cleanup()
  },
})
