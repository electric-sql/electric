import { DMMF } from '@prisma/generator-helper'

import { GeneratorConfig } from '../../schemas'
import { FormattedNames } from '../formattedNames'

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFFieldBase
  extends FormattedNames
  implements DMMF.Field
{
  protected _modelName: string
  protected _errorLocation: string

  readonly generatorConfig: GeneratorConfig

  readonly kind: DMMF.Field['kind']
  readonly name: DMMF.Field['name']
  readonly isRequired: DMMF.Field['isRequired']
  readonly isList: DMMF.Field['isList']
  readonly isUnique: DMMF.Field['isUnique']
  readonly isId: DMMF.Field['isId']
  readonly isReadOnly: DMMF.Field['isReadOnly']
  readonly type: DMMF.Field['type']
  readonly dbNames?: DMMF.Field['dbNames']
  readonly isGenerated: DMMF.Field['isGenerated']
  readonly isUpdatedAt: DMMF.Field['isUpdatedAt']
  readonly hasDefaultValue: DMMF.Field['hasDefaultValue']
  readonly default?: DMMF.Field['default']
  readonly relationFromFields?: DMMF.Field['relationFromFields']
  readonly relationToFields?: DMMF.Field['relationToFields']
  readonly relationOnDelete?: DMMF.Field['relationOnDelete']
  readonly relationName?: DMMF.Field['relationName']
  readonly documentation?: DMMF.Field['documentation']

  readonly isNullable: boolean
  readonly isJsonType: boolean
  readonly isBytesType: boolean
  readonly isDecimalType: boolean
  readonly isOptionalOnDefaultValue: boolean
  readonly isOptionalDefaultField: boolean

  constructor(
    field: DMMF.Field,
    generatorConfig: GeneratorConfig,
    modelName: string
  ) {
    super(field.name)

    this.generatorConfig = generatorConfig
    this._modelName = modelName

    this.kind = field.kind
    this.name = field.name
    this.isRequired = field.isRequired
    this.isList = field.isList
    this.isUnique = field.isUnique
    this.isId = field.isId
    this.isReadOnly = field.isReadOnly
    this.type = field.type
    this.dbNames = field.dbNames
    this.isGenerated = field.isGenerated
    this.isUpdatedAt = field.isUpdatedAt
    this.hasDefaultValue = field.hasDefaultValue
    this.default = field.default
    this.relationFromFields = field.relationFromFields
    this.relationToFields = field.relationToFields
    this.relationOnDelete = field.relationOnDelete
    this.relationName = field.relationName
    this.documentation = field.documentation

    this.isNullable = this._setIsNullable()
    this.isJsonType = this._setIsJsonType()
    this.isBytesType = this._setIsBytesType()
    this.isDecimalType = this._setIsDecimalType()
    this.isOptionalOnDefaultValue = this._setDefaultValueOptional()
    this.isOptionalDefaultField = this._setIsOptionalDefaultField()

    this._errorLocation = this._setErrorLocation()
  }

  private _setIsJsonType() {
    return this.type === 'Json'
  }

  private _setIsBytesType() {
    return this.type === 'Bytes'
  }

  private _setIsDecimalType() {
    return this.type === 'Decimal'
  }

  private _setIsNullable() {
    return !this.isRequired
  }

  private _setDefaultValueOptional() {
    return (
      (this.hasDefaultValue || Boolean(this.isUpdatedAt)) &&
      this.generatorConfig.createOptionalDefaultValuesTypes
    )
  }

  private _setErrorLocation() {
    return `[Error Location]: Model: '${this._modelName}', Field: '${this.name}'.`
  }

  // PUBLIC METHODS
  //--------------------------------------------------

  private _setIsOptionalDefaultField() {
    return Boolean(this.hasDefaultValue || this.isUpdatedAt)
  }
}
