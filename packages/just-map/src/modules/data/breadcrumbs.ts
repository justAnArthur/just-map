import maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import type { Fix } from '../../utils/types'

export type BreadcrumbsOptions = {
  fixes: Fix[]
  color: string
  visible: boolean
}

/** imperative handle for `Breadcrumbs` (`engine.module<BreadcrumbsHandle>('Breadcrumbs')`) */
export type BreadcrumbsHandle = {
  setFixes(fixes: Fix[]): void
  setVisible(v: boolean): void
}

type BreadcrumbsState = BreadcrumbsHandle & { options: BreadcrumbsOptions }

const crumbs = (fixes: Fix[]) => ({
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: fixes.map(f => f.coord) },
    },
    ...fixes.map(f => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: f.coord },
    })),
  ],
})

function setVisibility(map: maplibregl.Map, v: boolean) {
  const visibility = v ? 'visible' : 'none'
  map.setLayoutProperty('breadcrumbs-line', 'visibility', visibility)
  map.setLayoutProperty('breadcrumbs-dots', 'visibility', visibility)
}

/** Raw GPS breadcrumbs: a straight line through the fixes with a dot at each one. */
export const Breadcrumbs = module<BreadcrumbsOptions>({
  name: 'Breadcrumbs',
  defaults: { fixes: [], color: '#fb923b', visible: true },

  create(engine: JustMapEngine, options: BreadcrumbsOptions) {
    const map = engine.map
    map.addSource('breadcrumbs', { type: 'geojson', data: crumbs(options.fixes) })
    map.addLayer({
      id: 'breadcrumbs-line',
      type: 'line',
      source: 'breadcrumbs',
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { visibility: options.visible ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': options.color, 'line-width': 2.5, 'line-opacity': 0.9 },
    })
    map.addLayer({
      id: 'breadcrumbs-dots',
      type: 'circle',
      source: 'breadcrumbs',
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { visibility: options.visible ? 'visible' : 'none' },
      paint: {
        'circle-radius': 4.5,
        'circle-color': options.color,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    })

    const state: BreadcrumbsState = {
      options,
      setFixes(fixes) {
        state.options = { ...state.options, fixes }
        ;(map.getSource('breadcrumbs') as GeoJSONSource).setData(crumbs(fixes))
      },
      setVisible(v) {
        state.options = { ...state.options, visible: v }
        setVisibility(map, v)
      },
    }
    return state
  },

  update(state: BreadcrumbsState, options: BreadcrumbsOptions, prev: BreadcrumbsOptions, engine: JustMapEngine) {
    const map = engine.map
    state.options = options

    if (options.fixes !== prev.fixes)
      (map.getSource('breadcrumbs') as GeoJSONSource).setData(crumbs(options.fixes))
    if (options.visible !== prev.visible) setVisibility(map, options.visible)
    if (options.color !== prev.color) {
      map.setPaintProperty('breadcrumbs-line', 'line-color', options.color)
      map.setPaintProperty('breadcrumbs-dots', 'circle-color', options.color)
    }
  },
})
