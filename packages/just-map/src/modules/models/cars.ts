import maplibregl from 'maplibre-gl'
import type { CustomLayerInterface, CustomRenderMethodInput, GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import { FONT } from '../../core/style'
import { distKm, lerpAngle, lerpCoord } from '../../utils/geo'
import {
  instancing,
  mercatorMeter,
  mercatorX,
  mercatorY,
  metersPerPixel,
  multiply,
  preserveState,
  program,
  releaseVao,
  rgb,
  StreamBuffer,
  translation,
  type GL,
  type Instancing,
  type Program,
} from '../../utils/gl'
import { keepImage, pillSprite } from '../../utils/images'
import { groundSampler } from '../../utils/terrain'
import type { Coord } from '../../utils/types'
import { carMesh, STRIDE, type CarKind } from './car-mesh'

export type Car = {
  id: string
  coord: Coord
  /** degrees, 0 = north */
  heading?: number
  /** body style; default `sedan` */
  kind?: CarKind
  /** paint color `#rrggbb`; default `paint` option */
  color?: string
  /** key into `colors` — tints the ground ring */
  status?: string
  /** label text; defaults to the id */
  label?: string
}

export type CarLabels = 'all' | 'selected' | 'none'

export type CarsOptions = {
  data: Car[]
  /** status → ground ring color; statuses missing here get no ring */
  colors: Record<string, string>
  /** default paint */
  paint: string
  /** ink outline around the shell (the drawing look), or false */
  outline: string | false
  /** outline width, px */
  outlineWidth: number
  /** cars never draw shorter than this many px — real size when zoomed in, exaggerated when zoomed out */
  minSize: number
  /** extra multiplier on top of real size */
  scale: number
  /** soft contact shadow under each car */
  shadow: boolean
  /** cars overlapping on screen merge into one, labelled `+n`; a click zooms in (or cycles co-located cars) */
  cluster: boolean
  selectedId?: string
  labels: CarLabels
  font: string[]
  /** ms to glide between positions on `data` changes; 0 jumps, moves over 5 km always jump */
  tween: number
  onSelect?(id: string): void
}

/** imperative handle for `Cars` (`engine.module<CarsHandle>('Cars')`) */
export type CarsHandle = {
  /** new positions; glides when `tween` > 0 — call every frame with `tween: 0` for continuous motion */
  setData(data: Car[]): void
  select(id?: string): void
  /** the car as currently drawn (mid-glide included) */
  get(id: string): Car | undefined
  fit(ids?: string[], options?: { padding?: number; maxZoom?: number; duration?: number }): void
  flyTo(id: string, zoom?: number): void
}

const LAYER = 'cars'
const LABELS = 'cars-label'
const PILL = 'cars-pill'
const MAX_TWEEN_KM = 5
/** reference car length for `minSize`, so trucks still read bigger than sedans when exaggerated */
const REF_LENGTH = 4.7
const PICK_MIN_PX = 16
/** a group tighter than this can't be zoomed apart — clicks cycle through it instead */
const CO_LOCATED_M = 12

// ---------------------------------------------------------------------------------------------
// shaders

// One instanced draw per car kind: the per-car transform lives in instance
// attributes, so a fleet costs a few draw calls instead of a few per car.
//   i_offset  mercator position relative to the frame's origin; z = ground lift
//   i_frame   cos(heading), sin(heading), scale (mercator units per model meter), outline inflate (model meters)
const CAR_VS = `
attribute vec3 a_pos;
attribute vec3 a_normal;
attribute vec3 a_color;
attribute float a_mat;
attribute vec3 i_offset;
attribute vec4 i_frame;
attribute vec3 i_paint;
uniform mat4 u_matrix;
uniform float u_inflate;
uniform vec3 u_light;
uniform vec3 u_view;
varying vec3 v_normal;
varying vec3 v_color;
varying vec3 v_paint;
varying vec3 v_light;
varying vec3 v_view;
varying float v_mat;
void main() {
  float c = i_frame.x;
  float s = i_frame.y;
  float k = i_frame.z;
  vec3 p = a_pos + a_normal * (i_frame.w * u_inflate);
  // model (x right, y forward, z up) -> mercator (x east, y south), turned by the heading
  vec3 world = vec3(k * (c * p.x + s * p.y), k * (s * p.x - c * p.y), k * p.z);
  gl_Position = u_matrix * vec4(i_offset + world, 1.0);
  // light and eye into model space, where the shading happens
  v_light = vec3(u_light.x * c - u_light.y * s, u_light.x * s + u_light.y * c, u_light.z);
  v_view = vec3(u_view.x * c - u_view.y * s, u_view.x * s + u_view.y * c, u_view.z);
  v_normal = a_normal;
  v_color = a_color;
  v_paint = i_paint;
  v_mat = a_mat;
}`

const CAR_FS = `
precision mediump float;
uniform vec4 u_ink;
varying vec3 v_normal;
varying vec3 v_color;
varying vec3 v_paint;
varying vec3 v_light;
varying vec3 v_view;
varying float v_mat;
void main() {
  if (u_ink.a > 0.0) { gl_FragColor = vec4(u_ink.rgb, 1.0); return; }
  if (v_mat > 2.5) { gl_FragColor = vec4(v_color, 1.0); return; }

  vec3 n = normalize(v_normal);
  bool glass = v_mat > 0.5 && v_mat < 1.5;
  bool matte = v_mat > 1.5;
  vec3 base = v_mat < 0.5 ? v_paint : v_color;

  float diffuse = max(dot(n, v_light), 0.0);
  float hemi = 0.5 + 0.5 * n.z;
  vec3 sky = vec3(0.86, 0.9, 0.95);
  vec3 ambient = mix(vec3(0.6, 0.61, 0.64), sky, hemi);

  vec3 h = normalize(v_light + v_view);
  float shine = glass ? 140.0 : matte ? 10.0 : 70.0;
  float ks = glass ? 0.9 : matte ? 0.04 : 0.32;
  float spec = ks * pow(max(dot(n, h), 0.0), shine);
  float fresnel = pow(1.0 - max(dot(n, v_view), 0.0), 3.0);

  vec3 color = base * (ambient * 0.72 + diffuse * 0.36);
  if (glass) color = mix(color, sky * 0.55, 0.12 + 0.55 * fresnel * hemi);
  else if (!matte) color += sky * fresnel * 0.18;
  gl_FragColor = vec4(color + spec, 1.0);
}`

// ground decals (shadows, rings, halos), instanced: i_axes are the mesh's x and y axes in mercator
const GROUND_VS = `
attribute vec2 a_pos;
attribute float a_alpha;
attribute vec3 i_offset;
attribute vec4 i_axes;
attribute vec4 i_color;
uniform mat4 u_matrix;
varying vec4 v_color;
void main() {
  v_color = i_color * a_alpha;
  vec2 xy = i_offset.xy + i_axes.xy * a_pos.x + i_axes.zw * a_pos.y;
  gl_Position = u_matrix * vec4(xy, i_offset.z, 1.0);
}`

const GROUND_FS = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = v_color; }`

/** floats per instance */
const CAR_INSTANCE = 10
const GROUND_INSTANCE = 11

// ---------------------------------------------------------------------------------------------
// ground meshes (unit size, scaled per car)

/** elliptical blob: solid core out to `core`, fading to 0 at the rim */
function shadowMesh(core = 0.62) {
  const SEG = 32
  const out: number[] = []
  const p = (r: number, a: number, alpha: number) => [r * Math.cos(a), r * Math.sin(a), alpha]
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2
    const a1 = ((i + 1) / SEG) * Math.PI * 2
    out.push(0, 0, 1, ...p(core, a0, 1), ...p(core, a1, 1))
    out.push(...p(core, a0, 1), ...p(1, a0, 0), ...p(1, a1, 0), ...p(core, a0, 1), ...p(1, a1, 0), ...p(core, a1, 1))
  }
  return new Float32Array(out)
}

/** annulus, inner radius `inner`, outer 1 */
function ringMesh(inner: number) {
  const SEG = 48
  const out: number[] = []
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2
    const a1 = ((i + 1) / SEG) * Math.PI * 2
    const p = (r: number, a: number) => [r * Math.cos(a), r * Math.sin(a), 1]
    out.push(...p(inner, a0), ...p(1, a0), ...p(1, a1), ...p(inner, a0), ...p(1, a1), ...p(inner, a1))
  }
  return new Float32Array(out)
}

// ---------------------------------------------------------------------------------------------

const LIGHT_WORLD: [number, number, number] = (() => {
  const az = (215 * Math.PI) / 180
  const polar = (42 * Math.PI) / 180
  return [-Math.sin(az) * Math.sin(polar), -Math.cos(az) * Math.sin(polar), Math.cos(polar)]
})()

/** `#rrggbb` → 0..1 channels, memoized: statuses and paints repeat across a fleet */
const COLORS = new Map<string, [number, number, number]>()
const color3 = (hex: string) => {
  let c = COLORS.get(hex)
  if (!c) COLORS.set(hex, (c = rgb(hex)))
  return c
}

