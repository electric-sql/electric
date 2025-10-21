import { describe, expectTypeOf, it } from "vitest"
import {
  Row,
  ShapeStream,
  Shape,
  Message,
  isChangeMessage,
  ShapeData,
  ExternalParamsRecord,
} from "../src"
import {
  COLUMNS_QUERY_PARAM,
  LIVE_CACHE_BUSTER_QUERY_PARAM,
  SHAPE_HANDLE_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
} from "../src/constants"

type CustomRow = {
  foo: number
  bar: boolean
  baz: string
  ts: Date
}

describe("client", () => {
  describe("ShapeStream", () => {
    it("should infer generic row return type when no type is provided", () => {
      const shapeStream = new ShapeStream({
        url: "",
        params: {
          table: "",
        },
      })

      expectTypeOf(shapeStream).toEqualTypeOf<ShapeStream<Row>>()
      shapeStream.subscribe((msgs) => {
        expectTypeOf(msgs).toEqualTypeOf<Message<Row>[]>()
      })
    })

    it("should infer correct return type when provided", () => {
      const shapeStream = new ShapeStream<CustomRow>({
        url: "",
        params: {
          table: "",
        },
        parser: {
          timestamptz: (date: string) => {
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

    describe("params validation", () => {
      it("should allow valid params", () => {
        const validParams: ExternalParamsRecord = {
          // PostgreSQL params
          table: "users",
          columns: ["id", "name"],
          where: "id > 0",
          replica: "full",

          // Custom params
          customParam: "value",
          customArrayParam: ["value1", "value2"],
          customFunctionParam: () => "value",
          customAsyncFunctionParam: async () => ["value1", "value2"],
        }
        expectTypeOf(validParams).toEqualTypeOf<ExternalParamsRecord>()
      })

      it("should not allow reserved params", () => {
        // Test that reserved parameters are not allowed in ExternalParamsRecord
        type WithReservedParam1 = { [COLUMNS_QUERY_PARAM]: string }
        type WithReservedParam2 = { [LIVE_CACHE_BUSTER_QUERY_PARAM]: string }
        type WithReservedParam3 = { [SHAPE_HANDLE_QUERY_PARAM]: string }
        type WithReservedParam4 = { [LIVE_QUERY_PARAM]: string }
        type WithReservedParam5 = { [OFFSET_QUERY_PARAM]: string }

        // These should all not be equal to ExternalParamsRecord (not assignable)
        expectTypeOf<WithReservedParam1>().not.toMatchTypeOf<ExternalParamsRecord>()
        expectTypeOf<WithReservedParam2>().not.toMatchTypeOf<ExternalParamsRecord>()
        expectTypeOf<WithReservedParam3>().not.toMatchTypeOf<ExternalParamsRecord>()
        expectTypeOf<WithReservedParam4>().not.toMatchTypeOf<ExternalParamsRecord>()
        expectTypeOf<WithReservedParam5>().not.toMatchTypeOf<ExternalParamsRecord>()
      })
    })
  })

  describe("Shape", () => {
    it("should infer generic row return type when no type is provided", async () => {
      const shapeStream = new ShapeStream({
        url: "",
        params: {
          table: "",
        },
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

    it("should infer correct return type when provided", async () => {
      const shapeStream = new ShapeStream<CustomRow>({
        url: "",
        params: {
          table: "",
        },
        parser: {
          timestamptz: (date: string) => {
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
