/**
 * Shared JSON body schema middleware for itty-router handlers.
 */

import Ajv from 'ajv'
import { apiError } from '../electric-agents-http'
import { ErrCodeInvalidRequest } from '../electric-agents-types'
import type { TSchema as TypeBoxSchema } from '@sinclair/typebox'
import type { ValidateFunction } from 'ajv'
import type { IRequest, RequestHandler } from 'itty-router'

export interface JsonRouteRequest extends IRequest {
  content?: unknown
}

const jsonBodyAjv = new Ajv({ allErrors: true })
const schemaValidators = new WeakMap<TypeBoxSchema, ValidateFunction>()

export function routeBody<T>(request: JsonRouteRequest): T {
  return request.content as T
}

export interface WithSchemaOptions {
  lenient?: boolean
}

export function withSchema<TSchema extends TypeBoxSchema>(
  schema: TSchema,
  options: WithSchemaOptions = {}
): RequestHandler<JsonRouteRequest, Array<unknown>> {
  return async (request) => {
    const contentType = request.headers.get(`content-type`)?.toLowerCase() ?? ``
    const isJson = contentType.includes(`application/json`)
    if (options.lenient && !isJson) {
      return undefined
    }

    const bodyStr = await request.text()
    let parsed: unknown

    if (bodyStr.trim()) {
      try {
        parsed = JSON.parse(bodyStr)
      } catch {
        return apiError(400, ErrCodeInvalidRequest, `Invalid JSON body`)
      }
    } else {
      parsed = {}
    }

    const validate = schemaValidator(schema)
    if (!validate(parsed)) {
      return apiError(
        400,
        ErrCodeInvalidRequest,
        `Request body does not match API schema`,
        (validate.errors ?? []).map((err) => ({
          path: err.instancePath || `/`,
          message: err.message ?? `validation error`,
        }))
      )
    }

    request.content = parsed
    return undefined
  }
}

export function validateBody<TSchema extends TypeBoxSchema>(
  schema: TSchema,
  body: Uint8Array
): { ok: true; value: unknown } | { ok: false; response: Response } {
  const parsed = parseJsonBodyBytes(body)
  if (!parsed.ok) return parsed

  const validation = validateParsedBody(schema, parsed.value)
  if (!validation.ok) return validation
  return { ok: true, value: parsed.value }
}

export function validateOptionalJsonBody<TSchema extends TypeBoxSchema>(
  schema: TSchema,
  body: Uint8Array,
  contentType?: string | null
):
  | { ok: true; value: unknown | undefined }
  | { ok: false; response: Response } {
  const bodyText = new TextDecoder().decode(body)
  const trimmed = bodyText.trim()
  if (!trimmed) return { ok: true, value: undefined }

  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    if (contentType?.toLowerCase().includes(`application/json`)) {
      return {
        ok: false,
        response: apiError(400, ErrCodeInvalidRequest, `Invalid JSON body`),
      }
    }
    return { ok: true, value: undefined }
  }

  const validation = validateParsedBody(schema, parsed)
  if (!validation.ok) return validation
  return { ok: true, value: parsed }
}

function parseJsonBodyBytes(
  body: Uint8Array
): { ok: true; value: unknown } | { ok: false; response: Response } {
  if (body.length === 0) return { ok: true, value: {} }
  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder().decode(body)) as unknown,
    }
  } catch {
    return {
      ok: false,
      response: apiError(400, ErrCodeInvalidRequest, `Invalid JSON body`),
    }
  }
}

function validateParsedBody<TSchema extends TypeBoxSchema>(
  schema: TSchema,
  parsed: unknown
): { ok: true } | { ok: false; response: Response } {
  const validate = schemaValidator(schema)
  if (validate(parsed)) return { ok: true }
  return {
    ok: false,
    response: apiError(
      400,
      ErrCodeInvalidRequest,
      `Request body does not match API schema`,
      (validate.errors ?? []).map((err) => ({
        path: err.instancePath || `/`,
        message: err.message ?? `validation error`,
      }))
    ),
  }
}

function schemaValidator(schema: TypeBoxSchema): ValidateFunction {
  let validate = schemaValidators.get(schema)
  if (!validate) {
    validate = jsonBodyAjv.compile(schema)
    schemaValidators.set(schema, validate)
  }
  return validate
}
