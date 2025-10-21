import { describe, expectTypeOf, test } from "vitest"
import { Row, ShapeStream, ShapeStreamOptions } from "@electric-sql/client"
import { MultiShapeStream } from "../src/multi-shape-stream"

interface UserRow extends Row {
  id: string
  name: string
}

interface PostRow extends Row {
  id: string
  content: string
}

describe("MultiShapeStream", () => {
  test("type inference with ShapeStream instances", () => {
    const stream = new MultiShapeStream({
      shapes: {
        users: new ShapeStream<UserRow>({ url: "users" }),
        posts: new ShapeStream<PostRow>({ url: "posts" }),
      },
    })

    expectTypeOf(stream.shapes.users).toEqualTypeOf<ShapeStream<UserRow>>()
    expectTypeOf(stream.shapes.posts).toEqualTypeOf<ShapeStream<PostRow>>()
  })

  test("type inference with ShapeStreamOptions", () => {
    const stream = new MultiShapeStream({
      shapes: {
        users: { url: "users" } as ShapeStreamOptions<UserRow>,
        posts: { url: "posts" } as ShapeStreamOptions<PostRow>,
      },
    })

    expectTypeOf(stream.shapes.users).toEqualTypeOf<ShapeStream<UserRow>>()
    expectTypeOf(stream.shapes.posts).toEqualTypeOf<ShapeStream<PostRow>>()
  })

  test("type inference with mixed ShapeStream and ShapeStreamOptions", () => {
    const stream = new MultiShapeStream({
      shapes: {
        users: new ShapeStream<UserRow>({ url: "users" }),
        posts: { url: "posts" } as ShapeStreamOptions<PostRow>,
      },
    })

    expectTypeOf(stream.shapes.users).toEqualTypeOf<ShapeStream<UserRow>>()
    expectTypeOf(stream.shapes.posts).toEqualTypeOf<ShapeStream<PostRow>>()
  })
})
