import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  DataDrivenPropertyValueSpecification,
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  LightSpecification,
} from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import { FONT } from '../../core/style'
import { keepImage, type Sprite } from '../../utils/images'
import { extrusionGroundSampler, tileGroundSampler, type Ground, type TileGround } from '../../utils/terrain'
import {
  cameraPosition,
  mercatorMeter,
  mercatorMeterAtY,
  mercatorX,
  mercatorY,
  multiply,
  preserveState,
  program,
  releaseVao,
  rgb,
  translation,
  type GL,
  type Program,
} from '../../utils/gl'

/** colors of the architectural-drawing look */
export type DrawingPalette = {
  land: string
  green: string
  water: string
  /** water grid lines; alpha via `gridOpacity` */
  grid: string
  road: string
  roadCasing: string
  rail: string
  building: string
  /** building + shoreline outlines */
  edge: string
  label: string
}

export type DrawingOptions = {
  /** vector tiles in the OpenMapTiles schema */
  url: string
  palette: DrawingPalette
  /** the nautical grid drawn over water */
  waterGrid: boolean
  gridOpacity: number
  /** 3D edge lines on buildings — the pen-drawn look */
  edges: boolean
  edgeOpacity: number
  /** lowest zoom with extruded buildings (OpenMapTiles carries buildings from z13) */
  buildingMinzoom: number
  /**
   * Tile detail across a pitched view: how many zoom levels the far field may
   * drop below the camera. Lower = more distant tiles at full detail (buildings,
   * minor roads) at the cost of more tiles. MapLibre's default is 4; 2 keeps
   * a 70° view of a city at z13–14 everywhere (~50 tiles).
   */
  lodLevels: number
  labels: boolean
  font: string[]
  /** lift buildings above siblings' flat overlays (routes, zones) so they hide what's behind them */
  occlude: boolean
  visible: boolean
}

export const DRAWING_PALETTE: DrawingPalette = {
  land: '#f2f2f0',
  green: '#e6ebe6',
  water: '#5d8994',
  grid: '#ffffff',
  road: '#ffffff',
  roadCasing: '#c4c9cf',
  rail: '#b3b9c0',
  building: '#ffffff',
  edge: '#2e353d',
  label: '#737a84',
}

export type DrawingHandle = {
  /** rebuild the edge geometry from the currently loaded tiles */
  refresh(): void
}

const SOURCE = 'drawing'
const GRID = 'drawing-grid'
const EDGES = 'drawing-edges'
const EDGE_MINZOOM = 13
/** far-field tile budget relative to the near field: high enough that a pitched view stays at z13+ */
const LOD_TILE_RATIO = 50
/**
 * Edges draw before the buildings and write depth: a wall can't paint over its
 * own (camera-pulled) outline, while a building in front still hides lines
 * behind it. Edges after the extrusions break the extrusions under Terrain.
 */
const SOLID = [EDGES, 'drawing-buildings']
const LABELS = ['drawing-street-label', 'drawing-place-label']

const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']

/** road width per class at z10 / z18, in px */
const ROAD_WIDTH: Record<string, [number, number]> = {
  motorway: [1.6, 30],
  trunk: [1.4, 26],
  primary: [1.2, 22],
  secondary: [0.9, 18],
  tertiary: [0.8, 16],
  minor: [0.4, 11],
  service: [0.2, 7],
}

function roadWidth(extra: number): DataDrivenPropertyValueSpecification<number> {
  const at = (zoom: number, k: 0 | 1) =>
    [
      'match',
      ['get', 'class'],
      ...ROAD_CLASSES.flatMap(c => [c, ROAD_WIDTH[c][k] + extra * (zoom >= 14 ? 1 : 0.5)]),
      0,
    ] as unknown as ExpressionSpecification
  return ['interpolate', ['exponential', 1.6], ['zoom'], 10, at(10, 0), 18, at(18, 1)]
}

const roads: FilterSpecification = [
  'all',
  ['==', ['geometry-type'], 'LineString'],
  ['in', ['get', 'class'], ['literal', ROAD_CLASSES]],
]
const buildings3d: FilterSpecification = ['!=', ['get', 'hide_3d'], true]

/** white grid lines on transparent, tiled by `fill-pattern` over the water fill */
function gridSprite(color: string, opacity: number): Sprite {
  const size = 192
  const line = 2
  const [r, g, b] = rgb(color).map(c => c * 255)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (x >= line && y >= line) continue
      const o = (y * size + x) * 4
      data.set([r, g, b, 255 * opacity], o)
    }
  return { width: size, height: size, data, options: { pixelRatio: 2 } }
}

