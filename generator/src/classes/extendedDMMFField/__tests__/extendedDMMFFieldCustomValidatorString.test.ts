import { DMMF } from '@prisma/generator-helper'
import { it, expect, describe } from 'vitest'

import { DEFAULT_GENERATOR_CONFIG, FIELD_BASE } from './setup'
import { ExtendedDMMFFieldCustomValidatorString } from '../extendedDMMFFieldCustomValidatorString'

const getField = (field?: Partial<DMMF.Field>) =>
  new ExtendedDMMFFieldCustomValidatorString(
    { ...FIELD_BASE, ...field },
    DEFAULT_GENERATOR_CONFIG,
    'ModelName'
  )

describe(`ExtendedDMMFFieldCustomValidatorString`, () => {
  it(`should load class with docs and custom validator`, async () => {
    const field = getField({
      documentation:
        'some text in docs @zod.custom.use(z.string().min(2).max(4)).array(.length(2))',
    })
    expect(field.zodCustomValidatorString).toBe('z.string().min(2).max(4)')
  })

  it(`should load class with docs and custom omit validator`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["model", "input"])',
    })
    expect(field.zodCustomValidatorString).toBeUndefined()
  })

  it(`should load class with docs and invalid validator for type string`, async () => {
    expect(() =>
      getField({
        documentation:
          'some text in docs @zod.custom.use(z.string().min(2).max(4)).array(.length(2)).wrong()',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})
