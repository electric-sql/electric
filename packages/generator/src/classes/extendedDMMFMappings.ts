import { DMMF } from '@prisma/generator-helper'

import { GeneratorConfig } from '../schemas'

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFMappings implements DMMF.Mappings {
  readonly modelOperations: DMMF.ModelMapping[]
  readonly otherOperations: {
    readonly read: string[]
    readonly write: string[]
  }

  constructor(
    readonly generatorConfig: GeneratorConfig,
    mappings: DMMF.Mappings
  ) {
    this.modelOperations = mappings.modelOperations
    this.otherOperations = mappings.otherOperations
  }
}