function layers(o: DrawingOptions): LayerSpecification[] {
  const p = o.palette
  const source = SOURCE
  const label = { 'text-font': o.font, 'text-size': 11 } as const

  const list: LayerSpecification[] = [
    { id: 'drawing-land', type: 'background', paint: { 'background-color': p.land } },
    {
      id: 'drawing-green',
      type: 'fill',
      source,
      'source-layer': 'park',
      paint: { 'fill-color': p.green },
    },
    {
      id: 'drawing-landcover',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland']]],
      paint: { 'fill-color': p.green, 'fill-opacity': 0.7 },
    },
    {
      id: 'drawing-water',
      type: 'fill',
      source,
      'source-layer': 'water',
      paint: { 'fill-color': p.water },
    },
    {
      id: 'drawing-water-grid',
      type: 'fill',
      source,
      'source-layer': 'water',
      minzoom: 11,
      layout: { visibility: o.waterGrid ? 'visible' : 'none' },
      paint: { 'fill-pattern': GRID },
    },
    {
      id: 'drawing-shore',
      type: 'line',
      source,
      'source-layer': 'water',
      paint: {
        'line-color': p.edge,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 16, 1],
        'line-opacity': 0.7,
      },
    },
    {
      id: 'drawing-waterway',
      type: 'line',
      source,
      'source-layer': 'waterway',
      paint: { 'line-color': p.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 3] },
    },
    {
      id: 'drawing-road-casing',
      type: 'line',
      source,
      'source-layer': 'transportation',
      filter: roads,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadCasing, 'line-width': roadWidth(2) },
    },
    {
      id: 'drawing-road',
      type: 'line',
      source,
      'source-layer': 'transportation',
      filter: roads,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.road, 'line-width': roadWidth(0) },
    },
    {
      id: 'drawing-rail',
      type: 'line',
      source,
      'source-layer': 'transportation',
      filter: ['==', ['get', 'class'], 'rail'],
      paint: { 'line-color': p.rail, 'line-width': 1, 'line-dasharray': [3, 2] },
    },
    {
      id: 'drawing-footprint',
      type: 'fill',
      source,
      'source-layer': 'building',
      minzoom: 13,
      maxzoom: o.buildingMinzoom,
      paint: { 'fill-color': p.building, 'fill-outline-color': p.edge },
    },
    {
      id: 'drawing-buildings',
      type: 'fill-extrusion',
      source,
      'source-layer': 'building',
      minzoom: o.buildingMinzoom,
      filter: buildings3d,
      paint: {
        'fill-extrusion-color': p.building,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-vertical-gradient': false,
      },
    },
  ]

  if (o.labels)
    list.push(
      {
        id: 'drawing-street-label',
        type: 'symbol',
        source,
        'source-layer': 'transportation_name',
        minzoom: 14,
        filter: ['in', ['get', 'class'], ['literal', ROAD_CLASSES]],
        layout: { ...label, 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-size': 10 },
        paint: { 'text-color': p.label, 'text-halo-color': p.road, 'text-halo-width': 1.4 },
      },
      {
        id: 'drawing-place-label',
        type: 'symbol',
        source,
        'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'quarter', 'village']]],
        layout: {
          ...label,
          'text-field': ['upcase', ['get', 'name']],
          'text-letter-spacing': 0.18,
          'text-size': ['match', ['get', 'class'], 'city', 13, 'town', 12, 10],
        },
        paint: { 'text-color': p.label, 'text-halo-color': p.land, 'text-halo-width': 1.6 },
      },
    )

  return list
}

/** edge pull toward the camera: meters + fraction of the camera distance */
const PULL: [number, number] = [0.5, 0.003]

/** angle (deg) between incoming and outgoing ring edges above which a wall corner gets a vertical edge */
const CORNER_COS = Math.cos((25 * Math.PI) / 180)

/** edge geometry is relative to an origin; past this (mercator units, ~80 km) the tile cache re-anchors */
const ORIGIN_RESET = 0.002
/** built tiles kept beyond the ones on screen, for zooming and panning back */
const SPARE_TILES = 96
/** ground samples per tile, re-checked while terrain tiles stream in */
const TILE_PROBES = 3
/** at most one edge rebuild per this many ms while the camera keeps moving */
const REBUILD_MS = 250
/** main-thread time one rebuild may spend building new tiles; the rest continue next slice */
const SLICE_MS = 8

