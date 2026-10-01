import maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import type { Coord } from '../../utils/types'

export type ZoneEditorOptions = {
  /** ring vertices in draw order; the polygon closes itself */
  ring: Coord[]
  readonly: boolean
  color: string
  /** emitted once per edit commit: vertex drag end, insert, or delete */
  onChange?(ring: Coord[]): void
}

/** imperative handle for `ZoneEditor` (`engine.module<ZoneEditorHandle>('ZoneEditor')`) */
export type ZoneEditorHandle = {
  setRing(ring: Coord[]): void
}

type State = ZoneEditorHandle & {
  options: ZoneEditorOptions
  ring: Coord[]
  markers: maplibregl.Marker[]
  rebuild(): void
}

const cleanups = new WeakMap<ZoneEditorHandle, () => void>()

const zoneData = (ring: Coord[]) => {
  const features = []
  if (ring.length >= 2)
    features.push({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: ring } })
  if (ring.length >= 3)
    features.push({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [[...ring, ring[0]]] },
    })
  return { type: 'FeatureCollection' as const, features }
}

/** index of the segment a click belongs to; degree-space distance is enough to pick the nearest */
export function nearestSegment(ring: Coord[], p: Coord): number {
  const seg = (a: Coord, b: Coord) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    const x = a[0] + t * dx - p[0]
    const y = a[1] + t * dy - p[1]
    return x * x + y * y
  }

  let best = 0
  let bestD = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = seg(ring[i], ring[(i + 1) % ring.length])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function vertex(color: string, readonly: boolean) {
  const el = document.createElement('div')
  el.style.width = el.style.height = '11px'
  el.style.borderRadius = '3px'
  el.style.background = '#fff'
  el.style.border = `2px solid ${color}`
  el.style.boxSizing = 'border-box'
  el.style.cursor = readonly ? 'default' : 'move'
  return el
}

/**
 * Interactive polygon editor for geofence-style zones: click the map to insert a
 * vertex into the nearest edge, drag vertices to reshape, click a vertex to
 * delete it. Undo/redo belongs to the consuming app.
 */
export const ZoneEditor = module<ZoneEditorOptions>({
  name: 'ZoneEditor',
  defaults: { ring: [], readonly: false, color: '#2563eb' },

  create(engine: JustMapEngine, options: ZoneEditorOptions) {
    const map = engine.map
    map.addSource('zone-editor', { type: 'geojson', data: zoneData(options.ring) })
    map.addLayer({
      id: 'zone-fill',
      type: 'fill',
      source: 'zone-editor',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': options.color, 'fill-opacity': 0.12 },
    })
    map.addLayer({
      id: 'zone-line',
      type: 'line',
      source: 'zone-editor',
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': options.color, 'line-width': 2.5 },
    })

    const state: State = {
      options,
      ring: [...options.ring],
      markers: [],
      setRing(ring) {
        state.ring = [...ring]
        state.options = { ...state.options, ring }
        state.rebuild()
      },
      rebuild() {
        for (const m of state.markers) m.remove()
        const { readonly, color, onChange } = state.options

        state.markers = state.ring.map((c, i) => {
          const marker = new maplibregl.Marker({ element: vertex(color, readonly), draggable: !readonly })
            .setLngLat(c)
            .addTo(map)

          marker.on('drag', () => {
            const ll = marker.getLngLat()
            state.ring[i] = [ll.lng, ll.lat]
            ;(map.getSource('zone-editor') as GeoJSONSource).setData(zoneData(state.ring))
          })
          marker.on('dragend', () => onChange?.([...state.ring]))
          marker.getElement().addEventListener('click', ev => {
            ev.stopPropagation()
            if (readonly) return
            state.ring.splice(i, 1)
            state.rebuild()
            onChange?.([...state.ring])
          })
          return marker
        })

        ;(map.getSource('zone-editor') as GeoJSONSource).setData(zoneData(state.ring))
      },
    }

    const onClick = (e: MapMouseEvent) => {
      if (state.options.readonly) return
      const c: Coord = [e.lngLat.lng, e.lngLat.lat]
      if (state.ring.length < 2) state.ring.push(c)
      else state.ring.splice(nearestSegment(state.ring, c) + 1, 0, c)
      state.rebuild()
      state.options.onChange?.([...state.ring])
    }
    map.on('click', onClick)

    map.getCanvas().style.cursor = options.readonly ? '' : 'crosshair'
    state.rebuild()

    cleanups.set(state, () => {
      map.off('click', onClick)
      map.getCanvas().style.cursor = ''
      for (const m of state.markers) m.remove()
      if (map.getLayer('zone-fill')) map.removeLayer('zone-fill')
      if (map.getLayer('zone-line')) map.removeLayer('zone-line')
      if (map.getSource('zone-editor')) map.removeSource('zone-editor')
    })
    return state
  },

  update(state: State, options: ZoneEditorOptions, prev: ZoneEditorOptions, engine: JustMapEngine) {
    state.options = options
    if (options.ring !== prev.ring) state.ring = [...options.ring]

    if (options.ring !== prev.ring || options.readonly !== prev.readonly || options.color !== prev.color) {
      if (options.color !== prev.color) {
        engine.map.setPaintProperty('zone-fill', 'fill-color', options.color)
        engine.map.setPaintProperty('zone-line', 'line-color', options.color)
      }
      if (options.readonly !== prev.readonly)
        engine.map.getCanvas().style.cursor = options.readonly ? '' : 'crosshair'
      state.rebuild()
    }
  },

  destroy(state: State) {
    cleanups.get(state)?.()
  },
})
