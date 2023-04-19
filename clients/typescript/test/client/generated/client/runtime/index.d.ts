/**
 * TODO
 * @param this
 */
declare function $extends(
  this: Client,
  extension: Args | ((client: Client) => Client)
): Client

declare type Action =
  | keyof typeof DMMF.ModelAction
  | 'executeRaw'
  | 'queryRaw'
  | 'runCommandRaw'

declare type Aggregate = '_count' | '_max' | '_min' | '_avg' | '_sum'

declare class AnyNull extends NullTypesEnumValue {}

declare type ApplyExtensionsParams = {
  result: object
  modelName: string
  args: JsArgs
  extensions: MergedExtensionsList
}

declare class Arg {
  key: string
  value: ArgValue
  error?: InvalidArgError
  hasError: boolean
  isEnum: boolean
  schemaArg?: DMMF.SchemaArg
  isNullable: boolean
  inputType?: DMMF.SchemaArgInputType
  constructor({ key, value, isEnum, error, schemaArg, inputType }: ArgOptions)
  get [Symbol.toStringTag](): string
  _toString(value: ArgValue, key: string): string | undefined
  toString(): string | undefined
  collectErrors(): ArgError[]
}

declare interface ArgError {
  path: string[]
  id?: string
  error: InvalidArgError
}

declare interface ArgOptions {
  key: string
  value: ArgValue
  isEnum?: boolean
  error?: InvalidArgError
  schemaArg?: DMMF.SchemaArg
  inputType?: DMMF.SchemaArgInputType
}

declare type Args = OptionalFlat<RequiredArgs>

declare class Args_2 {
  args: Arg[]
  readonly hasInvalidArg: boolean
  constructor(args?: Arg[])
  get [Symbol.toStringTag](): string
  toString(): string
  collectErrors(): ArgError[]
}

declare type Args_3 = InternalArgs

declare type Args_4<T, F extends Operation> = T extends {
  [K: symbol]: {
    types: {
      [K in F]: {
        args: any
      }
    }
  }
}
  ? T[symbol]['types'][F]['args']
  : never

declare type ArgValue =
  | string
  | boolean
  | number
  | undefined
  | Args_2
  | string[]
  | boolean[]
  | number[]
  | Args_2[]
  | null

declare interface AtLeastOneError {
  type: 'atLeastOne'
  key: string
  inputType: DMMF.InputType
  atLeastFields?: string[]
}

declare interface AtMostOneError {
  type: 'atMostOne'
  key: string
  inputType: DMMF.InputType
  providedKeys: string[]
}

export declare type BaseDMMF = Pick<DMMF.Document, 'datamodel' | 'mappings'>

declare interface BaseDMMFHelper
  extends DMMFDatamodelHelper,
    DMMFMappingsHelper {}

declare class BaseDMMFHelper {
  constructor(dmmf: BaseDMMF)
}

declare type BatchQueryEngineResult<T> = QueryEngineResult<T> | Error

declare type BatchTransactionOptions = {
  isolationLevel?: Transaction.IsolationLevel
}

declare interface BinaryTargetsEnvValue {
  fromEnvVar: null | string
  value: string
}

declare interface CallSite {
  getLocation(): LocationInFile | null
}

declare type Cast<A, W> = A extends W ? A : W

declare type Client = ReturnType<
  typeof getPrismaClient
> extends new () => infer T
  ? T
  : never

declare type ClientArg = {
  [MethodName in string]: Function
}

declare type ClientArgs = {
  client: ClientArg
}

declare enum ClientEngineType {
  Library = 'library',
  Binary = 'binary',
}

declare type Compute<T> = T extends Function
  ? T
  : {
      [K in keyof T]: T[K]
    } & unknown

declare type ComputedField = {
  name: string
  needs: string[]
  compute: ResultArgsFieldCompute
}

declare type ComputedFieldsMap = {
  [fieldName: string]: ComputedField
}

declare type ConnectorType =
  | 'mysql'
  | 'mongodb'
  | 'sqlite'
  | 'postgresql'
  | 'sqlserver'
  | 'jdbc:sqlserver'
  | 'cockroachdb'

declare interface Context {
  /**
   * Get a value from the context.
   *
   * @param key key which identifies a context value
   */
  getValue(key: symbol): unknown
  /**
   * Create a new context which inherits from this context and has
   * the given key set to the given value.
   *
   * @param key context key for which to set the value
   * @param value value to set for the given key
   */
  setValue(key: symbol, value: unknown): Context
  /**
   * Return a new context which inherits from this context but does
   * not contain a value for the given key.
   *
   * @param key context key for which to clear a value
   */
  deleteValue(key: symbol): Context
}

declare type Context_2<T> = T extends {
  [K: symbol]: {
    ctx: infer C
  }
}
  ? C & {
      [K in Exclude<keyof T, keyof C> & string]: T[K]
    } & ContextMeta
  : T & ContextMeta

declare type ContextMeta = {
  name: string
}

declare type Count<O> = {
  [K in keyof O]: Count<number>
} & {}

declare type CreateMessageOptions = {
  action: Action
  modelName?: string
  args?: JsArgs
  extensions: MergedExtensionsList
  clientMethod: string
  callsite?: CallSite
}

declare class DataLoader<T = unknown> {
  private options
  batches: {
    [key: string]: Job[]
  }
  private tickActive
  constructor(options: DataLoaderOptions<T>)
  request(request: T): Promise<any>
  private dispatchBatches
  get [Symbol.toStringTag](): string
}

declare type DataLoaderOptions<T> = {
  singleLoader: (request: T) => Promise<any>
  batchLoader: (request: T[]) => Promise<any[]>
  batchBy: (request: T) => string | undefined
}

declare type Datasource = {
  url?: string
}

declare interface DatasourceOverwrite {
  name: string
  url?: string
  env?: string
}

declare type Datasources = {
  [name in string]: Datasource
}

declare class DbNull extends NullTypesEnumValue {}

export declare interface Debug {
  (namespace: string): Debugger
  disable: () => string
  enable: (namespace: string) => void
  enabled: (namespace: string) => boolean
  log: (...args: any[]) => any
  formatters: Record<string, ((value: any) => string) | undefined>
}

declare interface Debugger {
  (format: any, ...args: any[]): void
  log: (...args: any[]) => any
  extend: (namespace: string, delimiter?: string) => Debugger
  color: string | number
  enabled: boolean
  namespace: string
}

export declare namespace Decimal {
  export type Constructor = typeof Decimal
  export type Instance = Decimal
  export type Rounding = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  export type Modulo = Rounding | 9
  export type Value = string | number | Decimal

  // http://mikemcl.github.io/decimal.js/#constructor-properties
  export interface Config {
    precision?: number
    rounding?: Rounding
    toExpNeg?: number
    toExpPos?: number
    minE?: number
    maxE?: number
    crypto?: boolean
    modulo?: Modulo
    defaults?: boolean
  }
}

export declare class Decimal {
  readonly d: number[]
  readonly e: number
  readonly s: number

  constructor(n: Decimal.Value)

  absoluteValue(): Decimal
  abs(): Decimal

  ceil(): Decimal

  clampedTo(min: Decimal.Value, max: Decimal.Value): Decimal
  clamp(min: Decimal.Value, max: Decimal.Value): Decimal

  comparedTo(n: Decimal.Value): number
  cmp(n: Decimal.Value): number

  cosine(): Decimal
  cos(): Decimal

  cubeRoot(): Decimal
  cbrt(): Decimal

  decimalPlaces(): number
  dp(): number

  dividedBy(n: Decimal.Value): Decimal
  div(n: Decimal.Value): Decimal

  dividedToIntegerBy(n: Decimal.Value): Decimal
  divToInt(n: Decimal.Value): Decimal

  equals(n: Decimal.Value): boolean
  eq(n: Decimal.Value): boolean

  floor(): Decimal

  greaterThan(n: Decimal.Value): boolean
  gt(n: Decimal.Value): boolean

  greaterThanOrEqualTo(n: Decimal.Value): boolean
  gte(n: Decimal.Value): boolean

  hyperbolicCosine(): Decimal
  cosh(): Decimal

  hyperbolicSine(): Decimal
  sinh(): Decimal

  hyperbolicTangent(): Decimal
  tanh(): Decimal

  inverseCosine(): Decimal
  acos(): Decimal

  inverseHyperbolicCosine(): Decimal
  acosh(): Decimal

  inverseHyperbolicSine(): Decimal
  asinh(): Decimal

  inverseHyperbolicTangent(): Decimal
  atanh(): Decimal

  inverseSine(): Decimal
  asin(): Decimal

  inverseTangent(): Decimal
  atan(): Decimal

  isFinite(): boolean

  isInteger(): boolean
  isInt(): boolean

  isNaN(): boolean

  isNegative(): boolean
  isNeg(): boolean

  isPositive(): boolean
  isPos(): boolean

  isZero(): boolean

  lessThan(n: Decimal.Value): boolean
  lt(n: Decimal.Value): boolean

  lessThanOrEqualTo(n: Decimal.Value): boolean
  lte(n: Decimal.Value): boolean

