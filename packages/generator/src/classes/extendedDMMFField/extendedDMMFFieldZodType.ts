import { DMMF } from '@prisma/generator-helper'

import { ExtendedDMMFFieldOmitField } from './extendedDMMFFieldOmitField'
import { GeneratorConfig } from '../../schemas'

/////////////////////////////////////////////////
// TYPES
/////////////////////////////////////////////////

export type ZodPrimitiveType =
  | 'string'
  | 'number'
  | 'bigint'
  | 'boolean'
  | 'date'
  | 'symbol'
  | 'undefined'
  | 'null'
  | 'void'
  | 'unknown'
  | 'never'
  | 'any'

export type ZodScalarType = Extract<
  ZodPrimitiveType,
  'string' | 'number' | 'date' | 'boolean' | 'bigint' | 'unknown' | 'any'
>

export type PrismaScalarType =
  | 'String'
  | 'Boolean'
  | 'Int'
  | 'BigInt'
  | 'Float'
  | 'Decimal'
  | 'DateTime'
  | 'Json'
  | 'Bytes'

// "Json" | "Bytes" are handled seperately in the generator functions
export type ZodPrismaScalarType = Exclude<
  PrismaScalarType,
  'Json' | 'Bytes' | 'Decimal'
>

/////////////////////////////////////////////////
// TYPE MAPS
/////////////////////////////////////////////////

/**
 * Map prisma scalar types to their corresponding zod validators.
 */
export const PRISMA_TO_ZOD_TYPE_MAP: Record<
  ZodPrismaScalarType,
  ZodScalarType
> = {
  String: 'string',
  Boolean: 'boolean',
  DateTime: 'date',
  Int: 'number',
  BigInt: 'bigint',
  Float: 'number',
}

/////////////////////////////////////////////////
// CLASS
/////////////////////////////////////////////////

export class ExtendedDMMFFieldZodType extends ExtendedDMMFFieldOmitField {
  readonly zodType: string

  constructor(
    field: DMMF.Field,
    generatorConfig: GeneratorConfig,
    modelName: string
  ) {
    super(field, generatorConfig, modelName)

    this.zodType = this._setZodType()
  }

  private _setZodType(): string {
    if (this.kind === 'scalar') return this._getZodTypeFromScalarType()
    return this.type
  }

  private _getZodTypeFromScalarType(): string {
    return PRISMA_TO_ZOD_TYPE_MAP[this.type as ZodPrismaScalarType] || this.type
  }
}
