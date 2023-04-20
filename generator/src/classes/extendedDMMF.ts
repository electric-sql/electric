import { DMMF, Dictionary } from '@prisma/generator-helper'

import { ExtendedDMMFDatamodel } from './extendedDMMFDatamodel'
import { ExtendedDMMFMappings } from './extendedDMMFMappings'
import { ExtendedDMMFSchema } from './extendedDMMFSchema'
import { GeneratorConfig, configSchema } from '../schemas'

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMF implements DMMF.Document {
  readonly generatorConfig: GeneratorConfig
  readonly datamodel: ExtendedDMMFDatamodel
  readonly schema: ExtendedDMMFSchema
  readonly mappings: DMMF.Mappings
  readonly imports: Set<string>
  readonly customImports: Set<string>

  constructor(dmmf: DMMF.Document, config: Dictionary<string>) {
    this.generatorConfig = this._setGeneratorConfig(config)
    this.datamodel = this._getExtendedDatamodel(dmmf)
    this.schema = this._getExtendedSchema(dmmf)
    this.mappings = this._getExtendedMappings(dmmf)
    this.imports = this._getImports()
    this.customImports = this._getCustomImports()
  }

  private _getExtendedDatamodel({ datamodel }: DMMF.Document) {
    return new ExtendedDMMFDatamodel(this.generatorConfig, datamodel)
  }

  private _getExtendedSchema(dmmf: DMMF.Document) {
    return new ExtendedDMMFSchema(
      this.generatorConfig,
      dmmf.schema,
      this.datamodel
    )
  }

  private _getImports() {
    return new Set(
      this.datamodel.models.map((model) => [...model.imports]).flat()
    )
  }

  private _getCustomImports() {
    return new Set(
      this.datamodel.models.map((model) => [...model.customImports]).flat()
    )
  }

  private _getExtendedMappings(dmmf: DMMF.Document) {
    return new ExtendedDMMFMappings(this.generatorConfig, dmmf.mappings)
  }

  private _setGeneratorConfig(config: Dictionary<string>): GeneratorConfig {
    return configSchema.parse(config)
  }
}