type Ring = [number, number][]

/** growable float32 list: no boxed numbers on the way to the GPU */
class Floats {
  data = new Float32Array(4096)
  length = 0

  reserve(n: number) {
    if (this.length + n <= this.data.length) return
    let size = this.data.length * 2
    while (size < this.length + n) size *= 2
    const next = new Float32Array(size)
    next.set(this.data.subarray(0, this.length))
    this.data = next
  }

  segment(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    this.reserve(6)
    const d = this.data
    const i = this.length
    d[i] = ax
    d[i + 1] = ay
    d[i + 2] = az
    d[i + 3] = bx
    d[i + 4] = by
    d[i + 5] = bz
    this.length = i + 6
  }

  take() {
    return this.data.slice(0, this.length)
  }
}

/** one building piece in mercator: rings without their closing vertex, as flat x/y pairs */
type Outline = {
  rings: { xy: Float64Array; hole: boolean; poly: number }[]
  /** ground under each polygon, meters */
  lifts: number[]
  height: number
  base: number
  /** vertex count — of the pieces of one building clipped by tiles, the largest wins */
  size: number
}

type Props = Record<string, any>

const heights = (p: Props) => ({ height: p.render_height ?? 5, base: p.render_min_height ?? 0 })

/** average of a ring's distinct vertices (`xy` pairs), the point MapLibre lifts an extrusion by */
function centroid(xy: ArrayLike<number>, n: number): [number, number] {
  let x = 0
  let y = 0
  for (let i = 0; i < n; i++) {
    x += xy[i * 2]
    y += xy[i * 2 + 1]
  }
  return [x / (n || 1), y / (n || 1)]
}

/** GeoJSON polygon(s) in lng/lat → outline; terrain via `ground(lng, lat)` */
function outlineFromGeoJSON(geometry: { type: string; coordinates?: unknown }, props: Props, ground?: Ground): Outline | undefined {
  const { type, coordinates } = geometry
  const polys = type === 'Polygon' ? [coordinates as Ring[]] : type === 'MultiPolygon' ? (coordinates as Ring[][]) : []
  const rings: Outline['rings'] = []
  const lifts: number[] = []
  let size = 0
  polys.forEach((poly, p) => {
    poly.forEach((ring, i) => {
      size += ring.length
      const n = ring.length - 1 // closed ring: last == first
      const xy = new Float64Array(Math.max(0, n) * 2)
      for (let k = 0; k < n; k++) {
        xy[k * 2] = mercatorX(ring[k][0])
        xy[k * 2 + 1] = mercatorY(ring[k][1])
      }
      if (i === 0 && ground) {
        // Terrain lifts each polygon by the ground under its outer ring's centroid,
        // as MapLibre's extrusions do. Per polygon, not per feature: OpenMapTiles
        // merges many buildings into one MultiPolygon feature.
        const lnglat = ring.slice(0, Math.max(1, n)).flat()
        const [lng, lat] = centroid(lnglat, Math.max(1, n))
        lifts[p] = ground(lng, lat)
      }
      rings.push({ xy, hole: i > 0, poly: p })
    })
  })
  return rings.length ? { rings, lifts, ...heights(props), size } : undefined
}

type TilePoint = { x: number; y: number }
type CanonicalTile = { x: number; y: number; z: number }
/** the vector tile feature behind a `querySourceFeatures` result (MapLibre internals) */
type RawFeature = { extent: number; type: number; loadGeometry(): TilePoint[][] }

/**
 * Tile-space polygon(s) → outline, straight from the vector tile: no GeoJSON,
 * no trigonometry — tile units map linearly onto mercator. Rings are split
 * into polygons by winding, as the vector tile spec (and MapLibre) does.
 */
