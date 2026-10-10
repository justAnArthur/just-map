import type maplibregl from 'maplibre-gl'
import type { MapStyleImageMissingEvent, StyleImageMetadata } from 'maplibre-gl'

/** raw RGBA pixels plus addImage metadata; no canvas, so sprites also build outside a browser */
export type Sprite = {
  width: number
  height: number
  data: Uint8ClampedArray
  options: Partial<StyleImageMetadata>
}

type Point = [number, number]

const PIXEL_RATIO = 2
const SDF_RADIUS = 8

function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}

function insidePolygon(p: Point, poly: Point[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const crosses = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/** signed distance field of a polygon, alpha-encoded the way maplibre sdf icons expect (edge = 0.75) */
export function polygonSdf(poly: Point[], size: number): Sprite {
  const data = new Uint8ClampedArray(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p: Point = [x + 0.5, y + 0.5]
      let d = Infinity
      for (let i = 0; i < poly.length; i++) d = Math.min(d, segmentDistance(p, poly[i], poly[(i + 1) % poly.length]))
      const signed = insidePolygon(p, poly) ? -d : d

      const o = (y * size + x) * 4
      data[o] = data[o + 1] = data[o + 2] = 255
      data[o + 3] = 255 * (0.75 - signed / SDF_RADIUS)
    }
  }

  return { width: size, height: size, data, options: { sdf: true, pixelRatio: PIXEL_RATIO } }
}

/** navigation arrow pointing north; tint with `icon-color`, rotate with `icon-rotate` */
export const arrowSprite = () =>
  polygonSdf(
    [
      [28, 6],
      [47, 49],
      [28, 39],
      [9, 49],
    ],
    56,
  )

/** white rounded label background with a hairline border, stretchable for `icon-text-fit` */
export function pillSprite(): Sprite {
  const width = 40
  const height = 32
  const radius = 10
  const border = 2
  const data = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // rounded-box distance, inset 1px so the antialiased edge fits
      const px = Math.abs(x + 0.5 - width / 2) - (width / 2 - 1 - radius)
      const py = Math.abs(y + 0.5 - height / 2) - (height / 2 - 1 - radius)
      const d = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - radius

      const o = (y * width + x) * 4
      const rgb = d > -border ? [203, 213, 225] : [255, 255, 255]
      data.set(rgb, o)
      data[o + 3] = 255 * Math.min(1, Math.max(0, 0.5 - d))
    }
  }

  return {
    width,
    height,
    data,
    options: {
      pixelRatio: PIXEL_RATIO,
      stretchX: [[radius + 1, width - radius - 1]],
      stretchY: [[radius + 1, height - radius - 1]],
      content: [8, 5, width - 8, height - 5],
    },
  }
}

/** adds the image now and again after a style swap (setStyle drops runtime images); returns the cleanup */
export function keepImage(map: maplibregl.Map, id: string, sprite: () => Sprite) {
  const add = () => {
    if (map.hasImage(id)) return
    const { options, ...image } = sprite()
    map.addImage(id, image, options)
  }
  const onMissing = (e: MapStyleImageMissingEvent) => {
    if (e.id === id) add()
  }

  add()
  map.on('styleimagemissing', onMissing)

  return () => {
    map.off('styleimagemissing', onMissing)
    if (map.hasImage(id)) map.removeImage(id)
  }
}
