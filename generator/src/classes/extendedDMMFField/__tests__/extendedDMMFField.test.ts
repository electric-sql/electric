import { DMMF } from '@prisma/generator-helper'
import { it, expect, describe } from 'vitest'

import { DEFAULT_GENERATOR_CONFIG, FIELD_BASE } from './setup'
import { ExtendedDMMFFieldClass } from '../extendedDMMFField'

const getField = (field?: Partial<DMMF.Field>) =>
  new ExtendedDMMFFieldClass(
    { ...FIELD_BASE, ...field },
    DEFAULT_GENERATOR_CONFIG,
    'ModelName'
  )

// BASE TESTS
// ----------------------------------------------

describe(`ExtendedDMMFFieldBase`, () => {
  it(`should load class with all its features`, async () => {
    const field = getField()

    expect(field.generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(field?.['_modelName']).toEqual('ModelName')
    expect(field).toBeDefined()
    expect(field.isNullable).toBe(false)
    expect(field.isJsonType).toBe(false)
    expect(field.isBytesType).toBe(false)
    expect(field.isDecimalType).toBe(false)
  })

  it(`should load a class of that is nullable `, async () => {
    const field = getField({ isRequired: false })
    expect(field.isNullable).toBe(true)
  })

  it(`should load a class of type json `, async () => {
    const field = getField({ type: 'Json' })
    expect(field.isJsonType).toBe(true)
  })

  it(`should load a class of type bytes `, async () => {
    const field = getField({ type: 'Bytes' })
    expect(field.isBytesType).toBe(true)
  })

  it(`should load a class of type decimal `, async () => {
    const field = getField({ type: 'Decimal' })
    expect(field.isDecimalType).toBe(true)
  })
})

// MATCH TESTS
// ----------------------------------------------

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
      isList: true,
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

// VALIDATOR TYPE TESTS
// ----------------------------------------------

describe(`ExtendedDMMFFieldValidatorType`, () => {
  it(`should load a class without docs`, async () => {
    const field = getField()
    expect(field?.['_validatorMatch']).toBeUndefined()
    expect(field?.['_validatorType']).toBeUndefined()
  })

  it(`should load a class with docs`, async () => {
    const field = getField({ documentation: 'some text in docs' })
    expect(field?.['_validatorMatch']).toBeUndefined()
    expect(field?.['_validatorType']).toBeUndefined()
  })

  it(`should load a class with docs and valid validator string`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.string.max(4)',
    })
    expect(field?.['_validatorMatch']).toBeDefined()
    expect(field?.['_validatorType']).toBe('string')
  })

  it(`should load a class with docs and valid enum validator string`, async () => {
    const field = getField({
      type: 'MyEnum',
      kind: 'enum',
      isList: true,
      documentation: 'some text in docs @zod.enum.array(.length(2))',
    })
    expect(field?.['_validatorMatch']).toBeDefined()
    expect(field?.['_validatorType']).toBe('enum')
  })

  it(`should load a class with docs and valid object validator string`, async () => {
    const field = getField({
      type: 'MyType',
      kind: 'object',
      isList: true,
      documentation: 'some text in docs @zod.object.array(.length(2))',
    })
    expect(field?.['_validatorMatch']).toBeDefined()
    expect(field?.['_validatorType']).toBe('object')
  })

  it(`should load a class with docs and invalid validator string`, async () => {
    expect(() =>
      getField({
        documentation: 'some text in docs @zod.numer.max(4)',
      })
    ).toThrowError(
      "[@zod generator error]: 'numer' is not a valid validator type. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})

// VALIDATOR PATTERN TESTS
// ----------------------------------------------

describe(`ExtendedDMMFFieldValidatorPattern`, () => {
  it(`should load class without docs`, async () => {
    const field = getField()
    expect(field?.['_validatorPattern']).toBeUndefined()
  })

  it(`should load with docs and string validator`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.string.min(2).max(4)',
    })
    expect(field?.['_validatorPattern']).toBe('.min(2).max(4)')
    expect(field?.['_validatorList']).toEqual(['.min(2)', '.max(4)'])
  })

  it(`should load with docs and number validator`, async () => {
    const field = getField({
      type: 'Int',
      documentation: 'some text in docs @zod.number.lt(2).gt(4)',
    })
    expect(field?.['_validatorPattern']).toBe('.lt(2).gt(4)')
    expect(field?.['_validatorList']).toEqual(['.lt(2)', '.gt(4)'])
  })

  it(`should load with docs and custom validator`, async () => {
    const field = getField({
      type: 'Int',
      isList: true,
      documentation:
        'some text in docs @zod.custom.use(z.string().min(2).max()).array(.length(2))',
    })
    expect(field?.['_validatorPattern']).toBe(
      '.use(z.string().min(2).max()).array(.length(2))'
    )
    expect(field?.['_validatorList']).toEqual([
      '.use(z.string().min(2).max())',
      '.array(.length(2))',
    ])
    expect(field?.['_getZodValidatorListWithoutArray']()).toEqual([
      '.use(z.string().min(2).max())',
    ])
    expect(field?.['_getZodValidatorListArray']()).toEqual([
      '.array(.length(2))',
    ])
  })

  it(`should load with docs and custom validator`, async () => {
    const field = getField({
      type: 'MyEnum',
      kind: 'enum',
      isList: true,
      documentation: 'some text in docs @zod.enum.array(.length(2))',
    })
    expect(field?.['_validatorPattern']).toBe('.array(.length(2))')
    expect(field?.['_validatorList']).toEqual(['.array(.length(2))'])
  })

  it(`should load with docs and custom validator`, async () => {
    const field = getField({
      type: 'MyObject',
      kind: 'object',
      isList: true,
      documentation: 'some text in docs @zod.object.array(.length(2))',
    })
    expect(field?.['_validatorPattern']).toBe('.array(.length(2))')
    expect(field?.['_validatorList']).toEqual(['.array(.length(2))'])
  })
})

