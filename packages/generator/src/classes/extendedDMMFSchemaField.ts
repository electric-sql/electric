import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFDatamodel } from './extendedDMMFDatamodel'
import { ExtendedDMMFModel } from './extendedDMMFModel'
import { ExtendedDMMFSchemaArg } from './extendedDMMFSchemaArg'
import { FormattedNames } from './formattedNames'
import {
  FilterdPrismaAction,
  PRISMA_ACTION_ARG_MAP,
  PRISMA_ACTION_ARRAY,
} from '../constants/objectMaps'
import { GeneratorConfig } from '../schemas'

/////////////////////////////////////////////////
// REGEX
/////////////////////////////////////////////////

const OMIT_FIELDS_REGEX = /create|upsert|update|delete/

const OMIT_FIELDS_UNION_REGEX = /create|update|upsert|delete|data/

const WRITE_INCLUDE_SELECT_FIELDS_REGEX =
  /findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|create|update|upsert|delete/

const WRITE_NO_INCLUDE_SELECT_FIELDS_REGEX = /createMany|updateMany|deleteMany/

// const MUTEX_FIELDS_REGEX = /create|update|upsert/;
// const MUTEX_FIELDS_MANY_REGEX = /createMany|updateMany/;

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFSchemaField
  extends FormattedNames
  implements DMMF.SchemaField
{
  readonly name: DMMF.SchemaField['name']
  readonly isNullable: DMMF.SchemaField['isNullable']
  readonly outputType: DMMF.SchemaField['outputType']
  readonly args: ExtendedDMMFSchemaArg[]
  readonly deprecation?: DMMF.SchemaField['deprecation']
  readonly documentation?: DMMF.SchemaField['documentation']
  /**
   * Prisma action of the field.
   * @example "findManyUser"
   */
  readonly prismaAction: FilterdPrismaAction
  /**
   * String that contains the arg name according to prisma types.
   * @example "UserFindManyArgs"
   */
  readonly argName?: string
  /**
   * Type of the model according to the prisma action.
   * @example "User" for "findManyUser"
   */
  readonly modelType: string | DMMF.OutputType | DMMF.SchemaEnum
  /**
   * Linked `ExtendedDMMFModel`.
   * Used when generating the `select` and `include` args.
   */
  readonly linkedModel?: ExtendedDMMFModel
  readonly hasOmitFields: boolean
  readonly argTypeImports: Set<string>
  readonly writeSelectFindManyField: boolean
  readonly writeSelectField: boolean
  readonly writeIncludeFindManyField: boolean
  readonly writeIncludeField: boolean
  readonly writeSelectAndIncludeArgs: boolean
  readonly customArgType: string
  readonly writeSelectArg: boolean
  readonly writeIncludeArg: boolean

  constructor(
    readonly generatorConfig: GeneratorConfig,
    field: DMMF.SchemaField,
    datamodel: ExtendedDMMFDatamodel
  ) {
    super(field.name)
    this.generatorConfig = generatorConfig
    this.name = field.name
    this.isNullable = field.isNullable
    this.outputType = field.outputType
    this.deprecation = field.deprecation
    this.documentation = field.documentation
    this.writeSelectAndIncludeArgs = this._setWriteSelectAndIncludeArgs()
    this.writeSelectFindManyField = this._setWriteSelectFindManyField()
    this.writeSelectField = this._setWriteSelectField()
    this.writeIncludeFindManyField = this._setWriteIncludeFindManyField()
    this.writeIncludeField = this._setWriteIncludeField()
    this.prismaAction = this._setMatchedPrismaAction()
    this.modelType = this._setModelType()
    this.argName = this._setArgName()
    this.linkedModel = this._setLinkedModel(datamodel)
    this.args = this._setArgs(field)
    this.hasOmitFields = this._setHasOmitFields()
    this.writeSelectArg = this._setWriteSelectArg()
    this.writeIncludeArg = this._setWriteIncludeArg()
    this.argTypeImports = this._setArgTypeImports()
    this.customArgType = this._setCustomArgType()
  }

  testOutputType() {
    return this.outputType.namespace === 'model'
  }

  private _setArgs({ args }: DMMF.SchemaField) {
    return args.map((arg) => {
      const linkedField = this.linkedModel?.fields.find(
        (field) => field?.name === arg?.name
      )

      return new ExtendedDMMFSchemaArg(this.generatorConfig, arg, linkedField)
    })
  }

  /**
   * Matches the prisma action to the specific field.
   * @example "findManyUser" for "findMany"
   * @returns prisma action of the field e.g. "findMany"
   */
  private _setMatchedPrismaAction() {
    return PRISMA_ACTION_ARRAY.find((elem) =>
      this.name.includes(elem)
    ) as FilterdPrismaAction // can be asserted because all other fields are filterd in ExtendedDMMFOutputType
  }

  /**
   * Extracts the type of the model from the prisma action.
   * @example "findManyUser" -> "User"
   * @returns type of the model extracted from string
   */
  private _setModelType() {
    return this.name
      .replace(this.prismaAction as string, '')
      .replace('OrThrow', '')
  }

  /**
   * Rebuilds the `arg` typename used in prisma types.
   * @example "findManyUser" -> "UserFindManyArgs"
   * @returns name of the argType used in prisma types
   */
  private _setArgName() {
    const argName: FormattedNames | undefined =
      PRISMA_ACTION_ARG_MAP[this.prismaAction]

    if (this.name.includes('OrThrow')) {
      return `${this.modelType}${argName?.formattedNames.pascalCase}OrThrowArgs`
    }

    if (!argName) return

    return `${this.modelType}${argName.formattedNames.pascalCase}Args`
  }

  /**
   * Link dmmf model to schema field to get access to the model properties.
   * Used when generating the `select` and `include` args.
   * @returns datamodel matching the field
   */
  private _setLinkedModel(datamodel: ExtendedDMMFDatamodel) {
    return datamodel.models.find((model) => {
      return typeof this.modelType === 'string'
        ? this.modelType === model.name
        : false
    })
  }

  /**
   * Checks if the field contains `create`, `upsert`, `update` or `delete` in its name.
   * If so, it checks if the linked model has `omit` fields
   * @returns `true` if the field contains `create`, `upsert`, `update` or `delete` and the linked model has `omit` fields
   */
  private _setHasOmitFields() {
    const writeOmit = OMIT_FIELDS_REGEX.test(this.name)
    if (writeOmit) return Boolean(this.linkedModel?.hasOmitFields)
    return false
  }

  private _setArgTypeImports() {
    const { prismaClientPath } = this.generatorConfig
    const prismaImport = `import type { Prisma } from '${prismaClientPath}';`

    const imports: string[] = ["import { z } from 'zod';", prismaImport]

    if (this.writeIncludeArg) {
      imports.push(
        `import { ${this.modelType}IncludeSchema } from '../${this.generatorConfig.inputTypePath}/${this.modelType}IncludeSchema'`
      )
    }

    this.args.forEach((arg) => {
      if (arg.hasMultipleTypes) {
        return arg.inputTypes.forEach((inputType) => {
          imports.push(
            `import { ${inputType.type}Schema } from '../${this.generatorConfig.inputTypePath}/${inputType.type}Schema'`
          )
        })
      }

      return imports.push(
        `import { ${arg.inputTypes[0].type}Schema } from '../${this.generatorConfig.inputTypePath}/${arg.inputTypes[0].type}Schema'`
      )
    })

    // IntSchema and BooleanSchema are not needed since z.boolen() and z.number() are used
    return new Set(
      imports.filter(
        (imp) => !imp.includes('IntSchema') && !imp.includes('BooleanSchema')
      )
    )
  }

  // When using mongodb, there is no `findMany` arg type created even for lists.
  private _setWriteSelectFindManyField() {
    return (
      this.isObjectOutputType() &&
      this.isListOutputType() &&
      !this.generatorConfig.isMongoDb
    )
  }

  private _setWriteSelectField() {
    return this.isObjectOutputType()
  }

  // When using mongodb, there is no `findMany` arg type created even for lists.
  private _setWriteIncludeFindManyField() {
    return (
      this.isObjectOutputType() &&
      this.isListOutputType() &&
      !this.generatorConfig.isMongoDb
    )
  }

  /**
   * When using mongodb, the `include` type is created but not filled with any fields.
   * To replicate this behaviour, the `include` schema is aslso created as empty object
   * @returns `true` if the field is an object type and the provider is not `mongodb`
   */
  private _setWriteIncludeField() {
    return this.isObjectOutputType() && !this.generatorConfig.isMongoDb
  }

  /**
   * Used to determine if the field should be included in the `select` and `include` args.
   */
  private _setWriteSelectAndIncludeArgs() {
    return (
      WRITE_INCLUDE_SELECT_FIELDS_REGEX.test(this.name) &&
      !WRITE_NO_INCLUDE_SELECT_FIELDS_REGEX.test(this.name)
    )
  }

  /**
   * Checks if the `select` field should be written in the arg types schema.
   */
  private _setWriteSelectArg() {
    return (
      this._setWriteSelectAndIncludeArgs() && this.generatorConfig.addSelectType
    )
  }

  /**
   * Checks if the `include` field should be written in the arg types schema.
   */
  private _setWriteIncludeArg() {
    return (
      this._setWriteSelectAndIncludeArgs() &&
      Boolean(this.linkedModel?.hasRelationFields) &&
      this.generatorConfig.addIncludeType
    )
  }

  // CUSTOM ARG TYPE
  //---------------------------------------------------------------------

  private _shouldAddOmittedFieldsToOmitUnionArray() {
    return (
      // check if the model has fields that should be omitted
      this.hasOmitFields &&
      // check if the field contains `create`, `upsert`, `update`, `delete` or `data` in its name
      this.args.some((arg) => OMIT_FIELDS_UNION_REGEX.test(arg.name))
    )
  }

  private _shouldAddIncludeOrSelectToOmitUnion() {
    return (
      // "include" or "select" should be added to omit union when they match the regex pattern
      this._setWriteSelectAndIncludeArgs() &&
      // "include" should be added to omit union when it is set to be omitted via generator config
      (!this.generatorConfig.addIncludeType ||
        // "select" should be added to omit union when it is set to be omitted via generator config
        !this.generatorConfig.addSelectType)
    )
  }

  private _shouldAddIncludeToOmitUnionArray() {
    return (
      // "include" or "select" should be added to omit union when they match the regex pattern
      this._setWriteSelectAndIncludeArgs() &&
      // "include" should be added to omit union when field is of type "outputObjectType"
      this._setWriteIncludeField() &&
      // "include" should be added to omit union when it is set to be omitted via generator config
      !this.generatorConfig.addIncludeType &&
      // "include" should be added to omit union when it has relation fields
      this.linkedModel?.hasRelationFields
    )
  }

  private _shouldAddSelectToOmitUnionArray() {
    return (
      // "include" or "select" should be added to omit union when they match the regex pattern
      this._setWriteSelectAndIncludeArgs() &&
      // "select" should be added to omit union when field is of type "outputObjectType"
      this._setWriteSelectField() &&
      // "select" should be added to omit union when it is set to be omitted via generator config
      !this.generatorConfig.addSelectType
    )
  }

  /**
   * Used to determine if the field contains a union that
   * should be mutually exclusive as in prismas `Without<..>` type
   * used in `create`, `update` and `upsert` args.
   */
  // private _shouldAddDataToOmitUnionArray() {
  //   return (
  //     // check if the field contains `create`, `upsert`o `update` in its name
  //     MUTEX_FIELDS_REGEX.test(this.name) &&
  //     // check if the field does not contains `createMany` or `updateMany` in its name
  //     !MUTEX_FIELDS_MANY_REGEX.test(this.name)
  //   );
  // }

  private _getOmitFieldsUnion(omitUnionArray: string[]) {
    return omitUnionArray.join(' | ')
  }

  private _addOmittedFieldsToOmitUnionArray(omitUnionArray: string[]) {
    this.args.forEach((arg) => {
      if (OMIT_FIELDS_UNION_REGEX.test(arg.name))
        omitUnionArray.push(`"${arg.name}"`)
    })
  }

  /**
   * By default, the type for `[Model]ArgTypeSchema` is just the prisma client type.
   * If the model contains fields that should be omitted or the `include` and `select`
   * types should not be created in the arg type schema, the type information
   * passed to the zod schema needs to be updated.
   */

  private _setCustomArgType() {
    const omitUnionArray: string[] = []

    // if (this._shouldAddDataToOmitUnionArray()) {
    //   omitUnionArray.push('"data"');
    // }

    if (this._shouldAddSelectToOmitUnionArray()) {
      omitUnionArray.push('"select"')
    }

    if (this._shouldAddIncludeToOmitUnionArray()) {
      omitUnionArray.push('"include"')
    }

    if (this._shouldAddOmittedFieldsToOmitUnionArray()) {
      this._addOmittedFieldsToOmitUnionArray(omitUnionArray)

      return `z.ZodType<Omit<Prisma.${this.argName}, ${this._getOmitFieldsUnion(
        omitUnionArray
      )}> & { ${this._getTypeForCustomArgsType()} }>`
    }

    if (this._shouldAddIncludeOrSelectToOmitUnion()) {
      return `z.ZodType<Omit<Prisma.${this.argName}, ${this._getOmitFieldsUnion(
        omitUnionArray
      )}>>`
    }

    return `z.ZodType<Prisma.${this.argName}>`
  }

  /**
   * If a model contains fields that should be omitted,
   * the type information passed to the zod schema needs to be updated.
   */
  private _getTypeForCustomArgsType() {
    return this.args
      .map((arg) => {
        if (arg.rewriteArgWithNewType()) {
          return (
            this._getCustomArgsFieldName(arg) + this._getCustomArgsType(arg)
          )
        }
        return undefined
      })
      .filter((arg): arg is string => arg !== undefined)
      .join(', ')
  }

  /**
   * Determins if a custom arg field is optional or required.
   */
  private _getCustomArgsFieldName(arg: ExtendedDMMFSchemaArg) {
    return `${arg.name}${arg.isRequired ? '' : '?'}: `
  }

  /**
   * Returns the union of types or a single type.
   */
  private _getCustomArgsType(arg: ExtendedDMMFSchemaArg) {
    return arg.hasMultipleTypes
      ? this._getCustomArgsMultipleTypes(arg)
      : this._getCustomArgsSingleType(arg)
  }

  /**
   * If the arg has multiple types, the type is a union of the types.
   */
  private _getCustomArgsMultipleTypes(arg: ExtendedDMMFSchemaArg) {
    return arg.inputTypes
      .map((inputType) => {
        return `z.infer<typeof ${inputType.type}Schema>${
          inputType.isList ? '[]' : ''
        }`
      })
      .join(' | ')
  }

  /**
   * If the arg has a single type, the type is returnd as is or as a list.
   */
  private _getCustomArgsSingleType(arg: ExtendedDMMFSchemaArg) {
    if (arg.inputTypes[0].isList) {
      return `z.infer<typeof ${arg.inputTypes[0].type}Schema>[]`
    }
    return `z.infer<typeof ${arg.inputTypes[0].type}Schema>`
  }

  // HELPER METHODS
  //---------------------------------------------------------------------

  isEnumOutputType() {
    return this.outputType?.location === 'enumTypes'
  }

  isListOutputType() {
    return this.outputType.isList
  }

  isObjectOutputType() {
    return this.outputType?.location === 'outputObjectTypes'
  }

  isScalarOutputType() {
    return this.outputType?.location === 'scalar'
  }

  isCountField() {
    return this.name.includes('_count')
  }
}
