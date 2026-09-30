type Handler<T> = (payload: T) => void

export class Emitter<Events extends Record<string, unknown>> {
  #map = new Map<keyof Events, Set<(payload: any) => void>>()

  on(event: keyof Events, handler: Handler<any>) {
    let set = this.#map.get(event)
    if (!set) this.#map.set(event, (set = new Set()))
    set.add(handler)
    return () => this.off(event, handler)
  }

  off(event: keyof Events, handler: Handler<any>) {
    this.#map.get(event)?.delete(handler)
  }

  emit(event: keyof Events, payload: any) {
    for (const handler of this.#map.get(event) ?? []) handler(payload)
  }

  clear() {
    this.#map.clear()
  }
}
