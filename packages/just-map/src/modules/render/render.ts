import type { RasterLayerSpecification, RasterSourceSpecification } from 'maplibre-gl'
import { module } from '../../core/module'

const PRESETS = {
  satellite: {
    // note the {z}/{y}/{x} axis order
    tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  osm: {
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
  },
} as const

export type RenderOptions = {
  /** 'tiles' requires the tiles URL template */
  provider: 'satellite' | 'osm' | 'tiles'
  tiles?: string
  /** dim grading: brightness-max 0.72 / saturation -0.15 */
  dim: boolean
  maxzoom: number
  /** 3-tier LOD underlay (z6 floor + z8 mid + main) + far-field LOD cap — the tile-void fix */
  lodTiers: boolean
  attribution?: string
}

export type RenderHandle = {
  setDim(dim: boolean): void
}

const brightness = (dim: boolean) => (dim ? 0.72 : 1)
const saturation = (dim: boolean) => (dim ? -0.15 : 0)

/** Basemap raster imagery with optional dim grading and the LOD tile-void fix. */
export const Render = module<RenderOptions>({
  name: 'Render',
  defaults: { provider: 'satellite', dim: false, maxzoom: 19, lodTiers: true },
  create(engine, options) {
    const { map } = engine
    const preset = options.provider === 'tiles' ? undefined : PRESETS[options.provider]
    const tiles = preset?.tiles ?? options.tiles
    if (!tiles) throw new Error("just-map: Render provider 'tiles' requires the tiles URL template")
    const attribution = options.attribution ?? preset?.attribution

    const source = (maxzoom: number, attribution?: string): RasterSourceSpecification => ({
      type: 'raster',
      tiles: [tiles],
      tileSize: 256,
      maxzoom,
      ...(attribution && { attribution }),
    })

    const layer = (id: string, minzoom?: number): RasterLayerSpecification => ({
      id,
      type: 'raster',
      source: id,
      ...(minzoom !== undefined && { minzoom }),
      paint: {
        'raster-brightness-max': brightness(options.dim),
        'raster-saturation': saturation(options.dim),
        'raster-fade-duration': 0,
      },
    })

    if (options.lodTiers) {
      map.addSource('render-floor', source(6))
      map.addSource('render-lo', source(8))
      map.addLayer(layer('render-floor'))
      map.addLayer(layer('render-lo'))
    }
    map.addSource('render', source(options.maxzoom, attribution))
    map.addLayer(layer('render', options.lodTiers ? 8 : undefined))
    if (options.lodTiers) map.setSourceTileLodParams(6.5, 3, 'render')

    const ids = options.lodTiers ? ['render-floor', 'render-lo', 'render'] : ['render']
    return {
      setDim(dim: boolean) {
        for (const id of ids) {
          map.setPaintProperty(id, 'raster-brightness-max', brightness(dim))
          map.setPaintProperty(id, 'raster-saturation', saturation(dim))
        }
      },
    }
  },
  update(handle: RenderHandle, options, prev) {
    if (options.dim === prev.dim) return
    handle.setDim(options.dim)
  },
})
