import { describe, expect, test } from 'bun:test'
import { vehicleCollection, Vehicles } from './vehicles'
import type { Vehicle } from './vehicles'

test('Vehicles defaults', () => {
  expect(Vehicles().options).toEqual({
    data: [],
    colors: { driving: '#16a34a', idle: '#f59e0b', stopped: '#64748b', offline: '#a1a1aa' },
    arrowStatuses: ['driving'],
    labels: 'auto',
    labelMinZoom: 13,
    font: ['Noto Sans Regular'],
    tween: 800,
  })
})

test('Vehicles merges partial options', () => {
  const o = Vehicles({ labels: 'none', tween: 0, selectedId: 'v1' }).options
  expect(o.labels).toBe('none')
  expect(o.tween).toBe(0)
  expect(o.selectedId).toBe('v1')
  expect(o.labelMinZoom).toBe(13)
})

describe('vehicleCollection', () => {
  const vehicles: Vehicle[] = [
    { id: 'v1', coord: [17.1, 48.1], heading: 90, status: 'driving', label: 'BA 392 DP' },
    { id: 'v2', coord: [17.2, 48.2], status: 'driving' },
    { id: 'v3', coord: [17.3, 48.3], heading: 45, status: 'idle' },
  ]
  const fc = vehicleCollection(vehicles, ['driving'])

  test('one point feature per vehicle', () => {
    expect(fc.features.map(f => f.geometry.coordinates)).toEqual([
      [17.1, 48.1],
      [17.2, 48.2],
      [17.3, 48.3],
    ])
  })

  test('arrow only for arrow statuses that carry a heading', () => {
    expect(fc.features.map(f => f.properties.arrow)).toEqual([true, false, false])
  })

  test('label falls back to the id, heading to 0', () => {
    expect(fc.features[0].properties).toEqual({ id: 'v1', status: 'driving', label: 'BA 392 DP', heading: 90, arrow: true })
    expect(fc.features[1].properties.label).toBe('v2')
    expect(fc.features[1].properties.heading).toBe(0)
  })
})
