import { DMMF } from '@prisma/generator-helper'
import { it, expect, describe } from 'vitest'

import { DEFAULT_GENERATOR_CONFIG, FIELD_BASE } from './setup'
import { ExtendedDMMFFieldValidatorString } from '../extendedDMMFFieldValidatorString'

const getField = (field?: Partial<DMMF.Field>) =>
  new ExtendedDMMFFieldValidatorString(
    { ...FIELD_BASE, ...field },
    DEFAULT_GENERATOR_CONFIG,
    'ModelName'
  )

describe(`ExtendedDMMFFieldValidatorString`, () => {
  it(`should load class without docs`, async () => {
    const field = getField()
    expect(field.zodValidatorString).toBeUndefined()
  })

  it(`should load class with docs and validator`, async () => {
    const field = getField({
      documentation:
        'some text in docs @zod.string({ required_error: "error" }).min(2).max(4)',
    })
    expect(field.zodValidatorString).toBe('.min(2).max(4)')
  })

  it(`should load class with docs and validator on field with default validator`, async () => {
    const field = getField({
      type: 'Int',
      documentation:
        'some text in docs @zod.number({ required_error: "error" }).lt(2).gt(4).array(.length(2))',
    })
    expect(field.zodValidatorString).toBe('.lt(2).gt(4)')
  })

  it(`should load class with docs and NO validator on field with default validator`, async () => {
    const field = getField({
      type: 'Int',
      documentation: 'some text in docs',
    })
    expect(field?.zodValidatorString).toBe('.int()')
  })
})