  logarithm(n?: Decimal.Value): Decimal
  log(n?: Decimal.Value): Decimal

  minus(n: Decimal.Value): Decimal
  sub(n: Decimal.Value): Decimal

  modulo(n: Decimal.Value): Decimal
  mod(n: Decimal.Value): Decimal

  naturalExponential(): Decimal
  exp(): Decimal

  naturalLogarithm(): Decimal
  ln(): Decimal

  negated(): Decimal
  neg(): Decimal

  plus(n: Decimal.Value): Decimal
  add(n: Decimal.Value): Decimal

  precision(includeZeros?: boolean): number
  sd(includeZeros?: boolean): number

  round(): Decimal

  sine(): Decimal
  sin(): Decimal

  squareRoot(): Decimal
  sqrt(): Decimal

  tangent(): Decimal
  tan(): Decimal

  times(n: Decimal.Value): Decimal
  mul(n: Decimal.Value): Decimal

  toBinary(significantDigits?: number): string
  toBinary(significantDigits: number, rounding: Decimal.Rounding): string

  toDecimalPlaces(decimalPlaces?: number): Decimal
  toDecimalPlaces(decimalPlaces: number, rounding: Decimal.Rounding): Decimal
  toDP(decimalPlaces?: number): Decimal
  toDP(decimalPlaces: number, rounding: Decimal.Rounding): Decimal

  toExponential(decimalPlaces?: number): string
  toExponential(decimalPlaces: number, rounding: Decimal.Rounding): string

  toFixed(decimalPlaces?: number): string
  toFixed(decimalPlaces: number, rounding: Decimal.Rounding): string

  toFraction(max_denominator?: Decimal.Value): Decimal[]

  toHexadecimal(significantDigits?: number): string
  toHexadecimal(significantDigits: number, rounding: Decimal.Rounding): string
  toHex(significantDigits?: number): string
  toHex(significantDigits: number, rounding?: Decimal.Rounding): string

  toJSON(): string

  toNearest(n: Decimal.Value, rounding?: Decimal.Rounding): Decimal

  toNumber(): number

  toOctal(significantDigits?: number): string
  toOctal(significantDigits: number, rounding: Decimal.Rounding): string

  toPower(n: Decimal.Value): Decimal
  pow(n: Decimal.Value): Decimal

  toPrecision(significantDigits?: number): string
  toPrecision(significantDigits: number, rounding: Decimal.Rounding): string

  toSignificantDigits(significantDigits?: number): Decimal
  toSignificantDigits(
    significantDigits: number,
    rounding: Decimal.Rounding
  ): Decimal
  toSD(significantDigits?: number): Decimal
  toSD(significantDigits: number, rounding: Decimal.Rounding): Decimal

  toString(): string

  truncated(): Decimal
  trunc(): Decimal

  valueOf(): string

  static abs(n: Decimal.Value): Decimal
  static acos(n: Decimal.Value): Decimal
  static acosh(n: Decimal.Value): Decimal
  static add(x: Decimal.Value, y: Decimal.Value): Decimal
  static asin(n: Decimal.Value): Decimal
  static asinh(n: Decimal.Value): Decimal
  static atan(n: Decimal.Value): Decimal
  static atanh(n: Decimal.Value): Decimal
  static atan2(y: Decimal.Value, x: Decimal.Value): Decimal
  static cbrt(n: Decimal.Value): Decimal
  static ceil(n: Decimal.Value): Decimal
  static clamp(
    n: Decimal.Value,
    min: Decimal.Value,
    max: Decimal.Value
  ): Decimal
  static clone(object?: Decimal.Config): Decimal.Constructor
  static config(object: Decimal.Config): Decimal.Constructor
  static cos(n: Decimal.Value): Decimal
  static cosh(n: Decimal.Value): Decimal
  static div(x: Decimal.Value, y: Decimal.Value): Decimal
  static exp(n: Decimal.Value): Decimal
  static floor(n: Decimal.Value): Decimal
  static hypot(...n: Decimal.Value[]): Decimal
  static isDecimal(object: any): object is Decimal
  static ln(n: Decimal.Value): Decimal
  static log(n: Decimal.Value, base?: Decimal.Value): Decimal
  static log2(n: Decimal.Value): Decimal
  static log10(n: Decimal.Value): Decimal
  static max(...n: Decimal.Value[]): Decimal
  static min(...n: Decimal.Value[]): Decimal
  static mod(x: Decimal.Value, y: Decimal.Value): Decimal
  static mul(x: Decimal.Value, y: Decimal.Value): Decimal
  static noConflict(): Decimal.Constructor // Browser only
  static pow(base: Decimal.Value, exponent: Decimal.Value): Decimal
  static random(significantDigits?: number): Decimal
  static round(n: Decimal.Value): Decimal
  static set(object: Decimal.Config): Decimal.Constructor
  static sign(n: Decimal.Value): number
  static sin(n: Decimal.Value): Decimal
  static sinh(n: Decimal.Value): Decimal
  static sqrt(n: Decimal.Value): Decimal
  static sub(x: Decimal.Value, y: Decimal.Value): Decimal
  static sum(...n: Decimal.Value[]): Decimal
  static tan(n: Decimal.Value): Decimal
  static tanh(n: Decimal.Value): Decimal
  static trunc(n: Decimal.Value): Decimal

  static readonly default?: Decimal.Constructor
  static readonly Decimal?: Decimal.Constructor

  static readonly precision: number
  static readonly rounding: Decimal.Rounding
  static readonly toExpNeg: number
  static readonly toExpPos: number
  static readonly minE: number
  static readonly maxE: number
  static readonly crypto: boolean
  static readonly modulo: Decimal.Modulo

  static readonly ROUND_UP: 0
  static readonly ROUND_DOWN: 1
  static readonly ROUND_CEIL: 2
  static readonly ROUND_FLOOR: 3
  static readonly ROUND_HALF_UP: 4
  static readonly ROUND_HALF_DOWN: 5
  static readonly ROUND_HALF_EVEN: 6
  static readonly ROUND_HALF_CEIL: 7
  static readonly ROUND_HALF_FLOOR: 8
  static readonly EUCLID: 9
}

/**
 * Interface for any Decimal.js-like library
 * Allows us to accept Decimal.js from different
 * versions and some compatible alternatives
 */
export declare interface DecimalJsLike {
  d: number[]
  e: number
  s: number
  toFixed(): string
}

export declare const decompressFromBase64: any

declare type DefaultArgs = InternalArgs<{}, {}, {}, {}>

declare function defineExtension(
  ext: Args | ((client: Client) => Client)
): (client: Client) => Client

declare interface Dictionary<T> {
  [key: string]: T
}

declare type Dictionary_2<T> = {
  [key: string]: T
}

