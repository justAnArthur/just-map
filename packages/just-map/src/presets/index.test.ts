import { describe, expect, test } from 'bun:test'
import { flat, googleEarth, history, realtime } from './index'

describe('presets', () => {
  test('googleEarth bundles the demo look', () => {
    const b = googleEarth()
    expect(b.modules.map(m => m.def.name)).toEqual(['Render', 'Terrain', 'Buildings', 'Gestures', 'Navigation'])
    expect(b.camera).toEqual({ projection: 'globe', pitch: 68, bearing: -35, maxPitch: 80 })
    expect(b.sky).toBe('day')
  })

  test('overrides merge per module, others keep preset values', () => {
    const b = googleEarth({ terrain: { exaggeration: 2.2 } })
    const terrain = b.modules.find(m => m.def.name === 'Terrain')!
    expect(terrain.options.exaggeration).toBe(2.2)
    expect(b.modules.find(m => m.def.name === 'Render')!.options.dim).toBe(true)
  })

  test('flat is mercator without terrain', () => {
    const b = flat()
    expect(b.modules.map(m => m.def.name)).toEqual(['Render', 'Navigation'])
    expect(b.camera!.projection).toBe('mercator')
    expect(b.modules[0].options.provider).toBe('osm')
  })

  test('history and realtime module sets', () => {
    expect(history().modules.map(m => m.def.name)).toEqual([
      'Render', 'Terrain', 'Tracks', 'Playback', 'FollowCam', 'Gestures', 'Navigation',
    ])

    const rt = realtime()
    expect(rt.modules.map(m => m.def.name)).toEqual([
      'Render', 'Terrain', 'Tracks', 'Breadcrumbs', 'FollowCam', 'Gestures', 'Navigation',
    ])
    expect(rt.modules.find(m => m.def.name === 'Tracks')!.options.fit).toBe(false)
  })
})