type Gpu = { buffer: WebGLBuffer; count: number; hull: WebGLBuffer; hullCount: number }

/** a car placed on screen this frame */
type Placed = ScreenCar & {
  kind: CarKind
  /** exaggeration */
  k: number
  /** mercator position and ground lift */
  mx: number
  my: number
  lift: number
  /** mercator units per model meter (exaggeration included) */
  scale: number
  cos: number
  sin: number
}

type PlacedGroup = { leader: Placed; count: number; members: Car[] }

const KIND_ORDER: Record<CarKind, number> = { sedan: 0, suv: 1, van: 2, truck: 3 }

type State = CarsHandle & {
  options: CarsOptions
  /** groups from the last frame — what's on screen, for picking */
  placed: PlacedGroup[]
  labelKey: string
  from: Map<string, Car>
  to: Car[]
  t0: number
  shown(now: number): Car[]
  cleanup(): void
}

const tweens = (a: Car, b: Car) => distKm(a.coord, b.coord) <= MAX_TWEEN_KM

function between(a: Car, b: Car, u: number): Car {
  const heading = a.heading === undefined || b.heading === undefined ? b.heading : lerpAngle(a.heading, b.heading, u)
  return { ...b, coord: lerpCoord(a.coord, b.coord, u), heading }
}

