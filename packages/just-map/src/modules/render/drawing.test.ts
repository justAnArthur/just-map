import { expect, test } from 'bun:test'
import { buildingEdges, Drawing } from './drawing'

const square = (x: number, y: number, d: number) => [
  [
    [x, y],
    [x + d, y],
    [x + d, y + d],
    [x, y + d],
    [x, y],
  ],
]

test('Drawing defaults', () => {
  const { options } = Drawing()
  expect(options.edges).toBe(true)
  expect(options.waterGrid).toBe(true)
  expect(options.occlude).toBe(true)
  expect(options.url).toBe('https://tiles.openfreemap.org/planet')
})

test('a box building: roof + base rings and four corner edges', () => {
  const edges = buildingEdges(
    [{ id: 1, geometry: { type: 'Polygon', coordinates: square(17, 48, 0.0001) }, properties: { render_height: 10 } }],
    [0, 0],
  )
  // 4 sides × (roof + base) + 4 corners, 2 vertices × 3 floats each
  expect(edges.length).toBe((4 * 2 + 4) * 6)
})

test('tile duplicates collapse to the largest piece; hide_3d is skipped', () => {
  const big = { id: 7, geometry: { type: 'Polygon', coordinates: square(17, 48, 0.0001) }, properties: {} }
  const clipped = { id: 7, geometry: { type: 'Polygon', coordinates: [square(17, 48, 0.0001)[0].slice(0, 4)] }, properties: {} }
  const hidden = { id: 8, geometry: { type: 'Polygon', coordinates: square(18, 48, 0.0001) }, properties: { hide_3d: true } }
  expect(buildingEdges([clipped, big, hidden], [0, 0]).length).toBe(buildingEdges([big], [0, 0]).length)
})
