import { describe, expect, it } from 'vitest'
import {
  groupModelSettings,
  hasSchemaProperties,
  inlineSchemaProperties,
  isObjectSchema,
  isReasoningProperty,
  isSimpleType,
  isSpeedProperty,
  isStringArrayType,
  parseStringArray,
  stringArrayToDisplay,
} from './schemaProperties'

const hortonLike = {
  type: `object`,
  properties: {
    model: { enum: [`anthropic:a`, `openai:b`], default: `anthropic:a` },
    reasoningEffort: { enum: [`auto`, `high`], default: `auto` },
    workingDirectory: { type: `string` },
    verbose: { type: `boolean` },
  },
}

describe(`schemaProperties`, () => {
  it(`detects object schemas with properties`, () => {
    expect(isObjectSchema(hortonLike)).toBe(true)
    expect(isObjectSchema(null)).toBe(false)
    expect(isObjectSchema({})).toBe(false)
    expect(hasSchemaProperties(hortonLike)).toBe(true)
    expect(hasSchemaProperties({ type: `object`, properties: {} })).toBe(false)
  })

  it(`returns only enum and boolean properties as inline`, () => {
    const keys = inlineSchemaProperties(hortonLike).map((p) => p.key)
    expect(keys).toEqual([`model`, `reasoningEffort`, `verbose`])
  })

  it(`recognizes reasoning/speed property spellings (normalized)`, () => {
    expect(isReasoningProperty(`reasoningEffort`)).toBe(true)
    expect(isReasoningProperty(`thinking_level`)).toBe(true)
    expect(isReasoningProperty(`model`)).toBe(false)
    expect(isSpeedProperty(`speed`)).toBe(true)
    expect(isSpeedProperty(`service-tier`)).toBe(true)
    expect(isSpeedProperty(`reasoningEffort`)).toBe(false)
  })

  it(`bundles model + reasoning (+ optional speed) and leaves the rest standalone`, () => {
    const inline = inlineSchemaProperties(hortonLike)
    const { modelSettings, standalone } = groupModelSettings(inline)
    expect(modelSettings?.model.key).toBe(`model`)
    expect(modelSettings?.reasoning.key).toBe(`reasoningEffort`)
    expect(modelSettings?.speed).toBeUndefined()
    expect(standalone.map((p) => p.key)).toEqual([`verbose`])
  })

  it(`does not bundle when reasoning is absent`, () => {
    const inline = inlineSchemaProperties({
      type: `object`,
      properties: { model: { enum: [`a`] }, verbose: { type: `boolean` } },
    })
    const { modelSettings, standalone } = groupModelSettings(inline)
    expect(modelSettings).toBeNull()
    expect(standalone.map((p) => p.key)).toEqual([`model`, `verbose`])
  })

  it(`classifies simple, string-array, and complex properties`, () => {
    expect(isSimpleType({ type: `string` })).toBe(true)
    expect(isSimpleType({ enum: [`a`] })).toBe(true)
    expect(isSimpleType({ type: `array`, items: { type: `string` } })).toBe(
      false
    )
    expect(
      isStringArrayType({ type: `array`, items: { type: `string` } })
    ).toBe(true)
    expect(
      isStringArrayType({ type: `array`, items: { type: `number` } })
    ).toBe(false)
  })

  it(`parses comma and JSON string arrays, and renders them back`, () => {
    expect(parseStringArray(`a, b ,c`)).toEqual([`a`, `b`, `c`])
    expect(parseStringArray(`["x","y"]`)).toEqual([`x`, `y`])
    expect(parseStringArray(``)).toEqual([])
    expect(stringArrayToDisplay([`a`, `b`])).toBe(`a, b`)
    expect(stringArrayToDisplay(`raw`)).toBe(`raw`)
    expect(stringArrayToDisplay(undefined)).toBe(``)
  })
})
