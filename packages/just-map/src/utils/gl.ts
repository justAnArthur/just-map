import { hex } from './colors'

export type GL = WebGLRenderingContext | WebGL2RenderingContext

export const EARTH_CIRCUMFERENCE = 40075016.686

/** web mercator x/y in 0..1 (MapLibre's world space) */
export const mercatorX = (lng: number) => (180 + lng) / 360
export const mercatorY = (lat: number) =>
  (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360

/** one meter in mercator units at a latitude (also the z scale of a 3D custom layer) */
export const mercatorMeter = (lat: number) => 1 / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180))

/** `mercatorMeter` from a mercator y (0..1) — no trip through latitude: cos(lat) = 1 / cosh(π(1 − 2y)) */
export const mercatorMeterAtY = (y: number) => Math.cosh(Math.PI * (1 - 2 * y)) / EARTH_CIRCUMFERENCE

/** meters per CSS pixel at a latitude and zoom (512px tiles) */
export const metersPerPixel = (lat: number, zoom: number) =>
  (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)

/** column-major 4x4 multiply in float64, so mercator-sized translations keep their precision */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  return out
}

/**
 * The eye position (in the matrix's world space) of a perspective view-projection
 * matrix: the point that clips to x = y = w = 0. Exactly the camera the frame
 * was rendered with — no drift from a separately computed altitude.
 */
export function cameraPosition(m: ArrayLike<number>): [number, number, number] {
  // rows 0, 1, 3 of the column-major matrix: a·p = -d
  const row = (r: number) => [m[r], m[4 + r], m[8 + r], m[12 + r]]
  const [a, b, c] = [row(0), row(1), row(3)]
  const det3 = (x: number[], y: number[], z: number[]) =>
    x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0])
  const D = det3(a, b, c)
  const rhs = [-a[3], -b[3], -c[3]]
  const col = (k: number) => [a, b, c].map((r, i) => r.map((v, j) => (j === k ? rhs[i] : v)))
  return [0, 1, 2].map(k => {
    const [x, y, z] = col(k)
    return det3(x, y, z) / D
  }) as [number, number, number]
}

export const translation = (x: number, y: number, z = 0) =>
  new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1])

/** `#rrggbb` → 0..1 channels */
export const rgb = (color: string): [number, number, number] => hex(color).map(c => c / 255) as [number, number, number]

function shader(gl: GL, type: number, source: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, source)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`just-map: shader — ${gl.getShaderInfoLog(s)}`)
  return s
}

export type Program = {
  program: WebGLProgram
  attrib: Record<string, number>
  uniform: Record<string, WebGLUniformLocation | null>
}

/** compile + link, resolving the named attributes and uniforms up front */
export function program(gl: GL, vertex: string, fragment: string, attribs: string[], uniforms: string[]): Program {
  const p = gl.createProgram()!
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, vertex))
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`just-map: program — ${gl.getProgramInfoLog(p)}`)

  return {
    program: p,
    attrib: Object.fromEntries(attribs.map(a => [a, gl.getAttribLocation(p, a)])),
    uniform: Object.fromEntries(uniforms.map(u => [u, gl.getUniformLocation(p, u)])),
  }
}

/** a MapLibre cached GL value (`painter.context.depthMask` …) */
type CachedValue = { current: unknown; dirty: boolean; set(v: unknown): void }

/** the GL state our layers touch, as MapLibre's state cache names it */
const CACHED = [
  'depthTest',
  'blend',
  'cullFace',
  'depthMask',
  'depthFunc',
  'blendFunc',
  'cullFaceSide',
  'frontFace',
  'program',
  'bindVertexBuffer',
  'bindVertexArray',
] as const

/** MapLibre's GL state cache for `map`, when its internals have the expected shape */
function stateCache(map: unknown): CachedValue[] | undefined {
  const context = (map as { painter?: { context?: Record<string, CachedValue> } } | undefined)?.painter?.context
  if (!context) return undefined
  const values = CACHED.map(name => context[name])
  return values.every(v => v && typeof v.set === 'function' && 'current' in v) ? values : undefined
}

/**
 * Runs `draw` and puts back every piece of GL state a custom layer here
 * touches. MapLibre caches GL state and does not always re-apply it after a
 * custom layer (with terrain it doesn't): a depth mask left off makes later
 * fill-extrusions skip depth writes and draw their walls through their roofs.
 *
 * Pass the map: the state then comes back from MapLibre's own cache (what it
 * believes is bound), which costs a dozen GL calls. Without it every value is
 * read back with `getParameter` — a synchronous round trip to the GPU process
 * that costs ~0.6 ms a frame in Chrome.
 */
