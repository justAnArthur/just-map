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

type TileLike = { tileID: { canonical: { x: number; y: number; z: number } } }

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
  const manager = (map.style as any)?.tileManagers?.[sourceId]
  if (!manager?.getRenderableIds) return fallback

  const tiles: TileLike[] = manager
    .getRenderableIds()
    .map((id: string) => manager.getTileByID(id))
    .filter(Boolean)
    // most detailed first: that's the tile a building renders from
    .sort((a: TileLike, b: TileLike) => b.tileID.canonical.z - a.tileID.canonical.z)

  return (lng, lat) => {
    const mx = (lng + 180) / 360
    const my = (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2
    for (const tile of tiles) {
      const { x, y, z } = tile.tileID.canonical
      const n = 2 ** z
      const tx = mx * n - x
      const ty = my * n - y
      if (tx >= 0 && tx < 1 && ty >= 0 && ty < 1)
        // MapLibre stores the centroid as integer tile units
        return terrain.getElevation(tile.tileID as any, Math.floor(tx * EXTENT), Math.floor(ty * EXTENT), EXTENT)
    }
    return fallback(lng, lat)
  }
}