function outlineFromTile(raw: RawFeature, tile: CanonicalTile, props: Props, ground?: TileGround, probes?: number[]): Outline | undefined {
  if (raw.type !== 3) return undefined
  const { extent } = raw
  const scale = 1 / (extent * 2 ** tile.z)
  const x0 = tile.x * extent
  const y0 = tile.y * extent
  const rings: Outline['rings'] = []
  const lifts: number[] = []
  let size = 0
  let poly = -1
  let outerCcw: boolean | undefined

  for (const ring of raw.loadGeometry()) {
    const n = ring.length - 1
    if (n < 1) continue
    let area = 0
    for (let k = 0, j = n - 1; k < n; j = k++) area += (ring[k].x - ring[j].x) * (ring[j].y + ring[k].y)
    if (area === 0) continue
    const ccw = area < 0
    outerCcw ??= ccw
    const hole = ccw !== outerCcw
    if (!hole) poly++
    if (poly < 0) continue

    size += ring.length
    const xy = new Float64Array(n * 2)
    for (let k = 0; k < n; k++) {
      xy[k * 2] = (x0 + ring[k].x) * scale
      xy[k * 2 + 1] = (y0 + ring[k].y) * scale
    }
    if (!hole && ground) {
      let cx = 0
      let cy = 0
      for (let k = 0; k < n; k++) {
        cx += ring[k].x
        cy += ring[k].y
      }
      cx /= n
      cy /= n
      lifts[poly] = ground(tile, cx, cy, extent)
      if (probes && probes.length < TILE_PROBES * 3) probes.push(cx, cy, lifts[poly])
    }
    rings.push({ xy, hole, poly })
  }
  return rings.length ? { rings, lifts, ...heights(props), size } : undefined
}

/**
 * Line segments of one outline into `out`: roof outline, base outline and
 * vertical corner edges, `offset` meters outside the building (out from the
 * walls, up from the roof), relative to `origin`.
 */
function outlineEdges(o: Outline, origin: [number, number], offset: number, out: Floats) {
  const [ox, oy] = origin
  for (const { xy, hole, poly } of o.rings) {
    const n = xy.length / 2
    if (n < 3) continue
    const lift = o.lifts[poly] ?? 0
    const meter = mercatorMeterAtY(xy[1])
    const top = (lift + o.height + offset) * meter
    const bottom = (lift + o.base) * meter

    // outward = away from the building's material: right of a positive-area ring, flipped for holes
    let area = 0
    for (let i = 0, j = n - 1; i < n; j = i++) area += xy[j * 2] * xy[i * 2 + 1] - xy[i * 2] * xy[j * 2 + 1]
    const side = (area > 0 ? 1 : -1) * (hole ? -1 : 1)

    // per-edge unit normals: edge i runs from vertex i to i + 1
    const nx = new Float64Array(n)
    const ny = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const dx = xy[j * 2] - xy[i * 2]
      const dy = xy[j * 2 + 1] - xy[i * 2 + 1]
      const len = Math.hypot(dx, dy) || 1
      nx[i] = (side * dy) / len
      ny[i] = (-side * dx) / len
    }

    // vertices pushed out along the miter, capped so needle-sharp corners don't shoot out
    const px = new Float64Array(n)
    const py = new Float64Array(n)
    const corner = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const p = (i - 1 + n) % n
      const dot = nx[p] * nx[i] + ny[p] * ny[i]
      const mx = nx[p] + nx[i]
      const my = ny[p] + ny[i]
      const mlen = Math.hypot(mx, my) || 1
      const push = (offset * meter) / Math.sqrt(Math.max(0.35, (dot + 1) / 2))
      px[i] = xy[i * 2] - ox + (mx / mlen) * push
      py[i] = xy[i * 2 + 1] - oy + (my / mlen) * push
      corner[i] = dot < CORNER_COS ? 1 : 0
    }

    out.reserve(n * 18)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      out.segment(px[i], py[i], top, px[j], py[j], top)
      out.segment(px[i], py[i], bottom, px[j], py[j], bottom)
      if (corner[i]) out.segment(px[i], py[i], bottom, px[i], py[i], top)
    }
  }
}

/**
 * Line-segment list (xyz triplets, mercator units relative to `origin`) for
 * every building: roof outline, base outline and the vertical corner edges.
 *
 * Every line sits `offset` meters outside its building (out from the walls,
 * up from the roof); the shader then pulls it a little toward the camera.
 */
export function buildingEdges(
  features: { id?: string | number; geometry: { type: string; coordinates?: unknown }; properties: Record<string, any> }[],
  origin: [number, number],
  offset = 0.1,
  ground?: Ground,
): Float32Array {
  // the same building arrives once per tile it touches, clipped: keep its largest piece
  const best = new Map<string | number, Outline>()
  let anonymous = 0
  for (const f of features) {
    if (f.properties.hide_3d) continue
    const outline = outlineFromGeoJSON(f.geometry, f.properties, ground)
    if (!outline) continue
    const key = f.id ?? `anon-${anonymous++}`
    const prev = best.get(key)
    if (!prev || prev.size < outline.size) best.set(key, outline)
  }
  const out = new Floats()
  for (const outline of best.values()) outlineEdges(outline, origin, offset, out)
  return out.take()
}

