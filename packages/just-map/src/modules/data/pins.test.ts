import { expect, test } from 'bun:test'
import { pinCollection, Pins } from './pins'

test('Pins defaults', () => {
  expect(Pins().options).toEqual({
    data: [],
    colors: { critical: '#f04438', warning: '#f59e0b', info: '#3b82f6', stop: '#334155' },
    visible: true,
    font: ['Noto Sans Regular'],
  })
})

test('Pins merges partial options', () => {
  const o = Pins({ selectedId: 'p1', visible: false }).options
  expect(o.selectedId).toBe('p1')
  expect(o.visible).toBe(false)
  expect(o.colors.stop).toBe('#334155')
})

test('pinCollection keeps kind and defaults the label to empty', () => {
  const fc = pinCollection([
    { id: 'p1', coord: [17.1, 48.1], kind: 'stop', label: '3' },
    { id: 'p2', coord: [17.2, 48.2], kind: 'critical' },
  ])
  expect(fc.features.map(f => f.properties)).toEqual([
    { id: 'p1', kind: 'stop', label: '3' },
    { id: 'p2', kind: 'critical', label: '' },
  ])
  expect(fc.features[1].geometry.coordinates).toEqual([17.2, 48.2])
})