export declare namespace DMMF {
  export interface Document {
    datamodel: Datamodel
    schema: Schema
    mappings: Mappings
  }
  export interface Mappings {
    modelOperations: ModelMapping[]
    otherOperations: {
      read: string[]
      write: string[]
    }
  }
  export interface OtherOperationMappings {
    read: string[]
    write: string[]
  }
  export interface DatamodelEnum {
    name: string
    values: EnumValue[]
    dbName?: string | null
    documentation?: string
  }
  export interface SchemaEnum {
    name: string
    values: string[]
  }
  export interface EnumValue {
    name: string
    dbName: string | null
  }
  export interface Datamodel {
    models: Model[]
    enums: DatamodelEnum[]
    types: Model[]
  }
  export interface uniqueIndex {
    name: string
    fields: string[]
  }
  export interface PrimaryKey {
    name: string | null
    fields: string[]
  }
  export interface Model {
    name: string
    dbName: string | null
    fields: Field[]
    uniqueFields: string[][]
    uniqueIndexes: uniqueIndex[]
    documentation?: string
    primaryKey: PrimaryKey | null
    [key: string]: any
  }
  export type FieldKind = 'scalar' | 'object' | 'enum' | 'unsupported'
  export type FieldNamespace = 'model' | 'prisma'
  export type FieldLocation =
    | 'scalar'
    | 'inputObjectTypes'
    | 'outputObjectTypes'
    | 'enumTypes'
    | 'fieldRefTypes'
  export interface Field {
    kind: FieldKind
    name: string
    isRequired: boolean
    isList: boolean
    isUnique: boolean
    isId: boolean
    isReadOnly: boolean
    isGenerated?: boolean
    isUpdatedAt?: boolean
    /**
     * Describes the data type in the same the way is is defined in the Prisma schema:
     * BigInt, Boolean, Bytes, DateTime, Decimal, Float, Int, JSON, String, $ModelName
     */
    type: string
    dbNames?: string[] | null
    hasDefaultValue: boolean
    default?: FieldDefault | FieldDefaultScalar | FieldDefaultScalar[]
    relationFromFields?: string[]
    relationToFields?: any[]
    relationOnDelete?: string
    relationName?: string
    documentation?: string
    [key: string]: any
  }
  export interface FieldDefault {
    name: string
    args: any[]
  }
  export type FieldDefaultScalar = string | boolean | number
  export interface Schema {
    rootQueryType?: string
    rootMutationType?: string
    inputObjectTypes: {
      model?: InputType[]
      prisma: InputType[]
    }
    outputObjectTypes: {
      model: OutputType[]
      prisma: OutputType[]
    }
    enumTypes: {
      model?: SchemaEnum[]
      prisma: SchemaEnum[]
    }
    fieldRefTypes: {
      prisma?: FieldRefType[]
    }
  }
  export interface Query {
    name: string
    args: SchemaArg[]
    output: QueryOutput
  }
  export interface QueryOutput {
    name: string
    isRequired: boolean
    isList: boolean
  }
  export type ArgType = string | InputType | SchemaEnum
  export interface SchemaArgInputType {
    isList: boolean
    type: ArgType
    location: FieldLocation
    namespace?: FieldNamespace
  }
  export interface SchemaArg {
    name: string
    comment?: string
    isNullable: boolean
    isRequired: boolean
    inputTypes: SchemaArgInputType[]
    deprecation?: Deprecation
  }
  export interface OutputType {
    name: string
    fields: SchemaField[]
    fieldMap?: Record<string, SchemaField>
  }
  export interface SchemaField {
    name: string
    isNullable?: boolean
    outputType: OutputTypeRef
    args: SchemaArg[]
    deprecation?: Deprecation
    documentation?: string
  }
  export type TypeRefCommon = {
    isList: boolean
    namespace?: FieldNamespace
  }
  export type TypeRefScalar = TypeRefCommon & {
    location: 'scalar'
    type: string
  }
  export type TypeRefOutputObject = TypeRefCommon & {
    location: 'outputObjectTypes'
    type: OutputType | string
  }
  export type TypeRefEnum = TypeRefCommon & {
    location: 'enumTypes'
    type: SchemaEnum | string
  }
  export type OutputTypeRef = TypeRefScalar | TypeRefOutputObject | TypeRefEnum
  export interface Deprecation {
    sinceVersion: string
    reason: string
    plannedRemovalVersion?: string
  }
  export interface InputType {
    name: string
    constraints: {
      maxNumFields: number | null
      minNumFields: number | null
      fields?: string[]
    }
    meta?: {
      source?: string
    }
    fields: SchemaArg[]
    fieldMap?: Record<string, SchemaArg>
  }
  export interface FieldRefType {
    name: string
    allowTypes: FieldRefAllowType[]
    fields: SchemaArg[]
  }
  export type FieldRefAllowType = TypeRefScalar | TypeRefEnum
  export interface ModelMapping {
    model: string
    plural: string
    findUnique?: string | null
    findUniqueOrThrow?: string | null
    findFirst?: string | null
    findFirstOrThrow?: string | null
    findMany?: string | null
    create?: string | null
    createMany?: string | null
    update?: string | null
    updateMany?: string | null
    upsert?: string | null
    delete?: string | null
    deleteMany?: string | null
    aggregate?: string | null
    groupBy?: string | null
    count?: string | null
    findRaw?: string | null
    aggregateRaw?: string | null
  }
  export enum ModelAction {
    findUnique = 'findUnique',
    findUniqueOrThrow = 'findUniqueOrThrow',
    findFirst = 'findFirst',
    findFirstOrThrow = 'findFirstOrThrow',
    findMany = 'findMany',
    create = 'create',
    createMany = 'createMany',
    update = 'update',
    updateMany = 'updateMany',
    upsert = 'upsert',
    delete = 'delete',
    deleteMany = 'deleteMany',
    groupBy = 'groupBy',
    count = 'count',
    aggregate = 'aggregate',
    findRaw = 'findRaw',
    aggregateRaw = 'aggregateRaw',
  }
}

export declare interface DMMFClass extends BaseDMMFHelper, DMMFSchemaHelper {}

export declare class DMMFClass {
  constructor(dmmf: DMMF.Document)
}

declare class DMMFDatamodelHelper implements Pick<DMMF.Document, 'datamodel'> {
  datamodel: DMMF.Datamodel
  datamodelEnumMap: Dictionary<DMMF.DatamodelEnum>
  modelMap: Dictionary<DMMF.Model>
  typeMap: Dictionary<DMMF.Model>
  typeAndModelMap: Dictionary<DMMF.Model>
  constructor({ datamodel }: Pick<DMMF.Document, 'datamodel'>)
  getDatamodelEnumMap(): Dictionary<DMMF.DatamodelEnum>
  getModelMap(): Dictionary<DMMF.Model>
  getTypeMap(): Dictionary<DMMF.Model>
  getTypeModelMap(): Dictionary<DMMF.Model>
}

declare class DMMFMappingsHelper implements Pick<DMMF.Document, 'mappings'> {
  mappings: DMMF.Mappings
  mappingsMap: Dictionary<DMMF.ModelMapping>
  constructor({ mappings }: Pick<DMMF.Document, 'mappings'>)
  getMappingsMap(): Dictionary<DMMF.ModelMapping>
  getOtherOperationNames(): string[]
}

declare class DMMFSchemaHelper implements Pick<DMMF.Document, 'schema'> {
  schema: DMMF.Schema
  queryType: DMMF.OutputType
  mutationType: DMMF.OutputType
  outputTypes: {
    model: DMMF.OutputType[]
    prisma: DMMF.OutputType[]
  }
  outputTypeMap: Dictionary<DMMF.OutputType>
  inputObjectTypes: {
    model?: DMMF.InputType[]
    prisma: DMMF.InputType[]
  }
  inputTypeMap: Dictionary<DMMF.InputType>
  enumMap: Dictionary<DMMF.SchemaEnum>
  rootFieldMap: Dictionary<DMMF.SchemaField>
  constructor({ schema }: Pick<DMMF.Document, 'schema'>)
  get [Symbol.toStringTag](): string
  outputTypeToMergedOutputType: (outputType: DMMF.OutputType) => DMMF.OutputType
  resolveOutputTypes(): void
  resolveInputTypes(): void
  resolveFieldArgumentTypes(): void
  getQueryType(): DMMF.OutputType
  getMutationType(): DMMF.OutputType
  getOutputTypes(): {
    model: DMMF.OutputType[]
    prisma: DMMF.OutputType[]
  }
  getEnumMap(): Dictionary<DMMF.SchemaEnum>
  hasEnumInNamespace(enumName: string, namespace: 'prisma' | 'model'): boolean
  getMergedOutputTypeMap(): Dictionary<DMMF.OutputType>
  getInputTypeMap(): Dictionary<DMMF.InputType>
  getRootFieldMap(): Dictionary<DMMF.SchemaField>
}

declare class Document_2 {
  readonly type: 'query' | 'mutation'
  readonly children: Field[]
  constructor(type: 'query' | 'mutation', children: Field[])
  get [Symbol.toStringTag](): string
  toString(): string
  validate(
    select?: any,
    isTopLevelQuery?: boolean,
    originalMethod?: string,
    errorFormat?: 'pretty' | 'minimal' | 'colorless',
    validationCallsite?: any
  ): void
  protected printFieldError: (
    { error }: FieldError,
    missingItems: MissingItem[],
    minimal: boolean
  ) => string | undefined
  protected printArgError: (
    { error, path, id }: ArgError,
    hasMissingItems: boolean,
    minimal: boolean
  ) => string | undefined
  /**
   * As we're allowing both single objects and array of objects for list inputs, we need to remove incorrect
   * zero indexes from the path
   * @param inputPath e.g. ['where', 'AND', 0, 'id']
   * @param select select object
   */
  private normalizePath
}

declare interface DocumentInput {
  dmmf: DMMFClass
  rootTypeName: 'query' | 'mutation'
  rootField: string
  select?: any
  modelName?: string
  extensions: MergedExtensionsList
}

/**
 * Placeholder value for "no text".
 */
export declare const empty: Sql

declare interface EmptyIncludeError {
  type: 'emptyInclude'
  field: DMMF.SchemaField
}

declare interface EmptySelectError {
  type: 'emptySelect'
  field: DMMF.SchemaField
}

declare type EmptyToUnknown<T> = T

export declare abstract class Engine<InteractiveTransactionPayload = unknown> {
  abstract on(event: EngineEventType, listener: (args?: any) => any): void
  abstract start(): Promise<void>
  abstract stop(): Promise<void>
  abstract getDmmf(): Promise<DMMF.Document>
  abstract version(forceRun?: boolean): Promise<string> | string
  abstract request<T>(
    query: EngineQuery,
    options: RequestOptions<InteractiveTransactionPayload>
  ): Promise<QueryEngineResult<T>>
  abstract requestBatch<T>(
    queries: EngineBatchQueries,
    options: RequestBatchOptions<InteractiveTransactionPayload>
  ): Promise<BatchQueryEngineResult<T>[]>
  abstract transaction(
    action: 'start',
    headers: Transaction.TransactionHeaders,
    options?: Transaction.Options
  ): Promise<Transaction.InteractiveTransactionInfo<unknown>>
  abstract transaction(
    action: 'commit',
    headers: Transaction.TransactionHeaders,
    info: Transaction.InteractiveTransactionInfo<unknown>
  ): Promise<void>
  abstract transaction(
    action: 'rollback',
    headers: Transaction.TransactionHeaders,
    info: Transaction.InteractiveTransactionInfo<unknown>
  ): Promise<void>
  abstract metrics(options: MetricsOptionsJson): Promise<Metrics>
  abstract metrics(options: MetricsOptionsPrometheus): Promise<string>
}

