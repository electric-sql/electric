import { DMMF } from '@prisma/generator-helper'

import { GeneratorConfig } from '../../../schemas'

export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  useMultipleFiles: false,
  createInputTypes: true,
  createModelTypes: true,
  createOptionalDefaultValuesTypes: false,
  createRelationValuesTypes: false,
  createPartialTypes: false,
  addIncludeType: true,
  addSelectType: true,
  addInputTypeValidation: true,
  useDefaultValidators: true,
  prismaClientPath: '@prisma/client',
  coerceDate: true,
  writeNullishInModelTypes: false,
  isMongoDb: false,
  validateWhereUniqueInput: false,
  inputTypePath: 'inputTypeSchemas',
  outputTypePath: 'outputTypeSchemas',
}

export const FIELD_BASE: DMMF.Field = {
  kind: 'scalar',
  name: 'test',
  isRequired: true,
  isList: false,
  isUnique: false,
  isId: false,
  isReadOnly: false,
  type: 'String',
  dbNames: ['test'],
  isGenerated: false,
  isUpdatedAt: false,
  hasDefaultValue: false,
  default: undefined,
  relationToFields: undefined,
  relationOnDelete: undefined,
  relationName: undefined,
  documentation: undefined,
}
