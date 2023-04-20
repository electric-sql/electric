import CodeBlockWriter from 'code-block-writer'
// import { StatementStructures, WriterFunction } from 'ts-morph';

import {
  CreateFileOptions,
  ExtendedDMMF,
  ExtendedDMMFField,
  ExtendedDMMFModel,
  ExtendedDMMFSchemaArgInputType,
  ZodValidatorOptions,
} from './classes'

export type WriteStatements = (
  datamodel: ExtendedDMMF,
  writer: CreateFileOptions
) => void

export interface CreateOptions {
  dmmf: ExtendedDMMF
  path: string
}

export type CreateFiles = (options: CreateOptions) => void

export interface ScalarValidatorFunctionOptions {
  key: string
  pattern: string
}

export type ValidatorFunction = (
  options: ScalarValidatorFunctionOptions
) => string | undefined

export type ValidatorFunctionMap = Record<ZodValidatorType, ValidatorFunction>

export type ZodValidatorTypeMap = Record<ZodValidatorType, PrismaScalarType[]>

export type PrismaScalarTypeMap<T> = Record<PrismaScalarType, T>

export type ZodCustomErrorKey =
  | 'invalid_type_error'
  | 'required_error'
  | 'description'

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

export type ZodValidatorType =
  | Extract<ZodPrimitiveType, 'string' | 'number' | 'date' | 'bigint'>
  | 'custom'

export type ZodScalarType = Extract<
  ZodPrimitiveType,
  'string' | 'number' | 'date' | 'boolean' | 'bigint' | 'unknown' | 'any'
>
// | 'JsonValue'; // allow jsonSchema as a type

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

export type ZodBasicValidatorKeys = 'refine' | 'transform' | 'superRefine'

export type ZodStringValidatorKeys =
  | 'min'
  | 'max'
  | 'length'
  | 'email'
  | 'url'
  | 'uuid'
  | 'cuid'
  | 'regex'
  | 'startsWith'
  | 'endsWith'
  | 'trim'
  | 'datetime'
  | 'noDefault'

export type ZodNumberValidatorKeys =
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'int'
  | 'positive'
  | 'nonpositive'
  | 'negative'
  | 'nonnegative'
  | 'multipleOf'
  | 'finite'
  | 'noDefault'

export type ZodDateValidatorKeys = 'min' | 'max'

export type ZodBigIntValidatorKeys = 'array'

export type ZodCustomValidatorKeys = 'use' | 'omit' | 'import' | 'array'

export type WriteBaseFilterTypesFunction = (options?: {
  nullable?: boolean
  aggregates?: boolean
}) => (writer: CodeBlockWriter) => void

export type PrismaAction =
  | 'findUnique'
  | 'findMany'
  | 'findFirst'
  | 'createOne'
  | 'createMany'
  | 'updateOne'
  | 'updateMany'
  | 'upsertOne'
  | 'deleteOne'
  | 'deleteMany'
  | 'executeRaw'
  | 'aggregate'
  | 'count'
  | 'groupBy'

export interface WriteTypeOptions extends ZodValidatorOptions {
  inputType: ExtendedDMMFSchemaArgInputType
  isOptional?: boolean
  isNullable?: boolean
  writeLazy?: boolean
  writeComma?: boolean
  writeValidation?: boolean
}

export type WriteTypeFunction<
  TOptions extends WriteTypeOptions = WriteTypeOptions
> = (writer: CodeBlockWriter, options: TOptions) => CodeBlockWriter | undefined

///////////////////////////////////////////////
// HELPER TYPES FOR MODEL GENERATION
///////////////////////////////////////////////

export interface WriteFieldOptions {
  writer: CodeBlockWriter
  field: ExtendedDMMFField
  writeOptionalDefaults?: boolean
  forcePartial?: boolean
}

export interface ExtendedWriteFieldOptions extends WriteFieldOptions {
  model: ExtendedDMMFModel
  dmmf: ExtendedDMMF
}

export interface ContentWriterOptions {
  fileWriter: CreateFileOptions
  dmmf: ExtendedDMMF
  getSingleFileContent?: boolean
}
