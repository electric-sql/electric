import { describe, expectTypeOf, it } from 'vitest'
import { useShape, UseShapeResult } from '../src/react-hooks'
import { Row } from 'packages/typescript-client/dist'

describe(`useShape`, () => {
  it(`should infer correct return type when no selector is provided`, () => {
    const shape = useShape({
      table: ``,
      url: ``,
    })

    expectTypeOf(shape).toEqualTypeOf<UseShapeResult>()
  })

  type SelectorRetType = {
    foo: number
    bar: boolean
    baz: string
    ts: Date
  }

  it(`should infer correct return type when a selector is provided`, () => {
    const shape = useShape({
      table: ``,
      url: ``,
      selector: (_value: UseShapeResult) => {
        return {
          foo: 5,
          bar: true,
          baz: `str`,
          ts: new Date(),
        }
      },
    })

    expectTypeOf(shape).toEqualTypeOf<SelectorRetType>()
  })

  it(`should raise a type error if type argument does not equal inferred return type`, () => {
    const shape = useShape<Row, number>({
      table: ``,
      url: ``,
      // @ts-expect-error - should have type mismatch, because doesn't match the declared `Number` type
      selector: (_value: UseShapeResult) => {
        return {
          foo: 5,
          bar: true,
          baz: `str`,
          ts: new Date(),
        }
      },
    })

    // Return type is based on the type argument
    expectTypeOf(shape).toEqualTypeOf<number>()
  })
})
