import { describe, expect, it } from 'vitest'
import {
  isModelProperty,
  schemaModelSupportsImageInput,
} from './modelCapabilities'

const schema = {
  type: `object`,
  properties: {
    model: {
      enum: [`anthropic:claude-sonnet-4-6`, `deepseek:deepseek-v4-flash`],
      default: `anthropic:claude-sonnet-4-6`,
    },
  },
  $defs: {
    electricModelInputs: {
      type: `object`,
      properties: {
        'anthropic:claude-sonnet-4-6': {
          default: [`text`, `image`],
        },
        'deepseek:deepseek-v4-flash': {
          default: [`text`],
        },
      },
    },
  },
}

describe(`model capabilities`, () => {
  it(`recognizes common model property spellings`, () => {
    expect(isModelProperty(`model`)).toBe(true)
    expect(isModelProperty(`modelId`)).toBe(true)
    expect(isModelProperty(`model_id`)).toBe(true)
    expect(isModelProperty(`provider`)).toBe(false)
  })

  it(`gates image input from schema metadata`, () => {
    expect(
      schemaModelSupportsImageInput(schema, {
        model: `deepseek:deepseek-v4-flash`,
      })
    ).toBe(false)
    expect(
      schemaModelSupportsImageInput(schema, {
        model: `anthropic:claude-sonnet-4-6`,
      })
    ).toBe(true)
  })

  it(`uses the schema default and fails open when metadata is absent`, () => {
    expect(schemaModelSupportsImageInput(schema, {})).toBe(true)
    expect(schemaModelSupportsImageInput(null, {})).toBe(true)
  })
})
