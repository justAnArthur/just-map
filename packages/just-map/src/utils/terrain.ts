import maplibregl from 'maplibre-gl'

/** ground height in meters (exaggeration included) under a lng/lat */
export type Ground = (lng: number, lat: number) => number

/**
 * Samples the terrain surface. Undefined without terrain.
 * `map.queryTerrainElevation` recomputes the covering tiles on every call;
 * this resolves the DEM zoom once, which matters at thousands of samples.
 * Points whose DEM tile isn't loaded yet read 0.
 */
export function groundSampler(map: maplibregl.Map): Ground | undefined {
  const { terrain } = map
  if (!terrain) return undefined
  const zoom = Math.min(terrain.tileManager.maxzoom, Math.floor(map.getZoom()))
  return (lng, lat) => terrain.getElevationForLngLatZoom(new maplibregl.LngLat(lng, lat), zoom)
}

const EXTENT = 8192

type CanonicalTile = { x: number; y: number; z: number }
type TileLike = { tileID: { canonical: CanonicalTile } }

/** the renderable tiles of a source, by canonical `z/x/y` — MapLibre internals, undefined when they're not there */
export function renderableTiles(map: maplibregl.Map, sourceId: string): Map<string, TileLike> | undefined {
  const manager = (map.style as any)?.tileManagers?.[sourceId]
  if (!manager?.getRenderableIds) return undefined
  const tiles = new Map<string, TileLike>()
  for (const id of manager.getRenderableIds()) {
    const tile: TileLike | undefined = manager.getTileByID(id)
    if (!tile) continue
    const { x, y, z } = tile.tileID.canonical
    tiles.set(`${z}/${x}/${y}`, tile)
  }
  return tiles
}

/**
 * Ground under a point given in a source tile's own coordinates (0..`extent`),
 * looked up exactly as MapLibre lifts that tile's fill-extrusions.
 */
export type TileGround = (tile: CanonicalTile, x: number, y: number, extent: number) => number

/**
 * The ground exactly as MapLibre lifts a vector source's fill-extrusions:
 * the elevation is looked up through the *rendered tile* of that source.
 * MapLibre resolves the DEM per tile ID, so a z14 building tile can get a
 * coarser DEM than a point sample does — on a hill that is tens of meters.
 * Sampling through the same tile keeps custom geometry glued to the
 * extrusions. Reaches into MapLibre's tile manager (not public API) and falls
 * back to `groundSampler` when that isn't available.
 */
export function extrusionGroundSampler(map: maplibregl.Map, sourceId: string): Ground | undefined {
  const { terrain } = map
  if (!terrain) return undefined
  const fallback = groundSampler(map)!
  const tiles = renderableTiles(map, sourceId)
  if (!tiles?.size) return fallback

  // most detailed first: that's the tile a building renders from
  const zooms = [...new Set([...tiles.values()].map(t => t.tileID.canonical.z))].sort((a, b) => b - a)

  return (lng, lat) => {
    const mx = (lng + 180) / 360
    const my = (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2
    for (const z of zooms) {
      const n = 2 ** z
      const x = Math.floor(mx * n)
      const y = Math.floor(my * n)
      const tile = tiles.get(`${z}/${x}/${y}`)
      if (tile)
        // MapLibre stores the centroid as integer tile units
        return terrain.getElevation(
          tile.tileID as any,
          Math.floor((mx * n - x) * EXTENT),
          Math.floor((my * n - y) * EXTENT),
          EXTENT,
        )
    }
    return fallback(lng, lat)
  }
}

/** `TileGround` for a source's tiles; undefined without terrain or MapLibre's tile internals */
export function tileGroundSampler(map: maplibregl.Map, sourceId: string): TileGround | undefined {
  const { terrain } = map
  if (!terrain) return undefined
  const tiles = renderableTiles(map, sourceId)
  if (!tiles) return undefined
  const fallback = groundSampler(map)!
  return ({ x, y, z }, px, py, extent) => {
    const tile = tiles.get(`${z}/${x}/${y}`)
    if (tile) return terrain.getElevation(tile.tileID as any, Math.floor(px), Math.floor(py), extent)
    const n = 2 ** z
    const lng = ((x + px / extent) / n) * 360 - 180
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI
    return fallback(lng, lat)
  }
}
