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
import {
  mercatorMeter,
  mercatorX,
  mercatorY,
  multiply,
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
const SOLID = ['drawing-buildings', EDGES]
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

/** angle (deg) between incoming and outgoing ring edges above which a wall corner gets a vertical edge */
const CORNER_DEG = 25

type Ring = [number, number][]

/**
 * Line-segment list (xyz triplets, mercator units relative to `origin`) for
 * every building: roof outline, base outline and the vertical corner edges.
 */
export function buildingEdges(
  features: { id?: string | number; geometry: { type: string; coordinates?: unknown }; properties: Record<string, any> }[],
  origin: [number, number],
): Float32Array {
  // the same building arrives once per tile it touches, clipped: keep its largest piece
  const best = new Map<string | number, { rings: Ring[]; size: number; height: number; base: number }>()
  let anonymous = 0

  for (const f of features) {
    if (f.properties.hide_3d) continue
    const { type, coordinates } = f.geometry
    const polys = type === 'Polygon' ? [coordinates as Ring[]] : type === 'MultiPolygon' ? (coordinates as Ring[][]) : []
    const rings = polys.flat()
    if (!rings.length) continue

    const size = rings.reduce((n, r) => n + r.length, 0)
    const key = f.id ?? `anon-${anonymous++}`
    const prev = best.get(key)
    if (prev && prev.size >= size) continue
    best.set(key, {
      rings,
      size,
      height: f.properties.render_height ?? 5,
      base: f.properties.render_min_height ?? 0,
    })
  }

  const out: number[] = []
  const [ox, oy] = origin
  for (const { rings, height, base } of best.values()) {
    for (const ring of rings) {
      const n = ring.length - 1 // closed ring: last == first
      if (n < 3) continue
      const meter = mercatorMeter(ring[0][1])
      const top = (height + 0.05) * meter
      const bottom = base * meter
      const pts = ring.slice(0, n).map(([lng, lat]) => [mercatorX(lng) - ox, mercatorY(lat) - oy])

      for (let i = 0; i < n; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % n]
        out.push(a[0], a[1], top, b[0], b[1], top)
        out.push(a[0], a[1], bottom, b[0], b[1], bottom)

        const prev = pts[(i - 1 + n) % n]
        const turn = Math.abs(
          ((Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.atan2(a[1] - prev[1], a[0] - prev[0]) + 3 * Math.PI) %
            (2 * Math.PI)) -
            Math.PI,
        )
        if (turn > (CORNER_DEG * Math.PI) / 180) out.push(a[0], a[1], bottom, a[0], a[1], top)
      }
    }
  }
  return new Float32Array(out)
}

const EDGE_VS = `
attribute vec3 a_pos;
uniform mat4 u_matrix;
uniform float u_centerW;
varying float v_fade;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  // thin out toward the horizon, where a whole district of edges would merge into grey haze
  v_fade = clamp(2.6 - gl_Position.w / u_centerW, 0.0, 1.0);
  // pull edges a hair toward the camera so they win against their own faces
  gl_Position.z -= 0.0004 * gl_Position.w;
}`

const EDGE_FS = `
precision mediump float;
uniform vec4 u_color;
varying float v_fade;
void main() { gl_FragColor = u_color * v_fade; }`

type EdgeState = {
  layer: CustomLayerInterface
  rebuild(): void
  setStyle(color: string, opacity: number): void
}

function edgeLayer(engine: JustMapEngine, color: string, opacity: number): EdgeState {
  const { map } = engine
  let gl: GL | undefined
  let prog: Program | undefined
  let buffer: WebGLBuffer | null = null
  let count = 0
  let origin: [number, number] = [0, 0]
  let rgba = [...rgb(color), opacity]

  const rebuild = () => {
    if (!gl || map.getZoom() < EDGE_MINZOOM - 0.5) return
    const c = map.getCenter()
    origin = [mercatorX(c.lng), mercatorY(c.lat)]
    const features = map.querySourceFeatures(SOURCE, { sourceLayer: 'building' })
    const data = buildingEdges(features, origin)
    count = data.length / 3
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    map.triggerRepaint()
  }

  const layer: CustomLayerInterface = {
    id: EDGES,
    type: 'custom',
    renderingMode: '3d',

    onAdd(_map, context) {
      gl = context
      prog = program(gl, EDGE_VS, EDGE_FS, ['a_pos'], ['u_matrix', 'u_color', 'u_centerW'])
      buffer = gl.createBuffer()
      rebuild()
    },

    onRemove() {
      if (gl && buffer) gl.deleteBuffer(buffer)
      if (gl && prog) gl.deleteProgram(prog.program)
      gl = undefined
    },

    render(context: GL, args: CustomRenderMethodInput) {
      const zoom = map.getZoom()
      if (!prog || !count || zoom < EDGE_MINZOOM) return
      const g = context
      // fade in over the first zoom level so edges don't pop
      const fade = Math.min(1, zoom - EDGE_MINZOOM)
      const a = rgba[3] * fade

      releaseVao(g)
      g.useProgram(prog.program)
      const matrix = multiply(args.defaultProjectionData.mainMatrix, translation(origin[0], origin[1]))
      g.uniformMatrix4fv(prog.uniform.u_matrix, false, new Float32Array(matrix))
      // clip-space w of the map center = camera distance to what the user is looking at
      const m = args.defaultProjectionData.mainMatrix
      const c = map.getCenter()
      const centerW = m[3] * mercatorX(c.lng) + m[7] * mercatorY(c.lat) + m[15]
      g.uniform1f(prog.uniform.u_centerW, centerW)
      g.uniform4f(prog.uniform.u_color, rgba[0] * a, rgba[1] * a, rgba[2] * a, a)

      g.enable(g.DEPTH_TEST)
      g.depthFunc(g.LEQUAL)
      g.depthMask(false)
      g.enable(g.BLEND)
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)

      g.bindBuffer(g.ARRAY_BUFFER, buffer)
      const loc = prog.attrib.a_pos
      g.enableVertexAttribArray(loc)
      g.vertexAttribPointer(loc, 3, g.FLOAT, false, 0, 0)
      g.drawArrays(g.LINES, 0, count)
      g.disableVertexAttribArray(loc)
    },
  }

  return {
    layer,
    rebuild,
    setStyle(c, o) {
      rgba = [...rgb(c), o]
      map.triggerRepaint()
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

    const edges = edgeLayer(engine, options.palette.edge, options.edgeOpacity)
    map.addLayer(edges.layer)
    const offReady = engine.on('ready', () => {
      if (state.options.occlude) stack(map, state.ids)
    })

    let timer = 0
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(edges.rebuild, 120)
    }
    const onData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (e.sourceId === SOURCE && e.isSourceLoaded) schedule()
    }
    map.on('sourcedata', onData)
    map.on('moveend', schedule)

    const state: State = {
      options,
      edges,
      ids: [...specs.map(l => l.id), EDGES],
      refresh: edges.rebuild,

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
}
