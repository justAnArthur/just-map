import { expect, test } from 'bun:test'
import { cameraPosition, multiply, translation } from './gl'

test('cameraPosition recovers the eye of a view-projection matrix', () => {
  // perspective looking down -z, camera translated to (3, -2, 7)
  const f = 1 / Math.tan(0.4)
  const near = 0.1
  const far = 100
  const projection = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
  const view = translation(-3, 2, -7)
  const [x, y, z] = cameraPosition(multiply(projection, view))
  expect(x).toBeCloseTo(3, 9)
  expect(y).toBeCloseTo(-2, 9)
  expect(z).toBeCloseTo(7, 9)
})