const EDGE_VS = `
attribute vec3 a_pos;
uniform mat4 u_matrix;
uniform float u_centerW;
uniform vec3 u_camera;
uniform vec2 u_pull;
varying float v_fade;
void main() {
  // Slide toward the camera by a few meters in world space, so an edge wins
  // against its own faces. Unlike a clip-space depth bias this is a real
  // distance: a building across the street still hides the line.
  vec3 toCamera = u_camera - a_pos;
  float dist = length(toCamera);
  vec3 pos = a_pos + toCamera / dist * min(0.5 * dist, u_pull.x + u_pull.y * dist);
  gl_Position = u_matrix * vec4(pos, 1.0);
  // thin out toward the horizon, where a whole district of edges would merge into grey haze
  v_fade = clamp(2.6 - gl_Position.w / u_centerW, 0.0, 1.0);
}`

const EDGE_FS = `
precision mediump float;
uniform vec4 u_color;
varying float v_fade;
void main() { gl_FragColor = u_color * v_fade; }`

type EdgeState = {
  layer: CustomLayerInterface
  /** rebuild from the loaded tiles; `fresh` drops every cached tile first */
  rebuild(fresh?: boolean): void
  /** a terrain change: re-check the ground under cached tiles, rebuild those that moved */
  reground(): void
  setStyle(color: string, opacity: number): void
  setEnabled(on: boolean): void
  destroy(): void
}

/** a tile's building pieces, keyed by building id, with the ground samples they were built on */
type TileEdges = {
  tile: CanonicalTile
  pieces: Map<string | number, { size: number; data: Float32Array }>
  /** (x, y, ground) triplets in tile units */
  probes: number[]
}

type SourceFeature = { id?: string | number; properties: Props; geometry: { type: string; coordinates?: unknown } }
/** `querySourceFeatures` results carry their tile and raw feature (MapLibre internals) */
type TiledFeature = SourceFeature & { _vectorTileFeature?: RawFeature; _x?: number; _y?: number; _z?: number }

