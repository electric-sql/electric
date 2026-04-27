import { describe, expect, it } from 'vitest'
import { SchemaValidator } from '../src/electric-agents-schema-validator'

describe(`SchemaValidator`, () => {
  it(`accepts nullable union keywords produced by runtime state schemas`, () => {
    const validator = new SchemaValidator()

    const result = validator.validateSchemaSubset({
      type: `object`,
      properties: {
        articleKey: {
          anyOf: [{ type: `string` }, { type: `null` }],
        },
        stage: {
          oneOf: [{ type: `integer` }, { const: 0 }],
        },
      },
    })

    expect(result).toBeNull()
  })

  it(`still rejects unknown schema keywords`, () => {
    const validator = new SchemaValidator()

    const result = validator.validateSchemaSubset({
      type: `object`,
      if: {
        properties: {
          kind: { const: `entity` },
        },
      },
    })

    expect(result).toMatchObject({
      code: `INVALID_REQUEST`,
      message: `Schema uses disallowed keywords`,
    })
  })
})
