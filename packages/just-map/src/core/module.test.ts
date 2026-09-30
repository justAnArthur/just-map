import { describe, expect, test } from 'bun:test'
import { module } from './module'

const Echo = module<{ level: number; label: string }>({
  name: 'Echo',
  defaults: { level: 3, label: 'hi' },
})

describe('module factory', () => {
  test('no args → pure defaults', () => {
    expect(Echo().options).toEqual({ level: 3, label: 'hi' })
  })

  test('partial options merge over defaults', () => {
    expect(Echo({ level: 9 }).options).toEqual({ level: 9, label: 'hi' })
  })

  test('each call yields an independent spec', () => {
    const a = Echo()
    const b = Echo({ level: 1 })
    expect(a.options.level).toBe(3)
    expect(b.options.level).toBe(1)
  })

  test('factory carries the def', () => {
    expect(Echo.def.name).toBe('Echo')
    expect(Echo().def).toBe(Echo.def)
  })
})