declare type EngineBatchQueries = GraphQLQuery[] | JsonQuery[]

declare interface EngineConfig {
  cwd: string
  dirname?: string
  datamodelPath: string
  enableDebugLogs?: boolean
  allowTriggerPanic?: boolean
  prismaPath?: string
  generator?: GeneratorConfig
  datasources?: DatasourceOverwrite[]
  showColors?: boolean
  logQueries?: boolean
  logLevel?: 'info' | 'warn'
  env: Record<string, string>
  flags?: string[]
  clientVersion?: string
  previewFeatures?: string[]
  engineEndpoint?: string
  activeProvider?: string
  logEmitter: EventEmitter
  engineProtocol: EngineProtocol
  /**
   * The contents of the schema encoded into a string
   * @remarks only used for the purpose of data proxy
   */
  inlineSchema?: string
  /**
   * The contents of the datasource url saved in a string
   * @remarks only used for the purpose of data proxy
   */
  inlineDatasources?: Record<string, InlineDatasource>
  /**
   * The string hash that was produced for a given schema
   * @remarks only used for the purpose of data proxy
   */
  inlineSchemaHash?: string
  /**
   * The configuration object for enabling tracing
   * @remarks enabling is determined by the client
   */
  tracingConfig: TracingConfig
}

declare type EngineEventType =
  | 'query'
  | 'info'
  | 'warn'
  | 'error'
  | 'beforeExit'

declare type EngineProtocol = 'graphql' | 'json'

declare type EngineQuery = GraphQLQuery | JsonQuery

declare interface EnvValue {
  fromEnvVar: null | string
  value: null | string
}

declare interface EnvValue_2 {
  fromEnvVar: string | null
  value: string | null
}

declare type ErrorFormat = 'pretty' | 'colorless' | 'minimal'

declare interface ErrorWithBatchIndex {
  batchRequestIdx?: number
}

declare interface EventEmitter {
  on(event: string, listener: (...args: any[]) => void): unknown
  emit(event: string, args?: any): boolean
}

declare type Exact<A, W> =
  | (W extends A
      ? {
          [K in keyof W]: K extends keyof A ? Exact<A[K], W[K]> : never
        }
      : W)
  | (A extends Narrowable ? A : never)

declare namespace Extensions {
  export { defineExtension, getExtensionContext }
}
export { Extensions }

declare namespace Extensions_2 {
  export {
    InternalArgs,
    Args_3 as Args,
    DefaultArgs,
    GetResult,
    GetSelect,
    GetModel,
    GetClient,
    ReadonlySelector,
    RequiredArgs as UserArgs,
  }
}

declare type Fetch = typeof nodeFetch

declare class Field {
  readonly name: string
  readonly args?: Args_2
  readonly children?: Field[]
  readonly error?: InvalidFieldError
  readonly hasInvalidChild: boolean
  readonly hasInvalidArg: boolean
  readonly schemaField?: DMMF.SchemaField
  constructor({ name, args, children, error, schemaField }: FieldArgs)
  get [Symbol.toStringTag](): string
  toString(): string
  collectErrors(prefix?: string): {
    fieldErrors: FieldError[]
    argErrors: ArgError[]
  }
}

declare interface FieldArgs {
  name: string
  schemaField?: DMMF.SchemaField
  args?: Args_2
  children?: Field[]
  error?: InvalidFieldError
}

declare interface FieldError {
  path: string[]
  error: InvalidFieldError
}

/**
 * A reference to a specific field of a specific model
 */
export declare interface FieldRef<Model, FieldType> {
  readonly modelName: Model
  readonly name: string
  readonly typeName: FieldType
  readonly isList: boolean
}

/**
 * Find paths that match a set of regexes
 * @param root to start from
 * @param match to match against
 * @param types to select files, folders, links
 * @param deep to recurse in the directory tree
 * @param limit to limit the results
 * @param handler to further filter results
 * @param found to add to already found
 * @param seen to add to already seen
 * @returns found paths (symlinks preserved)
 */
export declare function findSync(
  root: string,
  match: (RegExp | string)[],
  types?: ('f' | 'd' | 'l')[],
  deep?: ('d' | 'l')[],
  limit?: number,
  handler?: Handler,
  found?: string[],
  seen?: Record<string, true>
): string[]

declare interface GeneratorConfig {
  name: string
  output: EnvValue | null
  isCustomOutput?: boolean
  provider: EnvValue
  config: Dictionary_2<string>
  binaryTargets: BinaryTargetsEnvValue[]
  previewFeatures: string[]
}

declare type GetAggregateResult<P, A> = {
  [K in keyof A as K extends Aggregate ? K : never]: K extends '_count'
    ? A[K] extends true
      ? number
      : Count<A[K]>
    : Count<A[K]>
}

declare type GetBatchResult<P, A> = {
  count: number
}

declare type GetClient<
  Base extends Record<any, any>,
  C extends Args_3['client']
> = Omit<Base, keyof C | '$use'> & {
  [K in keyof C]: ReturnType<C[K]>
}

declare type GetCountResult<P, A> = A extends {
  select: infer S
}
  ? S extends true
    ? number
    : Count<S>
  : number

declare function getExtensionContext<T>(that: T): Context_2<T>

declare type GetFindResult<P extends Payload, A> = A extends
  | ({
      select: infer S
    } & Record<string, unknown>)
  | ({
      include: infer S
    } & Record<string, unknown>)
  ? {
      [K in keyof S as S[K] extends false | undefined | null
        ? never
        : K]: S[K] extends true
        ? P extends {
            objects: {
              [k in K]: (infer O)[]
            }
          }
          ? O extends Payload
            ? O['scalars'][]
            : never
          : P extends {
              objects: {
                [k in K]: infer O | null
              }
            }
          ? O extends Payload
            ? O['scalars'] | (P['objects'][K] & null)
            : never
          : P extends {
              scalars: {
                [k in K]: infer O
              }
            }
          ? O
          : K extends '_count'
          ? Count<P['objects']>
          : never
        : P extends {
            objects: {
              [k in K]: (infer O)[]
            }
          }
        ? O extends Payload
          ? GetFindResult<O, S[K]>[]
          : never
        : P extends {
            objects: {
              [k in K]: infer O | null
            }
          }
        ? O extends Payload
          ? GetFindResult<O, S[K]> | (P['objects'][K] & null)
          : never
        : K extends '_count'
        ? Count<GetFindResult<P, S[K]>>
        : never
    } & (A extends {
      include: any
    } & Record<string, unknown>
      ? P['scalars']
      : unknown)
  : P['scalars']

declare type GetGroupByResult<P, A> = P extends Payload
  ? A extends {
      by: string[]
    }
    ? Array<
        GetAggregateResult<P, A> & {
          [K in A['by'][number]]: P['scalars'][K]
        }
      >
    : never
  : never

declare type GetModel<
  Base extends Record<any, any>,
  M extends Args_3['model'][string]
> = {
  [K in keyof M | keyof Base]: K extends keyof M ? ReturnType<M[K]> : Base[K]
}

