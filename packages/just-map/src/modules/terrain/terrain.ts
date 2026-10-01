import { module } from '../../core/module'

/**
 * 3D terrain options.
 */
export type TerrainOptions = {
  /** terrarium-encoded raster-dem tile URL template */
  demUrl: string
  /** highest DEM zoom to request; above it tiles 404 and starve the tile queue */
  maxzoom: number
  /** vertical exaggeration of the terrain */
  exaggeration: number
  /** render the hillshade relief layer */
  hillshade: boolean
  /** hillshade relief intensity */
  hillshadeExaggeration: number
  /** false detaches terrain (map-type switching without remount) */
  enabled: boolean
}

export type TerrainHandle = {
  /** no-op when equal to last applied — avoids resetting terrain mid-slider-gesture */
  setExaggeration(v: number): void
  setHillshade(on: boolean): void
  setEnabled(on: boolean): void
}

const RELIEF = 'terrain-relief'

/**
 * Global 3D terrain over the AWS terrarium DEM, plus an optional hillshade
 * relief layer. Provides the `'3d'` capability.
 */
export const Terrain = module<TerrainOptions>({
  name: 'Terrain',
  provides: ['3d'],
  defaults: {
    demUrl: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    maxzoom: 12,
    exaggeration: 1.8,
    hillshade: true,
    hillshadeExaggeration: 0.35,
    enabled: true,
  },

  create(engine, options) {
    const { map } = engine
    const dem = {
      type: 'raster-dem' as const,
      tiles: [options.demUrl],
      encoding: 'terrarium' as const,
      tileSize: 256,
      maxzoom: options.maxzoom,
    }

    map.addSource('terrain', { ...dem, attribution: 'Terrain: Mapzen/AWS Open Data' })
    // the hillshade layer needs its own raster-dem instance
    map.addSource('terrain-hs', dem)

    map.addLayer({
      id: RELIEF,
      type: 'hillshade',
      source: 'terrain-hs',
      layout: { visibility: options.hillshade ? 'visible' : 'none' },
      paint: {
        'hillshade-exaggeration': options.hillshadeExaggeration,
        'hillshade-shadow-color': '#16202e',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#3a4a5e',
      },
    })

    if (options.enabled) map.setTerrain({ source: 'terrain', exaggeration: options.exaggeration })

    let applied = options.exaggeration
    let enabled = options.enabled
    const handle: TerrainHandle = {
      setExaggeration(v) {
        if (v === applied) return
        applied = v
        if (enabled) map.setTerrain({ source: 'terrain', exaggeration: v })
      },
      setHillshade(on) {
        map.setLayoutProperty(RELIEF, 'visibility', on ? 'visible' : 'none')
      },
      setEnabled(on) {
        enabled = on
        map.setTerrain(on ? { source: 'terrain', exaggeration: applied } : null)
      },
    }
    return handle
  },

  update(handle: TerrainHandle, options, prev) {
    if (options.enabled !== prev.enabled) handle.setEnabled(options.enabled)
    if (options.exaggeration !== prev.exaggeration) handle.setExaggeration(options.exaggeration)
    if (options.hillshade !== prev.hillshade) handle.setHillshade(options.hillshade)
  },
})
