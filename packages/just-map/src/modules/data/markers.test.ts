import { expect, test } from 'bun:test'
import { Markers } from './markers'
import type { MarkerPoint } from './markers'

test('Markers defaults', () => {
  expect(Markers().options).toEqual({ points: [], fit: false })
})

test('Markers merges partial options', () => {
  const points: MarkerPoint[] = [{ coord: [17.1, 48.1] }]
  expect(Markers({ points, fit: { padding: 40, maxZoom: 15 } }).options).toEqual({
    points,
    fit: { padding: 40, maxZoom: 15 },
  })
})
