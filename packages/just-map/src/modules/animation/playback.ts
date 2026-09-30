import type maplibregl from 'maplibre-gl'
import { module } from '../../core/module'
import { bearingBetween } from '../../utils/geo'
import type { Coord, Track } from '../../utils/types'
import type { FollowCamHandle } from './follow-cam'

export type PlaybackOptions = {
  /** track to play; needs times+speeds, without them playback idles (warn once) */
  track?: Track
  playing: boolean
  /** controlled scrub while paused, 0..1 */
  progress: number
  /** follow the vehicle with the FollowCam module; degrades to no-follow + one warning when absent */
  follow: boolean
  /** every track plays in roughly this many wall-clock seconds; the speed multiplier clamps to [40, 240] */
  wallTime: number
  onProgress?(progress: number, speedKmh: number): void
  onEnded?(): void
}

export type PlaybackHandle = {
  play(): void
  pause(): void
  seek(progress: number): void
  /** position at time t (seconds); returns interpolated km/h */
  place(t: number, withCamera?: boolean): number
  isPlaying(): boolean
}

type State = {
  opts: PlaybackOptions
  time: number
  playing: boolean
  raf: number
  last: number
  lastEmit: number
  warned: boolean
  timer: number
  onMove: () => void
  /** track reference changed: reset to the start, then keep rolling / idle */
  retarget(): void
}

// GL layers, not an HTML marker: with terrain + pitch, markers sink below ground level
const point = (coord: Coord) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'Point' as const, coordinates: coord },
})
const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] }

export const Playback = module<PlaybackOptions>({
  name: 'Playback',
  uses: ['FollowCam'],
  defaults: { playing: false, progress: 0, follow: false, wallTime: 150 },

  create(engine, options) {
    const map = engine.map

    map.addSource('playback-vehicle', {
      type: 'geojson',
      data: options.track?.coords.length ? point(options.track.coords[0]) : EMPTY_FC,
    })
    map.addLayer({
      id: 'playback-pulse',
      type: 'circle',
      source: 'playback-vehicle',
      paint: { 'circle-radius': 14, 'circle-color': '#38bdf8', 'circle-opacity': 0.3, 'circle-blur': 0.8 },
    })
    map.addLayer({
      id: 'playback-dot',
      type: 'circle',
      source: 'playback-vehicle',
      paint: { 'circle-radius': 7, 'circle-color': '#0284c7', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 },
    })
    const vehicle = map.getSource('playback-vehicle') as maplibregl.GeoJSONSource

    const timed = () => {
      const track = h.opts.track
      return !!track?.times && !!track.speeds && track.times.length > 1 && track.speeds.length > 1
    }
    const total = () => {
      const times = h.opts.track?.times
      return times?.length ? times[times.length - 1] : 0
    }
    const warnOnce = () => {
      if (h.warned || !h.opts.track) return
      h.warned = true
      console.warn('Playback: track has no times/speeds')
    }
    const stop = () => {
      cancelAnimationFrame(h.raf)
      h.raf = 0
    }
    const start = () => {
      if (h.raf) return
      h.last = performance.now()
      const tick = (now: number) => {
        h.raf = requestAnimationFrame(tick)
        h.time += Math.min(0.1, (now - h.last) / 1000) * Math.min(240, Math.max(40, total() / h.opts.wallTime))
        h.last = now

        if (h.time >= total()) {
          h.time = total()
          h.place(h.time)
          h.opts.onProgress?.(1, 0)
          h.opts.onEnded?.()
          h.playing = false
          stop()
          return
        }

        const speed = h.place(h.time, h.opts.follow)
        if (now - h.lastEmit > 120) {
          h.lastEmit = now
          h.opts.onProgress?.(h.time / total(), speed)
        }
      }
      h.raf = requestAnimationFrame(tick)
    }

    let lastMove = performance.now()
    const onMove = () => {
      lastMove = performance.now()
    }

    const h: PlaybackHandle & State = {
      opts: options,
      time: 0,
      playing: options.playing,
      raf: 0,
      last: 0,
      lastEmit: 0,
      warned: false,
      timer: 0,
      onMove,
      retarget() {
        h.time = 0
        h.place(0)
        if (timed()) {
          if (h.playing && !h.raf) start()
        } else {
          warnOnce()
          stop()
        }
      },

      play() {
        h.playing = true
        if (!timed()) {
          warnOnce()
          stop()
          return
        }
        if (h.time >= total()) h.time = 0
        start()
      },
      pause() {
        h.playing = false
        stop()
      },
      seek(progress: number) {
        const p = Math.min(1, Math.max(0, progress))
        h.time = p * total()
        h.opts.onProgress?.(p, h.place(h.time))
      },
      place(t, withCamera = false) {
        const { times, speeds, coords } = h.opts.track ?? {}
        if (!times || !speeds || !coords || times.length < 2) return 0

        const tc = Math.min(Math.max(t, 0), times[times.length - 1])
        let i = 0
        let j = times.length - 1
        while (j - i > 1) {
          const m = (i + j) >> 1
          if (times[m] <= tc) i = m
          else j = m
        }
        const u = (tc - times[i]) / (times[i + 1] - times[i] || 1)
        const coord: Coord = [
          coords[i][0] + (coords[i + 1][0] - coords[i][0]) * u,
          coords[i][1] + (coords[i + 1][1] - coords[i][1]) * u,
        ]
        vehicle.setData(point(coord))
        if (withCamera && h.opts.follow)
          engine.module<FollowCamHandle | undefined>('FollowCam')?.follow(coord, bearingBetween(coords[i], coords[i + 1]))
        return speeds[i] + (speeds[i + 1] - speeds[i]) * u
      },
      isPlaying() {
        return h.playing
      },
    }

    // The pulse only animates while something else is already paying for repaints
    // (playback, camera motion); idle it settles to a static frame and costs nothing.
    let phase = 0
    let wasActive = true
    map.on('move', onMove)
    h.timer = window.setInterval(() => {
      if (document.hidden) return
      if (!(h.playing || performance.now() - lastMove < 700)) {
        if (wasActive) {
          wasActive = false
          map.setPaintProperty('playback-pulse', 'circle-radius', 12)
          map.setPaintProperty('playback-pulse', 'circle-opacity', 0.3)
        }
        return
      }
      wasActive = true
      const p = (phase++ % 12) / 12
      map.setPaintProperty('playback-pulse', 'circle-radius', 10 + p * 16)
      map.setPaintProperty('playback-pulse', 'circle-opacity', 0.45 - p * 0.4)
    }, 90)

    if (options.playing) h.play()
    return h
  },

  update(handle, options, prev) {
    handle.opts = options

    if (options.track !== prev.track) handle.retarget()

    if (options.playing !== prev.playing) {
      if (options.playing) handle.play()
      else handle.pause()
    }

    if (!handle.playing && options.progress !== prev.progress) {
      const times = options.track?.times
      const t = options.progress * (times?.length ? times[times.length - 1] : 0)
      if (Math.abs(t - handle.time) >= 0.5) {
        handle.time = t
        options.onProgress?.(options.progress, handle.place(t))
      }
    }
  },

  destroy(handle, engine) {
    window.clearInterval(handle.timer)
    cancelAnimationFrame(handle.raf)
    engine.map.off('move', handle.onMove)
  },
})
