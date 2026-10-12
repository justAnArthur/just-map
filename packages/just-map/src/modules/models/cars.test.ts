import { expect, test } from 'bun:test'
import { carCollection, Cars, clusterCars, type ScreenCar } from './cars'

const at = (id: string, x: number, y: number, size = 30): ScreenCar => ({ car: { id, coord: [0, 0] }, x, y, size })

test('Cars clusters by default', () => {
  expect(Cars().options.cluster).toBe(true)
})

test('overlapping cars fold into the first; distant ones stay apart', () => {
  const groups = clusterCars([at('a', 0, 0), at('b', 10, 0), at('c', 0, 12), at('d', 200, 0)])
  expect(groups.map(g => [g.leader.id, g.members.map(m => m.id)])).toEqual([
    ['a', ['a', 'b', 'c']],
    ['d', ['d']],
  ])
})

test('the selected car leads its group', () => {
  const groups = clusterCars([at('a', 0, 0), at('b', 5, 0)], 'b')
  expect(groups[0].leader.id).toBe('b')
})

test('cars that only touch at the rims do not merge', () => {
  expect(clusterCars([at('a', 0, 0), at('b', 28, 0)])).toHaveLength(2)
})

test('group labels carry the folded count', () => {
  const [group] = clusterCars([at('a', 0, 0), at('b', 1, 0), at('c', 2, 0)])
  group.leader.label = 'BA 711 KE'
  expect(carCollection([group]).features[0].properties).toEqual({ id: 'a', label: 'BA 711 KE  +2', count: 3 })
})