export declare function getPrismaClient(config: GetPrismaClientConfig): {
  new (optionsArg?: PrismaClientOptions): {
    _baseDmmf: BaseDMMFHelper
    _dmmf?: DMMFClass | undefined
    _engine: Engine
    _fetcher: RequestHandler
    _connectionPromise?: Promise<any> | undefined
    _disconnectionPromise?: Promise<any> | undefined
    _engineConfig: EngineConfig
    _clientVersion: string
    _errorFormat: ErrorFormat
    _clientEngineType: ClientEngineType
    _tracingConfig: TracingConfig
    _metrics: MetricsClient
    _middlewares: MiddlewareHandler<QueryMiddleware>
    _previewFeatures: string[]
    _activeProvider: string
    _rejectOnNotFound?: InstanceRejectOnNotFound
    _dataProxy: boolean
    _extensions: MergedExtensionsList
    getEngine(): Engine
    /**
     * Hook a middleware into the client
     * @param middleware to hook
     */
    $use<T>(middleware: QueryMiddleware): void
    $on(eventType: EngineEventType, callback: (event: any) => void): void
    $connect(): Promise<void>
    /**
     * @private
     */
    _runDisconnect(): Promise<void>
    /**
     * Disconnect from the database
     */
    $disconnect(): Promise<void>
    /**
     * Executes a raw query and always returns a number
     */
    $executeRawInternal(
      transaction: PrismaPromiseTransaction | undefined,
      clientMethod: string,
      args: RawQueryArgs
    ): Promise<number>
    /**
     * Executes a raw query provided through a safe tag function
     * @see https://github.com/prisma/prisma/issues/7142
     *
     * @param query
     * @param values
     * @returns
     */
    $executeRaw(
      query: TemplateStringsArray | Sql,
      ...values: any[]
    ): PrismaPromise<unknown>
    /**
     * Unsafe counterpart of `$executeRaw` that is susceptible to SQL injections
     * @see https://github.com/prisma/prisma/issues/7142
     *
     * @param query
     * @param values
     * @returns
     */
    $executeRawUnsafe(
      query: string,
      ...values: RawValue[]
    ): PrismaPromise<unknown>
    /**
     * Executes a raw command only for MongoDB
     *
     * @param command
     * @returns
     */
    $runCommandRaw(command: object): PrismaPromise<unknown>
    /**
     * Executes a raw query and returns selected data
     */
    $queryRawInternal(
      transaction: PrismaPromiseTransaction | undefined,
      clientMethod: string,
      args: RawQueryArgs
    ): Promise<unknown[]>
    /**
     * Executes a raw query provided through a safe tag function
     * @see https://github.com/prisma/prisma/issues/7142
     *
     * @param query
     * @param values
     * @returns
     */
    $queryRaw(
      query: TemplateStringsArray | Sql,
      ...values: any[]
    ): PrismaPromise<unknown>
    /**
     * Unsafe counterpart of `$queryRaw` that is susceptible to SQL injections
     * @see https://github.com/prisma/prisma/issues/7142
     *
     * @param query
     * @param values
     * @returns
     */
    $queryRawUnsafe(
      query: string,
      ...values: RawValue[]
    ): PrismaPromise<unknown>
    /**
     * Execute a batch of requests in a transaction
     * @param requests
     * @param options
     */
    _transactionWithArray({
      promises,
      options,
    }: {
      promises: Array<PrismaPromise<any>>
      options?: BatchTransactionOptions | undefined
    }): Promise<any>
    /**
     * Perform a long-running transaction
     * @param callback
     * @param options
     * @returns
     */
    _transactionWithCallback({
      callback,
      options,
    }: {
      callback: (client: Client) => Promise<unknown>
      options?: Options | undefined
    }): Promise<unknown>
    /**
     * Execute queries within a transaction
     * @param input a callback or a query list
     * @param options to set timeouts (callback)
     * @returns
     */
    $transaction(input: any, options?: any): Promise<any>
    /**
     * Runs the middlewares over params before executing a request
     * @param internalParams
     * @returns
     */
    _request(internalParams: InternalRequestParams): Promise<any>
    _executeRequest({
      args,
      clientMethod,
      dataPath,
      callsite,
      action,
      model,
      argsMapper,
      transaction,
      unpacker,
      otelParentCtx,
      customDataProxyFetch,
    }: InternalRequestParams): Promise<any>
    _getDmmf: (
      params: Pick<InternalRequestParams, 'callsite' | 'clientMethod'>
    ) => Promise<DMMFClass>
    _getProtocolEncoder: (
      params: Pick<InternalRequestParams, 'callsite' | 'clientMethod'>
    ) => Promise<ProtocolEncoder<EngineQuery>>
    readonly $metrics: MetricsClient
    /**
     * Shortcut for checking a preview flag
     * @param feature preview flag
     * @returns
     */
    _hasPreviewFlag(feature: string): boolean
    $extends: typeof $extends
    readonly [Symbol.toStringTag]: string
  }
}

/**
 * Config that is stored into the generated client. When the generated client is
 * loaded, this same config is passed to {@link getPrismaClient} which creates a
 * closure with that config around a non-instantiated [[PrismaClient]].
 */
declare interface GetPrismaClientConfig {
  document: Omit<DMMF.Document, 'schema'>
  generator?: GeneratorConfig
  sqliteDatasourceOverrides?: DatasourceOverwrite[]
  relativeEnvPaths: {
    rootEnvPath?: string | null
    schemaEnvPath?: string | null
  }
  relativePath: string
  dirname: string
  filename?: string
  clientVersion?: string
  engineVersion?: string
  datasourceNames: string[]
  activeProvider: string
  /**
   * True when `--data-proxy` is passed to `prisma generate`
   * If enabled, we disregard the generator config engineType.
   * It means that `--data-proxy` binds you to the Data Proxy.
   */
  dataProxy: boolean
  /**
   * The contents of the schema encoded into a string
   * @remarks only used for the purpose of data proxy
   */
  inlineSchema?: string
  /**
   * A special env object just for the data proxy edge runtime.
   * Allows bundlers to inject their own env variables (Vercel).
   * Allows platforms to declare global variables as env (Workers).
   * @remarks only used for the purpose of data proxy
   */
  injectableEdgeEnv?: LoadedEnv
  /**
   * Engine protocol to use within edge runtime. Passed
   * through config because edge client can not read env variables
   * @remarks only used for the purpose of data proxy
   */
  edgeClientProtocol?: QueryEngineProtocol
  /**
   * The contents of the datasource url saved in a string.
   * This can either be an env var name or connection string.
   * It is needed by the client to connect to the Data Proxy.
   * @remarks only used for the purpose of data proxy
   */
  inlineDatasources?: InlineDatasources
  /**
   * The string hash that was produced for a given schema
   * @remarks only used for the purpose of data proxy
   */
  inlineSchemaHash?: string
}

declare type GetResult<
  Base extends Record<any, any>,
  R extends Args_3['result'][string]
> = {
  [K in keyof R | keyof Base]: K extends keyof R
    ? ReturnType<ReturnType<R[K]>['compute']>
    : Base[K]
} & unknown

declare type GetResult_2<P extends Payload, A, O extends Operation> = {
  findUnique: GetFindResult<P, A>
  findUniqueOrThrow: GetFindResult<P, A>
  findFirst: GetFindResult<P, A>
  findFirstOrThrow: GetFindResult<P, A>
  findMany: GetFindResult<P, A>[]
  create: GetFindResult<P, A>
  createMany: GetBatchResult<P, A>
  update: GetFindResult<P, A>
  updateMany: GetBatchResult<P, A>
  upsert: GetFindResult<P, A>
  delete: GetFindResult<P, A>
  deleteMany: GetBatchResult<P, A>
  aggregate: GetAggregateResult<P, A>
  count: GetCountResult<P, A>
  groupBy: GetGroupByResult<P, A>
  $queryRaw: any
  $executeRaw: any
  $queryRawUnsafe: any
  $executeRawUnsafe: any
  $runCommandRaw: object
}[O]

declare type GetSelect<
  Base extends Record<any, any>,
  R extends Args_3['result'][string]
> = {
  [K in keyof R | keyof Base]?: K extends keyof R ? boolean : Base[K]
}

declare type GraphQLQuery = {
  query: string
  variables: object
}

declare type HandleErrorParams = {
  args: JsArgs
  error: any
  clientMethod: string
  callsite?: CallSite
  transaction?: PrismaPromiseTransaction
}

declare type Handler = (
  base: string,
  item: string,
  type: ItemType
) => boolean | string

declare type Headers_2 = Record<string, string | string[] | undefined>

declare interface IncludeAndSelectError {
  type: 'includeAndSelect'
  field: DMMF.SchemaField
}

declare type InlineDatasource = {
  url: NullableEnvValue
}

declare type InlineDatasources = {
  [name in InternalDatasource['name']]: {
    url: InternalDatasource['url']
  }
}

declare type InstanceRejectOnNotFound =
  | RejectOnNotFound
  | Record<string, RejectOnNotFound>
  | Record<string, Record<string, RejectOnNotFound>>

declare type InteractiveTransactionInfo<Payload = unknown> = {
  /**
   * Transaction ID returned by the query engine.
   */
  id: string
  /**
   * Arbitrary payload the meaning of which depends on the `Engine` implementation.
   * For example, `DataProxyEngine` needs to associate different API endpoints with transactions.
   * In `LibraryEngine` and `BinaryEngine` it is currently not used.
   */
  payload: Payload
}

declare type InteractiveTransactionOptions<Payload> =
  Transaction.InteractiveTransactionInfo<Payload>

declare type InternalArgs<
  R extends RequiredArgs['result'] = RequiredArgs['result'],
  M extends RequiredArgs['model'] = RequiredArgs['model'],
  Q extends RequiredArgs['query'] = RequiredArgs['query'],
  C extends RequiredArgs['client'] = RequiredArgs['client']
> = {
  result: {
    [K in keyof R]: {
      [P in keyof R[K]]: () => R[K][P]
    }
  }
  model: {
    [K in keyof M]: {
      [P in keyof M[K]]: () => M[K][P]
    }
  }
  query: {
    [K in keyof Q]: {
      [P in keyof Q[K]]: () => Q[K][P]
    }
  }
  client: {
    [K in keyof C]: () => C[K]
  }
}

declare interface InternalDatasource {
  name: string
  activeProvider: ConnectorType
  provider: ConnectorType
  url: EnvValue_2
  config: any
}

