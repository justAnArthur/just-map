import { expect, test } from 'bun:test'
import { Tracks } from './tracks'

test('Tracks defaults keep the pre-0.5 idle look', () => {
  expect(Tracks().options.idle).toEqual({ color: '#cbd5e1', width: 2.5, opacity: 0.55 })
})
