import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFDatamodel } from './extendedDMMFDatamodel'
import { ExtendedDMMFField } from './extendedDMMFField/extendedDMMFField'
import { ExtendedDMMFModel } from './extendedDMMFModel'
import {
  ExtendedDMMFSchemaArg,
  ZodValidatorOptions,
} from './extendedDMMFSchemaArg'
import { FormattedNames } from './formattedNames'
import {
  PRISMA_FUNCTION_TYPES_WITH_VALIDATORS,
  PRISMA_FUNCTION_TYPES_WITH_VALIDATORS_WHERE_UNIQUE,
} from '../constants/regex'
import { GeneratorConfig } from '../schemas'

const SPLIT_NAME_REGEX =
  /Unchecked|Create|Update|CreateMany|UpdateMany|Upsert|Where|WhereUnique|OrderBy|ScalarWhere|Aggregate|GroupBy/g

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFInputType
  extends FormattedNames
  implements DMMF.InputType
{
  readonly name: DMMF.InputType['name']
  readonly constraints: DMMF.InputType['constraints']
  readonly meta: DMMF.InputType['meta']
  readonly fields: ExtendedDMMFSchemaArg[]
  readonly fieldMap: DMMF.InputType['fieldMap']
  readonly linkedModel?: ExtendedDMMFModel
  readonly isJsonField: boolean
  readonly isBytesField: boolean
  readonly isDecimalField: boolean
  readonly omitFields: string[] = []
  readonly imports: Set<string>
  /** @deprecated */
  readonly isWhereUniqueInput?: boolean
  readonly extendedWhereUniqueFields?: ExtendedDMMFSchemaArg[][]

  constructor(
    readonly generatorConfig: GeneratorConfig,
    type: DMMF.InputType,
    datamodel: ExtendedDMMFDatamodel
  ) {
    super(type.name)
    this.generatorConfig = generatorConfig
    this.name = type.name
    this.linkedModel = this._setLinkedModel(datamodel)
    this.constraints = type.constraints
    this.meta = type.meta
    this.fields = this._setFields(type.fields)
    this.fieldMap = type.fieldMap
    this.isJsonField = this._setIsJsonField()
    this.isBytesField = this._setIsBytesField()
    this.isDecimalField = this._setIsDecimalField()
    this.omitFields = this._setOmitFields()
    this.imports = this._setImports()
    this.extendedWhereUniqueFields = this._setExtendedWhereUniqueFields(
      type.fields
    )
  }

  /**
   * Finds the datamodel that matches the input type.
   * This way the documentation ,validator strings and other information
   * from the datamodel can be added to the input types.
   */
  private _setLinkedModel(datamodel: ExtendedDMMFDatamodel) {
    return datamodel.models.find((model) => {
      // need to split string to obtain the model name from the input type name.
      return model.name === this.name.split(SPLIT_NAME_REGEX)[0]
    })
  }

  private _setFields(fields: DMMF.SchemaArg[]) {
    return fields.map((field) => {
      const linkedField = this.linkedModel?.fields.find(
        (modelField) => modelField.name === field.name
      )

      // validators and omitField should only be written for create and update types.
      // this prevents validation in e.g. search queries in "where inputs",
      // where strings like email addresses can be incomplete.
      const optionalValidators: ZodValidatorOptions | undefined =
        this._fieldIsPrismaFunctionType()
          ? {
              zodValidatorString: this._getZodValidatorString(field.name),
              zodCustomErrors: this._getZodCustomErrorsString(field.name),
              zodCustomValidatorString: this._getZodCustomValidatorString(
                field.name
              ),
              zodOmitField: this._getZodOmitField(linkedField),
            }
          : undefined

      return new ExtendedDMMFSchemaArg(
        this.generatorConfig,
        { ...field, ...optionalValidators },
        linkedField
      )
    })
  }

  private _fieldIsPrismaFunctionType() {
    if (
      !this.generatorConfig.useMultipleFiles ||
      this.generatorConfig.validateWhereUniqueInput
    ) {
      return PRISMA_FUNCTION_TYPES_WITH_VALIDATORS_WHERE_UNIQUE.test(this.name)
    }
    return PRISMA_FUNCTION_TYPES_WITH_VALIDATORS.test(this.name)
  }

  private _getZodValidatorString(fieldName: string) {
    return this.linkedModel?.fields.find((field) => field.name === fieldName)
      ?.zodValidatorString
  }

  private _getZodCustomErrorsString(fieldName: string) {
    return this.linkedModel?.fields.find((field) => field.name === fieldName)
      ?.zodCustomErrors
  }

  private _getZodCustomValidatorString(fieldName: string) {
    return this.linkedModel?.fields.find((field) => field.name === fieldName)
      ?.zodCustomValidatorString
  }

  private _getZodOmitField(linkedField?: ExtendedDMMFField) {
    if (!linkedField) return undefined

    const shouldOmitField =
      linkedField.zodOmitField === 'input' || linkedField.zodOmitField === 'all'

    return shouldOmitField
  }

  private _setIsJsonField() {
    return this.fields.some((field) => field.isJsonType)
  }

  private _setIsBytesField() {
    return this.fields.some((field) => field.isBytesType)
  }

  private _setIsDecimalField() {
    return this.fields.some((field) => field.isDecimalType)
  }

  /**
   * Filters all fields that should be omitted in the input type.
   * This is used to create the "Omit" ts-type for the input type.
   * @returns an array of field names that should be omitted in the input type
   */
  private _setOmitFields() {
    return this.fields
      .filter((field) => field.zodOmitField)
      .map((field) => field.name)
  }

  private _setImports() {
    const { prismaClientPath } = this.generatorConfig
    const prismaImport = `import type { Prisma } from '${prismaClientPath}';`
    const zodImport = "import { z } from 'zod';"

    const fieldImports = [
      prismaImport,
      zodImport,
      ...this.fields.map((field) => field.getImports(this.name)).flat(),
    ]

    if (this._fieldIsPrismaFunctionType() && this.linkedModel?.customImports) {
      fieldImports.push(...this.linkedModel.customImports)
    }

    return new Set(fieldImports)
  }

  private _getExtendedWhereUniqueFieldCombinations(
    arr: DMMF.SchemaArg[]
  ): DMMF.SchemaArg[][] {
    const result: DMMF.SchemaArg[][] = []

    function combine(start: number, soFar: DMMF.SchemaArg[]) {
      if (soFar.length === arr.length) {
        result.push(soFar.slice())
        return
      }

      // include current element
      combine(start + 1, [...soFar, { ...arr[start], isRequired: true }])

      // exclude current element
      combine(start + 1, [...soFar, { ...arr[start], isRequired: false }])
    }

    combine(0, [])
    return result
  }

  private _setExtendedWhereUniqueFields(fields: DMMF.SchemaArg[]) {
    if (!this.constraints.fields || !this.name.includes('WhereUniqueInput')) {
      return undefined
    }

    // get the DMMF.SchemaArg for all fields that are part of the constraints
    // that are marked for the extended where unique input
    const extendedWhereUniqueFields = this.constraints.fields
      .map((fieldName) => {
        return fields.find((field) => field.name === fieldName)
      })
      .filter((field): field is DMMF.SchemaArg => field !== undefined)

    // get all combinations of bool values on isRequired fields
    // for the provided set of fields
    const combinations = this._getExtendedWhereUniqueFieldCombinations(
      extendedWhereUniqueFields
    )

    // filter out combinations where isRequired is False because
    // these cominations are included in the all optional type that is
    // later cominened with the generated union type.
    const filteredCombinations = combinations.filter(
      (combination) => !combination.every((field) => !field.isRequired)
    )

    // filter out all fields that are not required
    // since they are added via the all optional type
    const extendedFilterdCombinations = filteredCombinations.map(
      (combination) => {
        return combination.filter((field) => field.isRequired)
      }
    )

    // create an ExtendedDMMFSchemaArg for each combination field
    // so the writer functions can be used as is
    return extendedFilterdCombinations.map((combination) => {
      return this._setFields(combination)
    })
  }

  hasOmitFields() {
    return this.omitFields.length > 0
  }

  getOmitFieldsUnion() {
    return this.omitFields.map((field) => `"${field}"`).join(' | ')
  }
}
