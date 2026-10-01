import { describe, expect, test } from 'bun:test'
import { nearestSegment, ZoneEditor } from './zone-editor'

test('ZoneEditor defaults', () => {
  expect(ZoneEditor().options).toEqual({ ring: [], readonly: false, color: '#2563eb' })
})

describe('nearestSegment', () => {
  // a rough square around Bratislava
  const square = [
    [17.0, 48.1],
    [17.2, 48.1],
    [17.2, 48.2],
    [17.0, 48.2],
  ]

  test('click inside picks the nearest edge', () => {
    // just below the bottom edge (index 0 → 1)
    expect(nearestSegment(square, [17.1, 48.09])).toBe(0)
    // just left of the left edge (index 3 → 0)
    expect(nearestSegment(square, [16.98, 48.15])).toBe(3)
  })

  test('equidistant picks the first best', () => {
    expect(nearestSegment(square, [17.1, 48.15])).toBe(0)
  })

  test('single-vertex ring loops onto itself', () => {
    expect(nearestSegment([[17.1, 48.1]], [17.2, 48.2])).toBe(0)
  })
})
