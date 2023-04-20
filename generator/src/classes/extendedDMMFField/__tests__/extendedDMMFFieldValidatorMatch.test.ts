import { DMMF } from '@prisma/generator-helper'
import { it, expect, describe } from 'vitest'

import { DEFAULT_GENERATOR_CONFIG, FIELD_BASE } from './setup'
import { ExtendedDMMFFieldValidatorMatch } from '../extendedDMMFFieldValidatorMatch'

const getField = (field?: Partial<DMMF.Field>) =>
  new ExtendedDMMFFieldValidatorMatch(
    { ...FIELD_BASE, ...field },
    DEFAULT_GENERATOR_CONFIG,
    'ModelName'
  )

describe(`ExtendedDMMFFieldValidatorMatch`, () => {
  it(`should load a class without docs`, async () => {
    const field = getField()
    expect(field?.['_validatorMatch']).toBe(undefined)
    expect(field?.clearedDocumentation).toBe(undefined)
  })

  it(`should load a class with docs`, async () => {
    const field = getField({ documentation: 'some text in docs' })
    expect(field?.['_validatorMatch']).toBeUndefined()
    expect(field?.clearedDocumentation).toBe('some text in docs')
    expect(field.documentation).toBe('some text in docs')
  })

  it(`should load a class with docs and string validator`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.string.max(4)',
    })
    const match = field?.['_validatorMatch']
    expect(match?.groups?.['validatorPattern']).toBe('.max(4)')
    expect(field?.clearedDocumentation).toBe('some text in docs')
    expect(field.documentation).toBe('some text in docs @zod.string.max(4)')
  })

  it(`should load a class with docs and number validator`, async () => {
    const field = getField({
      type: 'Int',
      documentation: 'some text in docs @zod.number.lt(4)',
    })
    const match = field?.['_validatorMatch']
    expect(match?.groups?.['validatorPattern']).toBe('.lt(4)')
    expect(field?.clearedDocumentation).toBe('some text in docs')
    expect(field.documentation).toBe('some text in docs @zod.number.lt(4)')
  })

  it(`should load a class with docs and bigInt validator`, async () => {
    const field = getField({
      type: 'BigInt',
      documentation: 'some text in docs @zod.bigint.array(.length(4))',
    })
    const match = field?.['_validatorMatch']
    expect(match?.groups?.['validatorPattern']).toBe('.array(.length(4))')
    expect(field?.clearedDocumentation).toBe('some text in docs')
    expect(field.documentation).toBe(
      'some text in docs @zod.bigint.array(.length(4))'
    )
  })

  it(`should load a class with docs and date validator`, async () => {
    const field = getField({
      type: 'DateTime',
      documentation: 'some text in docs  @zod.date.min(new Date("2020-01-01"))',
    })
    const match = field?.['_validatorMatch']
    expect(match?.groups?.['validatorPattern']).toBe(
      '.min(new Date("2020-01-01"))'
    )
    expect(field?.clearedDocumentation).toBe('some text in docs')
    expect(field.documentation).toBe(
      'some text in docs  @zod.date.min(new Date("2020-01-01"))'
    )
  })

  it(`should load a class with docs and custom validator`, async () => {
    const field = getField({
      documentation: 'some text in docs  @zod.custom.use(z.string().min(4))',
    })
    const match = field?.['_validatorMatch']
    expect(match?.groups?.['validatorPattern']).toBe('.use(z.string().min(4))')
    expect(field?.clearedDocumentation).toBe('some text in docs')
    expect(field.documentation).toBe(
      'some text in docs  @zod.custom.use(z.string().min(4))'
    )
  })
})
