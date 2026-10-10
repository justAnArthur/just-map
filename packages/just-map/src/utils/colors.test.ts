import { describe, expect, test } from 'bun:test'
import { matchColor, paletteSampler } from './colors'

describe('paletteSampler', () => {
  test('viridis endpoints', () => {
    const sample = paletteSampler('viridis')
    expect(sample(0)).toBe('rgb(68, 1, 84)')
    expect(sample(1)).toBe('rgb(253, 231, 37)')
  })

  test('viridis clamps out-of-range input', () => {
    const sample = paletteSampler('viridis')
    expect(sample(-1)).toBe(sample(0))
    expect(sample(2)).toBe(sample(1))
  })

  test('custom hex ramp interpolates', () => {
    const sample = paletteSampler(['#000000', '#ffffff'])
    expect(sample(0)).toBe('rgb(0, 0, 0)')
    expect(sample(0.5)).toBe('rgb(128, 128, 128)')
    expect(sample(1)).toBe('rgb(255, 255, 255)')
  })
})

describe('matchColor', () => {
  test('builds a match over the property with a fallback', () => {
    expect(matchColor('status', { driving: '#16a34a', idle: '#f59e0b' }, '#a1a1aa')).toEqual([
      'match', ['get', 'status'], 'driving', '#16a34a', 'idle', '#f59e0b', '#a1a1aa',
    ])
  })

  test('empty map collapses to the fallback', () => {
    expect(matchColor('status', {}, '#a1a1aa')).toBe('#a1a1aa')
  })
})
