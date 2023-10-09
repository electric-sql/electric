import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFEnum } from './extendedDMMFEnum'
import { ExtendedDMMFModel } from './extendedDMMFModel'
import { GeneratorConfig } from '../schemas'
import { parseModels } from '../utils/schemaParser'

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
    datamodel: DMMF.Datamodel,
    prismaSchema: string
  ) {
    this.generatorConfig = generatorConfig
    this.enums = this._getExtendedEnums(datamodel.enums)
    this.models = this._getExtendedModels(datamodel.models, prismaSchema)
    this.types = this._getExtendedModels(datamodel.types, prismaSchema)
  }

  private _getExtendedModels(models: DMMF.Model[], prismaSchema: string) {
    const parsedModels = parseModels(prismaSchema)
    const modelsDct = new Map(parsedModels.map((m) => [m.name, m]))
    return models.map(
      (model) =>
        new ExtendedDMMFModel(
          this.generatorConfig,
          model,
          modelsDct.get(model.name)!
        )
    )
  }

  private _getExtendedEnums(enums: DMMF.DatamodelEnum[]) {
    return enums.map((elem) => new ExtendedDMMFEnum(this.generatorConfig, elem))
  }
}
