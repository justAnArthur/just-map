/**
 * Procedural low-poly car bodies in the clean, minimal style of a Tesla app
 * render: a smooth lofted shell, a dark glass canopy, aero wheels, light bars.
 * Local frame in meters: x = right, y = forward, z = up, origin on the ground
 * at the car's center.
 */

export type CarKind = 'sedan' | 'suv' | 'van' | 'truck'

/** material ids, read by the car shader */
export const MAT = { paint: 0, glass: 1, matte: 2, emissive: 3 } as const

type Keys = [number, number][]

type Spec = {
  length: number
  width: number
  wheelRadius: number
  /** axle positions as fractions of length, rear → front */
  axles: [number, number]
  /** roof line z(t), t = 0 rear … 1 front */
  top: Keys
  /** underbody z(t) before wheel arches */
  bottom: Keys
  /** beltline: glass above this, paint below */
  belt: number
  /** t range of the glasshouse */
  glass: [number, number]
  /** upper-body narrowing at the roof, as a fraction of width */
  tumblehome: number
  /** corner radius of the cross-section */
  radius: number
}

export const CAR_SPECS: Record<CarKind, Spec> = {
  sedan: {
    length: 4.72,
    width: 1.86,
    wheelRadius: 0.34,
    axles: [0.2, 0.79],
    top: [[0, 0.56], [0.03, 0.8], [0.12, 0.88], [0.24, 0.93], [0.38, 1.38], [0.52, 1.44], [0.64, 1.36], [0.8, 0.97], [0.92, 0.86], [0.985, 0.72], [1, 0.56]],
    bottom: [[0, 0.44], [0.05, 0.2], [0.95, 0.2], [1, 0.4]],
    belt: 0.93,
    glass: [0.245, 0.815],
    tumblehome: 0.74,
    radius: 0.16,
  },
  suv: {
    length: 4.75,
    width: 1.92,
    wheelRadius: 0.37,
    axles: [0.2, 0.79],
    top: [[0, 0.62], [0.02, 0.92], [0.07, 1.06], [0.15, 1.5], [0.42, 1.62], [0.64, 1.5], [0.8, 1.06], [0.93, 0.93], [0.99, 0.76], [1, 0.62]],
    bottom: [[0, 0.48], [0.05, 0.22], [0.95, 0.22], [1, 0.46]],
    belt: 1.05,
    glass: [0.105, 0.81],
    tumblehome: 0.78,
    radius: 0.18,
  },
  van: {
    length: 5.25,
    width: 2.0,
    wheelRadius: 0.37,
    axles: [0.17, 0.8],
    top: [[0, 1.9], [0.015, 2.12], [0.05, 2.2], [0.7, 2.2], [0.84, 1.95], [0.94, 1.12], [0.99, 0.95], [1, 0.75]],
    bottom: [[0, 0.5], [0.03, 0.24], [0.96, 0.24], [1, 0.45]],
    belt: 1.15,
    glass: [0.72, 0.945],
    tumblehome: 0.9,
    radius: 0.2,
  },
  truck: {
    length: 5.68,
    width: 2.02,
    wheelRadius: 0.44,
    axles: [0.17, 0.8],
    top: [[0, 1.06], [0.01, 1.12], [0.56, 1.8], [0.985, 1.08], [1, 0.96]],
    bottom: [[0, 0.62], [0.03, 0.32], [0.97, 0.32], [1, 0.6]],
    belt: 1.18,
    glass: [0.43, 0.79],
    tumblehome: 0.86,
    radius: 0.05,
  },
}

/** flat, non-indexed triangle soup: 3 pos, 3 normal, 3 color, 1 material per vertex */
export type CarMesh = {
  /** body + glass + wheels + lights */
  data: Float32Array
  count: number
  /** the shell alone (for the outline hull) */
  hull: Float32Array
  hullCount: number
  length: number
  width: number
}

export const STRIDE = 10

const lerpKeys = (keys: Keys, t: number) => {
  let i = 1
  while (i < keys.length - 1 && keys[i][0] < t) i++
  const [t0, z0] = keys[i - 1]
  const [t1, z1] = keys[i]
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)))
  // smoothstep between keys softens the polyline into a body line
  const s = u * u * (3 - 2 * u)
  return z0 + (z1 - z0) * (0.35 * u + 0.65 * s)
}

type V3 = [number, number, number]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** indexed part with smooth normals; `paint(tri)` picks color + material per triangle */
type Part = {
  pos: V3[]
  tris: [number, number, number][]
  paint(tri: [V3, V3, V3]): { color: V3; mat: number }
  /** hard-shaded: per-face normals instead of smoothed ones */
  flat?: boolean
}

/** make every triangle wind counter-clockwise seen from outside (relative to `center`) */
function orient(part: Part, center: (p: V3) => V3) {
  for (const t of part.tris) {
    const [a, b, c] = t.map(i => part.pos[i]) as [V3, V3, V3]
    const n = cross(sub(b, a), sub(c, a))
    const mid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
    if (dot(n, sub(mid, center(mid))) < 0) [t[1], t[2]] = [t[2], t[1]]
  }
}

