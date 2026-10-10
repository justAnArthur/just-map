import { describe, expect, test } from 'bun:test'
import { nextPlayableTime, Playback } from './playback'

test('Playback defaults stay backwards compatible', () => {
  expect(Playback().options).toEqual({ playing: false, progress: 0, follow: false, wallTime: 150 })
})

describe('nextPlayableTime', () => {
  test('outside every range passes through', () => {
    expect(nextPlayableTime(5, [[10, 20]])).toBe(5)
    expect(nextPlayableTime(20, [[10, 20]])).toBe(20)
    expect(nextPlayableTime(5)).toBe(5)
  })

  test('inside a range jumps to its end, start inclusive', () => {
    expect(nextPlayableTime(10, [[10, 20]])).toBe(20)
    expect(nextPlayableTime(15, [[10, 20]])).toBe(20)
  })

  test('chained and overlapping ranges jump through, in any order', () => {
    expect(nextPlayableTime(12, [[20, 30], [10, 20]])).toBe(30)
    expect(nextPlayableTime(3, [[5, 25], [0, 10]])).toBe(25)
  })

  test('a gap between ranges stops the jump', () => {
    expect(nextPlayableTime(12, [[10, 20], [21, 30]])).toBe(20)
  })
})