// DEFAULT VALIDATOR TESTS
// ----------------------------------------------

describe(`ExtendedDMMFFieldDefaultValidators`, () => {
  it(`should load a class without a default validator`, async () => {
    const field = getField()
    expect(field.zodValidatorString).toBe(undefined)
  })

  it(`should load a class with cuid default validator`, async () => {
    const field = getField({ default: { name: 'cuid', args: [] } })
    expect(field.zodValidatorString).toBe('.cuid()')
  })

  it(`should load a class with uuid default validator`, async () => {
    const field = getField({ default: { name: 'uuid', args: [] } })
    expect(field.zodValidatorString).toBe('.uuid()')
  })

  it(`should load a class with Int default validator`, async () => {
    const field = getField({ type: 'Int' })
    expect(field.zodValidatorString).toBe('.int()')
  })

  it(`should load a class with Int default validator and "noDefault()" annotation`, async () => {
    const field = getField({
      type: 'Int',
      documentation: '@zod.number.noDefault()',
    })
    expect(field.zodValidatorString).toBeUndefined()
  })

  it(`should load a class with Int default and added validator and "noDefault()" annotation`, async () => {
    const field = getField({
      type: 'Int',
      documentation: '@zod.number.int().lt(2).noDefault()',
    })
    expect(field.zodValidatorString).toBe('.int().lt(2)')
  })
})

// VALIDATOR CUSTOM ERRORS TESTS
// ----------------------------------------------

