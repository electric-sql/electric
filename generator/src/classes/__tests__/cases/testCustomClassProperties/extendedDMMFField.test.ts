import { describe, it, expect } from 'vitest'

import { GeneratorConfig } from '../../../../schemas'
import { getStringVariants } from '../../../../utils/getStringVariants'
import { ExtendedDMMF } from '../../../extendedDMMF'
import { loadDMMF } from '../../utils/loadDMMF'

export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  useMultipleFiles: false,
  createInputTypes: true,
  createModelTypes: true,
  createOptionalDefaultValuesTypes: false,
  createRelationValuesTypes: false,
  createPartialTypes: false,
  addIncludeType: true,
  addSelectType: true,
  addInputTypeValidation: true,
  useDefaultValidators: true,
  prismaClientPath: '@prisma/client',
  coerceDate: true,
  writeNullishInModelTypes: false,
  isMongoDb: false,
  validateWhereUniqueInput: false,
  inputTypePath: 'inputTypeSchemas',
  outputTypePath: 'outputTypeSchemas',
}

describe('testSimpleModelNoValidators', async () => {
  const dmmf = await loadDMMF(`${__dirname}/extendedDMMFField.prisma`)
  const extendedDMMF = new ExtendedDMMF(dmmf, {})

  const fields = extendedDMMF.datamodel.models[0].fields

  it(`should set expected values in field ${fields[0].name}`, () => {
    expect(fields[0].generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(fields[0].formattedNames).toStrictEqual(
      getStringVariants(fields[0].name)
    )
    expect(fields[0].kind).toBe('scalar')
    expect(fields[0].name).toBe('id')
    expect(fields[0].isRequired).toBe(true)
    expect(fields[0].isList).toBe(false)
    expect(fields[0].isUnique).toBe(false)
    expect(fields[0].isId).toBe(true)
    expect(fields[0].isReadOnly).toBe(false)
    expect(fields[0].type).toBe('String')
    expect(fields[0].dbNames).toBeUndefined()
    expect(fields[0].isGenerated).toBe(false)
    expect(fields[0].hasDefaultValue).toBe(true)
    expect(fields[0].default).toStrictEqual({ name: 'cuid', args: [] })
    expect(fields[0].relationToFields).toBeUndefined()
    expect(fields[0].relationOnDelete).toBeUndefined()
    expect(fields[0].relationName).toBeUndefined()
    expect(fields[0].documentation).toBe(
      '@zod.string({ invalid_type_error: "invalid type error" }).cuid()'
    )
    expect(fields[0].isNullable).toBe(false)
    expect(fields[0].isJsonType).toBe(false)
    expect(fields[0].isBytesType).toBe(false)
    expect(fields[0].isDecimalType).toBe(false)
    expect(fields[0]?.['_modelName']).toBe('MyPrismaScalarsType')
    expect(fields[0]?.['_errorLocation']).toBe(
      "[Error Location]: Model: 'MyPrismaScalarsType', Field: 'id'."
    )
    expect(fields[0].zodCustomErrors).toBe(
      '{ invalid_type_error: "invalid type error" }'
    )
    expect(fields[0].zodValidatorString).toBe('.cuid()')
    expect(fields[0].zodCustomValidatorString).toBeUndefined()
    expect(fields[0].clearedDocumentation).toBeUndefined()
    expect(fields[0].zodType).toBe('string')
  })

  it(`should set expected values in field ${fields[1].name}`, () => {
    expect(fields[1].generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(fields[1].formattedNames).toStrictEqual(
      getStringVariants(fields[1].name)
    )
    expect(fields[1].kind).toBe('scalar')
    expect(fields[1].name).toBe('string')
    expect(fields[1].isRequired).toBe(false)
    expect(fields[1].isList).toBe(false)
    expect(fields[1].isUnique).toBe(false)
    expect(fields[1].isId).toBe(false)
    expect(fields[1].isReadOnly).toBe(false)
    expect(fields[1].type).toBe('String')
    expect(fields[1].dbNames).toBeUndefined()
    expect(fields[1].isGenerated).toBe(false)
    expect(fields[1].hasDefaultValue).toBe(false)
    expect(fields[1].default).toBeUndefined()
    expect(fields[1].relationToFields).toBeUndefined()
    expect(fields[1].relationOnDelete).toBeUndefined()
    expect(fields[1].relationName).toBeUndefined()
    expect(fields[1].documentation).toBe(
      'Some comment about string @zod.string.min(3, { message: "min error" }).max(10, { message: "max error" })'
    )
    expect(fields[1].isNullable).toBe(true)
    expect(fields[1].isJsonType).toBe(false)
    expect(fields[1].isBytesType).toBe(false)
    expect(fields[1].isDecimalType).toBe(false)
    expect(fields[1]?.['_modelName']).toBe('MyPrismaScalarsType')
    expect(fields[1]?.['_errorLocation']).toBe(
      "[Error Location]: Model: 'MyPrismaScalarsType', Field: 'string'."
    )
    expect(fields[1].zodCustomErrors).toBeUndefined()
    expect(fields[1].zodValidatorString).toBe(
      '.min(3, { message: "min error" }).max(10, { message: "max error" })'
    )
    expect(fields[1].zodCustomValidatorString).toBeUndefined()
    expect(fields[1].clearedDocumentation).toBe('Some comment about string')
    expect(fields[1].zodType).toBe('string')
  })

  it(`should set expected values in field ${fields[2].name}`, () => {
    expect(fields[2].generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(fields[2].formattedNames).toStrictEqual(
      getStringVariants(fields[2].name)
    )
    expect(fields[2].kind).toBe('scalar')
    expect(fields[2].name).toBe('bic')
    expect(fields[2].isRequired).toBe(false)
    expect(fields[2].isList).toBe(false)
    expect(fields[2].isUnique).toBe(false)
    expect(fields[2].isId).toBe(false)
    expect(fields[2].isReadOnly).toBe(false)
    expect(fields[2].type).toBe('String')
    expect(fields[2].dbNames).toBeUndefined()
    expect(fields[2].isGenerated).toBe(false)
    expect(fields[2].hasDefaultValue).toBe(false)
    expect(fields[2].default).toBeUndefined()
    expect(fields[2].relationToFields).toBeUndefined()
    expect(fields[2].relationOnDelete).toBeUndefined()
    expect(fields[2].relationName).toBeUndefined()
    expect(fields[2].documentation).toBe(
      "@zod.custom.use(z.string().refine((val) => validator.isBIC(val), { message: 'BIC is not valid' }))"
    )
    expect(fields[2].isNullable).toBe(true)
    expect(fields[2].isJsonType).toBe(false)
    expect(fields[2].isBytesType).toBe(false)
    expect(fields[2].isDecimalType).toBe(false)
    expect(fields[2]?.['_modelName']).toBe('MyPrismaScalarsType')
    expect(fields[2]?.['_errorLocation']).toBe(
      "[Error Location]: Model: 'MyPrismaScalarsType', Field: 'bic'."
    )
    expect(fields[2].zodCustomErrors).toBeUndefined()
    expect(fields[2].zodValidatorString).toBeUndefined()
    expect(fields[2].zodCustomValidatorString).toBe(
      "z.string().refine((val) => validator.isBIC(val), { message: 'BIC is not valid' })"
    )
    expect(fields[2].clearedDocumentation).toBeUndefined()
    expect(fields[2].zodType).toBe('string')
  })

  it(`should set expected values in field ${fields[3].name}`, () => {
    expect(fields[3].generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(fields[3].formattedNames).toStrictEqual(
      getStringVariants(fields[3].name)
    )
    expect(fields[3].kind).toBe('scalar')
    expect(fields[3].name).toBe('float')
    expect(fields[3].isRequired).toBe(true)
    expect(fields[3].isList).toBe(false)
    expect(fields[3].isUnique).toBe(false)
    expect(fields[3].isId).toBe(false)
    expect(fields[3].isReadOnly).toBe(false)
    expect(fields[3].type).toBe('Float')
    expect(fields[3].dbNames).toBeUndefined()
    expect(fields[3].isGenerated).toBe(false)
    expect(fields[3].hasDefaultValue).toBe(false)
    expect(fields[3].default).toBeUndefined()
    expect(fields[3].relationToFields).toBeUndefined()
    expect(fields[3].relationOnDelete).toBeUndefined()
    expect(fields[3].relationName).toBeUndefined()
    expect(fields[3].documentation).toBe(
      '@zod.number.lt(10, { message: "lt error" }).gt(5, { message: "gt error" })'
    )
    expect(fields[3].isNullable).toBe(false)
    expect(fields[3].isJsonType).toBe(false)
    expect(fields[3].isBytesType).toBe(false)
    expect(fields[3].isDecimalType).toBe(false)
    expect(fields[3]?.['_modelName']).toBe('MyPrismaScalarsType')
    expect(fields[3]?.['_errorLocation']).toBe(
      "[Error Location]: Model: 'MyPrismaScalarsType', Field: 'float'."
    )
    expect(fields[3].zodCustomErrors).toBeUndefined()
    expect(fields[3].zodValidatorString).toBe(
      '.lt(10, { message: "lt error" }).gt(5, { message: "gt error" })'
    )
    expect(fields[3].zodCustomValidatorString).toBeUndefined()
    expect(fields[3].clearedDocumentation).toBeUndefined()
    expect(fields[3].zodType).toBe('number')
  })

  it(`should set expected values in field ${fields[4].name}`, () => {
    expect(fields[4].generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(fields[4].formattedNames).toStrictEqual(
      getStringVariants(fields[4].name)
    )
    expect(fields[4].kind).toBe('scalar')
    expect(fields[4].name).toBe('decimal')
    expect(fields[4].isRequired).toBe(true)
    expect(fields[4].isList).toBe(false)
    expect(fields[4].isUnique).toBe(false)
    expect(fields[4].isId).toBe(false)
    expect(fields[4].isReadOnly).toBe(false)
    expect(fields[4].type).toBe('Decimal')
    expect(fields[4].dbNames).toBeUndefined()
    expect(fields[4].isGenerated).toBe(false)
    expect(fields[4].hasDefaultValue).toBe(false)
    expect(fields[4].default).toBeUndefined()
    expect(fields[4].relationToFields).toBeUndefined()
    expect(fields[4].relationOnDelete).toBeUndefined()
    expect(fields[4].relationName).toBeUndefined()
    expect(fields[4].documentation).toBeUndefined()
    expect(fields[4].isNullable).toBe(false)
    expect(fields[4].isJsonType).toBe(false)
    expect(fields[4].isBytesType).toBe(false)
    expect(fields[4].isDecimalType).toBe(true)
    expect(fields[4]?.['_modelName']).toBe('MyPrismaScalarsType')
    expect(fields[4]?.['_errorLocation']).toBe(
      "[Error Location]: Model: 'MyPrismaScalarsType', Field: 'decimal'."
    )
    expect(fields[4].zodCustomErrors).toBeUndefined()
    expect(fields[4].zodValidatorString).toBeUndefined()
    expect(fields[4].zodCustomValidatorString).toBeUndefined()
    expect(fields[4].clearedDocumentation).toBeUndefined()
    expect(fields[4].zodType).toBe('Decimal')
  })

  it(`should set expected values in field ${fields[5].name}`, () => {
    expect(fields[5].generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(fields[5].formattedNames).toStrictEqual(
      getStringVariants(fields[5].name)
    )
    expect(fields[5].kind).toBe('scalar')
    expect(fields[5].name).toBe('date')
    expect(fields[5].isRequired).toBe(false)
    expect(fields[5].isList).toBe(false)
    expect(fields[5].isUnique).toBe(false)
    expect(fields[5].isId).toBe(false)
    expect(fields[5].isReadOnly).toBe(false)
    expect(fields[5].type).toBe('DateTime')
    expect(fields[5].dbNames).toBeUndefined()
    expect(fields[5].isGenerated).toBe(false)
    expect(fields[5].hasDefaultValue).toBe(false)
    expect(fields[5].default).toBeUndefined()
    expect(fields[5].relationToFields).toBeUndefined()
    expect(fields[5].relationOnDelete).toBeUndefined()
    expect(fields[5].relationName).toBeUndefined()
    expect(fields[5].documentation).toBe(
      "@zod.date.min(new Date('2020-01-01')).max(new Date('2020-12-31'))"
    )
    expect(fields[5].isNullable).toBe(true)
    expect(fields[5].isJsonType).toBe(false)
    expect(fields[5].isBytesType).toBe(false)
    expect(fields[5].isDecimalType).toBe(false)
    expect(fields[5]?.['_modelName']).toBe('MyPrismaScalarsType')
    expect(fields[5]?.['_errorLocation']).toBe(
      "[Error Location]: Model: 'MyPrismaScalarsType', Field: 'date'."
    )
    expect(fields[5].zodCustomErrors).toBeUndefined()
    expect(fields[5].zodValidatorString).toBe(
      ".min(new Date('2020-01-01')).max(new Date('2020-12-31'))"
    )
    expect(fields[5].zodCustomValidatorString).toBeUndefined()
    expect(fields[5].clearedDocumentation).toBeUndefined()
    expect(fields[5].zodType).toBe('date')
  })

  it(`should set expected values in field ${fields[6].name}`, () => {
    expect(fields[6].generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(fields[6].formattedNames).toStrictEqual(
      getStringVariants(fields[6].name)
    )
    expect(fields[6].kind).toBe('scalar')
    expect(fields[6].name).toBe('bigInt')
    expect(fields[6].isRequired).toBe(true)
    expect(fields[6].isList).toBe(false)
    expect(fields[6].isUnique).toBe(false)
    expect(fields[6].isId).toBe(false)
    expect(fields[6].isReadOnly).toBe(false)
    expect(fields[6].type).toBe('BigInt')
    expect(fields[6].dbNames).toBeUndefined()
    expect(fields[6].isGenerated).toBe(false)
    expect(fields[6].hasDefaultValue).toBe(false)
    expect(fields[6].default).toBeUndefined()
    expect(fields[6].relationToFields).toBeUndefined()
    expect(fields[6].relationOnDelete).toBeUndefined()
    expect(fields[6].relationName).toBeUndefined()
    expect(fields[6].documentation).toBeUndefined()
    expect(fields[6].isNullable).toBe(false)
    expect(fields[6].isJsonType).toBe(false)
    expect(fields[6].isBytesType).toBe(false)
    expect(fields[6].isDecimalType).toBe(false)
    expect(fields[6]?.['_modelName']).toBe('MyPrismaScalarsType')
    expect(fields[6]?.['_errorLocation']).toBe(
      "[Error Location]: Model: 'MyPrismaScalarsType', Field: 'bigInt'."
    )
    expect(fields[6].zodCustomErrors).toBeUndefined()
    expect(fields[6].zodValidatorString).toBeUndefined()
    expect(fields[6].zodCustomValidatorString).toBeUndefined()
    expect(fields[6].clearedDocumentation).toBeUndefined()
    expect(fields[6].zodType).toBe('bigint')
  })

  it(`should set expected values in field ${fields[7].name}`, () => {
    expect(fields[7].generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(fields[7].formattedNames).toStrictEqual(
      getStringVariants(fields[7].name)
    )
    expect(fields[7].kind).toBe('scalar')
    expect(fields[7].name).toBe('json')
    expect(fields[7].isRequired).toBe(true)
    expect(fields[7].isList).toBe(false)
    expect(fields[7].isUnique).toBe(false)
    expect(fields[7].isId).toBe(false)
    expect(fields[7].isReadOnly).toBe(false)
    expect(fields[7].type).toBe('Json')
    expect(fields[7].dbNames).toBeUndefined()
    expect(fields[7].isGenerated).toBe(false)
    expect(fields[7].hasDefaultValue).toBe(false)
    expect(fields[7].default).toBeUndefined()
    expect(fields[7].relationToFields).toBeUndefined()
    expect(fields[7].relationOnDelete).toBeUndefined()
    expect(fields[7].relationName).toBeUndefined()
    expect(fields[7].documentation).toBeUndefined()
    expect(fields[7].isNullable).toBe(false)
    expect(fields[7].isJsonType).toBe(true)
    expect(fields[7].isBytesType).toBe(false)
    expect(fields[7].isDecimalType).toBe(false)
    expect(fields[7]?.['_modelName']).toBe('MyPrismaScalarsType')
    expect(fields[7]?.['_errorLocation']).toBe(
      "[Error Location]: Model: 'MyPrismaScalarsType', Field: 'json'."
    )
    expect(fields[7].zodCustomErrors).toBeUndefined()
    expect(fields[7].zodValidatorString).toBeUndefined()
    expect(fields[7].zodCustomValidatorString).toBeUndefined()
    expect(fields[7].clearedDocumentation).toBeUndefined()
    expect(fields[7].zodType).toBe('Json')
  })

  it(`should set expected values in field ${fields[8].name}`, () => {
    expect(fields[8].generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(fields[8].formattedNames).toStrictEqual(
      getStringVariants(fields[8].name)
    )
    expect(fields[8].kind).toBe('scalar')
    expect(fields[8].name).toBe('bytes')
    expect(fields[8].isRequired).toBe(true)
    expect(fields[8].isList).toBe(false)
    expect(fields[8].isUnique).toBe(false)
    expect(fields[8].isId).toBe(false)
    expect(fields[8].isReadOnly).toBe(false)
    expect(fields[8].type).toBe('Bytes')
    expect(fields[8].dbNames).toBeUndefined()
    expect(fields[8].isGenerated).toBe(false)
    expect(fields[8].hasDefaultValue).toBe(false)
    expect(fields[8].default).toBeUndefined()
    expect(fields[8].relationToFields).toBeUndefined()
    expect(fields[8].relationOnDelete).toBeUndefined()
    expect(fields[8].relationName).toBeUndefined()
    expect(fields[8].documentation).toBeUndefined()
    expect(fields[8].isNullable).toBe(false)
    expect(fields[8].isJsonType).toBe(false)
    expect(fields[8].isBytesType).toBe(true)
    expect(fields[8].isDecimalType).toBe(false)
    expect(fields[8]?.['_modelName']).toBe('MyPrismaScalarsType')
    expect(fields[8]?.['_errorLocation']).toBe(
      "[Error Location]: Model: 'MyPrismaScalarsType', Field: 'bytes'."
    )
    expect(fields[8].zodCustomErrors).toBeUndefined()
    expect(fields[8].zodValidatorString).toBeUndefined()
    expect(fields[8].zodCustomValidatorString).toBeUndefined()
    expect(fields[8].clearedDocumentation).toBeUndefined()
    expect(fields[8].zodType).toBe('Bytes')
  })

  it(`should set expected values in field ${fields[9].name}`, () => {
    expect(fields[9].generatorConfig).toEqual(DEFAULT_GENERATOR_CONFIG)
    expect(fields[9].formattedNames).toStrictEqual(
      getStringVariants(fields[9].name)
    )
    expect(fields[9].kind).toBe('scalar')
    expect(fields[9].name).toBe('custom')
    expect(fields[9].isRequired).toBe(false)
    expect(fields[9].isList).toBe(false)
    expect(fields[9].isUnique).toBe(false)
    expect(fields[9].isId).toBe(false)
    expect(fields[9].isReadOnly).toBe(false)
    expect(fields[9].type).toBe('String')
    expect(fields[9].dbNames).toBeUndefined()
    expect(fields[9].isGenerated).toBe(false)
    expect(fields[9].hasDefaultValue).toBe(false)
    expect(fields[9].default).toBeUndefined()
    expect(fields[9].relationToFields).toBeUndefined()
    expect(fields[9].relationOnDelete).toBeUndefined()
    expect(fields[9].relationName).toBeUndefined()
    expect(fields[9].documentation).toBe(
      "@zod.custom.use(z.string().refine((val) => myFunction.validate(val), { message: 'Is not valid' }))"
    )
    expect(fields[9].isNullable).toBe(true)
    expect(fields[9].isJsonType).toBe(false)
    expect(fields[9].isBytesType).toBe(false)
    expect(fields[9].isDecimalType).toBe(false)
    expect(fields[9]?.['_modelName']).toBe('MyPrismaScalarsType')
    expect(fields[9]?.['_errorLocation']).toBe(
      "[Error Location]: Model: 'MyPrismaScalarsType', Field: 'custom'."
    )
    expect(fields[9].zodCustomErrors).toBeUndefined()
    expect(fields[9].zodValidatorString).toBeUndefined()
    expect(fields[9].zodCustomValidatorString).toBe(
      "z.string().refine((val) => myFunction.validate(val), { message: 'Is not valid' })"
    )
    expect(fields[9].clearedDocumentation).toBeUndefined()
    expect(fields[9].zodType).toBe('string')
  })
})