export function preserveState(gl: GL, draw: () => void, map?: unknown) {
  const cache = stateCache(map)
  if (cache) {
    try {
      draw()
    } finally {
      for (const value of cache) {
        value.dirty = true
        value.set(value.current)
      }
    }
    return
  }
  preserveByQuery(gl, draw)
}

function preserveByQuery(gl: GL, draw: () => void) {
  const on = (cap: number) => gl.isEnabled(cap)
  const saved = {
    depthTest: on(gl.DEPTH_TEST),
    blend: on(gl.BLEND),
    cull: on(gl.CULL_FACE),
    depthMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
    depthFunc: gl.getParameter(gl.DEPTH_FUNC) as number,
    blendSrcRgb: gl.getParameter(gl.BLEND_SRC_RGB) as number,
    blendDstRgb: gl.getParameter(gl.BLEND_DST_RGB) as number,
    blendSrcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA) as number,
    blendDstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA) as number,
    cullFace: gl.getParameter(gl.CULL_FACE_MODE) as number,
    frontFace: gl.getParameter(gl.FRONT_FACE) as number,
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    buffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
    vao: 'bindVertexArray' in gl ? (gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null) : null,
  }
  const set = (cap: number, value: boolean) => (value ? gl.enable(cap) : gl.disable(cap))

  try {
    draw()
  } finally {
    set(gl.DEPTH_TEST, saved.depthTest)
    set(gl.BLEND, saved.blend)
    set(gl.CULL_FACE, saved.cull)
    gl.depthMask(saved.depthMask)
    gl.depthFunc(saved.depthFunc)
    gl.blendFuncSeparate(saved.blendSrcRgb, saved.blendDstRgb, saved.blendSrcAlpha, saved.blendDstAlpha)
    gl.cullFace(saved.cullFace)
    gl.frontFace(saved.frontFace)
    gl.useProgram(saved.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, saved.buffer)
    if ('bindVertexArray' in gl) gl.bindVertexArray(saved.vao)
  }
}

/**
 * Custom layers share MapLibre's context: on WebGL2 a MapLibre VAO may still be
 * bound, and attribute setup would silently rewrite it. Unbind before drawing.
 */
export function releaseVao(gl: GL) {
  if ('bindVertexArray' in gl) gl.bindVertexArray(null)
}

export type Instancing = {
  divisor(location: number, divisor: number): void
  drawArrays(mode: number, first: number, count: number, instances: number): void
}

/** instanced drawing on WebGL2, or WebGL1's ANGLE_instanced_arrays (universally supported) */
export function instancing(gl: GL): Instancing | undefined {
  if ('drawArraysInstanced' in gl)
    return {
      divisor: (location, divisor) => gl.vertexAttribDivisor(location, divisor),
      drawArrays: (mode, first, count, instances) => gl.drawArraysInstanced(mode, first, count, instances),
    }
  const ext = gl.getExtension('ANGLE_instanced_arrays')
  if (!ext) return undefined
  return {
    divisor: (location, divisor) => ext.vertexAttribDivisorANGLE(location, divisor),
    drawArrays: (mode, first, count, instances) => ext.drawArraysInstancedANGLE(mode, first, count, instances),
  }
}

/** a dynamic vertex buffer refilled every frame, grown (never shrunk) to fit */
export class StreamBuffer {
  data: Float32Array
  length = 0
  buffer: WebGLBuffer
  #capacity = 0

  constructor(
    readonly gl: GL,
    floats = 1024,
  ) {
    this.data = new Float32Array(floats)
    this.buffer = gl.createBuffer()!
  }

  /** room for `n` more floats; returns the write offset */
  alloc(n: number) {
    if (this.length + n > this.data.length) {
      let size = this.data.length * 2
      while (size < this.length + n) size *= 2
      const next = new Float32Array(size)
      next.set(this.data.subarray(0, this.length))
      this.data = next
    }
    const at = this.length
    this.length += n
    return at
  }

  /** upload what was written this frame (binds the buffer) */
  upload() {
    const { gl } = this
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    if (this.data.length > this.#capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
      this.#capacity = this.data.length
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.length))
  }

  delete() {
    this.gl.deleteBuffer(this.buffer)
  }
}
