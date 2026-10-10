import { module } from '../../core/module'

export type BuildingsOptions = {
  /** vector tile source URL whose tiles contain a `building` source-layer */
  url: string
  /** lowest zoom at which buildings render */
  minzoom: number
  /** fill-extrusion opacity */
  opacity: number
  visible: boolean
}

/**
 * OSM buildings as 3D fill-extrusions. Uses the `'3d'` capability softly:
 * without Terrain the extrusions render on a flat map.
 */
export const Buildings = module<BuildingsOptions>({
  name: 'Buildings',
  uses: ['3d'],
  defaults: {
    url: 'https://tiles.openfreemap.org/planet',
    minzoom: 14,
    opacity: 0.7,
    visible: true,
  },

  create(engine, options) {
    const { map } = engine

    map.addSource('terrain-buildings', { type: 'vector', url: options.url })
    map.addLayer({
      id: 'terrain-buildings',
      type: 'fill-extrusion',
      source: 'terrain-buildings',
      'source-layer': 'building',
      minzoom: options.minzoom,
      layout: { visibility: options.visible ? 'visible' : 'none' },
      paint: {
        'fill-extrusion-color': '#16202e',
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0,
          15.5,
          ['coalesce', ['get', 'render_height'], 5],
        ],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': options.opacity,
      },
    })
  },

  update(_handle, options, prev, engine) {
    const { map } = engine
    if (options.opacity !== prev.opacity) map.setPaintProperty('terrain-buildings', 'fill-extrusion-opacity', options.opacity)
    if (options.visible !== prev.visible)
      map.setLayoutProperty('terrain-buildings', 'visibility', options.visible ? 'visible' : 'none')
  },
})
