import { describe, expectTypeOf, it } from 'vitest'
import {
  useShape,
  UseShapeResult,
  UseShapeResultEnabled,
  UseShapeResultDisabled,
} from '../src/react-hooks'
import { Row } from 'packages/typescript-client/dist'

describe(`useShape`, () => {
  it(`should infer correct return type when no selector is provided`, () => {
    const shape = useShape({
      params: {
        table: ``,
      },
      url: ``,
    })

    expectTypeOf(shape).toEqualTypeOf<UseShapeResultEnabled>()
  })

  type SelectorRetType = {
    foo: number
    bar: boolean
    baz: string
    ts: Date
  }

  it(`should infer correct return type when a selector is provided`, () => {
    const shape = useShape({
      params: {
        table: ``,
      },
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
      params: {
        table: ``,
      },
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

  it(`should return UseShapeResultEnabled when enabled is true or undefined`, () => {
    const shape1 = useShape({
      params: {
        table: ``,
      },
      url: ``,
      enabled: true,
    })

    const shape2 = useShape({
      params: {
        table: ``,
      },
      url: ``,
      // enabled is undefined (default)
    })

    expectTypeOf(shape1).toEqualTypeOf<UseShapeResultEnabled>()
    expectTypeOf(shape2).toEqualTypeOf<UseShapeResultEnabled>()
  })

  it(`should return UseShapeResultDisabled when enabled is false`, () => {
    const shape = useShape({
      params: {
        table: ``,
      },
      url: ``,
      enabled: false,
    })

    expectTypeOf(shape).toEqualTypeOf<UseShapeResultDisabled>()
  })

  it(`should maintain backwards compatibility when no enabled option is provided`, () => {
    const shape = useShape({
      params: {
        table: ``,
      },
      url: ``,
    })

    // Should return UseShapeResult for backwards compatibility
    expectTypeOf(shape).toEqualTypeOf<UseShapeResultEnabled>()
  })

  it(`should work with selector when enabled is false`, () => {
    const shape = useShape({
      params: {
        table: ``,
      },
      url: ``,
      enabled: false,
      selector: (result) => result.data.length,
    })

    expectTypeOf(shape).toEqualTypeOf<number>()
  })

  it(`should work with selector when enabled is true`, () => {
    const shape = useShape({
      params: {
        table: ``,
      },
      url: ``,
      enabled: true,
      selector: (result) => result.data.length,
    })

    expectTypeOf(shape).toEqualTypeOf<number>()
  })
})
