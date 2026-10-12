import { hex } from './colors'

export type GL = WebGLRenderingContext | WebGL2RenderingContext

export const EARTH_CIRCUMFERENCE = 40075016.686

/** web mercator x/y in 0..1 (MapLibre's world space) */
export const mercatorX = (lng: number) => (180 + lng) / 360
export const mercatorY = (lat: number) =>
  (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360

/** one meter in mercator units at a latitude (also the z scale of a 3D custom layer) */
export const mercatorMeter = (lat: number) => 1 / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180))

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

/**
 * Custom layers share MapLibre's context: on WebGL2 a MapLibre VAO may still be
 * bound, and attribute setup would silently rewrite it. Unbind before drawing.
 */
export function releaseVao(gl: GL) {
  if ('bindVertexArray' in gl) gl.bindVertexArray(null)
}
