import { expect, test } from 'bun:test'
import { arrowSprite, pillSprite } from './images'

const alpha = (s: { width: number; data: Uint8ClampedArray }, x: number, y: number) => s.data[(y * s.width + x) * 4 + 3]

test('arrow sdf: solid inside, ~0.75 on the edge, empty far outside', () => {
  const s = arrowSprite()
  expect(s.data.length).toBe(56 * 56 * 4)
  expect(s.options.sdf).toBe(true)
  expect(alpha(s, 28, 24)).toBe(255)
  expect(alpha(s, 0, 0)).toBe(0)
  expect(alpha(s, 28, 5)).toBeGreaterThan(150)
  expect(alpha(s, 28, 5)).toBeLessThan(230)
})

test('pill: opaque white middle, transparent corners, stretch zones inside the image', () => {
  const s = pillSprite()
  const o = (16 * s.width + 20) * 4
  expect([...s.data.slice(o, o + 4)]).toEqual([255, 255, 255, 255])
  expect(alpha(s, 0, 0)).toBe(0)

  const [[x0, x1]] = s.options.stretchX!
  expect(x0).toBeGreaterThan(0)
  expect(x1).toBeLessThan(s.width)
})
