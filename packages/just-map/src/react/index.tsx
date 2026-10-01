import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { JustMapEngine } from '../core/engine'
import type { ModuleSpec } from '../core/module'
import type { CameraOptions, SkyPreset, SkySpecification } from '../core/style'
import type { JustMapTheme } from '../core/theme'

export type UseJustMapOptions = {
  modules: ModuleSpec<any>[]
  camera?: CameraOptions
  sky?: SkyPreset | SkySpecification | false
  theme?: JustMapTheme
  onReady?(engine: JustMapEngine): void
  onError?(error: unknown): void
  onRemove?(): void
}

/** Mount a just-map engine on a container div and keep it in sync with React state. */
export function useJustMap(options: UseJustMapOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<JustMapEngine | undefined>(undefined)
  const [ready, setReady] = useState(false)

  const cbs = useRef(options)
  cbs.current = options
  const appliedCamera = useRef<CameraOptions | undefined>(options.camera)
  const appliedTheme = useRef<JustMapTheme | undefined>(options.theme)
  const mountedKey = useRef('')

  useEffect(() => {
    let cancelled = false
    const engine = new JustMapEngine(containerRef.current!, {
      modules: options.modules,
      camera: cbs.current.camera,
      sky: cbs.current.sky,
      theme: cbs.current.theme,
    })
    engineRef.current = engine
    // debug affordance: the live engine, also before ready
    ;(globalThis as any).__justMap = engine

    const offError = engine.on('error', e => cbs.current.onError?.(e))
    engine.ready
      .then(() => {
        if (cancelled) return
        setReady(true)
        cbs.current.onReady?.(engine)
      })
      .catch(e => {
        if (!cancelled) cbs.current.onError?.(e)
      })

    return () => {
      cancelled = true
      offError()
      engine.destroy()
      engineRef.current = undefined
      setReady(false)
      cbs.current.onRemove?.()
    }
  }, [])

  useEffect(() => {
    const key = options.modules.map(m => m.def.name).join(',')
    if (!mountedKey.current) {
      mountedKey.current = key
    } else if (mountedKey.current !== key) {
      mountedKey.current = key
      console.warn('just-map: the module set changed — remount to apply it; update module options instead')
    }
  })

  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !ready) return

    for (const spec of options.modules) engine.updateModule(spec)

    if (options.theme && options.theme !== appliedTheme.current) {
      appliedTheme.current = options.theme
      engine.setTheme(options.theme)
    }
    const camera = options.camera
    const prev = appliedCamera.current
    if (camera && prev) {
      const changed: CameraOptions = {}
      let any = false

      for (const k of ['center', 'zoom', 'pitch', 'bearing', 'projection'] as const) {
        if (camera[k] !== undefined && camera[k] !== prev[k]) {
          changed[k] = camera[k] as any
          any = true
        }
      }

      if (any) engine.setCamera(changed)
    }
    appliedCamera.current = camera
  })

  return { containerRef, engine: engineRef.current, ready }
}

export type JustMapProps = UseJustMapOptions & { className?: string; style?: CSSProperties }

/** React entry point: `<JustMap modules={[Render(), Terrain()]} camera={{...}} />`. */
export const JustMap = ({ className, style, ...options }: JustMapProps) => {
  const { containerRef } = useJustMap(options)
  return <div ref={containerRef} className={className} style={{ width: '100%', height: '100%', ...style }} />
}
