import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFFieldValidatorPattern } from './extendedDMMFFieldValidatorPattern'
import { GeneratorConfig } from '../../schemas'

export class ExtendedDMMFFieldDefaultValidators extends ExtendedDMMFFieldValidatorPattern {
  protected _defaultValidatorString?: string

  constructor(
    field: DMMF.Field,
    generatorConfig: GeneratorConfig,
    modelName: string
  ) {
    super(field, generatorConfig, modelName)

    this._defaultValidatorString = this._setZodDefaultValidator()
    this._validatorList = this._updateValidatorList()
  }

  // GET DEFAULT VALIDATOR
  // ----------------------------------------------

  private _setZodDefaultValidator() {
    if (!this.generatorConfig.useDefaultValidators) return
    if (this._validatorList?.includes('.noDefault()')) return
    if (this._isCuid()) return '.cuid()'
    if (this._isUuid()) return '.uuid()'
    if (this._isInt()) return '.int()'
    return undefined
  }

  private _isCuid() {
    if (this._IsFieldDefault(this.default)) return this.default.name === 'cuid'
    return false
  }

  private _isUuid() {
    if (this._IsFieldDefault(this.default)) return this.default.name === 'uuid'
    return false
  }

  private _isInt() {
    return this.type === 'Int'
  }

  // Type guard to check if the field default is a DMMF.FieldDefault.
  // While investigating the DMMF, I found that the default property
  // is exclusively a DMMF.FieldDefault. Maybe in the future, the
  // other properties will be used, but for now they are not.

  private _IsFieldDefault(
    value?:
      | DMMF.FieldDefault
      | DMMF.FieldDefaultScalar
      | DMMF.FieldDefaultScalar[]
  ): value is DMMF.FieldDefault {
    return (value as DMMF.FieldDefault)?.name !== undefined
  }

  // The validator list needs to be updated after the default validator
  // has been added to the list. This is because ".noDefault()" would
  // otherwise be added to the "zodValidatorString" later on.

  private _updateValidatorList() {
    if (!this._validatorList) return

    const filterdList = this._validatorList.filter(
      (validator) => !validator.includes('.noDefault()')
    )

    if (filterdList.length < 1) {
      return undefined
    }

    return filterdList
  }
}
