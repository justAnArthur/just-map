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

/** the original O(n²) greedy grouping, as the reference */
function naive(cars: ScreenCar[], selectedId?: string, overlap = 0.8) {
  const order = [...cars].sort((a, b) => Number(b.car.id === selectedId) - Number(a.car.id === selectedId))
  const taken = new Set<string>()
  const groups: string[][] = []
  for (const lead of order) {
    if (taken.has(lead.car.id)) continue
    taken.add(lead.car.id)
    const members = [lead.car.id]
    for (const other of order) {
      if (taken.has(other.car.id)) continue
      if (Math.hypot(other.x - lead.x, other.y - lead.y) < ((lead.size + other.size) / 2) * overlap) {
        taken.add(other.car.id)
        members.push(other.car.id)
      }
    }
    groups.push(members)
  }
  return groups
}

test('grid clustering groups exactly like the brute-force greedy pass', () => {
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let round = 0; round < 20; round++) {
    const cars = Array.from({ length: 400 }, (_, i) => at(`c${i}`, random() * 1200, random() * 800, 20 + random() * 40))
    const selected = `c${Math.floor(random() * 400)}`
    const fast = clusterCars(cars, selected).map(g => g.members.map(m => m.id))
    expect(fast).toEqual(naive(cars, selected))
  }
})
