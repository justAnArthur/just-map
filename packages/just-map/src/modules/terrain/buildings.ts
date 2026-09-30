import { module } from '../../core/module'

/**
 * 3D buildings options.
 */
export type BuildingsOptions = {
  /** vector tile source URL whose tiles contain a `building` source-layer */
  url: string
  /** lowest zoom at which buildings render */
  minzoom: number
  /** fill-extrusion opacity */
  opacity: number
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
    if (options.opacity === prev.opacity) return
    engine.map.setPaintProperty('terrain-buildings', 'fill-extrusion-opacity', options.opacity)
  },
})
