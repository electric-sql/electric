import { DMMF } from '@prisma/generator-helper'

import { FormattedNames } from './formattedNames'
import { GeneratorConfig } from '../schemas'

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFSchemaEnum
  extends FormattedNames
  implements DMMF.SchemaEnum
{
  readonly name: DMMF.SchemaEnum['name']
  readonly values: DMMF.SchemaEnum['values']
  readonly useNativeEnum: boolean

  constructor(
    readonly generatorConfig: GeneratorConfig,
    enumType: DMMF.SchemaEnum
  ) {
    super(enumType.name)
    this.generatorConfig = generatorConfig
    this.name = enumType.name
    this.values = enumType.values
    this.useNativeEnum = this._setUseNativeEnum()
  }

  private _setUseNativeEnum() {
    return !this.name.includes('JsonNullValue')
  }
}
