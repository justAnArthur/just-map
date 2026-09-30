import type { JustMapEngine } from './engine'

/**
 * A just-map module definition. Modules are the unit of composition:
 * each owns a slice of the map (sources, layers, behaviors) and is installed
 * via its factory — `Terrain({ exaggeration: 1.8 })`.
 */
export type ModuleDef<P extends object> = {
  /** unique PascalCase name; doubles as the `engine.module(name)` key */
  name: string
  defaults: P

  /** capability tags this module adds to the engine, e.g. Terrain → ['3d'] */
  provides?: readonly string[]

  /** module names or capabilities that must also be installed; the engine throws at init when missing */
  requires?: readonly string[]

  /** module names or capabilities this module benefits from; affected features degrade with a dev warning */
  uses?: readonly string[]

  /** runs after style load, in modules[] order (order = layer order); returns the module's imperative handle */
  create?(engine: JustMapEngine, options: P): unknown

  /** live option changes (React re-renders diff options per module and call this) */
  update?(handle: any, options: P, prev: P, engine: JustMapEngine): void

  destroy?(handle: any, engine: JustMapEngine): void
}

export type ModuleSpec<P extends object = Record<string, unknown>> = {
  def: ModuleDef<P>
  options: P
}

export type ModuleFactory<P extends object> = {
  (options?: Partial<P>): ModuleSpec<P>
  def: ModuleDef<P>
}

/** Define a module. Returns its factory: `const Terrain = module({ name: 'Terrain', ... })`. */
export function module<P extends object>(def: ModuleDef<P>): ModuleFactory<P> {
  const factory = ((options?: Partial<P>) => ({
    def,
    options: { ...def.defaults, ...options },
  })) as ModuleFactory<P>

  factory.def = def
  return factory
}
