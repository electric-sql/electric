import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFEnum } from './extendedDMMFEnum'
import { ExtendedDMMFModel } from './extendedDMMFModel'
import { GeneratorConfig } from '../schemas'

export interface ExtendedDMMFDatamodelOptions {
  datamodel: DMMF.Datamodel
  config: GeneratorConfig
}

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFDatamodel {
  readonly enums: ExtendedDMMFEnum[]
  readonly models: ExtendedDMMFModel[]
  readonly types: ExtendedDMMFModel[]

  constructor(
    readonly generatorConfig: GeneratorConfig,
    datamodel: DMMF.Datamodel
  ) {
    this.generatorConfig = generatorConfig
    this.enums = this._getExtendedEnums(datamodel.enums)
    this.models = this._getExtendedModels(datamodel.models)
    this.types = this._getExtendedModels(datamodel.types)
  }

  private _getExtendedModels(models: DMMF.Model[]) {
    return models.map(
      (model) => new ExtendedDMMFModel(this.generatorConfig, model)
    )
  }

  private _getExtendedEnums(enums: DMMF.DatamodelEnum[]) {
    return enums.map((elem) => new ExtendedDMMFEnum(this.generatorConfig, elem))
  }
}
