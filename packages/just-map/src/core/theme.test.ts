import { describe, expect, test } from 'bun:test'
import { themeVars } from './theme'
import { Navigation } from '../modules/navigation/navigation'

test('themeVars maps every token', () => {
  expect(themeVars({ accent: '#ff0000', radius: '10px', barBg: 'rgba(0,0,0,.5)' })).toEqual({
    '--jm-accent': '#ff0000',
    '--jm-radius': '10px',
    '--jm-bar-bg': 'rgba(0,0,0,.5)',
  })
})

test('themeVars keeps unset tokens out', () => {
  expect(themeVars({})).toEqual({})
  expect(themeVars({ fg: undefined })).toEqual({})
})

test('Navigation defaults include className', () => {
  expect(Navigation().options).toEqual({ controls: ['compass', 'zoom'], visualizePitch: true, className: '' })
})
