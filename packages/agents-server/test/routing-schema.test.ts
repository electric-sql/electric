import { describe, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import { AutoRouter } from 'itty-router'
import { routeBody, withSchema } from '../src/routing/schema'

const exampleSchema = Type.Object({
  foo: Type.Optional(Type.String()),
})

describe(`withSchema strict mode`, () => {
  it(`rejects malformed JSON`, async () => {
    const router = AutoRouter().post(
      `/x`,
      withSchema(exampleSchema),
      () => new Response(`hit`)
    )

    const response = await router.fetch(
      new Request(`http://x/x`, { method: `POST`, body: `not-json` })
    )

    expect(response.status).toBe(400)
  })

  it(`parses valid JSON and exposes it through routeBody`, async () => {
    let captured: { foo?: string } | null = null
    const router = AutoRouter().post(
      `/x`,
      withSchema(exampleSchema),
      (request: any) => {
        captured = routeBody<{ foo?: string }>(request)
        return new Response(`hit`)
      }
    )

    await router.fetch(
      new Request(`http://x/x`, {
        method: `POST`,
        body: JSON.stringify({ foo: `bar` }),
        headers: { 'content-type': `application/json` },
      })
    )

    expect(captured).toEqual({ foo: `bar` })
  })
})

describe(`withSchema lenient mode`, () => {
  it(`skips validation when content-type is not JSON`, async () => {
    let observed: unknown = `untouched`
    const router = AutoRouter().post(
      `/x`,
      withSchema(exampleSchema, { lenient: true }),
      (request: any) => {
        observed = routeBody<unknown>(request)
        return new Response(`hit`)
      }
    )

    const response = await router.fetch(
      new Request(`http://x/x`, {
        method: `POST`,
        body: `opaque-bytes`,
        headers: { 'content-type': `application/octet-stream` },
      })
    )

    expect(response.status).toBe(200)
    expect(observed).toBeUndefined()
  })

  it(`still rejects malformed JSON when content-type is JSON`, async () => {
    const router = AutoRouter().post(
      `/x`,
      withSchema(exampleSchema, { lenient: true }),
      () => new Response(`hit`)
    )

    const response = await router.fetch(
      new Request(`http://x/x`, {
        method: `POST`,
        body: `not-json`,
        headers: { 'content-type': `application/json` },
      })
    )

    expect(response.status).toBe(400)
  })

  it(`rejects schema-mismatched JSON`, async () => {
    const strictNumber = Type.Object({ foo: Type.Number() })
    const router = AutoRouter().post(
      `/x`,
      withSchema(strictNumber, { lenient: true }),
      () => new Response(`hit`)
    )

    const response = await router.fetch(
      new Request(`http://x/x`, {
        method: `POST`,
        body: JSON.stringify({ foo: `not-a-number` }),
        headers: { 'content-type': `application/json` },
      })
    )

    expect(response.status).toBe(400)
  })
})