describe(`ExtendedDMMFFieldValidatorCustomErrors`, () => {
  it(`should load a class without docs`, async () => {
    const field = getField()
    expect(field?.['_validatorCustomError']).toBeUndefined()
    expect(field?.zodCustomErrors).toBeUndefined()
  })

  it(`should load a class with valid custom error messages`, async () => {
    const field = getField({
      documentation:
        '@zod.string({ required_error: "error", invalid_type_error: "error" , description: "error"})',
    })
    expect(field?.['_validatorCustomError']).toBe(
      '({ required_error: "error", invalid_type_error: "error" , description: "error"})'
    )
    expect(field?.zodCustomErrors).toBe(
      '{ required_error: "error", invalid_type_error: "error" , description: "error"}'
    )
  })

  it(`should load a class with docs and invalid validator string`, async () => {
    expect(() =>
      getField({
        documentation:
          '@zod.string({ required_error: "error", invalid_type_errrror: "error"})',
      })
    ).toThrowError(
      "[@zod generator error]: Custom error key 'invalid_type_errrror' is not valid. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})

/////////////////////////////////////////////
// TEST VALIDATOR MAP
/////////////////////////////////////////////

describe(`ExtendedDMMFFieldValidatorMap test _validatorMap`, () => {
  const field = getField()

  // LOAD INSTANCE
  // ----------------------------------------------

  it(`should load an instance`, async () => {
    expect(field).toBeDefined()
    expect(field?.['_validatorMatch']).toBeUndefined()
    expect(field?.['_validatorType']).toBeUndefined()
    expect(field?.['_validatorCustomError']).toBeUndefined()
    expect(field?.['_validatorPattern']).toBeUndefined()
    expect(field?.zodCustomErrors).toBeUndefined()
  })

  // STRING
  // ----------------------------------------------

  it(`should pass valid string data to validator map`, async () => {
    const map = field?.['_validatorMap']['string']
    expect(
      map({
        key: 'min',
        pattern: '.min(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'max',
        pattern: '.max(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'length',
        pattern: '.length(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'email',
        pattern: '.email()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'url',
        pattern: '.url()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'emoji',
        pattern: '.emoji()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'uuid',
        pattern: '.uuid()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'cuid',
        pattern: '.cuid()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'cuid2',
        pattern: '.cuid2()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'ulid',
        pattern: '.ulid()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'regex',
        pattern: '.regex(/^\\d+\\s*\\d+$/)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'includes',
        pattern: '.includes("some")',
      })
    ).toBe(true)
    expect(
      map({
        key: 'startsWith',
        pattern: '.startsWith("some")',
      })
    ).toBe(true)
    expect(
      map({
        key: 'startsWith',
        pattern: '.startsWith("some")',
      })
    ).toBe(true)
    expect(
      map({
        key: 'datetime',
        pattern: '.datetime()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'ip',
        pattern: '.ip()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'trim',
        pattern: '.trim()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'toLowerCase',
        pattern: '.toLowerCase()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'toUpperCase',
        pattern: '.toUpperCase()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'noDefault',
        pattern: '.noDefault()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass valid string with message data to validator map`, async () => {
    const map = field?.['_validatorMap']['string']
    expect(
      map({
        key: 'min',
        pattern: '.min(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'max',
        pattern: '.max(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'length',
        pattern: '.length(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'email',
        pattern: '.email({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'url',
        pattern: '.url({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'emoji',
        pattern: '.emoji({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'uuid',
        pattern: '.uuid({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'cuid',
        pattern: '.cuid({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'cuid2',
        pattern: '.cuid2({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'ulid',
        pattern: '.ulid({ message: "someMessage" })',
      })
    ).toBe(true)
    // expect(
    //   map({
    //     key: 'regex',
    //     pattern: '.regex(/^\\d+\\s*\\d+$/)',
    //   }),
    // ).toBe(true);
    expect(
      map({
        key: 'includes',
        pattern: '.includes("some", { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'startsWith',
        pattern: '.startsWith("some", { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'startsWith',
        pattern: '.startsWith("some", { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'datetime',
        pattern: '.datetime({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'trim',
        pattern: '.trim({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'toLowerCase',
        pattern: '.toLowerCase({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'toUpperCase',
        pattern: '.toUpperCase({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(map({ key: 'noDefault', pattern: '.noDefault()' })).toBe(true)
    expect(map({ key: 'array', pattern: '.array(.length(2))' })).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['string']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['string']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // NUMBER
  // ----------------------------------------------

  it(`should pass valid number data to validator map`, async () => {
    const map = field?.['_validatorMap']['number']
    expect(
      map({
        key: 'gt',
        pattern: '.gt(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'gte',
        pattern: '.gte(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lt',
        pattern: '.lt(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lte',
        pattern: '.lte(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'multipleOf',
        pattern: '.multipleOf(2)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'int',
        pattern: '.int()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'positive',
        pattern: '.positive()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonpositive',
        pattern: '.nonpositive()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'negative',
        pattern: '.negative()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonnegative',
        pattern: '.nonnegative()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'finite',
        pattern: '.finite()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'noDefault',
        pattern: '.noDefault()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass valid number with message data to validator map`, async () => {
    const map = field?.['_validatorMap']['number']
    expect(
      map({
        key: 'gt',
        pattern: '.gt(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'gte',
        pattern: '.gte(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lt',
        pattern: '.lt(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lte',
        pattern: '.lte(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'multipleOf',
        pattern: '.multipleOf(2, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'int',
        pattern: '.int({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'positive',
        pattern: '.positive({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonpositive',
        pattern: '.nonpositive({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'negative',
        pattern: '.negative({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonnegative',
        pattern: '.nonnegative({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'finite',
        pattern: '.finite({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'noDefault',
        pattern: '.noDefault({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['number']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['number']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // DATE
  // ----------------------------------------------

  it(`should pass valid date data to validator map`, async () => {
    const map = field?.['_validatorMap']['date']
    expect(
      map({
        key: 'min',
        pattern: '.min(new Date(01-01-2022))',
      })
    ).toBe(true)
    expect(
      map({
        key: 'max',
        pattern: '.max(new Date(Date.now()))',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass valid date with message data to validator map`, async () => {
    const map = field?.['_validatorMap']['date']
    expect(
      map({
        key: 'min',
        pattern: '.min(new Date(01-01-2022), { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'max',
        pattern: '.max(new Date(Date.now(), { message: "someMessage" }))',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['date']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['date']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // BIGINT
  // ----------------------------------------------

  it(`should pass valid bigint data to validator map`, async () => {
    const map = field?.['_validatorMap']['bigint']
    expect(
      map({
        key: 'gt',
        pattern: '.gt(2n)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'gte',
        pattern: '.gte(2n)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lt',
        pattern: '.lt(2n)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lte',
        pattern: '.lte(2n)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'multipleOf',
        pattern: '.multipleOf(2n)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'positive',
        pattern: '.positive()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonpositive',
        pattern: '.nonpositive()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'negative',
        pattern: '.negative()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonnegative',
        pattern: '.nonnegative()',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['bigint']
    expect(
      map({
        key: 'gt',
        pattern: '.gt(2n, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'gte',
        pattern: '.gte(2n, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lt',
        pattern: '.lt(2n, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'lte',
        pattern: '.lte(2n, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'multipleOf',
        pattern: '.multipleOf(2n, { message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'positive',
        pattern: '.positive({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonpositive',
        pattern: '.nonpositive({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'negative',
        pattern: '.negative({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(
      map({
        key: 'nonnegative',
        pattern: '.nonnegative({ message: "someMessage" })',
      })
    ).toBe(true)
    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['bigint']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // CUSTOM
  // ----------------------------------------------

  it(`should pass valid custom data to validator map`, async () => {
    const map = field?.['_validatorMap']['custom']

    expect(
      map({
        key: 'use',
        pattern: '.use(some content)',
      })
    ).toBe(true)
    expect(
      map({
        key: 'omit',
        pattern: '.omit(["model", "field"])',
      })
    ).toBe(true)
    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['custom']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['custom']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // ENUM
  // ----------------------------------------------

  it(`should pass valid custom data to validator map`, async () => {
    const map = field?.['_validatorMap']['enum']

    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['enum']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['enum']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  // OBJECT
  // ----------------------------------------------

  it(`should pass valid custom data to validator map`, async () => {
    const map = field?.['_validatorMap']['object']

    expect(
      map({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass ivalid data to to validator map`, async () => {
    const map = field?.['_validatorMap']['object']

    expect(() =>
      map({
        key: 'array',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'array' with validatorPattern '.length(2)'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should pass ivalid key to to validator map`, async () => {
    const map = field?.['_validatorMap']['object']

    expect(() =>
      map({
        key: 'wrong',
        pattern: '.length(2)',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})

/////////////////////////////////////////////////
// TEST VALIDATE PATTERN IN MAP
/////////////////////////////////////////////////

describe(`tests ExtendedDMMFFieldValidatorMap method _validatePatternInMap`, () => {
  it(`should pass valid data for string`, async () => {
    const field = getField({
      type: 'String',
      isList: true,
      documentation: '@zod.string.array(.length(2))',
    })

    expect(
      field?.['_validatePatternInMap']({
        key: 'array',
        pattern: '.array(.length(2))',
      })
    ).toBe(true)
  })

  it(`should pass invalid data for string`, async () => {
    const field = getField({
      type: 'String',
      isList: true,
      documentation: '@zod.string.array(.length(2))',
    })

    expect(() =>
      field?.['_validatePatternInMap']({
        key: 'use',
        pattern: '.use(.length(2))',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'use' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})

/////////////////////////////////////////////////
// TEST GET VALIDATOR KEY FROM PATTERN
/////////////////////////////////////////////////

describe(`tests ExtendedDMMFFieldValidatorMap method _getValidatorKeyFromPattern`, () => {
  it(`should pass valid data for string`, async () => {
    const field = getField()
    expect(field?.['_getValidatorKeyFromPattern']('.array(.length(2))')).toBe(
      'array'
    )
  })

  it(`should pass invalid data for string`, async () => {
    const field = getField()

    expect(() =>
      field?.['_getValidatorKeyFromPattern']('wrong(length(2))')
    ).toThrowError(
      "[@zod generator error]: no matching validator key found in 'wrong(length(2))'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})

/////////////////////////////////////////////////
// TEST VALIDATOR IS VALID
/////////////////////////////////////////////////

describe(`tests ExtendedDMMFFieldValidatorMap method _validatorIsValid`, () => {
  it(`should pass valid data for string`, async () => {
    const field = getField({
      documentation: '@zod.string.min(2).max(4)',
    })
    expect(field?.['_validatorIsValid']()).toBe(true)
  })
})

// VALIDATOR STRING
// ----------------------------------------------

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
      isList: true,
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

// CUSTOM VALIDATOR STRING
// ----------------------------------------------

describe(`ExtendedDMMFFieldCustomValidatorString`, () => {
  it(`should load class with docs and custom validator`, async () => {
    const field = getField({
      isList: true,
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
        isList: true,
        documentation:
          'some text in docs @zod.custom.use(z.string().min(2).max(4)).array(.length(2)).wrong()',
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'wrong' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })
})

// ARRAY VALIDATOR STRING
// ----------------------------------------------

describe(`ExtendedDMMFFieldArrayValidatorString`, () => {
  it(`should load field with docs and array validator on string list`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.string.min(4).array(.length(2))',
      isList: true,
    })
    expect(field.zodArrayValidatorString).toBe('.length(2)')
    expect(field.zodValidatorString).toBe('.min(4)')
  })

  it(`should load field with docs and array validator on Int list`, async () => {
    const field = getField({
      type: 'Int',
      isList: true,
      documentation: 'some text in docs @zod.number.lt(4).array(.length(2))',
    })
    expect(field.zodArrayValidatorString).toBe('.length(2)')
    expect(field.zodValidatorString).toBe('.lt(4)')
  })

  it(`should load field with docs and array validator on custom int list`, async () => {
    const field = getField({
      type: 'Int',
      isList: true,
      documentation:
        'some text in docs @zod.custom.use(z.string.min(4)).array(.length(2))',
    })

    expect(field.zodArrayValidatorString).toBe('.length(2)')
    expect(field.zodCustomValidatorString).toBe('z.string.min(4)')
  })

  it(`should load field with docs and array validator on enum list`, async () => {
    const field = getField({
      type: 'MyEnum',
      kind: 'enum',
      isList: true,
      documentation: 'some text in docs @zod.enum.array(.length(2))',
    })

    expect(field.zodArrayValidatorString).toBe('.length(2)')
  })

  it(`should load field with docs and array validator on object list`, async () => {
    const field = getField({
      type: 'MyType',
      kind: 'object',
      isList: true,
      documentation: 'some text in docs @zod.object.array(.length(2))',
    })

    expect(field.zodArrayValidatorString).toBe('.length(2)')
  })

  it(`should NOT load field with docs and array validator on a single string`, async () => {
    expect(() =>
      getField({
        documentation: 'some text in docs @zod.string.min(4).array(.length(2))',
        isList: false,
      })
    ).toThrowError(
      "[@zod generator error]: '.array' validator is only allowed on lists. [Error Location]: Model: 'ModelName', Field: 'test'"
    )
  })

  it(`should NOT load field with docs and array validator on a single string if no pattern is present`, async () => {
    const field = getField({
      isList: false,
      documentation: 'some text in docs @zod.string.min(3)',
    })

    expect(field.zodArrayValidatorString).toBeUndefined()
  })

  it(`should load field with docs and array validator list on string`, async () => {
    const field = getField({
      documentation:
        'some text in docs @zod.string.min(4).array(.length(2).min(3).max(4).nonempty())',
      isList: true,
    })
    expect(field.zodArrayValidatorString).toBe(
      '.length(2).min(3).max(4).nonempty()'
    )
  })

  it(`should load field with docs and array validator list on string with message`, async () => {
    const field = getField({
      documentation:
        'some text in docs @zod.string.min(4).array(.length(2, { message: "my message" }).min(3, { message: "my message" }).max(4, { message: "my message" }).nonempty({ message: "my message" }))',
      isList: true,
    })
    expect(field.zodArrayValidatorString).toBe(
      '.length(2, { message: "my message" }).min(3, { message: "my message" }).max(4, { message: "my message" }).nonempty({ message: "my message" })'
    )
  })

  it(`should NOT load field with docs and array validator on a single string with wrong error message key`, async () => {
    expect(() =>
      getField({
        documentation:
          'some text in docs @zod.string.min(4).array(.length(2, { mussage: "my message" })',
        isList: true,
      })
    ).toThrowError(
      "[@zod generator error]: Could not match validator 'length' with validatorPattern '.length(2, { mussage: \"my message\" }'. Please check for typos! [Error Location]: Model: 'ModelName', Field: 'test'"
    )
  })

  it(`should NOT load field with docs and array validator on a single string wiht wrong validator`, async () => {
    expect(() =>
      getField({
        documentation:
          'some text in docs @zod.string.min(4).array(.lt(2, { mussage: "my message" })',
        isList: true,
      })
    ).toThrowError(
      "[@zod generator error]: Validator 'lt' is not valid for type 'String', for specified '@zod.[key] or for 'z.array.[key]'. [Error Location]: Model: 'ModelName', Field: 'test'"
    )
  })
})

// OMIT FIELD
// ----------------------------------------------

describe(`ExtendedDMMFFieldOmitField`, () => {
  it(`should load field with docs and custom validator`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["model", "input"])',
    })
    const fieldTwo = getField({
      documentation: 'some text in docs @zod.custom.omit([model, input])',
    })
    const fieldThree = getField({
      documentation: "some text in docs @zod.custom.omit(['model', 'input'])",
    })
    expect(field.zodOmitField).toBe('all')
    expect(field.isOmitField()).toBe(true)
    expect(fieldTwo.zodOmitField).toBe('all')
    expect(fieldTwo.isOmitField()).toBe(true)
    expect(fieldThree.zodOmitField).toBe('all')
    expect(fieldThree.isOmitField()).toBe(true)
  })

  it(`should load field with docs and custom validator`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["model"])',
    })
    const fieldTwo = getField({
      documentation: 'some text in docs @zod.custom.omit([model])',
    })
    const fieldThree = getField({
      documentation: "some text in docs @zod.custom.omit(['model'])",
    })
    expect(field.zodOmitField).toBe('model')
    expect(field.isOmitField()).toBe(true)
    expect(fieldTwo.zodOmitField).toBe('model')
    expect(fieldTwo.isOmitField()).toBe(true)
    expect(fieldThree.zodOmitField).toBe('model')
    expect(fieldThree.isOmitField()).toBe(true)
  })

  it(`should load field with docs and custom validator`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["input"])',
    })
    const fieldTwo = getField({
      documentation: 'some text in docs @zod.custom.omit([input])',
    })
    const fieldThree = getField({
      documentation: "some text in docs @zod.custom.omit(['input'])",
    })
    expect(field.zodOmitField).toBe('input')
    expect(field.isOmitField()).toBe(true)
    expect(fieldTwo.zodOmitField).toBe('input')
    expect(fieldTwo.isOmitField()).toBe(true)
    expect(fieldThree.zodOmitField).toBe('input')
    expect(fieldThree.isOmitField()).toBe(true)
  })

  it(`should load field with docs and custom validator witout omit`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.use(z.string())',
    })

    expect(field.zodOmitField).toBe('none')
  })

  it(`should throw an error when wrong option is used`, async () => {
    expect(() =>
      getField({
        documentation: 'some text in docs @zod.custom.omit(["model", "wrong"])',
      })
    ).toThrowError(
      "[@zod generator error]: unknown key 'wrong' in '.omit()'. only 'model' and 'input' are allowed. [Error Location]: Model: 'ModelName', Field: 'test'."
    )
  })

  it(`should load field with docs and custom validator and test "omitInModel" method`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["model", "input"])',
    })
    const fieldTwo = getField({
      documentation: 'some text in docs @zod.custom.omit(["model"])',
    })
    const fieldThree = getField({
      documentation: 'some text in docs @zod.custom.omit(["input"])',
    })
    expect(field.zodOmitField).toBe('all')
    expect(field.omitInModel()).toBe(true)
    expect(fieldTwo.zodOmitField).toBe('model')
    expect(fieldTwo.omitInModel()).toBe(true)
    expect(fieldThree.zodOmitField).toBe('input')
    expect(fieldThree.omitInModel()).toBe(false)
  })

  it(`should load field with docs and custom validator and test "omitInInputTypes" method`, async () => {
    const field = getField({
      documentation: 'some text in docs @zod.custom.omit(["model", "input"])',
    })
    const fieldTwo = getField({
      documentation: 'some text in docs @zod.custom.omit(["model"])',
    })
    const fieldThree = getField({
      documentation: 'some text in docs @zod.custom.omit(["input"])',
    })
    expect(field.zodOmitField).toBe('all')
    expect(field.omitInInputTypes('UserCreateManyInput')).toBe(true)
    expect(fieldTwo.zodOmitField).toBe('model')
    expect(fieldTwo.omitInInputTypes('UserCreateManyInput')).toBe(false)
    expect(fieldThree.zodOmitField).toBe('input')
    expect(fieldThree.omitInInputTypes('UserCreateManyInput')).toBe(true)
  })
})

// ZOD TYPE
// ----------------------------------------------

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
