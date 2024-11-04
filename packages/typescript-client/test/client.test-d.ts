import { describe, expectTypeOf, it } from 'vitest'
import {
  Row,
  ShapeStream,
  Shape,
  Message,
  isChangeMessage,
  ShapeData,
} from '../src'

type CustomRow = {
  foo: number
  bar: boolean
  baz: string
  ts: Date
}

describe(`client`, () => {
  describe(`ShapeStream`, () => {
    it(`should infer generic row return type when no type is provided`, () => {
      const shapeStream = new ShapeStream({
        table: ``,
        url: ``,
      })

      expectTypeOf(shapeStream).toEqualTypeOf<ShapeStream<Row>>()
      shapeStream.subscribe((msgs) => {
        expectTypeOf(msgs).toEqualTypeOf<Message<Row>[]>()
      })
    })

    it(`should infer correct return type when provided`, () => {
      const shapeStream = new ShapeStream<CustomRow>({
        table: ``,
        url: ``,
        parser: {
          timestampz: (date: string) => {
            return new Date(date)
          },
        },
      })

      shapeStream.subscribe((msgs) => {
        expectTypeOf(msgs).toEqualTypeOf<Message<CustomRow>[]>()
        if (isChangeMessage(msgs[0])) {
          expectTypeOf(msgs[0].value).toEqualTypeOf<CustomRow>()
        }
      })
    })
  })

  describe(`Shape`, () => {
    it(`should infer generic row return type when no type is provided`, async () => {
      const shapeStream = new ShapeStream({
        table: ``,
        url: ``,
      })
      const shape = new Shape(shapeStream)

      expectTypeOf(shape).toEqualTypeOf<Shape<Row>>()

      shape.subscribe(({ value, rows }) => {
        expectTypeOf(value).toEqualTypeOf<ShapeData<Row>>()
        expectTypeOf(rows).toEqualTypeOf<Row[]>()
      })

      const data = await shape.value
      expectTypeOf(data).toEqualTypeOf<ShapeData<Row>>()
    })

    it(`should infer correct return type when provided`, async () => {
      const shapeStream = new ShapeStream<CustomRow>({
        table: ``,
        url: ``,
        parser: {
          timestampz: (date: string) => {
            return new Date(date)
          },
        },
      })
      const shape = new Shape(shapeStream)
      expectTypeOf(shape).toEqualTypeOf<Shape<CustomRow>>()

      shape.subscribe(({ value, rows }) => {
        expectTypeOf(value).toEqualTypeOf<ShapeData<CustomRow>>()
        expectTypeOf(rows).toEqualTypeOf<CustomRow[]>()
      })

      const data = await shape.value
      expectTypeOf(data).toEqualTypeOf<ShapeData<CustomRow>>()
    })
  })
})