declare type InternalRequestParams = {
  /**
   * The original client method being called.
   * Even though the rootField / operation can be changed,
   * this method stays as it is, as it's what the user's
   * code looks like
   */
  clientMethod: string
  /**
   * Name of js model that triggered the request. Might be used
   * for warnings or error messages
   */
  jsModelName?: string
  callsite?: CallSite
  transaction?: PrismaPromiseTransaction
  unpacker?: Unpacker
  otelParentCtx?: Context
  /** Used to "desugar" a user input into an "expanded" one */
  argsMapper?: (args?: UserArgs) => UserArgs
  /** Used for Accelerate client extension via Data Proxy */
  customDataProxyFetch?: (fetch: Fetch) => Fetch
} & Omit<QueryMiddlewareParams, 'runInTransaction'>

declare type InvalidArgError =
  | InvalidArgNameError
  | MissingArgError
  | InvalidArgTypeError
  | AtLeastOneError
  | AtMostOneError
  | InvalidNullArgError

/**
 * This error occurs if the user provides an arg name that doesn't exist
 */
declare interface InvalidArgNameError {
  type: 'invalidName'
  providedName: string
  providedValue: any
  didYouMeanArg?: string
  didYouMeanField?: string
  originalType: DMMF.ArgType
  possibilities?: DMMF.SchemaArgInputType[]
  outputType?: DMMF.OutputType
}

/**
 * If the scalar type of an arg is not matching what is required
 */
declare interface InvalidArgTypeError {
  type: 'invalidType'
  argName: string
  requiredType: {
    bestFittingType: DMMF.SchemaArgInputType
    inputType: DMMF.SchemaArgInputType[]
  }
  providedValue: any
}

declare type InvalidFieldError =
  | InvalidFieldNameError
  | InvalidFieldTypeError
  | EmptySelectError
  | NoTrueSelectError
  | IncludeAndSelectError
  | EmptyIncludeError

declare interface InvalidFieldNameError {
  type: 'invalidFieldName'
  modelName: string
  didYouMean?: string | null
  providedName: string
  isInclude?: boolean
  isIncludeScalar?: boolean
  outputType: DMMF.OutputType
}

declare interface InvalidFieldTypeError {
  type: 'invalidFieldType'
  modelName: string
  fieldName: string
  providedValue: any
}

/**
 * If a user incorrectly provided null where she shouldn't have
 */
declare interface InvalidNullArgError {
  type: 'invalidNullArg'
  name: string
  invalidType: DMMF.SchemaArgInputType[]
  atLeastOne: boolean
  atMostOne: boolean
}

declare enum IsolationLevel {
  ReadUncommitted = 'ReadUncommitted',
  ReadCommitted = 'ReadCommitted',
  RepeatableRead = 'RepeatableRead',
  Snapshot = 'Snapshot',
  Serializable = 'Serializable',
}

declare type ItemType = 'd' | 'f' | 'l'

declare interface Job {
  resolve: (data: any) => void
  reject: (data: any) => void
  request: any
}

/**
 * Create a SQL query for a list of values.
 */
export declare function join(
  values: RawValue[],
  separator?: string,
  prefix?: string,
  suffix?: string
): Sql

declare type JsArgs = {
  select?: Selection_2
  include?: Selection_2
  [argName: string]: JsInputValue
}

declare type JsInputValue =
  | null
  | undefined
  | string
  | number
  | boolean
  | bigint
  | Uint8Array
  | Date
  | DecimalJsLike
  | ObjectEnumValue
  | RawParameters
  | FieldRef<string, unknown>
  | JsInputValue[]
  | {
      [key: string]: JsInputValue
    }

declare type JsonArgumentValue =
  | number
  | string
  | boolean
  | null
  | JsonTaggedValue
  | JsonArgumentValue[]
  | {
      [key: string]: JsonArgumentValue
    }

declare type JsonFieldSelection = {
  arguments?: Record<string, JsonArgumentValue>
  selection: JsonSelectionSet
}

declare class JsonNull extends NullTypesEnumValue {}

declare type JsonQuery = {
  modelName?: string
  action: JsonQueryAction
  query: JsonFieldSelection
}

declare type JsonQueryAction =
  | 'findUnique'
  | 'findUniqueOrThrow'
  | 'findFirst'
  | 'findFirstOrThrow'
  | 'findMany'
  | 'createOne'
  | 'createMany'
  | 'updateOne'
  | 'updateMany'
  | 'deleteOne'
  | 'deleteMany'
  | 'upsertOne'
  | 'aggregate'
  | 'groupBy'
  | 'executeRaw'
  | 'queryRaw'
  | 'runCommandRaw'
  | 'findRaw'
  | 'aggregateRaw'

declare type JsonSelectionSet = {
  $scalars?: boolean
  $composites?: boolean
} & {
  [fieldName: string]: boolean | JsonFieldSelection
}

declare type JsonTaggedValue = {
  $type: 'Json'
  value: string
}

declare type KnownErrorParams = {
  code: string
  clientVersion: string
  meta?: Record<string, unknown>
  batchRequestIdx?: number
}

declare type LegacyExact<A, W = unknown> = W extends unknown
  ? A extends LegacyNarrowable
    ? Cast<A, W>
    : Cast<
        {
          [K in keyof A]: K extends keyof W ? LegacyExact<A[K], W[K]> : never
        },
        {
          [K in keyof W]: K extends keyof A ? LegacyExact<A[K], W[K]> : W[K]
        }
      >
  : never

declare type LegacyNarrowable = string | number | boolean | bigint

declare type LoadedEnv =
  | {
      message?: string
      parsed: {
        [x: string]: string
      }
    }
  | undefined

declare type LocationInFile = {
  fileName: string
  lineNumber: number | null
  columnNumber: number | null
}

declare type LogDefinition = {
  level: LogLevel
  emit: 'stdout' | 'event'
}

declare type LogLevel = 'info' | 'query' | 'warn' | 'error'

export declare function makeDocument({
  dmmf,
  rootTypeName,
  rootField,
  select,
  modelName,
  extensions,
}: DocumentInput): Document_2

/**
 * Generates more strict variant of an enum which, unlike regular enum,
 * throws on non-existing property access. This can be useful in following situations:
 * - we have an API, that accepts both `undefined` and `SomeEnumType` as an input
 * - enum values are generated dynamically from DMMF.
 *
 * In that case, if using normal enums and no compile-time typechecking, using non-existing property
 * will result in `undefined` value being used, which will be accepted. Using strict enum
 * in this case will help to have a runtime exception, telling you that you are probably doing something wrong.
 *
 * Note: if you need to check for existence of a value in the enum you can still use either
 * `in` operator or `hasOwnProperty` function.
 *
 * @param definition
 * @returns
 */
export declare function makeStrictEnum<
  T extends Record<PropertyKey, string | number>
>(definition: T): T

/**
 * Class that holds the list of all extensions, applied to particular instance, as well
 * as resolved versions of the components that need to apply on different levels. Main idea
 * of this class: avoid re-resolving as much of the stuff as possible when new extensions are added while also
 * delaying the resolve until the point it is actually needed. For example, computed fields of the model won't be resolved unless
 * the model is actually queried. Neither adding extensions with `client` component only cause other components to
 * recompute.
 */
declare class MergedExtensionsList {
  private head?
  private constructor()
  static empty(): MergedExtensionsList
  static single(extension: Args): MergedExtensionsList
  isEmpty(): boolean
  append(extension: Args): MergedExtensionsList
  getAllComputedFields(dmmfModelName: string): ComputedFieldsMap | undefined
  getAllClientExtensions(): ClientArg | undefined
  getAllModelExtensions(dmmfModelName: string): ModelArg | undefined
  getAllQueryCallbacks(jsModelName: string, operation: string): any
}

export declare type Metric<T> = {
  key: string
  value: T
  labels: Record<string, string>
  description: string
}

export declare type MetricHistogram = {
  buckets: MetricHistogramBucket[]
  sum: number
  count: number
}

export declare type MetricHistogramBucket = [maxValue: number, count: number]

export declare type Metrics = {
  counters: Metric<number>[]
  gauges: Metric<number>[]
  histograms: Metric<MetricHistogram>[]
}

export declare class MetricsClient {
  private _engine
  constructor(engine: Engine)
  /**
   * Returns all metrics gathered up to this point in prometheus format.
   * Result of this call can be exposed directly to prometheus scraping endpoint
   *
   * @param options
   * @returns
   */
  prometheus(options?: MetricsOptions): Promise<string>
  /**
   * Returns all metrics gathered up to this point in prometheus format.
   *
   * @param options
   * @returns
   */
  json(options?: MetricsOptions): Promise<Metrics>
}

declare type MetricsOptions = {
  /**
   * Labels to add to every metrics in key-value format
   */
  globalLabels?: Record<string, string>
}

declare type MetricsOptionsCommon = {
  globalLabels?: Record<string, string>
}

declare type MetricsOptionsJson = {
  format: 'json'
} & MetricsOptionsCommon

declare type MetricsOptionsPrometheus = {
  format: 'prometheus'
} & MetricsOptionsCommon

declare class MiddlewareHandler<M extends Function> {
  private _middlewares
  use(middleware: M): void
  get(id: number): M | undefined
  has(id: number): boolean
  length(): number
}

