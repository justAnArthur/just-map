import { describe, expect, test } from 'bun:test'
import { paletteSampler } from './colors'

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