function emit(part: Part, out: number[]) {
  const normals: V3[] = part.pos.map(() => [0, 0, 0])
  if (!part.flat)
    for (const [i, j, k] of part.tris) {
      const n = cross(sub(part.pos[j], part.pos[i]), sub(part.pos[k], part.pos[i]))
      for (const v of [i, j, k]) for (let c = 0; c < 3; c++) normals[v][c] += n[c]
    }

  for (const [i, j, k] of part.tris) {
    const tri: [V3, V3, V3] = [part.pos[i], part.pos[j], part.pos[k]]
    const { color, mat } = part.paint(tri)
    const face = norm(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])))
    for (const v of [i, j, k]) {
      const n = part.flat ? face : norm(normals[v])
      out.push(...part.pos[v], ...n, ...color, mat)
    }
  }
}

const BODY: V3 = [1, 1, 1]
const GLASS: V3 = [0.09, 0.11, 0.14]
const TIRE: V3 = [0.13, 0.14, 0.16]
const RIM: V3 = [0.8, 0.82, 0.85]
const FRONT_LIGHT: V3 = [1, 1, 1]
const REAR_LIGHT: V3 = [0.95, 0.12, 0.16]

/** cross-section ring: rounded rectangle, (x, z) points counter-clockwise seen from the front */
function section(hw: number, zb: number, zt: number, r: number, belt: number, tumble: number): [number, number][] {
  const h = zt - zb
  const rr = Math.min(r, h / 2.2, hw / 2)
  const pts: [number, number][] = []
  const arc = (cx: number, cz: number, a0: number) => {
    for (let k = 1; k < 5; k++) {
      const a = a0 + (k / 5) * (Math.PI / 2)
      pts.push([cx + rr * Math.cos(a), cz + rr * Math.sin(a)])
    }
  }
  // side samples hit the beltline exactly, so the glass/paint split is a clean line
  const beltZ = Math.min(zt - rr - 0.01, Math.max(zb + rr + 0.01, belt))
  const side = [
    ...[0, 0.5].map(u => zb + rr + (beltZ - zb - rr) * u),
    beltZ,
    ...[0.34, 0.67].map(u => beltZ + (zt - rr - beltZ) * u),
  ]

  pts.push([0, zb], [hw * 0.5, zb], [hw - rr, zb])
  arc(hw - rr, zb + rr, -Math.PI / 2)
  for (const z of side) pts.push([hw, z])
  pts.push([hw, zt - rr])
  arc(hw - rr, zt - rr, 0)
  pts.push([hw * 0.5, zt], [0, zt], [-hw * 0.5, zt], [-(hw - rr), zt])
  arc(-(hw - rr), zt - rr, Math.PI / 2)
  for (const z of [...side].reverse()) pts.push([-hw, z])
  pts.push([-hw, zb + rr])
  arc(-(hw - rr), zb + rr, Math.PI)
  pts.push([-hw * 0.5, zb])

  // tumblehome: the greenhouse leans in above the belt
  return pts.map(([x, z]) => {
    const u = Math.max(0, (z - belt) / Math.max(0.01, zt - belt))
    return [x * (1 - (1 - tumble) * u), z]
  })
}

function bodyPart(s: Spec): Part {
  const L = s.length
  const R = s.wheelRadius
  const archTop = R * 1.85
  const archSpan = (R * 1.2) / L

  const bottomAt = (t: number) => {
    let z = lerpKeys(s.bottom, t)
    for (const a of s.axles) {
      const d = Math.abs(t - a) / archSpan
      if (d < 1) z = Math.max(z, archTop * Math.sqrt(1 - d * d))
    }
    return z
  }
  // half-width rounds off at the bumpers
  const halfWidth = (t: number) => {
    const e = Math.min(t, 1 - t) / 0.07
    return (s.width / 2) * (e >= 1 ? 1 : 0.72 + 0.28 * Math.sqrt(1 - (1 - e) ** 2))
  }

  // denser sampling at the ends and around the arches
  const ts: number[] = []
  const N = 64
  for (let i = 0; i <= N; i++) ts.push(0.5 - 0.5 * Math.cos((Math.PI * i) / N))

  const pos: V3[] = []
  const rings: number[][] = []
  for (const t of ts) {
    const zb = bottomAt(t)
    const zt = Math.max(zb + 0.08, lerpKeys(s.top, t))
    const y = (t - 0.5) * L
    const ring = section(halfWidth(t), zb, zt, s.radius, s.belt, s.tumblehome)
    rings.push(ring.map(([x, z]) => pos.push([x, y, z]) - 1))
  }

  const tris: [number, number, number][] = []
  const M = rings[0].length
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < M; j++) {
      const a = rings[i][j]
      const b = rings[i][(j + 1) % M]
      const c = rings[i + 1][(j + 1) % M]
      const d = rings[i + 1][j]
      tris.push([a, b, c], [a, c, d])
    }
  // end caps: fan to the ring centroid
  for (const ring of [rings[0], rings[rings.length - 1]]) {
    const c = ring.reduce<V3>((m, i) => [m[0] + pos[i][0] / M, m[1] + pos[i][1] / M, m[2] + pos[i][2] / M], [0, 0, 0])
    const ci = pos.push(c) - 1
    for (let j = 0; j < M; j++) tris.push([ci, ring[j], ring[(j + 1) % M]])
  }

  const part: Part = {
    pos,
    tris,
    paint([a, b, c]) {
      const z = (a[2] + b[2] + c[2]) / 3
      const t = (a[1] + b[1] + c[1]) / 3 / L + 0.5
      const glass = z > s.belt + 0.005 && t > s.glass[0] && t < s.glass[1]
      return glass ? { color: GLASS, mat: MAT.glass } : { color: BODY, mat: MAT.paint }
    },
  }
  orient(part, p => [0, p[1], (bottomAt(p[1] / L + 0.5) + lerpKeys(s.top, p[1] / L + 0.5)) / 2])
  return part
}

