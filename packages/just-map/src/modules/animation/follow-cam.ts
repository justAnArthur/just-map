import type maplibregl from 'maplibre-gl'
import { module } from '../../core/module'
import type { Coord } from '../../utils/types'

export type FollowCamOptions = {
  /** camera pitch in degrees while following; only applied with Terrain installed */
  pitch: number
  /** the camera never zooms below this while following */
  zoomFloor: number
  /** camera update rate; `follow()` may be called at up to 60Hz */
  fps: number
}

export type FollowCamHandle = {
  /** track a moving subject; call on every position update. bearing in degrees, 0 = north */
  follow(coord: Coord, bearing?: number): void
  stop(): void
}

type State = {
  opts: FollowCamOptions
  parity: number
}

export const FollowCam = module<FollowCamOptions>({
  name: 'FollowCam',
  defaults: { pitch: 60, zoomFloor: 14, fps: 30 },
  create(engine, options) {
    const h: FollowCamHandle & State = {
      opts: options,
      parity: 0,
      follow(coord, bearing) {
        if (h.parity++ % Math.max(1, Math.round(60 / h.opts.fps))) return
        const view: maplibregl.JumpToOptions = {
          center: coord,
          pitch: engine.has('3d') ? h.opts.pitch : 0,
          zoom: Math.max(engine.map.getZoom(), h.opts.zoomFloor),
        }
        if (bearing !== undefined) view.bearing = bearing
        engine.map.jumpTo(view)
      },
      stop() {
        h.parity = 0
      },
    }
    return h
  },
  update(handle, options) {
    handle.opts = options
  },
})
