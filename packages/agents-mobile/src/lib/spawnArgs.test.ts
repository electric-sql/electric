import { describe, expect, it } from 'vitest'
import {
  arrayFieldEntries,
  buildInitialSpawnArgs,
  coerceTextFieldValue,
  finalizeSpawnArgs,
  hasMissingRequiredArgs,
  inlineArgProperties,
  isTextFieldProperty,
  objectFieldEntries,
  textFieldEntries,
} from './spawnArgs'

const schema = {
  type: `object`,
  properties: {
    model: { enum: [`anthropic:a`, `openai:b`], default: `anthropic:a` },
    reasoningEffort: { enum: [`auto`, `high`] },
    verbose: { type: `boolean` },
    label: { type: `string`, default: `draft` },
    count: { type: `integer` },
    tags: { type: `array`, items: { type: `string` } },
    config: { type: `object` },
    workingDirectory: { type: `string` },
  },
  required: [`label`, `count`],
}

describe(`spawnArgs`, () => {
  it(`seeds defaults: schema default, first enum, false for booleans`, () => {
    // AsyncStorage isn't hydrated in tests, so the model falls back to its
    // schema default rather than a remembered pick.
    expect(buildInitialSpawnArgs(schema)).toEqual({
      model: `anthropic:a`,
      reasoningEffort: `auto`,
      verbose: false,
      label: `draft`,
    })
  })

  it(`skips omitKeys when seeding (both inline and defaulted fields)`, () => {
    // `reasoningEffort` is an inline enum and `label` a defaulted text field;
    // omitting them keeps their defaults out of the seeded args, matching the
    // omitKeys the controls/gating/finalize steps already respect.
    expect(buildInitialSpawnArgs(schema, [`reasoningEffort`, `label`])).toEqual(
      {
        model: `anthropic:a`,
        verbose: false,
      }
    )
  })

  it(`classifies text fields (string/number) but not enums or booleans`, () => {
    expect(isTextFieldProperty({ type: `string` })).toBe(true)
    expect(isTextFieldProperty({ type: `integer` })).toBe(true)
    expect(isTextFieldProperty({ type: `string`, enum: [`a`] })).toBe(false)
    expect(isTextFieldProperty({ type: `boolean` })).toBe(false)
  })

  it(`classifies inline / text / array / object properties (with omitKeys)`, () => {
    expect(inlineArgProperties(schema).map((p) => p.key)).toEqual([
      `model`,
      `reasoningEffort`,
      `verbose`,
    ])
    expect(
      textFieldEntries(schema, [`workingDirectory`]).map((p) => p.key)
    ).toEqual([`label`, `count`])
    expect(arrayFieldEntries(schema).map((p) => p.key)).toEqual([`tags`])
    expect(objectFieldEntries(schema).map((p) => p.key)).toEqual([`config`])
  })

  it(`coerces text values to the property type, dropping empty input`, () => {
    expect(coerceTextFieldValue({ type: `string` }, ``)).toBeUndefined()
    expect(coerceTextFieldValue({ type: `string` }, `hi`)).toBe(`hi`)
    expect(coerceTextFieldValue({ type: `integer` }, `42`)).toBe(42)
    expect(coerceTextFieldValue({ type: `number` }, `1.5`)).toBe(1.5)
    // Partial input doesn't round-trip — keep raw text so the field stays
    // editable (e.g. mid-typing `1.`).
    expect(coerceTextFieldValue({ type: `number` }, `1.`)).toBe(`1.`)
  })

  it(`finalizes args: drops empties, keeps 0/false, converts string-arrays`, () => {
    expect(
      finalizeSpawnArgs(schema, {
        label: `x`,
        count: 0,
        verbose: false,
        reasoningEffort: ``,
        tags: `a, b`, // raw text → array
        config: { k: 1 }, // already-parsed object passes through
      })
    ).toEqual({
      label: `x`,
      count: 0,
      verbose: false,
      tags: [`a`, `b`],
      config: { k: 1 },
    })
    // An empty string-array drops out entirely.
    expect(finalizeSpawnArgs(schema, { tags: `` })).toEqual({})
  })

  it(`gates spawn on required fields (respecting omitKeys)`, () => {
    expect(hasMissingRequiredArgs(schema, { label: `x` }, [`count`])).toBe(
      false
    )
    expect(hasMissingRequiredArgs(schema, { label: `x` })).toBe(true)
    expect(hasMissingRequiredArgs(schema, { label: ``, count: 1 })).toBe(true)
    expect(hasMissingRequiredArgs(schema, { label: `x`, count: 1 })).toBe(false)
  })
})