function edgeLayer(engine: JustMapEngine, color: string, opacity: number, enabled: boolean): EdgeState {
  const { map } = engine
  let gl: GL | undefined
  let prog: Program | undefined
  let buffer: WebGLBuffer | null = null
  let count = 0
  let origin: [number, number] = [0, 0]
  let rgba = [...rgb(color), opacity]

  // Buildings are cut once per tile they touch. Each tile's edges are built
  // once and cached; a rebuild only processes tiles that weren't seen before,
  // then concatenates — panning across a city costs the new tiles only.
  const cache = new Map<string, TileEdges>()
  let shown = ''
  /** continuation of a rebuild that ran out of its time slice */
  let resume = 0

  const buildTile = (tile: CanonicalTile, features: TiledFeature[], ground?: TileGround): TileEdges => {
    const pieces: TileEdges['pieces'] = new Map()
    const probes: number[] = []
    const out = new Floats()
    features.forEach((f, i) => {
      if (f.properties.hide_3d) return
      const outline = outlineFromTile(f._vectorTileFeature!, tile, f.properties, ground, probes)
      if (!outline) return
      out.length = 0
      outlineEdges(outline, origin, 0.1, out)
      const key = f.id ?? `${tile.z}/${tile.x}/${tile.y}#${i}`
      const prev = pieces.get(key)
      if (!prev || prev.size < outline.size) pieces.set(key, { size: outline.size, data: out.take() })
    })
    return { tile, pieces, probes }
  }

  const upload = (data: Float32Array) => {
    count = data.length / 3
    const context = gl!
    // outside render: MapLibre caches its buffer binding, so put it back
    preserveState(
      context,
      () => {
        context.bindBuffer(context.ARRAY_BUFFER, buffer)
        context.bufferData(context.ARRAY_BUFFER, data, context.STATIC_DRAW)
      },
      map,
    )
    map.triggerRepaint()
  }

  const rebuild = (fresh = false) => {
    if (!gl || !enabled || map.getZoom() < EDGE_MINZOOM - 0.5) return
    const c = map.getCenter()
    const center: [number, number] = [mercatorX(c.lng), mercatorY(c.lat)]
    if (fresh || !cache.size || Math.hypot(center[0] - origin[0], center[1] - origin[1]) > ORIGIN_RESET) {
      cache.clear()
      origin = center
      shown = ''
    }

    const features = map.querySourceFeatures(SOURCE, { sourceLayer: 'building' }) as TiledFeature[]
    const byTile = new Map<string, { tile: CanonicalTile; features: TiledFeature[] }>()
    const loose: TiledFeature[] = []
    for (const f of features) {
      if (f._vectorTileFeature?.loadGeometry && f._z !== undefined) {
        const key = `${f._z}/${f._x}/${f._y}`
        let group = byTile.get(key)
        if (!group) byTile.set(key, (group = { tile: { z: f._z, x: f._x!, y: f._y! }, features: [] }))
        group.features.push(f)
      } else loose.push(f)
    }

    const keys = [...byTile.keys()].sort()
    const signature = keys.join(',')
    const ground = byTile.size ? tileGroundSampler(map, SOURCE) : undefined
    // Time-sliced: a fresh city (first load, terrain toggled) builds over a few
    // frames, nearest tiles first, instead of one long frame drop.
    const distance = (key: string) => {
      const { z, x, y } = byTile.get(key)!.tile
      const n = 2 ** z
      return Math.hypot((x + 0.5) / n - center[0], (y + 0.5) / n - center[1])
    }
    const nearest = keys.map(key => [distance(key), key] as const).sort((p, q) => p[0] - q[0])
    const deadline = performance.now() + SLICE_MS
    let built = false
    let pending = false
    for (const [, key] of nearest) {
      const hit = cache.get(key)
      if (hit) {
        // most recently used last, for eviction
        cache.delete(key)
        cache.set(key, hit)
        continue
      }
      if (performance.now() > deadline) {
        pending = true
        continue
      }
      const { tile, features: tileFeatures } = byTile.get(key)!
      cache.set(key, buildTile(tile, tileFeatures, ground))
      built = true
    }
    window.clearTimeout(resume)
    if (pending) resume = window.setTimeout(() => rebuild(), 0)
    if (!built && !loose.length && signature === shown) return
    // an unfinished build doesn't count as shown: the continuation reassembles
    shown = pending ? '' : signature

    // the same building from several tiles: its largest piece wins
    const best = new Map<string | number, { size: number; data: Float32Array }>()
    for (const key of keys)
      for (const [id, piece] of cache.get(key)?.pieces ?? []) {
        const prev = best.get(id)
        if (!prev || prev.size < piece.size) best.set(id, piece)
      }
    // features without tile internals (other MapLibre builds) take the GeoJSON path, uncached
    const extra = loose.length ? buildingEdges(loose, origin, 0.1, extrusionGroundSampler(map, SOURCE)) : undefined

    let total = extra?.length ?? 0
    for (const piece of best.values()) total += piece.data.length
    const data = new Float32Array(total)
    let at = 0
    for (const piece of best.values()) {
      data.set(piece.data, at)
      at += piece.data.length
    }
    if (extra) data.set(extra, at)
    upload(data)

    // evict least recently used tiles beyond the spare budget
    const limit = keys.length + SPARE_TILES
    for (const key of cache.keys()) {
      if (cache.size <= limit) break
      cache.delete(key)
    }
  }

  // Terrain tiles load without map events (and a live map is never idle), so
  // re-check a few building grounds per tile; tiles whose ground moved rebuild.
  const reground = () => {
    if (!gl || !enabled || !cache.size) return
    const ground = tileGroundSampler(map, SOURCE)
    let stale = false
    for (const [key, { tile, probes }] of cache) {
      if (!ground) {
        // terrain went away: anything built on it is stale
        if (probes.length) {
          cache.delete(key)
          stale = true
        }
        continue
      }
      for (let i = 0; i < probes.length; i += 3)
        if (Math.abs(ground(tile, probes[i], probes[i + 1], 8192) - probes[i + 2]) > 0.5) {
          cache.delete(key)
          stale = true
          break
        }
    }
    if (stale) rebuild()
  }
  const terrainWatch = window.setInterval(() => {
    if (!document.hidden && map.getTerrain()) reground()
  }, 1000)

  const layer: CustomLayerInterface = {
    id: EDGES,
    type: 'custom',
    renderingMode: '3d',

    onAdd(_map, context) {
      gl = context
      prog = program(gl, EDGE_VS, EDGE_FS, ['a_pos'], ['u_matrix', 'u_color', 'u_centerW', 'u_camera', 'u_pull'])
      buffer = gl.createBuffer()
      cache.clear()
      rebuild()
    },

    onRemove() {
      if (gl && buffer) gl.deleteBuffer(buffer)
      if (gl && prog) gl.deleteProgram(prog.program)
      gl = undefined
      cache.clear()
    },

    render(context: GL, args: CustomRenderMethodInput) {
      preserveState(context, () => drawEdges(context, args), map)
    },
  }

  function drawEdges(context: GL, args: CustomRenderMethodInput) {
    const zoom = map.getZoom()
    if (!prog || !count || zoom < EDGE_MINZOOM) return
    const g = context
    // fade in over the first zoom level so edges don't pop
    const fade = Math.min(1, zoom - EDGE_MINZOOM)
    const a = rgba[3] * fade

    releaseVao(g)
    g.useProgram(prog.program)
    const m = args.defaultProjectionData.mainMatrix
    g.uniformMatrix4fv(prog.uniform.u_matrix, false, new Float32Array(multiply(m, translation(origin[0], origin[1]))))
    // clip-space w of the map center = camera distance to what the user is looking at
    const c = map.getCenter()
    const centerW = m[3] * mercatorX(c.lng) + m[7] * mercatorY(c.lat) + m[15]
    g.uniform1f(prog.uniform.u_centerW, centerW)
    const meter = mercatorMeter(c.lat)
    const [cx, cy, cz] = cameraPosition(m)
    g.uniform3f(prog.uniform.u_camera, cx - origin[0], cy - origin[1], cz)
    g.uniform2f(prog.uniform.u_pull, PULL[0] * meter, PULL[1])
    g.uniform4f(prog.uniform.u_color, rgba[0] * a, rgba[1] * a, rgba[2] * a, a)

    g.enable(g.DEPTH_TEST)
    g.depthFunc(g.LEQUAL)
    g.depthMask(true)
    g.enable(g.BLEND)
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)

    g.bindBuffer(g.ARRAY_BUFFER, buffer)
    const loc = prog.attrib.a_pos
    g.enableVertexAttribArray(loc)
    g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0)
    g.drawArrays(g.LINES, 0, count)
    g.disableVertexAttribArray(loc)
  }

  return {
    layer,
    rebuild,
    reground,
    setStyle(c, o) {
      rgba = [...rgb(c), o]
      map.triggerRepaint()
    },
    setEnabled(on) {
      if (on === enabled) return
      enabled = on
      if (on) rebuild()
    },
    destroy() {
      window.clearInterval(terrainWatch)
      window.clearTimeout(resume)
    },
  }
}

