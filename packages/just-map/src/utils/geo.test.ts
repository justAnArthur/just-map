import { describe, expect, test } from 'bun:test'
import { bearingBetween, distanceFractions, distKm, lengthKm } from './geo'

describe('distKm', () => {
  test('zero distance', () => {
    expect(distKm([17.1, 48.1], [17.1, 48.1])).toBe(0)
  })

  test('Bratislava → Vienna ≈ 55 km great-circle', () => {
    const d = distKm([17.1077, 48.1486], [16.3738, 48.2082])
    expect(d).toBeGreaterThan(50)
    expect(d).toBeLessThan(60)
  })
})

describe('bearingBetween', () => {
  test('due east is 90°', () => {
    expect(bearingBetween([17, 48], [18, 48])).toBeCloseTo(90)
  })

  test('due north is 0°', () => {
    expect(bearingBetween([17, 48], [17, 49])).toBeCloseTo(0)
  })
})

describe('distanceFractions', () => {
  test('monotonic 0..1 over a path', () => {
    const f = distanceFractions([
      [17, 48],
      [17.01, 48],
      [17.01, 48.01],
    ])
    expect(f[0]).toBe(0)
    expect(f[f.length - 1]).toBe(1)
    expect(f[1] < f[2]).toBe(true)
  })

  test('degenerate single point stays zero', () => {
    expect(distanceFractions([[17, 48]])).toEqual([0])
  })
})

test('lengthKm matches the sum of segments', () => {
  const path = [
    [17, 48],
    [17.1, 48],
    [17.1, 48.1],
  ] as [number, number][]
  const expected = distKm(path[0], path[1]) + distKm(path[1], path[2])
  expect(lengthKm(path)).toBeCloseTo(expected)
})