/**
 * Opposite of InvalidArgNameError - if the user *doesn't* provide an arg that should be provided
 * This error both happens with an implicit and explicit `undefined`
 */
declare interface MissingArgError {
  type: 'missingArg'
  missingName: string
  missingArg: DMMF.SchemaArg
  atLeastOne: boolean
  atMostOne: boolean
}

declare interface MissingItem {
  path: string
  isRequired: boolean
  type: string | object
}

declare type ModelArg = {
  [MethodName in string]: Function
}

declare type ModelArgs = {
  model: {
    [ModelName in string]: ModelArg
  }
}

declare type NameArgs = {
  name?: string
}

declare type Narrow<A> =
  | {
      [K in keyof A]: A[K] extends Function ? A[K] : Narrow<A[K]>
    }
  | (A extends Narrowable ? A : never)

declare type Narrowable = string | number | bigint | boolean | []

declare type NeverToUnknown<T> = [T] extends [never] ? unknown : T

/**
 * Imitates `fetch` via `https` to only suit our needs, it does nothing more.
 * This is because we cannot bundle `node-fetch` as it uses many other Node.js
 * utilities, while also bloating our bundles. This approach is much leaner.
 * @param url
 * @param options
 * @returns
 */
declare function nodeFetch(
  url: string,
  options?: RequestOptions_2
): Promise<RequestResponse>

/**
 * @deprecated please don´t rely on type checks to this error anymore.
 * This will become a PrismaClientKnownRequestError with code P2025
 * in the future major version of the client
 */
export declare class NotFoundError extends PrismaClientKnownRequestError {
  constructor(message: string)
}

declare interface NoTrueSelectError {
  type: 'noTrueSelect'
  field: DMMF.SchemaField
}

declare type NullableEnvValue = {
  fromEnvVar: string | null
  value?: string | null
}

declare class NullTypesEnumValue extends ObjectEnumValue {
  _getNamespace(): string
}

/**
 * Base class for unique values of object-valued enums.
 */
declare abstract class ObjectEnumValue {
  constructor(arg?: symbol)
  abstract _getNamespace(): string
  _getName(): string
  toString(): string
}

export declare const objectEnumValues: {
  classes: {
    DbNull: typeof DbNull
    JsonNull: typeof JsonNull
    AnyNull: typeof AnyNull
  }
  instances: {
    DbNull: DbNull
    JsonNull: JsonNull
    AnyNull: AnyNull
  }
}

declare type Omit_2<T, K extends string | number | symbol> = {
  [P in keyof T as P extends K ? never : P]: T[P]
}

declare type Operation =
  | 'findFirst'
  | 'findFirstOrThrow'
  | 'findUnique'
  | 'findUniqueOrThrow'
  | 'findMany'
  | 'create'
  | 'createMany'
  | 'update'
  | 'updateMany'
  | 'upsert'
  | 'delete'
  | 'deleteMany'
  | 'aggregate'
  | 'count'
  | 'groupBy'
  | '$queryRaw'
  | '$executeRaw'
  | '$queryRawUnsafe'
  | '$executeRawUnsafe'
  | '$runCommandRaw'

declare type OptionalFlat<T> = {
  [K in keyof T]?: T[K]
}

/**
 * maxWait ?= 2000
 * timeout ?= 5000
 */
declare type Options = {
  maxWait?: number
  timeout?: number
  isolationLevel?: IsolationLevel
}

declare type PatchDeep<O1, O2, O = O1 & O2> = {
  [K in keyof O]: K extends keyof O1
    ? K extends keyof O2
      ? O1[K] extends object
        ? O2[K] extends object
          ? O1[K] extends Function
            ? O1[K]
            : O2[K] extends Function
            ? O1[K]
            : PatchDeep<O1[K], O2[K]>
          : O1[K]
        : O1[K]
      : O1[K]
    : O2[K & keyof O2]
}

declare type PatchFlat<O1, O2> = O1 & Omit_2<O2, keyof O1>

/**
 * Patches 3 objects on top of each other with minimal looping.
 * This is a more efficient way of doing `PatchFlat<A, PatchFlat<B, C>>`
 */
declare type PatchFlat3<A, B, C> = A & {
  [K in Exclude<keyof B | keyof C, keyof A>]: K extends keyof B
    ? B[K]
    : C[K & keyof C]
}

export declare type Payload = {
  scalars: {
    [ScalarName in string]: unknown
  }
  objects: {
    [ObjectName in string]: unknown
  }
}

declare type Payload_2<T, F extends Operation> = T extends {
  [K: symbol]: {
    types: {
      [K in F]: {
        payload: any
      }
    }
  }
}
  ? T[symbol]['types'][F]['payload']
  : never

declare type Pick_2<T, K extends string | number | symbol> = {
  [P in keyof T as P extends K ? P : never]: T[P]
}

export declare class PrismaClientInitializationError extends Error {
  clientVersion: string
  errorCode?: string
  constructor(message: string, clientVersion: string, errorCode?: string)
  get [Symbol.toStringTag](): string
}

export declare class PrismaClientKnownRequestError
  extends Error
  implements ErrorWithBatchIndex
{
  code: string
  meta?: Record<string, unknown>
  clientVersion: string
  batchRequestIdx?: number
  constructor(
    message: string,
    { code, clientVersion, meta, batchRequestIdx }: KnownErrorParams
  )
  get [Symbol.toStringTag](): string
}

export declare interface PrismaClientOptions {
  /**
   * Will throw an Error if findUnique returns null
   */
  rejectOnNotFound?: InstanceRejectOnNotFound
  /**
   * Overwrites the datasource url from your schema.prisma file
   */
  datasources?: Datasources
  /**
   * @default "colorless"
   */
  errorFormat?: ErrorFormat
  /**
   * @example
   * \`\`\`
   * // Defaults to stdout
   * log: ['query', 'info', 'warn']
   *
   * // Emit as events
   * log: [
   *  { emit: 'stdout', level: 'query' },
   *  { emit: 'stdout', level: 'info' },
   *  { emit: 'stdout', level: 'warn' }
   * ]
   * \`\`\`
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
   */
  log?: Array<LogLevel | LogDefinition>
  /**
   * @internal
   * You probably don't want to use this. \`__internal\` is used by internal tooling.
   */
  __internal?: {
    debug?: boolean
    engine?: {
      cwd?: string
      binaryPath?: string
      endpoint?: string
      allowTriggerPanic?: boolean
    }
  }
}

export declare class PrismaClientRustPanicError extends Error {
  clientVersion: string
  constructor(message: string, clientVersion: string)
  get [Symbol.toStringTag](): string
}

export declare class PrismaClientUnknownRequestError
  extends Error
  implements ErrorWithBatchIndex
{
  clientVersion: string
  batchRequestIdx?: number
  constructor(
    message: string,
    { clientVersion, batchRequestIdx }: UnknownErrorParams
  )
  get [Symbol.toStringTag](): string
}

export declare class PrismaClientValidationError extends Error {
  get [Symbol.toStringTag](): string
}

/**
 * Prisma's `Promise` that is backwards-compatible. All additions on top of the
 * original `Promise` are optional so that it can be backwards-compatible.
 * @see [[createPrismaPromise]]
 */
declare interface PrismaPromise<A> extends Promise<A> {
  /**
   * Extension of the original `.then` function
   * @param onfulfilled same as regular promises
   * @param onrejected same as regular promises
   * @param transaction transaction options
   */
  then<R1 = A, R2 = never>(
    onfulfilled?: (value: A) => R1 | PromiseLike<R1>,
    onrejected?: (error: unknown) => R2 | PromiseLike<R2>,
    transaction?: PrismaPromiseTransaction
  ): Promise<R1 | R2>
  /**
   * Extension of the original `.catch` function
   * @param onrejected same as regular promises
   * @param transaction transaction options
   */
  catch<R = never>(
    onrejected?: ((reason: any) => R | PromiseLike<R>) | undefined | null,
    transaction?: PrismaPromiseTransaction
  ): Promise<A | R>
  /**
   * Extension of the original `.finally` function
   * @param onfinally same as regular promises
   * @param transaction transaction options
   */
  finally(
    onfinally?: (() => void) | undefined | null,
    transaction?: PrismaPromiseTransaction
  ): Promise<A>
  /**
   * Called when executing a batch of regular tx
   * @param transaction transaction options for batch tx
   */
  requestTransaction?(
    transaction: PrismaPromiseBatchTransaction
  ): PromiseLike<unknown>
}

declare interface PrismaPromise_2<T> extends Promise<T> {
  [Symbol.toStringTag]: 'PrismaPromise'
}

declare type PrismaPromiseBatchTransaction = {
  kind: 'batch'
  id: number
  isolationLevel?: IsolationLevel
  index: number
  lock: PromiseLike<void>
}

declare type PrismaPromiseInteractiveTransaction<PayloadType = unknown> = {
  kind: 'itx'
  id: string
  payload: PayloadType
}

declare type PrismaPromiseTransaction<PayloadType = unknown> =
  | PrismaPromiseBatchTransaction
  | PrismaPromiseInteractiveTransaction<PayloadType>

