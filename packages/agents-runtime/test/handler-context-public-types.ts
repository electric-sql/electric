import type { HandlerContext } from '../src/types'

declare const ctx: HandlerContext

// @ts-expect-error __debug is test-only introspection and must not be public API
ctx.__debug
