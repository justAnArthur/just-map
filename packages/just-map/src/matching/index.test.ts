import { afterEach, describe, expect, test } from 'bun:test'
import { snapToRoad } from './index'
import type { Fix } from '../utils/types'

const fixes: Fix[] = Array.from({ length: 11 }, (_, i) => ({ coord: [17 + i * 0.01, 48] as [number, number], t: i * 30 }))

const chunkCoords: [number, number][][] = [
  [
    [17, 48],
    [17.005, 48.001],
    [17.01, 48],
  ],
  [
    // overlaps the previous chunk's last vertex — must be deduped by stitching
    [17.01, 48],
    [17.015, 47.999],
    [17.02, 48],
  ],
]

const calls: string[] = []
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  calls.length = 0
})

function mockFetch() {
  let n = 0
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url))
    const coords = chunkCoords[n++]
    return {
      json: async () => ({ code: 'Ok', matchings: [{ geometry: { coordinates: coords }, confidence: 0.5 + n * 0.1 }] }),
    }
  }) as unknown as typeof fetch
}

describe('snapToRoad', () => {
  test('chunks with overlap, stitches, averages confidence', async () => {
    mockFetch()
    const { coords, confidence, distanceKm } = await snapToRoad(fixes, { delayMs: 0 })

    // 11 fixes, chunk 10 overlap 1 → windows [0..9] and [9..10]
    expect(calls.length).toBe(2)

    const first = calls[0]
    expect(first).toContain('/match/v1/driving/')
    expect(first.match(/48\.000000/g)?.length).toBe(10)
    expect(first).toContain('timestamps=')

    expect(coords).toEqual([
      [17, 48],
      [17.005, 48.001],
      [17.01, 48],
      [17.015, 47.999],
      [17.02, 48],
    ])

    expect(confidence).toBeCloseTo(0.65)
    expect(distanceKm).toBeGreaterThan(0)
  })

  test('surfaces OSRM error codes', async () => {
    globalThis.fetch = (async () => ({ json: async () => ({ code: 'TooBig' }) })) as unknown as typeof fetch

    await expect(snapToRoad(fixes, { chunkSize: 100, delayMs: 0 })).rejects.toThrow('TooBig')
  })

  test('rejects fewer than 2 fixes without fetching', async () => {
    let fetched = false
    globalThis.fetch = (async () => {
      fetched = true
      throw new Error('unreachable')
    }) as unknown as typeof fetch

    await expect(snapToRoad([fixes[0]])).rejects.toThrow('at least 2')
    expect(fetched).toBe(false)
  })
})