declare interface ProtocolEncoder<
  EngineQueryType extends EngineQuery = EngineQuery
> {
  createMessage(options: CreateMessageOptions): ProtocolMessage<EngineQueryType>
  createBatch(messages: ProtocolMessage<EngineQueryType>[]): EngineBatchQueries
}

declare interface ProtocolMessage<
  EngineQueryType extends EngineQuery = EngineQuery
> {
  isWrite(): boolean
  getBatchId(): string | undefined
  toDebugString(): string
  toEngineQuery(): EngineQueryType
  deserializeResponse(data: unknown, dataPath: string[]): unknown
}

declare namespace Public {
  export {
    Args_4 as Args,
    Result,
    Payload_2 as Payload,
    PrismaPromise_2 as PrismaPromise,
    Operation,
    Exact,
  }
}

declare type QueryEngineProtocol = 'graphql' | 'json'

declare type QueryEngineResult<T> = {
  data: T
  elapsed: number
}

declare type QueryMiddleware = (
  params: QueryMiddlewareParams,
  next: (params: QueryMiddlewareParams) => Promise<unknown>
) => Promise<unknown>

declare type QueryMiddlewareParams = {
  /** The model this is executed on */
  model?: string
  /** The action that is being handled */
  action: Action
  /** TODO what is this */
  dataPath: string[]
  /** TODO what is this */
  runInTransaction: boolean
  args?: UserArgs
}

declare type QueryOptions = {
  query: {
    [ModelName in string]:
      | {
          [ModelAction in string]: QueryOptionsCb
        }
      | QueryOptionsCb
  }
}

declare type QueryOptionsCb = (args: QueryOptionsCbArgs) => Promise<any>

declare type QueryOptionsCbArgs = {
  model?: string
  operation: string
  args: object
  query: (args: object) => Promise<unknown>
}

/**
 * Create raw SQL statement.
 */
export declare function raw(value: string): Sql

declare type RawParameters = {
  __prismaRawParameters__: true
  values: string
}

declare type RawQueryArgs = [
  query: string | TemplateStringsArray | Sql,
  ...values: RawValue[]
]

/**
 * Supported value or SQL instance.
 */
export declare type RawValue = Value | Sql

declare type ReadonlyDeep<T> = {
  readonly [K in keyof T]: ReadonlyDeep<T[K]>
}

declare type ReadonlySelector<T> = T extends unknown
  ? {
      readonly [K in keyof T as K extends 'include' | 'select'
        ? K
        : never]: ReadonlyDeep<T[K]>
    } & {
      [K in keyof T as K extends 'include' | 'select' ? never : K]: T[K]
    }
  : never

declare type RejectOnNotFound = boolean | ((error: Error) => Error) | undefined

declare type Request_2 = {
  protocolMessage: ProtocolMessage
  protocolEncoder: ProtocolEncoder
  transaction?: PrismaPromiseTransaction
  otelParentCtx?: Context
  otelChildCtx?: Context
  tracingConfig?: TracingConfig
  customDataProxyFetch?: (fetch: Fetch) => Fetch
}

declare type RequestBatchOptions<InteractiveTransactionPayload> = {
  transaction?: TransactionOptions<InteractiveTransactionPayload>
  traceparent?: string
  numTry?: number
  containsWrite: boolean
  customDataProxyFetch?: (fetch: Fetch) => Fetch
}

declare class RequestHandler {
  client: Client
  dataloader: DataLoader<Request_2>
  private logEmitter?
  constructor(client: Client, logEmitter?: EventEmitter)
  request({
    protocolMessage,
    protocolEncoder,
    dataPath,
    callsite,
    modelName,
    rejectOnNotFound,
    clientMethod,
    args,
    transaction,
    unpacker,
    extensions,
    otelParentCtx,
    otelChildCtx,
    customDataProxyFetch,
  }: RequestParams): Promise<any>
  /**
   * Handles the error and logs it, logging the error is done synchronously waiting for the event
   * handlers to finish.
   */
  handleAndLogRequestError(params: HandleErrorParams): never
  handleRequestError({
    error,
    clientMethod,
    callsite,
    transaction,
    args,
  }: HandleErrorParams): never
  sanitizeMessage(message: any): any
  unpack(
    message: ProtocolMessage,
    data: unknown,
    dataPath: string[],
    unpacker?: Unpacker
  ): any
  applyResultExtensions({
    result,
    modelName,
    args,
    extensions,
  }: ApplyExtensionsParams): object
  get [Symbol.toStringTag](): string
}

declare type RequestOptions<InteractiveTransactionPayload> = {
  traceparent?: string
  numTry?: number
  interactiveTransaction?: InteractiveTransactionOptions<InteractiveTransactionPayload>
  isWrite: boolean
  customDataProxyFetch?: (fetch: Fetch) => Fetch
}

declare type RequestOptions_2 = {
  method?: string
  headers?: Record<string, string>
  body?: string
}

declare type RequestParams = {
  modelName?: string
  protocolMessage: ProtocolMessage
  protocolEncoder: ProtocolEncoder
  dataPath: string[]
  clientMethod: string
  callsite?: CallSite
  rejectOnNotFound?: RejectOnNotFound
  transaction?: PrismaPromiseTransaction
  extensions: MergedExtensionsList
  args?: any
  headers?: Record<string, string>
  unpacker?: Unpacker
  otelParentCtx?: Context
  otelChildCtx?: Context
  customDataProxyFetch?: (fetch: Fetch) => Fetch
}

declare type RequestResponse = {
  ok: boolean
  url: string
  statusText?: string
  status: number
  headers: Headers_2
  text: () => Promise<string>
  json: () => Promise<any>
}

declare type RequiredArgs = NameArgs &
  ResultArgs &
  ModelArgs &
  ClientArgs &
  QueryOptions

declare type Result<T, A, F extends Operation> = T extends {
  [K: symbol]: {
    types: {
      [K in F]: {
        payload: any
      }
    }
  }
}
  ? GetResult_2<T[symbol]['types'][F]['payload'], A, F>
  : never

declare type ResultArg = {
  [FieldName in string]: ResultFieldDefinition
}

declare type ResultArgs = {
  result: {
    [ModelName in string]: ResultArg
  }
}

declare type ResultArgsFieldCompute = (model: any) => unknown

declare type ResultFieldDefinition = {
  needs?: {
    [FieldName in string]: boolean
  }
  compute: ResultArgsFieldCompute
}

declare type Selection_2 = Record<string, boolean | JsArgs>

/**
 * A SQL instance can be nested within each other to build SQL strings.
 */
export declare class Sql {
  values: Value[]
  strings: string[]
  constructor(
    rawStrings: ReadonlyArray<string>,
    rawValues: ReadonlyArray<RawValue>
  )
  get text(): string
  get sql(): string
  inspect(): {
    text: string
    sql: string
    values: unknown[]
  }
}

/**
 * Create a SQL object from a template string.
 */
export declare function sqltag(
  strings: ReadonlyArray<string>,
  ...values: RawValue[]
): Sql

declare type TracingConfig = {
  enabled: boolean
  middleware: boolean
}

declare namespace Transaction {
  export {
    IsolationLevel,
    Options,
    InteractiveTransactionInfo,
    TransactionHeaders,
  }
}

declare type TransactionHeaders = {
  traceparent?: string
}

declare type TransactionOptions<InteractiveTransactionPayload> =
  | {
      kind: 'itx'
      options: InteractiveTransactionOptions<InteractiveTransactionPayload>
    }
  | {
      kind: 'batch'
      options: BatchTransactionOptions
    }

export declare function transformDocument(document: Document_2): Document_2

declare namespace Types {
  export {
    Extensions_2 as Extensions,
    Utils,
    Public,
    GetResult_2 as GetResult,
    GetFindResult,
    Payload,
  }
}
export { Types }

declare type UnknownErrorParams = {
  clientVersion: string
  batchRequestIdx?: number
}

/**
 * Unpacks the result of a data object and maps DateTime fields to instances of `Date` in-place
 * @param options: UnpackOptions
 */
export declare function unpack({ document, path, data }: UnpackOptions): any

declare type Unpacker = (data: any) => any

declare interface UnpackOptions {
  document: Document_2
  path: string[]
  data: any
}

/**
 * Input that flows from the user into the Client.
 */
declare type UserArgs = any

declare namespace Utils {
  export {
    EmptyToUnknown,
    NeverToUnknown,
    PatchFlat,
    PatchDeep,
    Omit_2 as Omit,
    Pick_2 as Pick,
    PatchFlat3,
    Compute,
    OptionalFlat,
    ReadonlyDeep,
    Narrow,
    Exact,
    Cast,
    LegacyExact,
    WrapPropsInFnDeep,
  }
}

/**
 * Values supported by SQL engine.
 */
export declare type Value = unknown

export declare function warnEnvConflicts(envPaths: any): void

declare type WrapPropsInFnDeep<T> = {
  [K in keyof T]: T[K] extends Function
    ? T[K]
    : T[K] extends object
    ? WrapPropsInFnDeep<T[K]>
    : () => T[K]
} & {}

export {}
