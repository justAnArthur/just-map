import { describe, expect, test } from 'bun:test'
import { bearingBetween, distanceFractions, distKm, lengthKm, lerpAngle, lerpCoord, ringCentroid } from './geo'

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

describe('lerpCoord', () => {
  test('endpoints and midpoint', () => {
    expect(lerpCoord([17, 48], [18, 49], 0)).toEqual([17, 48])
    expect(lerpCoord([17, 48], [18, 49], 1)).toEqual([18, 49])
    expect(lerpCoord([17, 48], [18, 49], 0.5)).toEqual([17.5, 48.5])
  })
})

describe('lerpAngle', () => {
  test('plain interpolation', () => {
    expect(lerpAngle(0, 90, 0.5)).toBeCloseTo(45)
  })

  test('takes the short way across north in both directions', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0)
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0)
    expect(lerpAngle(350, 10, 0.25)).toBeCloseTo(355)
  })

  test('normalizes into [0, 360)', () => {
    expect(lerpAngle(-90, 0, 0)).toBeCloseTo(270)
    expect(lerpAngle(270, 450, 1)).toBeCloseTo(90)
  })
})

describe('ringCentroid', () => {
  const square: [number, number][] = [
    [17, 48],
    [17.2, 48],
    [17.2, 48.2],
    [17, 48.2],
  ]

  test('square centers in the middle, open or closed', () => {
    const [x, y] = ringCentroid(square)
    expect(x).toBeCloseTo(17.1)
    expect(y).toBeCloseTo(48.1)
    expect(ringCentroid([...square, square[0]])).toEqual(ringCentroid(square))
  })

  test('weights by area, not by vertex count', () => {
    // extra vertices crowded on one edge don't pull the centroid
    const crowded: [number, number][] = [[17, 48], [17.05, 48], [17.1, 48], [17.15, 48], ...square.slice(1)]
    expect(ringCentroid(crowded)[0]).toBeCloseTo(17.1)
  })

  test('collinear ring falls back to the vertex mean', () => {
    const [x, y] = ringCentroid([[17, 48], [17.1, 48], [17.2, 48]])
    expect(x).toBeCloseTo(17.1)
    expect(y).toBe(48)
  })
})
