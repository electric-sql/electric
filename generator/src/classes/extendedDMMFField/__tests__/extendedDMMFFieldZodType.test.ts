import { DMMF } from '@prisma/generator-helper'
import { it, expect, describe } from 'vitest'

import { DEFAULT_GENERATOR_CONFIG, FIELD_BASE } from './setup'
import { ExtendedDMMFFieldZodType } from '../extendedDMMFFieldZodType'

const getField = (field?: Partial<DMMF.Field>) =>
  new ExtendedDMMFFieldZodType(
    { ...FIELD_BASE, ...field },
    DEFAULT_GENERATOR_CONFIG,
    'ModelName'
  )

describe(`ExtendedDMMFFieldZodType`, () => {
  it(`should load a class of type String`, async () => {
    const field = getField({ type: 'String' })
    expect(field.zodType).toBe('string')
  })

  it(`should load a class of type Boolean`, async () => {
    const field = getField({ type: 'Boolean' })
    expect(field.zodType).toBe('boolean')
  })

  it(`should load a class of type DateTime`, async () => {
    const field = getField({ type: 'DateTime' })
    expect(field.zodType).toBe('date')
  })

  it(`should load a class of type Int`, async () => {
    const field = getField({ type: 'Int' })
    expect(field.zodType).toBe('number')
  })

  it(`should load a class of type BigInt`, async () => {
    const field = getField({ type: 'BigInt' })
    expect(field.zodType).toBe('bigint')
  })

  it(`should load a class of type Float`, async () => {
    const field = getField({ type: 'Float' })
    expect(field.zodType).toBe('number')
  })
})
