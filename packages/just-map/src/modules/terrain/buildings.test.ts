import { expect, test } from 'bun:test'
import { Buildings } from './buildings'

test('Buildings defaults', () => {
  expect(Buildings().options).toEqual({
    url: 'https://tiles.openfreemap.org/planet',
    minzoom: 14,
    opacity: 0.7,
    visible: true,
  })
})
