import { describe, expect, test } from 'bun:test'
import { HYBRID_KEEP, Style } from './style'

describe('HYBRID_KEEP', () => {
  // real positron/liberty layer ids (OpenMapTiles schema)
  test.each([
    ['water', false],
    ['park', false],
    ['building', false],
    ['highway_minor', false],
    ['highway_major_casing', true],
    ['highway_major_inner', true],
    ['highway_motorway_inner', true],
    ['boundary_3', true],
    ['waterway_line_label', true],
    ['water_name_point_label', true],
    ['highway-name-path', true],
  ])('%s → %s', (id, expected) => {
    expect(HYBRID_KEEP.test(id)).toBe(expected)
  })
})

test('Style defaults', () => {
  expect(Style().options).toEqual({ base: 'positron', tweaks: [], hybrid: false, visible: true })
})