/** cylinder along x: tire tread + sidewalls (smooth), hub faces (flat) */
function wheelParts(cx: number, cy: number, r: number, w: number): Part[] {
  const SEG = 22
  const pos: V3[] = []
  const tris: [number, number, number][] = []
  const xs = [cx - w / 2, cx - w / 2 + 0.03, cx + w / 2 - 0.03, cx + w / 2]
  const rs = [r * 0.9, r, r, r * 0.9]
  for (let k = 0; k < 4; k++)
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2
      pos.push([xs[k], cy + rs[k] * Math.cos(a), r + rs[k] * Math.sin(a)])
    }
  for (let k = 0; k < 3; k++)
    for (let i = 0; i < SEG; i++) {
      const a = k * SEG + i
      const b = k * SEG + ((i + 1) % SEG)
      tris.push([a, b, b + SEG], [a, b + SEG, a + SEG])
    }
  const tire: Part = { pos, tris, paint: () => ({ color: TIRE, mat: MAT.matte }) }
  orient(tire, p => [p[0], cy, r])

  // aero hub covers on both faces
  const hubs: Part[] = [xs[0] - 0.002, xs[3] + 0.002].map(x => {
    const hp: V3[] = [[x, cy, r]]
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2
      hp.push([x, cy + r * 0.78 * Math.cos(a), r + r * 0.78 * Math.sin(a)])
    }
    const ht: [number, number, number][] = []
    for (let i = 0; i < SEG; i++) ht.push([0, 1 + i, 1 + ((i + 1) % SEG)])
    const hub: Part = { pos: hp, tris: ht, flat: true, paint: () => ({ color: RIM, mat: MAT.matte }) }
    orient(hub, () => [cx, cy, r])
    return hub
  })
  return [tire, ...hubs]
}

/** thin emissive bar hugging the body's nose or tail */
function lightBar(y: number, z: number, hw: number, color: V3): Part {
  const d = 0.05
  const h = 0.045
  const pos: V3[] = []
  for (const dx of [-hw, hw]) for (const dy of [-d, d]) for (const dz of [-h, h]) pos.push([dx, y + dy, z + dz])
  const tris: [number, number, number][] = [
    [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1],
    [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3],
  ]
  const part: Part = { pos, tris, flat: true, paint: () => ({ color, mat: MAT.emissive }) }
  orient(part, () => [0, y, z])
  return part
}

const cache = new Map<CarKind, CarMesh>()

export function carMesh(kind: CarKind): CarMesh {
  const hit = cache.get(kind)
  if (hit) return hit

  const s = CAR_SPECS[kind]
  const body = bodyPart(s)
  const hull: number[] = []
  emit(body, hull)

  const all = [...hull]
  const wx = s.width / 2 - 0.16
  for (const a of s.axles)
    for (const side of [-1, 1]) for (const p of wheelParts(side * wx, (a - 0.5) * s.length, s.wheelRadius, 0.26)) emit(p, all)

  // lights sit where the body is still near full width, just inside the bumper ends
  const front = lerpKeys(s.top, 0.985) - 0.1
  const rear = Math.min(lerpKeys(s.top, 0.015) - 0.08, s.belt)
  emit(lightBar(s.length / 2 - 0.035, front, s.width * 0.3, FRONT_LIGHT), all)
  emit(lightBar(-s.length / 2 + 0.035, rear, s.width * 0.33, REAR_LIGHT), all)

  const mesh: CarMesh = {
    data: new Float32Array(all),
    count: all.length / STRIDE,
    hull: new Float32Array(hull),
    hullCount: hull.length / STRIDE,
    length: s.length,
    width: s.width,
  }
  cache.set(kind, mesh)
  return mesh
}
