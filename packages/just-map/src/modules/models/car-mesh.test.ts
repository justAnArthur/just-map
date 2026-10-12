import { expect, test } from 'bun:test'
import { CAR_SPECS, carMesh, MAT, STRIDE, type CarKind } from './car-mesh'

const kinds = Object.keys(CAR_SPECS) as CarKind[]

/** signed volume of a triangle soup — positive when every face winds counter-clockwise from outside */
function volume(data: Float32Array) {
  let v = 0
  for (let i = 0; i < data.length; i += STRIDE * 3) {
    const a = data.subarray(i, i + 3)
    const b = data.subarray(i + STRIDE, i + STRIDE + 3)
    const c = data.subarray(i + 2 * STRIDE, i + 2 * STRIDE + 3)
    v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
  }
  return v / 6
}

test.each(kinds)('%s: outward-wound shell with paint and glass, roughly car-sized', kind => {
  const mesh = carMesh(kind)
  const spec = CAR_SPECS[kind]
  expect(mesh.count % 3).toBe(0)

  const hullVolume = volume(mesh.hull)
  expect(hullVolume).toBeGreaterThan(0)
  // a car is mostly air below its bounding box, but not that much
  expect(hullVolume).toBeLessThan(spec.length * spec.width * 2.3)
  expect(hullVolume).toBeGreaterThan(spec.length * spec.width * 0.5)

  const mats = new Set<number>()
  for (let i = 9; i < mesh.data.length; i += STRIDE) mats.add(mesh.data[i])
  for (const m of Object.values(MAT)) expect(mats.has(m)).toBe(true)
})

test('meshes are cached per kind', () => {
  expect(carMesh('sedan')).toBe(carMesh('sedan'))
})