/** cars drawn as one: the leader is shown, `members` (leader included) are folded into it */
export type CarGroup = { leader: Car; members: Car[] }

/** a car's footprint on screen: center and drawn length in px */
export type ScreenCar = { car: Car; x: number; y: number; size: number }

/**
 * Greedy screen-space grouping: cars whose drawn bodies overlap fold into the
 * first one in priority order (the selected car, then data order), so a stack
 * of cars reads as one car with a count instead of a tangle of rings and labels.
 */
export function clusterCars(cars: ScreenCar[], selectedId?: string, overlap = 0.8): CarGroup[] {
  const n = cars.length
  // priority: the selected car first, then data order
  const order: number[] = []
  for (let i = 0; i < n; i++) if (cars[i].car.id === selectedId) order.push(i)
  for (let i = 0; i < n; i++) if (cars[i].car.id !== selectedId) order.push(i)
  const rank = new Int32Array(n)
  order.forEach((i, r) => (rank[i] = r))

  // Spatial hash with cells as wide as the longest reach: a lead only checks
  // its 3×3 neighborhood, so a fleet groups in ~linear time, not n².
  let maxSize = 0
  for (const c of cars) maxSize = Math.max(maxSize, c.size)
  const cell = Math.max(1, maxSize * overlap)
  const cells = new Map<number, number[]>()
  const keyOf = (cx: number, cy: number) => cx * 73856093 + cy
  for (const i of order) {
    const k = keyOf(Math.floor(cars[i].x / cell), Math.floor(cars[i].y / cell))
    const list = cells.get(k)
    if (list) list.push(i)
    else cells.set(k, [i])
  }

  const taken = new Uint8Array(n)
  const groups: CarGroup[] = []
  for (const i of order) {
    if (taken[i]) continue
    taken[i] = 1
    const lead = cars[i]
    const found: number[] = []
    const cx = Math.floor(lead.x / cell)
    const cy = Math.floor(lead.y / cell)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of cells.get(keyOf(cx + dx, cy + dy)) ?? []) {
          if (taken[j]) continue
          const other = cars[j]
          const reach = ((lead.size + other.size) / 2) * overlap
          if (Math.hypot(other.x - lead.x, other.y - lead.y) < reach) found.push(j)
        }
    found.sort((p, q) => rank[p] - rank[q])
    const members = [lead.car]
    for (const j of found) {
      taken[j] = 1
      members.push(cars[j].car)
    }
    groups.push({ leader: lead.car, members })
  }
  return groups
}

export function carCollection(groups: CarGroup[]) {
  return {
    type: 'FeatureCollection' as const,
    features: groups.map(({ leader, members }) => {
      const label = leader.label ?? leader.id
      return {
        type: 'Feature' as const,
        properties: {
          id: leader.id,
          label: members.length > 1 ? `${label}  +${members.length - 1}` : label,
          count: members.length,
        },
        geometry: { type: 'Point' as const, coordinates: leader.coord },
      }
    }),
  }
}

