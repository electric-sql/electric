import { beforeEach, describe, expect, it, vi } from 'vitest'

const { shapeStreamMock, shapeMock } = vi.hoisted(() => ({
  shapeStreamMock: vi.fn(),
  shapeMock: vi.fn(),
}))

vi.mock(`@electric-sql/client`, () => ({
  ShapeStream: shapeStreamMock,
  Shape: shapeMock,
}))

import { fetchShapeRows } from '../src/shape-fetch'

describe(`fetchShapeRows`, () => {
  beforeEach(() => {
    shapeStreamMock.mockClear()
    shapeMock.mockClear()
    shapeStreamMock.mockImplementation(function ShapeStreamMock(
      this: { options?: unknown },
      options: unknown
    ) {
      this.options = options
    })
    shapeMock.mockImplementation(function ShapeMock(this: {
      rows?: Promise<unknown[]>
    }) {
      this.rows = Promise.resolve([])
    })
  })

  it(`builds shape URLs below tenant path prefixes`, async () => {
    await fetchShapeRows(
      `http://agents.test/t/svc-123/v1`,
      `electric_agents_entity_types`
    )

    expect(shapeStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `http://agents.test/t/svc-123/v1/_electric/electric/v1/shape`,
        params: { table: `electric_agents_entity_types` },
        subscribe: false,
      })
    )
  })
})