/**
 * Restack once every module has drawn: buildings + edges go above the
 * siblings' lines and fills (they're 2D and would bleed through walls) but
 * below their symbols and 3D custom layers; our labels go above all overlays.
 */
function stack(map: JustMapEngine['map'], own: string[]) {
  const mine = new Set(own)
  // getStyle() drops custom layers; the live order keeps them
  const siblings = map.getLayersOrder().filter(id => !mine.has(id))
  const type = (id: string) => map.getLayer(id)?.type
  const above3d = siblings.find(id => type(id) === 'symbol' || type(id) === 'custom')
  const aboveLabels = siblings.find(id => type(id) === 'symbol')
  for (const id of SOLID) if (map.getLayer(id)) map.moveLayer(id, above3d)
  for (const id of LABELS) if (map.getLayer(id)) map.moveLayer(id, aboveLabels)
}

type State = DrawingHandle & {
  options: DrawingOptions
  edges: EdgeState
  ids: string[]
  regrid(options: DrawingOptions): void
  cleanup(): void
}

const LIGHT: LightSpecification = { anchor: 'map', color: '#ffffff', intensity: 0.22, position: [1.4, 215, 35] }

/**
 * The white architectural-model map: pale land, white roads with hairline
 * casings, teal water with a nautical grid, white extruded buildings with
 * pen-drawn 3D edges. A complete base — use instead of `Render` / `Style`.
 * Edges and grid assume the mercator projection (set `camera.projection`).
 */