const single = (cars: Car[]): CarGroup[] => cars.map(c => ({ leader: c, members: [c] }))

/** lower sorts first = placed first: the selected car's label survives collisions */
const labelPriority = (selectedId?: string): maplibregl.DataDrivenPropertyValueSpecification<number> => [
  'case',
  ['==', ['get', 'id'], selectedId ?? ''],
  0,
  1,
]

/** label filter for the current mode */
const labelFilter = (labels: CarLabels, selectedId?: string): maplibregl.FilterSpecification =>
  labels === 'all' ? ['has', 'id'] : labels === 'selected' ? ['==', ['get', 'id'], selectedId ?? ''] : ['==', 1, 0]

/**
 * 3D car models on the map — minimal Tesla-style shells (sedan, SUV, van,
 * truck) with glass canopies, contact shadows, status rings and an optional
 * ink outline that matches `Drawing`. Rendered with plain WebGL in a custom
 * layer; assumes the mercator projection, and sits on `Terrain` when present.
 */
export const Cars = module<CarsOptions>({
  name: 'Cars',
  defaults: {
    data: [],
    colors: { driving: '#16a34a', idle: '#f59e0b', stopped: '#64748b', offline: '#a1a1aa', alert: '#ef4444' },
    paint: '#f4f5f7',
    outline: '#2e353d',
    outlineWidth: 1.1,
    minSize: 34,
    scale: 1,
    shadow: true,
    cluster: true,
    labels: 'all',
    font: FONT,
    tween: 800,
  },

  create(engine: JustMapEngine, options: CarsOptions) {
    const { map } = engine
    let gl: GL | undefined
    let inst: Instancing | undefined
    let carProg: Program | undefined
    let groundProg: Program | undefined
    const gpu = new Map<CarKind, Gpu>()
    let shadowBuf: WebGLBuffer | null = null
    let ringBuf: WebGLBuffer | null = null
    let haloBuf: WebGLBuffer | null = null
    let carInstances: StreamBuffer | undefined
    let groundInstances: StreamBuffer | undefined
    const SHADOW = shadowMesh()
    const RING = ringMesh(0.86)
    const HALO = ringMesh(0.6)

    const offPill = keepImage(map, PILL, pillSprite)
    map.addSource(LAYER, { type: 'geojson', data: carCollection(single(options.data)) })

    const upload = (data: Float32Array) => {
      const context = gl!
      const b = context.createBuffer()!
      // may run outside render (onAdd): keep MapLibre's cached buffer binding valid
      preserveState(
        context,
        () => {
          context.bindBuffer(context.ARRAY_BUFFER, b)
          context.bufferData(context.ARRAY_BUFFER, data, context.STATIC_DRAW)
        },
        map,
      )
      return b
    }

    const meshFor = (kind: CarKind) => {
      let g = gpu.get(kind)
      if (!g) {
        const m = carMesh(kind)
        g = { buffer: upload(m.data), count: m.count, hull: upload(m.hull), hullCount: m.hullCount }
        gpu.set(kind, g)
      }
      return g
    }

    /** float attribute `name` from the bound buffer; `first` instance offsets instanced ones */
    const attrib = (p: Program, name: string, size: number, stride: number, offset: number, divisor = 0, first = 0) => {
      const loc = p.attrib[name]
      if (loc < 0) return
      gl!.enableVertexAttribArray(loc)
      gl!.vertexAttribPointer(loc, size, gl!.FLOAT, false, stride * 4, (first * stride + offset) * 4)
      inst!.divisor(loc, divisor)
    }
    /** leave no divisor or enabled array behind for MapLibre's (or the next layer's) draws */
    const unbind = (p: Program) => {
      for (const loc of Object.values(p.attrib))
        if (loc >= 0) {
          inst!.divisor(loc, 0)
          gl!.disableVertexAttribArray(loc)
        }
    }

    const bindCarMesh = (p: Program, buffer: WebGLBuffer) => {
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer)
      attrib(p, 'a_pos', 3, STRIDE, 0)
      attrib(p, 'a_normal', 3, STRIDE, 3)
      attrib(p, 'a_color', 3, STRIDE, 6)
      attrib(p, 'a_mat', 1, STRIDE, 9)
    }
    const bindCarInstances = (p: Program, first: number) => {
      gl!.bindBuffer(gl!.ARRAY_BUFFER, carInstances!.buffer)
      attrib(p, 'i_offset', 3, CAR_INSTANCE, 0, 1, first)
      attrib(p, 'i_frame', 4, CAR_INSTANCE, 3, 1, first)
      attrib(p, 'i_paint', 3, CAR_INSTANCE, 7, 1, first)
    }

    /** exaggeration factor so a reference car is at least `minSize` px long */
    const exaggeration = (lat: number, zoom: number) => {
      const mpp = metersPerPixel(lat, zoom)
      return Math.max(1, (state.options.minSize * mpp) / REF_LENGTH) * state.options.scale
    }

    const layer: CustomLayerInterface = {
      id: LAYER,
      type: 'custom',
      renderingMode: '3d',

      onAdd(_map, context) {
        gl = context
        inst = instancing(gl)
        if (!inst) throw new Error('just-map: Cars needs instanced drawing (ANGLE_instanced_arrays)')
        carProg = program(gl, CAR_VS, CAR_FS, ['a_pos', 'a_normal', 'a_color', 'a_mat', 'i_offset', 'i_frame', 'i_paint'], [
          'u_matrix',
          'u_inflate',
          'u_light',
          'u_view',
          'u_ink',
        ])
        groundProg = program(gl, GROUND_VS, GROUND_FS, ['a_pos', 'a_alpha', 'i_offset', 'i_axes', 'i_color'], ['u_matrix'])
        shadowBuf = upload(SHADOW)
        ringBuf = upload(RING)
        haloBuf = upload(HALO)
        carInstances = new StreamBuffer(gl, 64 * CAR_INSTANCE)
        groundInstances = new StreamBuffer(gl, 128 * GROUND_INSTANCE)
      },

      onRemove() {
        if (!gl) return
        for (const g of gpu.values()) {
          gl.deleteBuffer(g.buffer)
          gl.deleteBuffer(g.hull)
        }
        gpu.clear()
        for (const b of [shadowBuf, ringBuf, haloBuf]) if (b) gl.deleteBuffer(b)
        carInstances?.delete()
        groundInstances?.delete()
        if (carProg) gl.deleteProgram(carProg.program)
        if (groundProg) gl.deleteProgram(groundProg.program)
        gl = undefined
      },

      render(g: GL, args: CustomRenderMethodInput) {
        preserveState(g, () => drawCars(g, args), map)
      },
    }

    function drawCars(g: GL, args: CustomRenderMethodInput) {
      if (!carProg || !groundProg || !carInstances || !groundInstances) return
      const now = performance.now()
      const o = state.options
      const zoom = map.getZoom()
      const center = map.getCenter()
      const mpp = metersPerPixel(center.lat, zoom)
      const vp = args.defaultProjectionData.mainMatrix
      // instance positions are relative to the map center: float32 stays exact near the camera
      const ox = mercatorX(center.lng)
      const oy = mercatorY(center.lat)

      const placed = place(state.shown(now), vp, zoom, mpp)
      const groups = cluster(placed)
      state.placed = groups
      syncLabels(groups)
      if (!groups.length) return

      const bearing = (map.getBearing() * Math.PI) / 180
      const pitch = (map.getPitch() * Math.PI) / 180
      const pulse = (now % 1600) / 1600

      // ground decals, grouped by mesh: shadows, rings, halos
      const decals = groundInstances
      decals.length = 0
      const decal = (p: Placed, sx: number, sy: number, r: number, gr: number, b: number, a: number) => {
        const at = decals.alloc(GROUND_INSTANCE)
        const d = decals.data
        const k = p.scale
        d[at] = p.mx - ox
        d[at + 1] = p.my - oy
        d[at + 2] = p.lift + 0.02 * k
        d[at + 3] = k * p.cos * sx
        d[at + 4] = k * p.sin * sx
        d[at + 5] = k * p.sin * sy
        d[at + 6] = -k * p.cos * sy
        d[at + 7] = r
        d[at + 8] = gr
        d[at + 9] = b
        d[at + 10] = a
      }
      if (o.shadow)
        for (const { leader } of groups) {
          const mesh = carMesh(leader.car.kind ?? 'sedan')
          decal(leader, mesh.width * 0.85, mesh.length * 0.66, 0, 0, 0, 0.28)
        }
      const shadows = decals.length / GROUND_INSTANCE
      for (const { leader, count } of groups) {
        const status = leader.car.status && o.colors[leader.car.status]
        const selected = leader.car.id === o.selectedId
        if (!status && !selected) continue
        const r = carMesh(leader.car.kind ?? 'sedan').length * 0.62
        const [cr, cg, cb] = color3(status || '#1769e0')
        const a = selected ? 1 : 0.85
        decal(leader, r, r, cr * a, cg * a, cb * a, a)
        // a merged group gets a second, fainter ring: reads as a stack, not one car
        if (count > 1) decal(leader, r * 1.2, r * 1.2, cr * 0.45, cg * 0.45, cb * 0.45, 0.45)
      }
      const rings = decals.length / GROUND_INSTANCE - shadows
      for (const { leader } of groups) {
        if (leader.car.id !== o.selectedId) continue
        const status = leader.car.status && o.colors[leader.car.status]
        const [cr, cg, cb] = color3(status || '#1769e0')
        const r = carMesh(leader.car.kind ?? 'sedan').length * 0.62 * (1 + 0.55 * pulse)
        const pa = 0.35 * (1 - pulse)
        decal(leader, r, r, cr * pa, cg * pa, cb * pa, pa)
      }
      const halos = decals.length / GROUND_INSTANCE - shadows - rings

      // bodies, grouped by kind so each kind is one instanced draw
      const bodies = carInstances
      bodies.length = 0
      const runs: { kind: CarKind; first: number; count: number }[] = []
      const byKind = [...groups].sort((p, q) => KIND_ORDER[p.leader.kind] - KIND_ORDER[q.leader.kind])
      for (const { leader: p } of byKind) {
        const last = runs[runs.length - 1]
        if (last?.kind === p.kind) last.count++
        else runs.push({ kind: p.kind, first: bodies.length / CAR_INSTANCE, count: 1 })
        const at = bodies.alloc(CAR_INSTANCE)
        const d = bodies.data
        const [pr, pg, pb] = color3(p.car.color ?? o.paint)
        d[at] = p.mx - ox
        d[at + 1] = p.my - oy
        d[at + 2] = p.lift
        d[at + 3] = p.cos
        d[at + 4] = p.sin
        d[at + 5] = p.scale
        // outline width in model meters: the hull inflates by a constant number of px
        d[at + 6] = (o.outlineWidth * mpp) / p.k
        d[at + 7] = pr
        d[at + 8] = pg
        d[at + 9] = pb
      }

      const matrix = new Float32Array(multiply(vp, translation(ox, oy)))
      releaseVao(g)
      g.enable(g.BLEND)
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
      g.enable(g.DEPTH_TEST)
      g.depthFunc(g.LEQUAL)

      // ground: contact shadows, status rings, the selection halo — no depth writes
      g.depthMask(false)
      g.disable(g.CULL_FACE)
      g.useProgram(groundProg.program)
      g.uniformMatrix4fv(groundProg.uniform.u_matrix, false, matrix)
      decals.upload()
      const drawDecals = (mesh: WebGLBuffer | null, vertices: number, first: number, count: number) => {
        if (!count) return
        g.bindBuffer(g.ARRAY_BUFFER, mesh)
        attrib(groundProg!, 'a_pos', 2, 3, 0)
        attrib(groundProg!, 'a_alpha', 1, 3, 2)
        g.bindBuffer(g.ARRAY_BUFFER, decals.buffer)
        attrib(groundProg!, 'i_offset', 3, GROUND_INSTANCE, 0, 1, first)
        attrib(groundProg!, 'i_axes', 4, GROUND_INSTANCE, 3, 1, first)
        attrib(groundProg!, 'i_color', 4, GROUND_INSTANCE, 7, 1, first)
        inst!.drawArrays(g.TRIANGLES, 0, vertices, count)
      }
      drawDecals(shadowBuf, SHADOW.length / 3, 0, shadows)
      drawDecals(ringBuf, RING.length / 3, shadows, rings)
      drawDecals(haloBuf, HALO.length / 3, shadows + rings, halos)
      unbind(groundProg)

      // bodies: ink hull first (front faces culled → only the inflated rim shows), then the shell
      g.depthMask(true)
      g.enable(g.CULL_FACE)
      g.frontFace(g.CCW)
      g.useProgram(carProg.program)
      g.uniformMatrix4fv(carProg.uniform.u_matrix, false, matrix)
      g.uniform3f(carProg.uniform.u_light, LIGHT_WORLD[0], LIGHT_WORLD[1], LIGHT_WORLD[2])
      g.uniform3f(
        carProg.uniform.u_view,
        -Math.sin(bearing) * Math.sin(pitch),
        -Math.cos(bearing) * Math.sin(pitch),
        Math.cos(pitch),
      )
      bodies.upload()
      const ink = o.outline ? color3(o.outline) : undefined

      for (const { kind, first, count } of runs) {
        const mesh = meshFor(kind)
        if (ink) {
          g.cullFace(g.FRONT)
          g.uniform1f(carProg.uniform.u_inflate, 1)
          g.uniform4f(carProg.uniform.u_ink, ink[0], ink[1], ink[2], 1)
          bindCarMesh(carProg, mesh.hull)
          bindCarInstances(carProg, first)
          inst!.drawArrays(g.TRIANGLES, 0, mesh.hullCount, count)
        }
        g.cullFace(g.BACK)
        g.uniform1f(carProg.uniform.u_inflate, 0)
        g.uniform4f(carProg.uniform.u_ink, 0, 0, 0, 0)
        bindCarMesh(carProg, mesh.buffer)
        bindCarInstances(carProg, first)
        inst!.drawArrays(g.TRIANGLES, 0, mesh.count, count)
      }
      unbind(carProg)
      g.disable(g.CULL_FACE)
      g.frontFace(g.CCW)

      const gliding = o.tween > 0 && now - state.t0 < o.tween
      if (gliding || o.selectedId) map.triggerRepaint()
    }

    map.addLayer(layer)
    map.addLayer({
      id: LABELS,
      type: 'symbol',
      source: LAYER,
      filter: labelFilter(options.labels, options.selectedId),
      layout: {
        'text-field': ['get', 'label'],
        'text-font': options.font,
        'text-size': 11,
        'text-anchor': 'bottom',
        'text-offset': [0, -2],
        'icon-image': PILL,
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [1, 4, 1, 4],
        // colliding labels drop out; the selected one wins placement
        'symbol-sort-key': labelPriority(options.selectedId),
      },
      paint: { 'text-color': '#0f172a' },
    })

    /**
     * This frame's cars on screen: projected with the frame's own matrix (no
     * `map.project` per car), lifted onto terrain, and culled when off screen.
     */
    const place = (cars: Car[], vp: ArrayLike<number>, zoom: number, mpp: number): Placed[] => {
      const canvas = map.getCanvas()
      const ratio = map.getPixelRatio()
      const width = canvas.width / ratio
      const height = canvas.height / ratio
      const terrainAt = groundSampler(map)
      const out: Placed[] = []
      for (const car of cars) {
        const [lng, lat] = car.coord
        const kind = car.kind ?? 'sedan'
        const meter = mercatorMeter(lat)
        const k = exaggeration(lat, zoom)
        const mx = mercatorX(lng)
        const my = mercatorY(lat)
        const lift = terrainAt ? terrainAt(lng, lat) * meter : 0
        const w = vp[3] * mx + vp[7] * my + vp[11] * lift + vp[15]
        if (w <= 0) continue
        const x = ((vp[0] * mx + vp[4] * my + vp[8] * lift + vp[12]) / w + 1) * 0.5 * width
        const y = (1 - (vp[1] * mx + vp[5] * my + vp[9] * lift + vp[13]) / w) * 0.5 * height
        const size = (carMesh(kind).length * k) / mpp
        // a car partly on screen still draws; a margin of its own size keeps edges from popping
        if (x < -size || y < -size || x > width + size || y > height + size) continue
        const h = ((car.heading ?? 0) * Math.PI) / 180
        out.push({ car, kind, x, y, size, k, mx, my, lift, scale: meter * k, cos: Math.cos(h), sin: Math.sin(h) })
      }
      return out
    }

    /** this frame's groups: one per car, or merged where bodies overlap on screen */
    const cluster = (placed: Placed[]): PlacedGroup[] => {
      if (!state.options.cluster) return placed.map(p => ({ leader: p, count: 1, members: [p.car] }))
      const byId = new Map(placed.map(p => [p.car.id, p]))
      return clusterCars(placed, state.options.selectedId).map(({ leader, members }) => ({
        leader: byId.get(leader.id)!,
        count: members.length,
        members,
      }))
    }

    // only touch the label source when what it shows changed
    const syncLabels = (groups: PlacedGroup[]) => {
      let key = ''
      for (const g of groups) key += `${g.leader.car.id}:${g.count}:${g.leader.mx}:${g.leader.my}|`
      if (key === state.labelKey) return
      state.labelKey = key
      ;(map.getSource(LAYER) as GeoJSONSource | undefined)?.setData(
        carCollection(groups.map(g => ({ leader: g.leader.car, members: g.members }))),
      )
    }

    // picking: nearest drawn car (group leader) within its size, from last frame's screen positions
    const pick = (point: maplibregl.Point) => {
      let best: { group: PlacedGroup; d: number } | undefined
      for (const group of state.placed) {
        const d = Math.hypot(group.leader.x - point.x, group.leader.y - point.y)
        const reach = Math.max(PICK_MIN_PX, group.leader.size / 2)
        if (d <= reach && (!best || d < best.d)) best = { group, d }
      }
      return best?.group
    }
    const onClick = (e: MapMouseEvent) => {
      const group = pick(e.point)
      if (!group) return
      const { members } = group
      if (members.length === 1) return state.options.onSelect?.(members[0].id)

      // spread out → zoom until they separate; stacked on one spot → each click selects the next one
      const bounds = members.reduce((b, c) => b.extend(c.coord), new maplibregl.LngLatBounds())
      const spreadM = distKm(bounds.getSouthWest().toArray() as Coord, bounds.getNorthEast().toArray() as Coord) * 1000
      if (spreadM > CO_LOCATED_M && map.getZoom() < map.getMaxZoom() - 0.5)
        map.fitBounds(bounds, { padding: 160, maxZoom: Math.min(map.getMaxZoom(), map.getZoom() + 3), duration: 800 })
      else {
        const at = members.findIndex(c => c.id === state.options.selectedId)
        state.options.onSelect?.(members[(at + 1) % members.length].id)
      }
    }
    let hovering = false
    const onMove = (e: MapMouseEvent) => {
      const over = !!pick(e.point)
      // only touch the DOM when the cursor actually changes
      if (over === hovering) return
      hovering = over
      map.getCanvas().style.cursor = over ? 'pointer' : ''
    }
    map.on('click', onClick)
    map.on('mousemove', onMove)

    const state: State = {
      options,
      from: new Map(),
      to: options.data,
      t0: 0,
      placed: [],
      labelKey: '',

      shown(now) {
        const { tween } = state.options
        const u = tween > 0 ? Math.min(1, (now - state.t0) / tween) : 1
        if (u >= 1) return state.to
        return state.to.map(to => {
          const from = state.from.get(to.id)
          return from && tweens(from, to) ? between(from, to, u) : to
        })
      },

      setData(data) {
        const now = performance.now()
        state.from = new Map(state.shown(now).map(c => [c.id, c]))
        state.to = data
        state.t0 = now
        state.options = { ...state.options, data }
        map.triggerRepaint()
      },

      select(id) {
        state.options = { ...state.options, selectedId: id }
        state.labelKey = ''
        map.setFilter(LABELS, labelFilter(state.options.labels, id))
        map.setLayoutProperty(LABELS, 'symbol-sort-key', labelPriority(id))
        map.triggerRepaint()
      },

      get(id) {
        return state.shown(performance.now()).find(c => c.id === id)
      },

      fit(ids, { padding = 80, maxZoom = 16, duration = 1000 } = {}) {
        const wanted = ids ? state.to.filter(c => ids.includes(c.id)) : state.to
        if (!wanted.length) return
        const bounds = wanted.reduce((b, c) => b.extend(c.coord), new maplibregl.LngLatBounds())
        map.fitBounds(bounds, { padding, maxZoom, duration })
      },

      flyTo(id, zoom) {
        const car = state.get(id)
        if (car) map.flyTo({ center: car.coord, zoom: zoom ?? Math.max(map.getZoom(), 17) })
      },

      cleanup() {
        map.off('click', onClick)
        map.off('mousemove', onMove)
        for (const id of [LABELS, LAYER]) if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(LAYER)) map.removeSource(LAYER)
        offPill()
      },
    }

    return state
  },

  update(state: State, options, prev, engine) {
    const { map } = engine
    state.options = { ...options, data: state.options.data }

    if (options.data !== prev.data) state.setData(options.data)
    if (options.labels !== prev.labels || options.selectedId !== prev.selectedId)
      map.setFilter(LABELS, labelFilter(options.labels, options.selectedId))
    if (options.selectedId !== prev.selectedId)
      map.setLayoutProperty(LABELS, 'symbol-sort-key', labelPriority(options.selectedId))
    if (options.font !== prev.font) map.setLayoutProperty(LABELS, 'text-font', options.font)
    state.labelKey = ''
    map.triggerRepaint()
  },

  destroy(state: State) {
    state.cleanup()
  },
})
