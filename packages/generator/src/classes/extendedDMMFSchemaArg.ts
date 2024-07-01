import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFField, ExtendedDMMFSchemaArgInputType } from '.'
import { FormattedNames } from './formattedNames'
import { GeneratorConfig } from '../schemas'

export interface ExtendedDMMFSchemaArgOptions
  extends DMMF.SchemaArg,
    ZodValidatorOptions {}

export interface ZodValidatorOptions {
  zodValidatorString?: string
  zodCustomErrors?: string
  zodCustomValidatorString?: string
  zodOmitField?: boolean
}

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFSchemaArg
  extends FormattedNames
  implements DMMF.SchemaArg
{
  readonly name: DMMF.SchemaArg['name']
  readonly comment?: DMMF.SchemaArg['comment']
  readonly isNullable: DMMF.SchemaArg['isNullable']
  readonly isRequired: DMMF.SchemaArg['isRequired']
  readonly inputTypes: ExtendedDMMFSchemaArgInputType[]
  readonly deprecation?: DMMF.SchemaArg['deprecation']
  readonly zodValidatorString?: string
  readonly zodCustomErrors?: string
  readonly zodCustomValidatorString?: string
  readonly zodOmitField?: boolean
  readonly hasSingleType: boolean
  readonly hasMultipleTypes: boolean
  readonly isOptional: boolean
  readonly isJsonType: boolean
  readonly isBytesType: boolean
  readonly isDecimalType: boolean
  readonly linkedField?: ExtendedDMMFField

  constructor(
    readonly generatorConfig: GeneratorConfig,
    arg: ExtendedDMMFSchemaArgOptions,
    linkedField?: ExtendedDMMFField
  ) {
    super(arg.name)
    this.generatorConfig = generatorConfig
    this.name = arg.name
    this.comment = arg.comment
    this.isNullable = arg.isNullable
    this.isRequired = arg.isRequired
    this.inputTypes = this._setInputTypes(arg.inputTypes)
    this.deprecation = arg.deprecation
    this.zodValidatorString = arg.zodValidatorString
    this.zodCustomErrors = arg.zodCustomErrors
    this.zodCustomValidatorString = arg.zodCustomValidatorString
    this.zodOmitField = arg.zodOmitField
    this.hasSingleType = this._setHasSingleType()
    this.hasMultipleTypes = this._setHasMultipleTypes()
    this.isOptional = this._setIsOptional()
    this.isJsonType = this._setIsJsonType()
    this.isBytesType = this._setIsBytesType()
    this.isDecimalType = this._setIsDecimalType()
    this.linkedField = linkedField
  }

  private _setInputTypes = (inputTypes: DMMF.SchemaArgInputType[]) => {
    // filter "null" from the inputTypes array to prevent the generator
    // from generating a union type with "null" and the actual field type
    // instead of e.g. a scalar type
    const nonNullTypes = inputTypes.filter(({ type }) => type !== 'Null')

    // FIX: this is a hacky workaround to prevent the generator from
    // generating a union in the "GroupByArgs" at the "by" property.
    // this should be fixed in the prisma dmmf
    if (this.name === 'by') {
      return nonNullTypes
        .filter((inputType) => inputType.isList === true)
        .map((inputType) => {
          return new ExtendedDMMFSchemaArgInputType(
            this.generatorConfig,
            inputType
          )
        })
    }

    return nonNullTypes.map((inputType) => {
      return new ExtendedDMMFSchemaArgInputType(this.generatorConfig, inputType)
    })
  }

  private _setHasSingleType() {
    return this.inputTypes.length === 1
  }

  private _setHasMultipleTypes() {
    return this.inputTypes.length > 1
  }

  private _setIsOptional() {
    return !this.isRequired
  }

  private _setIsJsonType() {
    return this.inputTypes.some((inputType) => inputType.isJsonType)
  }

  private _setIsBytesType() {
    return this.inputTypes.some((inputType) => inputType.isBytesType)
  }

  private _setIsDecimalType() {
    return this.inputTypes.some((inputType) => inputType.isDecimalType)
  }

  /**
   * Used to check if the arg contains a property name that should be omitted in base type
   * to then be added as new property with updated type information.
   * @returns `true` if the arg.name matches one of `create|update|upsert|delete|data`
   */
  rewriteArgWithNewType() {
    return /create|update|upsert|delete|data/.test(this.name)
  }

  getImports(fieldName: string) {
    const imports = this.inputTypes
      .map((type) => {
        const importType = type.getZodNonScalarType()
        const stringImportType = importType?.toString()

        // exclude the import for the current model if it references itself
        if (stringImportType === fieldName) {
          return
        }

        if (type.isJsonType) {
          return `import { InputJsonValue } from './InputJsonValue';`
        }

        if (type.isDecimalType) {
          const decimalImports = [
            `import { isValidDecimalInput } from './isValidDecimalInput';`,
          ]

          if (type.isList) {
            decimalImports.push(
              `import { DecimalJSLikeListSchema } from './DecimalJsLikeListSchema';`
            )
          }

          if (!type.isList) {
            decimalImports.push(
              `import { DecimalJSLikeSchema } from './DecimalJsLikeSchema';`
            )
          }

          return decimalImports
        }

        // get imports for all non scalar types (e.g. enums, models)
        if (importType) {
          return `import { ${importType}Schema } from './${importType}Schema';`
        }

        return undefined
      })
      .flat()
      .filter(
        (importString): importString is string => importString !== undefined
      )

    return imports
  }
}
