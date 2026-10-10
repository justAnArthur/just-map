import type maplibregl from 'maplibre-gl'
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import { FONT } from '../../core/style'
import { matchColor } from '../../utils/colors'
import type { Coord } from '../../utils/types'

export type Pin = {
  id: string
  coord: Coord
  /** key into `colors` */
  kind: string
  /** short text drawn inside the dot, e.g. a stop number */
  label?: string
}

export type PinsOptions = {
  data: Pin[]
  /** kind → color; unknown kinds render grey */
  colors: Record<string, string>
  selectedId?: string
  visible: boolean
  font: string[]
  onClick?(id: string): void
}

/** imperative handle for `Pins` (`engine.module<PinsHandle>('Pins')`) */
export type PinsHandle = {
  setData(data: Pin[]): void
  select(id?: string): void
}

type State = PinsHandle & {
  options: PinsOptions
  cleanup(): void
}

const FALLBACK_COLOR = '#94a3b8'
const LAYERS = ['pins-halo', 'pins-dot', 'pins-label']

const isSel = (id: string | undefined): FilterSpecification => ['==', ['get', 'id'], id ?? '']
const labeled: ExpressionSpecification = ['!=', ['get', 'label'], '']

export function pinCollection(pins: Pin[]) {
  return {
    type: 'FeatureCollection' as const,
    features: pins.map(p => ({
      type: 'Feature' as const,
      properties: { id: p.id, kind: p.kind, label: p.label ?? '' },
      geometry: { type: 'Point' as const, coordinates: p.coord },
    })),
  }
}

function applyVisibility(map: maplibregl.Map, visible: boolean) {
  for (const id of LAYERS) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
}

function applyColors(map: maplibregl.Map, colors: Record<string, string>) {
  const color = matchColor('kind', colors, FALLBACK_COLOR)
  map.setPaintProperty('pins-halo', 'circle-color', color)
  map.setPaintProperty('pins-dot', 'circle-color', color)
}

/** Small typed points of interest — alerts, stops, depots — with an optional label inside the dot. */
export const Pins = module<PinsOptions>({
  name: 'Pins',
  defaults: {
    data: [],
    colors: { critical: '#f04438', warning: '#f59e0b', info: '#3b82f6', stop: '#334155' },
    visible: true,
    font: FONT,
  },

  create(engine: JustMapEngine, options: PinsOptions) {
    const map = engine.map
    const color = matchColor('kind', options.colors, FALLBACK_COLOR)

    map.addSource('pins', { type: 'geojson', data: pinCollection(options.data) })
    map.addLayer({
      id: 'pins-halo',
      type: 'circle',
      source: 'pins',
      filter: isSel(options.selectedId),
      paint: { 'circle-radius': 15, 'circle-color': color, 'circle-opacity': 0.25 },
    })
    map.addLayer({
      id: 'pins-dot',
      type: 'circle',
      source: 'pins',
      paint: {
        'circle-radius': ['case', labeled, 9, 6],
        'circle-color': color,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: 'pins-label',
      type: 'symbol',
      source: 'pins',
      filter: labeled,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': options.font,
        'text-size': 10,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' },
    })
    if (!options.visible) applyVisibility(map, false)

    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'string') state.options.onClick?.(id)
    }
    const onEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
    }
    map.on('click', 'pins-dot', onClick)
    map.on('mouseenter', 'pins-dot', onEnter)
    map.on('mouseleave', 'pins-dot', onLeave)

    const state: State = {
      options,

      setData(data) {
        state.options = { ...state.options, data }
        ;(map.getSource('pins') as GeoJSONSource).setData(pinCollection(data))
      },

      select(id) {
        state.options = { ...state.options, selectedId: id }
        map.setFilter('pins-halo', isSel(id))
      },

      cleanup() {
        map.off('click', 'pins-dot', onClick)
        map.off('mouseenter', 'pins-dot', onEnter)
        map.off('mouseleave', 'pins-dot', onLeave)
        for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource('pins')) map.removeSource('pins')
      },
    }
    return state
  },

  update(state: State, options: PinsOptions, prev: PinsOptions, engine: JustMapEngine) {
    const map = engine.map
    state.options = options

    if (options.data !== prev.data) state.setData(options.data)
    if (options.selectedId !== prev.selectedId) state.select(options.selectedId)
    if (options.visible !== prev.visible) applyVisibility(map, options.visible)
    if (options.colors !== prev.colors) applyColors(map, options.colors)
    if (options.font !== prev.font) map.setLayoutProperty('pins-label', 'text-font', options.font)
  },

  destroy(state: State) {
    state.cleanup()
  },
})