export const Drawing = module<DrawingOptions>({
  name: 'Drawing',
  // a pitched 3D scene: lets Gestures tilt and FollowCam pitch without Terrain
  provides: ['3d'],
  defaults: {
    url: 'https://tiles.openfreemap.org/planet',
    palette: DRAWING_PALETTE,
    waterGrid: true,
    gridOpacity: 0.32,
    edges: true,
    edgeOpacity: 0.85,
    buildingMinzoom: 13,
    lodLevels: 2,
    labels: true,
    font: FONT,
    occlude: true,
    visible: true,
  },

  create(engine: JustMapEngine, options: DrawingOptions) {
    const { map } = engine
    const previousLight = map.getLight()
    map.setLight(LIGHT)

    let offGrid = keepImage(map, GRID, () => gridSprite(options.palette.grid, options.gridOpacity))
    map.addSource(SOURCE, { type: 'vector', url: options.url })
    map.setSourceTileLodParams(options.lodLevels, LOD_TILE_RATIO, SOURCE)
    const specs = layers(options)
    for (const l of specs) map.addLayer(l)

    const edges = edgeLayer(engine, options.palette.edge, options.edgeOpacity, options.edges && options.visible)
    map.addLayer(edges.layer, 'drawing-buildings')
    const offReady = engine.on('ready', () => {
      if (state.options.occlude) stack(map, state.ids)
    })

    // Throttled, not debounced: a camera that never stops (follow mode jumps
    // every frame) still gets fresh edges. Cached tiles make a rebuild cheap.
    let timer = 0
    let lastRun = 0
    let regroundNext = false
    const schedule = () => {
      if (timer) return
      timer = window.setTimeout(
        () => {
          timer = 0
          lastRun = performance.now()
          if (regroundNext) {
            regroundNext = false
            edges.reground()
          }
          edges.rebuild()
        },
        Math.max(60, lastRun + REBUILD_MS - performance.now()),
      )
    }
    const onData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (!e.isSourceLoaded) return
      if (e.sourceId === SOURCE) schedule()
      // terrain tiles arriving move buildings' ground: re-check the tiles built on it
      else if (e.sourceId === map.getTerrain()?.source) {
        regroundNext = true
        schedule()
      }
    }
    const onTerrain = () => edges.rebuild(true)
    map.on('sourcedata', onData)
    map.on('moveend', schedule)
    map.on('terrain', onTerrain)

    const state: State = {
      options,
      edges,
      ids: [...specs.map(l => l.id), EDGES],
      refresh: () => edges.rebuild(true),

      // the grid sprite bakes palette.grid + gridOpacity in
      regrid(o) {
        offGrid()
        offGrid = keepImage(map, GRID, () => gridSprite(o.palette.grid, o.gridOpacity))
      },

      cleanup() {
        offReady()
        window.clearTimeout(timer)
        map.off('sourcedata', onData)
        map.off('moveend', schedule)
        map.off('terrain', onTerrain)
        edges.destroy()
        for (const id of state.ids) if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(SOURCE)) map.removeSource(SOURCE)
        offGrid()
        map.setLight(previousLight ?? { anchor: 'viewport' })
      },
    }

    applyVisibility(engine, state, options)
    return state
  },

  update(state: State, options, prev, engine) {
    const { map } = engine
    state.options = options

    const restyle =
      options.palette !== prev.palette ||
      options.labels !== prev.labels ||
      options.font !== prev.font ||
      options.buildingMinzoom !== prev.buildingMinzoom
    if (restyle) {
      // re-add our layers under the siblings' (the flat base at the bottom), then restack
      const own = new Set(state.ids)
      for (const id of state.ids) if (id !== EDGES && map.getLayer(id)) map.removeLayer(id)
      const firstSibling = map.getLayersOrder().find(id => !own.has(id))
      const specs = layers(options)
      for (const l of specs) map.addLayer(l, firstSibling)
      state.ids = [...specs.map(l => l.id), EDGES]
      map.moveLayer(EDGES, 'drawing-buildings')
      if (options.occlude) stack(map, state.ids)
    }
    if (options.palette.grid !== prev.palette.grid || options.gridOpacity !== prev.gridOpacity) state.regrid(options)
    if (options.palette.edge !== prev.palette.edge || options.edgeOpacity !== prev.edgeOpacity)
      state.edges.setStyle(options.palette.edge, options.edgeOpacity)

    if (options.lodLevels !== prev.lodLevels) map.setSourceTileLodParams(options.lodLevels, LOD_TILE_RATIO, SOURCE)
    applyVisibility(engine, state, options)
  },

  destroy(state: State) {
    state.cleanup()
  },
})

function applyVisibility(engine: JustMapEngine, state: State, o: DrawingOptions) {
  const { map } = engine
  for (const id of state.ids) {
    const on = o.visible && (id === 'drawing-water-grid' ? o.waterGrid : id === EDGES ? o.edges : true)
    map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }
  // hidden edges skip their rebuilds too
  state.edges.setEnabled(o.visible && o.edges)
}
