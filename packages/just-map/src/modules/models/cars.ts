import maplibregl from 'maplibre-gl'
import type { CustomLayerInterface, CustomRenderMethodInput, GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import { FONT } from '../../core/style'
import { distKm, lerpAngle, lerpCoord } from '../../utils/geo'
import {
  mercatorMeter,
  mercatorX,
  mercatorY,
  metersPerPixel,
  multiply,
  program,
  releaseVao,
  rgb,
  type GL,
  type Program,
} from '../../utils/gl'
import { keepImage, pillSprite } from '../../utils/images'
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

// ---------------------------------------------------------------------------------------------
// shaders

const CAR_VS = `
attribute vec3 a_pos;
attribute vec3 a_normal;
attribute vec3 a_color;
attribute float a_mat;
uniform mat4 u_matrix;
uniform float u_inflate;
varying vec3 v_normal;
varying vec3 v_color;
varying float v_mat;
void main() {
  v_normal = a_normal;
  v_color = a_color;
  v_mat = a_mat;
  gl_Position = u_matrix * vec4(a_pos + a_normal * u_inflate, 1.0);
}`

const CAR_FS = `
precision mediump float;
uniform vec3 u_light;
uniform vec3 u_view;
uniform vec3 u_paint;
uniform vec4 u_ink;
varying vec3 v_normal;
varying vec3 v_color;
varying float v_mat;
void main() {
  if (u_ink.a > 0.0) { gl_FragColor = vec4(u_ink.rgb, 1.0); return; }
  if (v_mat > 2.5) { gl_FragColor = vec4(v_color, 1.0); return; }

  vec3 n = normalize(v_normal);
  bool glass = v_mat > 0.5 && v_mat < 1.5;
  bool matte = v_mat > 1.5;
  vec3 base = v_mat < 0.5 ? u_paint : v_color;

  float diffuse = max(dot(n, u_light), 0.0);
  float hemi = 0.5 + 0.5 * n.z;
  vec3 sky = vec3(0.86, 0.9, 0.95);
  vec3 ambient = mix(vec3(0.6, 0.61, 0.64), sky, hemi);

  vec3 h = normalize(u_light + u_view);
  float shine = glass ? 140.0 : matte ? 10.0 : 70.0;
  float ks = glass ? 0.9 : matte ? 0.04 : 0.32;
  float spec = ks * pow(max(dot(n, h), 0.0), shine);
  float fresnel = pow(1.0 - max(dot(n, u_view), 0.0), 3.0);

  vec3 color = base * (ambient * 0.72 + diffuse * 0.36);
  if (glass) color = mix(color, sky * 0.55, 0.12 + 0.55 * fresnel * hemi);
  else if (!matte) color += sky * fresnel * 0.18;
  gl_FragColor = vec4(color + spec, 1.0);
}`

const GROUND_VS = `
attribute vec2 a_pos;
attribute float a_alpha;
uniform mat4 u_matrix;
varying float v_alpha;
void main() {
  v_alpha = a_alpha;
  gl_Position = u_matrix * vec4(a_pos, 0.02, 1.0);
}`

const GROUND_FS = `
precision mediump float;
uniform vec4 u_color;
varying float v_alpha;
void main() { gl_FragColor = u_color * v_alpha; }`

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

/** world → car-local rotation (heading clockwise from north) */
const toLocal = ([e, n, u]: [number, number, number], heading: number): [number, number, number] => {
  const h = (heading * Math.PI) / 180
  return [e * Math.cos(h) - n * Math.sin(h), e * Math.sin(h) + n * Math.cos(h), u]
}

const LIGHT_WORLD: [number, number, number] = (() => {
  const az = (215 * Math.PI) / 180
  const polar = (42 * Math.PI) / 180
  return [-Math.sin(az) * Math.sin(polar), -Math.cos(az) * Math.sin(polar), Math.cos(polar)]
})()

/**
 * model matrix: local meters (x right, y forward, z up) → mercator 0..1,
 * rotated by heading and scaled by `k` (exaggeration)
 */
function modelMatrix(car: Car, k: number) {
  const [lng, lat] = car.coord
  const s = mercatorMeter(lat) * k
  const h = (-(car.heading ?? 0) * Math.PI) / 180
  const c = Math.cos(h)
  const sn = Math.sin(h)
  // mercator y grows south, hence the negated north component
  return new Float64Array([s * c, -s * sn, 0, 0, -s * sn, -s * c, 0, 0, 0, 0, s, 0, mercatorX(lng), mercatorY(lat), 0, 1])
}

const scaleXY = (m: Float64Array, sx: number, sy: number) => {
  const out = new Float64Array(m)
  for (let r = 0; r < 4; r++) {
    out[r] *= sx
    out[4 + r] *= sy
  }
  return out
}

type Gpu = { buffer: WebGLBuffer; count: number; hull: WebGLBuffer; hullCount: number }

type State = CarsHandle & {
  options: CarsOptions
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

export function carCollection(cars: Car[]) {
  return {
    type: 'FeatureCollection' as const,
    features: cars.map(c => ({
      type: 'Feature' as const,
      properties: { id: c.id, label: c.label ?? c.id },
      geometry: { type: 'Point' as const, coordinates: c.coord },
    })),
  }
}

/** label filter for the current mode */
const labelFilter = (labels: CarLabels, selectedId?: string): maplibregl.FilterSpecification =>
  labels === 'all' ? ['has', 'id'] : labels === 'selected' ? ['==', ['get', 'id'], selectedId ?? ''] : ['==', 1, 0]

/**
 * 3D car models on the map — minimal Tesla-style shells (sedan, SUV, van,
 * truck) with glass canopies, contact shadows, status rings and an optional
 * ink outline that matches `Drawing`. Rendered with plain WebGL in a custom
 * layer; assumes the mercator projection on a flat map.
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
    labels: 'all',
    font: FONT,
    tween: 800,
  },

  create(engine: JustMapEngine, options: CarsOptions) {
    const { map } = engine
    let gl: GL | undefined
    let carProg: Program | undefined
    let groundProg: Program | undefined
    const gpu = new Map<CarKind, Gpu>()
    let shadowBuf: WebGLBuffer | null = null
    let ringBuf: WebGLBuffer | null = null
    let haloBuf: WebGLBuffer | null = null
    const SHADOW = shadowMesh()
    const RING = ringMesh(0.86)
    const HALO = ringMesh(0.6)

    const offPill = keepImage(map, PILL, pillSprite)
    map.addSource(LAYER, { type: 'geojson', data: carCollection(options.data) })

    const upload = (data: Float32Array) => {
      const b = gl!.createBuffer()!
      gl!.bindBuffer(gl!.ARRAY_BUFFER, b)
      gl!.bufferData(gl!.ARRAY_BUFFER, data, gl!.STATIC_DRAW)
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

    const bindCar = (g: GL, p: Program, buffer: WebGLBuffer) => {
      g.bindBuffer(g.ARRAY_BUFFER, buffer)
      const F = 4
      const attr = (name: string, size: number, offset: number) => {
        const loc = p.attrib[name]
        if (loc < 0) return
        g.enableVertexAttribArray(loc)
        g.vertexAttribPointer(loc, size, g.FLOAT, false, STRIDE * F, offset * F)
      }
      attr('a_pos', 3, 0)
      attr('a_normal', 3, 3)
      attr('a_color', 3, 6)
      attr('a_mat', 1, 9)
    }

    const bindGround = (g: GL, p: Program, buffer: WebGLBuffer) => {
      g.bindBuffer(g.ARRAY_BUFFER, buffer)
      g.enableVertexAttribArray(p.attrib.a_pos)
      g.vertexAttribPointer(p.attrib.a_pos, 2, g.FLOAT, false, 12, 0)
      g.enableVertexAttribArray(p.attrib.a_alpha)
      g.vertexAttribPointer(p.attrib.a_alpha, 1, g.FLOAT, false, 12, 8)
    }

    /** exaggeration factor so a reference car is at least `minSize` px long */
    const exaggeration = (lat: number) => {
      const mpp = metersPerPixel(lat, map.getZoom())
      return Math.max(1, (state.options.minSize * mpp) / REF_LENGTH) * state.options.scale
    }

    const layer: CustomLayerInterface = {
      id: LAYER,
      type: 'custom',
      renderingMode: '3d',

      onAdd(_map, context) {
        gl = context
        carProg = program(gl, CAR_VS, CAR_FS, ['a_pos', 'a_normal', 'a_color', 'a_mat'], [
          'u_matrix',
          'u_inflate',
          'u_light',
          'u_view',
          'u_paint',
          'u_ink',
        ])
        groundProg = program(gl, GROUND_VS, GROUND_FS, ['a_pos', 'a_alpha'], ['u_matrix', 'u_color'])
        shadowBuf = upload(SHADOW)
        ringBuf = upload(RING)
        haloBuf = upload(HALO)
      },

      onRemove() {
        if (!gl) return
        for (const g of gpu.values()) {
          gl.deleteBuffer(g.buffer)
          gl.deleteBuffer(g.hull)
        }
        gpu.clear()
        for (const b of [shadowBuf, ringBuf, haloBuf]) if (b) gl.deleteBuffer(b)
        if (carProg) gl.deleteProgram(carProg.program)
        if (groundProg) gl.deleteProgram(groundProg.program)
        gl = undefined
      },

      render(g: GL, args: CustomRenderMethodInput) {
        if (!carProg || !groundProg) return
        const now = performance.now()
        const cars = state.shown(now)
        if (!cars.length) return
        const o = state.options
        const vp = args.defaultProjectionData.mainMatrix
        const mpp = metersPerPixel(map.getCenter().lat, map.getZoom())
        const bearing = (map.getBearing() * Math.PI) / 180
        const pitch = (map.getPitch() * Math.PI) / 180
        const viewWorld: [number, number, number] = [
          -Math.sin(bearing) * Math.sin(pitch),
          -Math.cos(bearing) * Math.sin(pitch),
          Math.cos(pitch),
        ]
        const pulse = (now % 1600) / 1600

        const items = cars.map(car => {
          const kind = car.kind ?? 'sedan'
          const k = exaggeration(car.coord[1])
          return { car, kind, k, model: modelMatrix(car, k), mesh: carMesh(kind) }
        })

        releaseVao(g)
        g.enable(g.BLEND)
        g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
        g.enable(g.DEPTH_TEST)
        g.depthFunc(g.LEQUAL)

        // ground: contact shadows, status rings, the selection halo — no depth writes
        g.depthMask(false)
        g.disable(g.CULL_FACE)
        g.useProgram(groundProg.program)
        const ground = (buffer: WebGLBuffer | null, matrix: Float64Array, color: number[], count: number) => {
          bindGround(g, groundProg!, buffer!)
          g.uniformMatrix4fv(groundProg!.uniform.u_matrix, false, new Float32Array(multiply(vp, matrix)))
          g.uniform4f(groundProg!.uniform.u_color, color[0], color[1], color[2], color[3])
          g.drawArrays(g.TRIANGLES, 0, count)
        }
        for (const { car, model, mesh } of items) {
          if (o.shadow) ground(shadowBuf, scaleXY(model, mesh.width * 0.85, mesh.length * 0.66), [0, 0, 0, 0.28], SHADOW.length / 3)

          const status = car.status && o.colors[car.status]
          const selected = car.id === o.selectedId
          const r = mesh.length * 0.62
          if (status || selected) {
            const [cr, cg, cb] = rgb(status || '#1769e0')
            const a = selected ? 1 : 0.85
            ground(ringBuf, scaleXY(model, r, r), [cr * a, cg * a, cb * a, a], RING.length / 3)
            if (selected) {
              const pr = r * (1 + 0.55 * pulse)
              const pa = 0.35 * (1 - pulse)
              ground(haloBuf, scaleXY(model, pr, pr), [cr * pa, cg * pa, cb * pa, pa], HALO.length / 3)
            }
          }
        }
        g.disableVertexAttribArray(groundProg.attrib.a_pos)
        g.disableVertexAttribArray(groundProg.attrib.a_alpha)

        // bodies: ink hull first (front faces culled → only the inflated rim shows), then the shell
        g.depthMask(true)
        g.enable(g.CULL_FACE)
        g.frontFace(g.CCW)
        g.useProgram(carProg.program)
        const ink = o.outline ? rgb(o.outline) : undefined

        for (const { car, kind, k, model } of items) {
          const gpuMesh = meshFor(kind)
          const matrix = new Float32Array(multiply(vp, model))
          g.uniformMatrix4fv(carProg.uniform.u_matrix, false, matrix)

          if (ink) {
            g.cullFace(g.FRONT)
            g.uniform1f(carProg.uniform.u_inflate, (o.outlineWidth * mpp) / k)
            g.uniform4f(carProg.uniform.u_ink, ink[0], ink[1], ink[2], 1)
            bindCar(g, carProg, gpuMesh.hull)
            g.drawArrays(g.TRIANGLES, 0, gpuMesh.hullCount)
          }

          g.cullFace(g.BACK)
          g.uniform1f(carProg.uniform.u_inflate, 0)
          g.uniform4f(carProg.uniform.u_ink, 0, 0, 0, 0)
          g.uniform3fv(carProg.uniform.u_light, toLocal(LIGHT_WORLD, car.heading ?? 0))
          g.uniform3fv(carProg.uniform.u_view, toLocal(viewWorld, car.heading ?? 0))
          g.uniform3fv(carProg.uniform.u_paint, rgb(car.color ?? o.paint))
          bindCar(g, carProg, gpuMesh.buffer)
          g.drawArrays(g.TRIANGLES, 0, gpuMesh.count)
        }

        for (const name of ['a_pos', 'a_normal', 'a_color', 'a_mat'])
          if (carProg.attrib[name] >= 0) g.disableVertexAttribArray(carProg.attrib[name])
        g.disable(g.CULL_FACE)
        g.frontFace(g.CCW)

        const gliding = o.tween > 0 && now - state.t0 < o.tween
        if (gliding) syncLabels(cars)
        if (gliding || o.selectedId) map.triggerRepaint()
      },
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
        'text-allow-overlap': true,
        'icon-image': PILL,
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [1, 4, 1, 4],
        'icon-allow-overlap': true,
      },
      paint: { 'text-color': '#0f172a' },
    })

    const syncLabels = (cars: Car[]) => (map.getSource(LAYER) as GeoJSONSource | undefined)?.setData(carCollection(cars))

    // picking: nearest car on screen within its drawn size
    const pick = (point: maplibregl.Point) => {
      let best: { id: string; d: number } | undefined
      const mpp = metersPerPixel(map.getCenter().lat, map.getZoom())
      for (const car of state.shown(performance.now())) {
        const p = map.project(car.coord)
        const d = Math.hypot(p.x - point.x, p.y - point.y)
        const reach = Math.max(PICK_MIN_PX, (carMesh(car.kind ?? 'sedan').length * exaggeration(car.coord[1])) / mpp / 2)
        if (d <= reach && (!best || d < best.d)) best = { id: car.id, d }
      }
      return best?.id
    }
    const onClick = (e: MapMouseEvent) => {
      const id = pick(e.point)
      if (id) state.options.onSelect?.(id)
    }
    const onMove = (e: MapMouseEvent) => {
      map.getCanvas().style.cursor = pick(e.point) ? 'pointer' : ''
    }
    map.on('click', onClick)
    map.on('mousemove', onMove)

    const state: State = {
      options,
      from: new Map(),
      to: options.data,
      t0: 0,

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
        if (state.options.tween <= 0) syncLabels(data)
        map.triggerRepaint()
      },

      select(id) {
        state.options = { ...state.options, selectedId: id }
        map.setFilter(LABELS, labelFilter(state.options.labels, id))
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
    if (options.font !== prev.font) map.setLayoutProperty(LABELS, 'text-font', options.font)
    map.triggerRepaint()
  },

  destroy(state: State) {
    state.cleanup()
  },
})
