import { describe, expect, test } from 'bun:test'
import { zoneCollection, zoneLabelCollection, Zones } from './zones'
import type { Zone } from './zones'

test('Zones defaults', () => {
  expect(Zones().options).toEqual({
    data: [],
    visible: true,
    color: '#1769e0',
    fillOpacity: 0.08,
    labels: true,
    labelMinZoom: 11.5,
    font: ['Noto Sans Regular'],
  })
})

test('Zones merges partial options', () => {
  const o = Zones({ labels: false, color: '#ff0000' }).options
  expect(o.labels).toBe(false)
  expect(o.color).toBe('#ff0000')
  expect(o.fillOpacity).toBe(0.08)
})

describe('zone collections', () => {
  const zones: Zone[] = [
    { id: 'depot', name: 'Depot', ring: [[17, 48], [17.2, 48], [17.2, 48.2], [17, 48.2]], color: '#16a34a' },
    { id: 'closed', ring: [[17, 48], [17.1, 48], [17.1, 48.1], [17, 48]] },
    { id: 'line', name: 'Too few', ring: [[17, 48], [17.1, 48]] },
  ]

  test('polygons close their ring once and skip rings under 3 vertices', () => {
    const fc = zoneCollection(zones)
    expect(fc.features.map(f => f.properties.id)).toEqual(['depot', 'closed'])
    expect(fc.features[0].geometry.coordinates[0]).toHaveLength(5)
    expect(fc.features[1].geometry.coordinates[0]).toHaveLength(4)
    expect(fc.features[1].properties.color).toBeNull()
  })

  test('labels only for named zones, at the centroid', () => {
    const fc = zoneLabelCollection(zones)
    expect(fc.features.map(f => f.properties.name)).toEqual(['Depot'])
    const [x, y] = fc.features[0].geometry.coordinates
    expect(x).toBeCloseTo(17.1)
    expect(y).toBeCloseTo(48.1)
  })
})
