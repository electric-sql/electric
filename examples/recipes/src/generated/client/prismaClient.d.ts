
/**
 * Client
**/

import * as runtime from './runtime/index';
declare const prisma: unique symbol
export type PrismaPromise<A> = Promise<A> & {[prisma]: true}
type UnwrapPromise<P extends any> = P extends Promise<infer R> ? R : P
type UnwrapTuple<Tuple extends readonly unknown[]> = {
  [K in keyof Tuple]: K extends `${number}` ? Tuple[K] extends PrismaPromise<infer X> ? X : UnwrapPromise<Tuple[K]> : UnwrapPromise<Tuple[K]>
};


/**
 * Model Activity_events
 * 
 */
export type Activity_events = {
  /**
   * @zod.string.uuid()
   */
  id: string
  /**
   * @zod.string.uuid()
   */
  source_user_id: string
  /**
   * @zod.string.uuid()
   */
  target_user_id: string
  activity_type: string
  timestamp: Date
  message: string
  action: string | null
  read_at: Date | null
}

/**
 * Model Background_jobs
 * 
 */
export type Background_jobs = {
  /**
   * @zod.string.uuid()
   */
  id: string
  timestamp: Date
  payload: Prisma.JsonValue
  completed: boolean
  cancelled: boolean
  /**
   * @zod.custom.use(z.number().or(z.nan()))
   */
  progress: number
  result: Prisma.JsonValue | null
}

/**
 * Model Chat_room
 * 
 */
export type Chat_room = {
  /**
   * @zod.string.uuid()
   */
  id: string
  timestamp: Date
  username: string
  message: string
}

/**
 * Model Commerce_orders
 * 
 */
export type Commerce_orders = {
  /**
   * @zod.string.uuid()
   */
  order_id: string
  timestamp: Date
  /**
   * @zod.custom.use(z.number().or(z.nan()))
   */
  price_amount: number
  price_currency: string
  promo_code: string | null
  customer_full_name: string
  country: string
  product: string
}

/**
 * Model Logs
 * 
 */
export type Logs = {
  /**
   * @zod.string.uuid()
   */
  id: string
  /**
   * @zod.string.uuid()
   */
  source_id: string
  timestamp: Date
  content: string
}

/**
 * Model Monitoring
 * 
 */
export type Monitoring = {
  /**
   * @zod.string.uuid()
   */
  id: string
  timestamp: Date
  type: string
  /**
   * @zod.custom.use(z.number().or(z.nan()))
   */
  value: number
}

/**
 * Model Requests
 * 
 */
export type Requests = {
  /**
   * @zod.string.uuid()
   */
  id: string
  timestamp: Date
  path: string
  method: string
  data: Prisma.JsonValue | null
  processing: boolean
  cancelled: boolean
}

/**
 * Model Responses
 * 
 */
export type Responses = {
  /**
   * @zod.string.uuid()
   */
  id: string
  timestamp: Date
  /**
   * @zod.string.uuid()
   */
  request_id: string
  /**
   * @zod.number.int().gte(-2147483648).lte(2147483647)
   */
  status_code: number
  data: Prisma.JsonValue | null
}


/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Activity_events
 * const activity_events = await prisma.activity_events.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  T extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof T ? T['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<T['log']> : never : never,
  GlobalReject extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined = 'rejectOnNotFound' extends keyof T
    ? T['rejectOnNotFound']
    : false
      > {
    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Activity_events
   * const activity_events = await prisma.activity_events.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<T, Prisma.PrismaClientOptions>);
  $on<V extends (U | 'beforeExit')>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : V extends 'beforeExit' ? () => Promise<void> : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): Promise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): Promise<void>;

  /**
   * Add a middleware
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): PrismaPromise<T>;

  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<UnwrapTuple<P>>;

  $transaction<R>(fn: (prisma: Prisma.TransactionClient) => Promise<R>, options?: {maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel}): Promise<R>;

      /**
   * `prisma.activity_events`: Exposes CRUD operations for the **Activity_events** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Activity_events
    * const activity_events = await prisma.activity_events.findMany()
    * ```
    */
  get activity_events(): Prisma.Activity_eventsDelegate<GlobalReject>;

  /**
   * `prisma.background_jobs`: Exposes CRUD operations for the **Background_jobs** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Background_jobs
    * const background_jobs = await prisma.background_jobs.findMany()
    * ```
    */
  get background_jobs(): Prisma.Background_jobsDelegate<GlobalReject>;

  /**
   * `prisma.chat_room`: Exposes CRUD operations for the **Chat_room** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Chat_rooms
    * const chat_rooms = await prisma.chat_room.findMany()
    * ```
    */
  get chat_room(): Prisma.Chat_roomDelegate<GlobalReject>;

  /**
   * `prisma.commerce_orders`: Exposes CRUD operations for the **Commerce_orders** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Commerce_orders
    * const commerce_orders = await prisma.commerce_orders.findMany()
    * ```
    */
  get commerce_orders(): Prisma.Commerce_ordersDelegate<GlobalReject>;

  /**
   * `prisma.logs`: Exposes CRUD operations for the **Logs** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Logs
    * const logs = await prisma.logs.findMany()
    * ```
    */
  get logs(): Prisma.LogsDelegate<GlobalReject>;

  /**
   * `prisma.monitoring`: Exposes CRUD operations for the **Monitoring** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Monitorings
    * const monitorings = await prisma.monitoring.findMany()
    * ```
    */
  get monitoring(): Prisma.MonitoringDelegate<GlobalReject>;

  /**
   * `prisma.requests`: Exposes CRUD operations for the **Requests** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Requests
    * const requests = await prisma.requests.findMany()
    * ```
    */
  get requests(): Prisma.RequestsDelegate<GlobalReject>;

  /**
   * `prisma.responses`: Exposes CRUD operations for the **Responses** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Responses
    * const responses = await prisma.responses.findMany()
    * ```
    */
  get responses(): Prisma.ResponsesDelegate<GlobalReject>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql

  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket


  /**
   * Prisma Client JS version: 4.8.1
   * Query Engine version: d6e67a83f971b175a593ccc12e15c4a757f93ffe
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */

  /**
   * From https://github.com/sindresorhus/type-fest/
   * Matches a JSON object.
   * This type can be useful to enforce some input to be JSON-compatible or as a super-type to be extended from. 
   */
  export type JsonObject = {[Key in string]?: JsonValue}

  /**
   * From https://github.com/sindresorhus/type-fest/
   * Matches a JSON array.
   */
  export interface JsonArray extends Array<JsonValue> {}

  /**
   * From https://github.com/sindresorhus/type-fest/
   * Matches any valid JSON value.
   */
  export type JsonValue = string | number | boolean | JsonObject | JsonArray | null

  /**
   * Matches a JSON object.
   * Unlike `JsonObject`, this type allows undefined and read-only properties.
   */
  export type InputJsonObject = {readonly [Key in string]?: InputJsonValue | null}

  /**
   * Matches a JSON array.
   * Unlike `JsonArray`, readonly arrays are assignable to this type.
   */
  export interface InputJsonArray extends ReadonlyArray<InputJsonValue | null> {}

  /**
   * Matches any valid value that can be used as an input for operations like
   * create and update as the value of a JSON field. Unlike `JsonValue`, this
   * type allows read-only arrays and read-only object properties and disallows
   * `null` at the top level.
   *
   * `null` cannot be used as the value of a JSON field because its meaning
   * would be ambiguous. Use `Prisma.JsonNull` to store the JSON null value or
   * `Prisma.DbNull` to clear the JSON value and set the field to the database
   * NULL value instead.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-by-null-values
   */
export type InputJsonValue = null | string | number | boolean | InputJsonObject | InputJsonArray

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }
  type HasSelect = {
    select: any
  }
  type HasInclude = {
    include: any
  }
  type CheckSelect<T, S, U> = T extends SelectAndInclude
    ? 'Please either choose `select` or `include`'
    : T extends HasSelect
    ? U
    : T extends HasInclude
    ? U
    : S

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => Promise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Exact<A, W = unknown> = 
  W extends unknown ? A extends Narrowable ? Cast<A, W> : Cast<
  {[K in keyof A]: K extends keyof W ? Exact<A[K], W[K]> : never},
  {[K in keyof W]: K extends keyof A ? Exact<A[K], W[K]> : W[K]}>
  : never;

  type Narrowable = string | number | boolean | bigint;

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;

  export function validator<V>(): <S>(select: Exact<S, V>) => S;

  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but with an array
   */
  type PickArray<T, K extends Array<keyof T>> = Prisma__Pick<T, TupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>

  class PrismaClientFetcher {
    private readonly prisma;
    private readonly debug;
    private readonly hooks?;
    constructor(prisma: PrismaClient<any, any>, debug?: boolean, hooks?: Hooks | undefined);
    request<T>(document: any, dataPath?: string[], rootField?: string, typeName?: string, isList?: boolean, callsite?: string): Promise<T>;
    sanitizeMessage(message: string): string;
    protected unpack(document: any, data: any, path: string[], rootField?: string, isList?: boolean): any;
  }

  export const ModelName: {
    Activity_events: 'Activity_events',
    Background_jobs: 'Background_jobs',
    Chat_room: 'Chat_room',
    Commerce_orders: 'Commerce_orders',
    Logs: 'Logs',
    Monitoring: 'Monitoring',
    Requests: 'Requests',
    Responses: 'Responses'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  export type DefaultPrismaClient = PrismaClient
  export type RejectOnNotFound = boolean | ((error: Error) => Error)
  export type RejectPerModel = { [P in ModelName]?: RejectOnNotFound }
  export type RejectPerOperation =  { [P in "findUnique" | "findFirst"]?: RejectPerModel | RejectOnNotFound } 
  type IsReject<T> = T extends true ? True : T extends (err: Error) => Error ? True : False
  export type HasReject<
    GlobalRejectSettings extends Prisma.PrismaClientOptions['rejectOnNotFound'],
    LocalRejectSettings,
    Action extends PrismaAction,
    Model extends ModelName
  > = LocalRejectSettings extends RejectOnNotFound
    ? IsReject<LocalRejectSettings>
    : GlobalRejectSettings extends RejectPerOperation
    ? Action extends keyof GlobalRejectSettings
      ? GlobalRejectSettings[Action] extends RejectOnNotFound
        ? IsReject<GlobalRejectSettings[Action]>
        : GlobalRejectSettings[Action] extends RejectPerModel
        ? Model extends keyof GlobalRejectSettings[Action]
          ? IsReject<GlobalRejectSettings[Action][Model]>
          : False
        : False
      : False
    : IsReject<GlobalRejectSettings>
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'

  export interface PrismaClientOptions {
    /**
     * Configure findUnique/findFirst to throw an error if the query returns null. 
     * @deprecated since 4.0.0. Use `findUniqueOrThrow`/`findFirstOrThrow` methods instead.
     * @example
     * ```
     * // Reject on both findUnique/findFirst
     * rejectOnNotFound: true
     * // Reject only on findFirst with a custom error
     * rejectOnNotFound: { findFirst: (err) => new Error("Custom Error")}
     * // Reject on user.findUnique with a custom error
     * rejectOnNotFound: { findUnique: {User: (err) => new Error("User not found")}}
     * ```
     */
    rejectOnNotFound?: RejectOnNotFound | RejectPerOperation
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
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *  { emit: 'stdout', level: 'query' },
     *  { emit: 'stdout', level: 'info' },
     *  { emit: 'stdout', level: 'warn' }
     *  { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: Array<LogLevel | LogDefinition>
  }

  export type Hooks = {
    beforeRequest?: (options: { query: string, path: string[], rootField?: string, typeName?: string, document: any }) => any
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findMany'
    | 'findFirst'
    | 'create'
    | 'createMany'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => Promise<T>,
  ) => Promise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type RequestsCountOutputType
   */


  export type RequestsCountOutputType = {
    responses: number
  }

  export type RequestsCountOutputTypeSelect = {
    responses?: boolean
  }

  export type RequestsCountOutputTypeGetPayload<S extends boolean | null | undefined | RequestsCountOutputTypeArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? RequestsCountOutputType :
    S extends undefined ? never :
    S extends { include: any } & (RequestsCountOutputTypeArgs)
    ? RequestsCountOutputType 
    : S extends { select: any } & (RequestsCountOutputTypeArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof RequestsCountOutputType ? RequestsCountOutputType[P] : never
  } 
      : RequestsCountOutputType




  // Custom InputTypes

  /**
   * RequestsCountOutputType without action
   */
  export type RequestsCountOutputTypeArgs = {
    /**
     * Select specific fields to fetch from the RequestsCountOutputType
     * 
    **/
    select?: RequestsCountOutputTypeSelect | null
  }



  /**
   * Models
   */

  /**
   * Model Activity_events
   */


  export type AggregateActivity_events = {
    _count: Activity_eventsCountAggregateOutputType | null
    _min: Activity_eventsMinAggregateOutputType | null
    _max: Activity_eventsMaxAggregateOutputType | null
  }

  export type Activity_eventsMinAggregateOutputType = {
    id: string | null
    source_user_id: string | null
    target_user_id: string | null
    activity_type: string | null
    timestamp: Date | null
    message: string | null
    action: string | null
    read_at: Date | null
  }

  export type Activity_eventsMaxAggregateOutputType = {
    id: string | null
    source_user_id: string | null
    target_user_id: string | null
    activity_type: string | null
    timestamp: Date | null
    message: string | null
    action: string | null
    read_at: Date | null
  }

  export type Activity_eventsCountAggregateOutputType = {
    id: number
    source_user_id: number
    target_user_id: number
    activity_type: number
    timestamp: number
    message: number
    action: number
    read_at: number
    _all: number
  }


  export type Activity_eventsMinAggregateInputType = {
    id?: true
    source_user_id?: true
    target_user_id?: true
    activity_type?: true
    timestamp?: true
    message?: true
    action?: true
    read_at?: true
  }

  export type Activity_eventsMaxAggregateInputType = {
    id?: true
    source_user_id?: true
    target_user_id?: true
    activity_type?: true
    timestamp?: true
    message?: true
    action?: true
    read_at?: true
  }

  export type Activity_eventsCountAggregateInputType = {
    id?: true
    source_user_id?: true
    target_user_id?: true
    activity_type?: true
    timestamp?: true
    message?: true
    action?: true
    read_at?: true
    _all?: true
  }

  export type Activity_eventsAggregateArgs = {
    /**
     * Filter which Activity_events to aggregate.
     * 
    **/
    where?: Activity_eventsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Activity_events to fetch.
     * 
    **/
    orderBy?: Enumerable<Activity_eventsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: Activity_eventsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Activity_events from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Activity_events.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Activity_events
    **/
    _count?: true | Activity_eventsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Activity_eventsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Activity_eventsMaxAggregateInputType
  }

  export type GetActivity_eventsAggregateType<T extends Activity_eventsAggregateArgs> = {
        [P in keyof T & keyof AggregateActivity_events]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateActivity_events[P]>
      : GetScalarType<T[P], AggregateActivity_events[P]>
  }




  export type Activity_eventsGroupByArgs = {
    where?: Activity_eventsWhereInput
    orderBy?: Enumerable<Activity_eventsOrderByWithAggregationInput>
    by: Array<Activity_eventsScalarFieldEnum>
    having?: Activity_eventsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Activity_eventsCountAggregateInputType | true
    _min?: Activity_eventsMinAggregateInputType
    _max?: Activity_eventsMaxAggregateInputType
  }


  export type Activity_eventsGroupByOutputType = {
    id: string
    source_user_id: string
    target_user_id: string
    activity_type: string
    timestamp: Date
    message: string
    action: string | null
    read_at: Date | null
    _count: Activity_eventsCountAggregateOutputType | null
    _min: Activity_eventsMinAggregateOutputType | null
    _max: Activity_eventsMaxAggregateOutputType | null
  }

  type GetActivity_eventsGroupByPayload<T extends Activity_eventsGroupByArgs> = PrismaPromise<
    Array<
      PickArray<Activity_eventsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Activity_eventsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Activity_eventsGroupByOutputType[P]>
            : GetScalarType<T[P], Activity_eventsGroupByOutputType[P]>
        }
      >
    >


  export type Activity_eventsSelect = {
    id?: boolean
    source_user_id?: boolean
    target_user_id?: boolean
    activity_type?: boolean
    timestamp?: boolean
    message?: boolean
    action?: boolean
    read_at?: boolean
  }


  export type Activity_eventsGetPayload<S extends boolean | null | undefined | Activity_eventsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Activity_events :
    S extends undefined ? never :
    S extends { include: any } & (Activity_eventsArgs | Activity_eventsFindManyArgs)
    ? Activity_events 
    : S extends { select: any } & (Activity_eventsArgs | Activity_eventsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Activity_events ? Activity_events[P] : never
  } 
      : Activity_events


  type Activity_eventsCountArgs = Merge<
    Omit<Activity_eventsFindManyArgs, 'select' | 'include'> & {
      select?: Activity_eventsCountAggregateInputType | true
    }
  >

  export interface Activity_eventsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Activity_events that matches the filter.
     * @param {Activity_eventsFindUniqueArgs} args - Arguments to find a Activity_events
     * @example
     * // Get one Activity_events
     * const activity_events = await prisma.activity_events.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends Activity_eventsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, Activity_eventsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Activity_events'> extends True ? Prisma__Activity_eventsClient<Activity_eventsGetPayload<T>> : Prisma__Activity_eventsClient<Activity_eventsGetPayload<T> | null, null>

    /**
     * Find one Activity_events that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {Activity_eventsFindUniqueOrThrowArgs} args - Arguments to find a Activity_events
     * @example
     * // Get one Activity_events
     * const activity_events = await prisma.activity_events.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends Activity_eventsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, Activity_eventsFindUniqueOrThrowArgs>
    ): Prisma__Activity_eventsClient<Activity_eventsGetPayload<T>>

    /**
     * Find the first Activity_events that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Activity_eventsFindFirstArgs} args - Arguments to find a Activity_events
     * @example
     * // Get one Activity_events
     * const activity_events = await prisma.activity_events.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends Activity_eventsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, Activity_eventsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Activity_events'> extends True ? Prisma__Activity_eventsClient<Activity_eventsGetPayload<T>> : Prisma__Activity_eventsClient<Activity_eventsGetPayload<T> | null, null>

    /**
     * Find the first Activity_events that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Activity_eventsFindFirstOrThrowArgs} args - Arguments to find a Activity_events
     * @example
     * // Get one Activity_events
     * const activity_events = await prisma.activity_events.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends Activity_eventsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, Activity_eventsFindFirstOrThrowArgs>
    ): Prisma__Activity_eventsClient<Activity_eventsGetPayload<T>>

    /**
     * Find zero or more Activity_events that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Activity_eventsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Activity_events
     * const activity_events = await prisma.activity_events.findMany()
     * 
     * // Get first 10 Activity_events
     * const activity_events = await prisma.activity_events.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const activity_eventsWithIdOnly = await prisma.activity_events.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends Activity_eventsFindManyArgs>(
      args?: SelectSubset<T, Activity_eventsFindManyArgs>
    ): PrismaPromise<Array<Activity_eventsGetPayload<T>>>

    /**
     * Create a Activity_events.
     * @param {Activity_eventsCreateArgs} args - Arguments to create a Activity_events.
     * @example
     * // Create one Activity_events
     * const Activity_events = await prisma.activity_events.create({
     *   data: {
     *     // ... data to create a Activity_events
     *   }
     * })
     * 
    **/
    create<T extends Activity_eventsCreateArgs>(
      args: SelectSubset<T, Activity_eventsCreateArgs>
    ): Prisma__Activity_eventsClient<Activity_eventsGetPayload<T>>

    /**
     * Create many Activity_events.
     *     @param {Activity_eventsCreateManyArgs} args - Arguments to create many Activity_events.
     *     @example
     *     // Create many Activity_events
     *     const activity_events = await prisma.activity_events.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends Activity_eventsCreateManyArgs>(
      args?: SelectSubset<T, Activity_eventsCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Activity_events.
     * @param {Activity_eventsDeleteArgs} args - Arguments to delete one Activity_events.
     * @example
     * // Delete one Activity_events
     * const Activity_events = await prisma.activity_events.delete({
     *   where: {
     *     // ... filter to delete one Activity_events
     *   }
     * })
     * 
    **/
    delete<T extends Activity_eventsDeleteArgs>(
      args: SelectSubset<T, Activity_eventsDeleteArgs>
    ): Prisma__Activity_eventsClient<Activity_eventsGetPayload<T>>

    /**
     * Update one Activity_events.
     * @param {Activity_eventsUpdateArgs} args - Arguments to update one Activity_events.
     * @example
     * // Update one Activity_events
     * const activity_events = await prisma.activity_events.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends Activity_eventsUpdateArgs>(
      args: SelectSubset<T, Activity_eventsUpdateArgs>
    ): Prisma__Activity_eventsClient<Activity_eventsGetPayload<T>>

    /**
     * Delete zero or more Activity_events.
     * @param {Activity_eventsDeleteManyArgs} args - Arguments to filter Activity_events to delete.
     * @example
     * // Delete a few Activity_events
     * const { count } = await prisma.activity_events.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends Activity_eventsDeleteManyArgs>(
      args?: SelectSubset<T, Activity_eventsDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Activity_events.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Activity_eventsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Activity_events
     * const activity_events = await prisma.activity_events.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends Activity_eventsUpdateManyArgs>(
      args: SelectSubset<T, Activity_eventsUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Activity_events.
     * @param {Activity_eventsUpsertArgs} args - Arguments to update or create a Activity_events.
     * @example
     * // Update or create a Activity_events
     * const activity_events = await prisma.activity_events.upsert({
     *   create: {
     *     // ... data to create a Activity_events
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Activity_events we want to update
     *   }
     * })
    **/
    upsert<T extends Activity_eventsUpsertArgs>(
      args: SelectSubset<T, Activity_eventsUpsertArgs>
    ): Prisma__Activity_eventsClient<Activity_eventsGetPayload<T>>

    /**
     * Count the number of Activity_events.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Activity_eventsCountArgs} args - Arguments to filter Activity_events to count.
     * @example
     * // Count the number of Activity_events
     * const count = await prisma.activity_events.count({
     *   where: {
     *     // ... the filter for the Activity_events we want to count
     *   }
     * })
    **/
    count<T extends Activity_eventsCountArgs>(
      args?: Subset<T, Activity_eventsCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Activity_eventsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Activity_events.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Activity_eventsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Activity_eventsAggregateArgs>(args: Subset<T, Activity_eventsAggregateArgs>): PrismaPromise<GetActivity_eventsAggregateType<T>>

    /**
     * Group by Activity_events.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Activity_eventsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends Activity_eventsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: Activity_eventsGroupByArgs['orderBy'] }
        : { orderBy?: Activity_eventsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, Activity_eventsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetActivity_eventsGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Activity_events.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__Activity_eventsClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';


    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Activity_events base type for findUnique actions
   */
  export type Activity_eventsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Activity_events
     * 
    **/
    select?: Activity_eventsSelect | null
    /**
     * Filter, which Activity_events to fetch.
     * 
    **/
    where: Activity_eventsWhereUniqueInput
  }

  /**
   * Activity_events findUnique
   */
  export interface Activity_eventsFindUniqueArgs extends Activity_eventsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Activity_events findUniqueOrThrow
   */
  export type Activity_eventsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Activity_events
     * 
    **/
    select?: Activity_eventsSelect | null
    /**
     * Filter, which Activity_events to fetch.
     * 
    **/
    where: Activity_eventsWhereUniqueInput
  }


  /**
   * Activity_events base type for findFirst actions
   */
  export type Activity_eventsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Activity_events
     * 
    **/
    select?: Activity_eventsSelect | null
    /**
     * Filter, which Activity_events to fetch.
     * 
    **/
    where?: Activity_eventsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Activity_events to fetch.
     * 
    **/
    orderBy?: Enumerable<Activity_eventsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Activity_events.
     * 
    **/
    cursor?: Activity_eventsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Activity_events from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Activity_events.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Activity_events.
     * 
    **/
    distinct?: Enumerable<Activity_eventsScalarFieldEnum>
  }

  /**
   * Activity_events findFirst
   */
  export interface Activity_eventsFindFirstArgs extends Activity_eventsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Activity_events findFirstOrThrow
   */
  export type Activity_eventsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Activity_events
     * 
    **/
    select?: Activity_eventsSelect | null
    /**
     * Filter, which Activity_events to fetch.
     * 
    **/
    where?: Activity_eventsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Activity_events to fetch.
     * 
    **/
    orderBy?: Enumerable<Activity_eventsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Activity_events.
     * 
    **/
    cursor?: Activity_eventsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Activity_events from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Activity_events.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Activity_events.
     * 
    **/
    distinct?: Enumerable<Activity_eventsScalarFieldEnum>
  }


  /**
   * Activity_events findMany
   */
  export type Activity_eventsFindManyArgs = {
    /**
     * Select specific fields to fetch from the Activity_events
     * 
    **/
    select?: Activity_eventsSelect | null
    /**
     * Filter, which Activity_events to fetch.
     * 
    **/
    where?: Activity_eventsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Activity_events to fetch.
     * 
    **/
    orderBy?: Enumerable<Activity_eventsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Activity_events.
     * 
    **/
    cursor?: Activity_eventsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Activity_events from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Activity_events.
     * 
    **/
    skip?: number
    distinct?: Enumerable<Activity_eventsScalarFieldEnum>
  }


  /**
   * Activity_events create
   */
  export type Activity_eventsCreateArgs = {
    /**
     * Select specific fields to fetch from the Activity_events
     * 
    **/
    select?: Activity_eventsSelect | null
    /**
     * The data needed to create a Activity_events.
     * 
    **/
    data: XOR<Activity_eventsCreateInput, Activity_eventsUncheckedCreateInput>
  }


  /**
   * Activity_events createMany
   */
  export type Activity_eventsCreateManyArgs = {
    /**
     * The data used to create many Activity_events.
     * 
    **/
    data: Enumerable<Activity_eventsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Activity_events update
   */
  export type Activity_eventsUpdateArgs = {
    /**
     * Select specific fields to fetch from the Activity_events
     * 
    **/
    select?: Activity_eventsSelect | null
    /**
     * The data needed to update a Activity_events.
     * 
    **/
    data: XOR<Activity_eventsUpdateInput, Activity_eventsUncheckedUpdateInput>
    /**
     * Choose, which Activity_events to update.
     * 
    **/
    where: Activity_eventsWhereUniqueInput
  }


  /**
   * Activity_events updateMany
   */
  export type Activity_eventsUpdateManyArgs = {
    /**
     * The data used to update Activity_events.
     * 
    **/
    data: XOR<Activity_eventsUpdateManyMutationInput, Activity_eventsUncheckedUpdateManyInput>
    /**
     * Filter which Activity_events to update
     * 
    **/
    where?: Activity_eventsWhereInput
  }


  /**
   * Activity_events upsert
   */
  export type Activity_eventsUpsertArgs = {
    /**
     * Select specific fields to fetch from the Activity_events
     * 
    **/
    select?: Activity_eventsSelect | null
    /**
     * The filter to search for the Activity_events to update in case it exists.
     * 
    **/
    where: Activity_eventsWhereUniqueInput
    /**
     * In case the Activity_events found by the `where` argument doesn't exist, create a new Activity_events with this data.
     * 
    **/
    create: XOR<Activity_eventsCreateInput, Activity_eventsUncheckedCreateInput>
    /**
     * In case the Activity_events was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<Activity_eventsUpdateInput, Activity_eventsUncheckedUpdateInput>
  }


  /**
   * Activity_events delete
   */
  export type Activity_eventsDeleteArgs = {
    /**
     * Select specific fields to fetch from the Activity_events
     * 
    **/
    select?: Activity_eventsSelect | null
    /**
     * Filter which Activity_events to delete.
     * 
    **/
    where: Activity_eventsWhereUniqueInput
  }


  /**
   * Activity_events deleteMany
   */
  export type Activity_eventsDeleteManyArgs = {
    /**
     * Filter which Activity_events to delete
     * 
    **/
    where?: Activity_eventsWhereInput
  }


  /**
   * Activity_events without action
   */
  export type Activity_eventsArgs = {
    /**
     * Select specific fields to fetch from the Activity_events
     * 
    **/
    select?: Activity_eventsSelect | null
  }



  /**
   * Model Background_jobs
   */


  export type AggregateBackground_jobs = {
    _count: Background_jobsCountAggregateOutputType | null
    _avg: Background_jobsAvgAggregateOutputType | null
    _sum: Background_jobsSumAggregateOutputType | null
    _min: Background_jobsMinAggregateOutputType | null
    _max: Background_jobsMaxAggregateOutputType | null
  }

  export type Background_jobsAvgAggregateOutputType = {
    progress: number | null
  }

  export type Background_jobsSumAggregateOutputType = {
    progress: number | null
  }

  export type Background_jobsMinAggregateOutputType = {
    id: string | null
    timestamp: Date | null
    completed: boolean | null
    cancelled: boolean | null
    progress: number | null
  }

  export type Background_jobsMaxAggregateOutputType = {
    id: string | null
    timestamp: Date | null
    completed: boolean | null
    cancelled: boolean | null
    progress: number | null
  }

  export type Background_jobsCountAggregateOutputType = {
    id: number
    timestamp: number
    payload: number
    completed: number
    cancelled: number
    progress: number
    result: number
    _all: number
  }


  export type Background_jobsAvgAggregateInputType = {
    progress?: true
  }

  export type Background_jobsSumAggregateInputType = {
    progress?: true
  }

  export type Background_jobsMinAggregateInputType = {
    id?: true
    timestamp?: true
    completed?: true
    cancelled?: true
    progress?: true
  }

  export type Background_jobsMaxAggregateInputType = {
    id?: true
    timestamp?: true
    completed?: true
    cancelled?: true
    progress?: true
  }

  export type Background_jobsCountAggregateInputType = {
    id?: true
    timestamp?: true
    payload?: true
    completed?: true
    cancelled?: true
    progress?: true
    result?: true
    _all?: true
  }

  export type Background_jobsAggregateArgs = {
    /**
     * Filter which Background_jobs to aggregate.
     * 
    **/
    where?: Background_jobsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Background_jobs to fetch.
     * 
    **/
    orderBy?: Enumerable<Background_jobsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: Background_jobsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Background_jobs from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Background_jobs.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Background_jobs
    **/
    _count?: true | Background_jobsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Background_jobsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Background_jobsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Background_jobsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Background_jobsMaxAggregateInputType
  }

  export type GetBackground_jobsAggregateType<T extends Background_jobsAggregateArgs> = {
        [P in keyof T & keyof AggregateBackground_jobs]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateBackground_jobs[P]>
      : GetScalarType<T[P], AggregateBackground_jobs[P]>
  }




  export type Background_jobsGroupByArgs = {
    where?: Background_jobsWhereInput
    orderBy?: Enumerable<Background_jobsOrderByWithAggregationInput>
    by: Array<Background_jobsScalarFieldEnum>
    having?: Background_jobsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Background_jobsCountAggregateInputType | true
    _avg?: Background_jobsAvgAggregateInputType
    _sum?: Background_jobsSumAggregateInputType
    _min?: Background_jobsMinAggregateInputType
    _max?: Background_jobsMaxAggregateInputType
  }


  export type Background_jobsGroupByOutputType = {
    id: string
    timestamp: Date
    payload: JsonValue
    completed: boolean
    cancelled: boolean
    progress: number
    result: JsonValue | null
    _count: Background_jobsCountAggregateOutputType | null
    _avg: Background_jobsAvgAggregateOutputType | null
    _sum: Background_jobsSumAggregateOutputType | null
    _min: Background_jobsMinAggregateOutputType | null
    _max: Background_jobsMaxAggregateOutputType | null
  }

  type GetBackground_jobsGroupByPayload<T extends Background_jobsGroupByArgs> = PrismaPromise<
    Array<
      PickArray<Background_jobsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Background_jobsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Background_jobsGroupByOutputType[P]>
            : GetScalarType<T[P], Background_jobsGroupByOutputType[P]>
        }
      >
    >


  export type Background_jobsSelect = {
    id?: boolean
    timestamp?: boolean
    payload?: boolean
    completed?: boolean
    cancelled?: boolean
    progress?: boolean
    result?: boolean
  }


  export type Background_jobsGetPayload<S extends boolean | null | undefined | Background_jobsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Background_jobs :
    S extends undefined ? never :
    S extends { include: any } & (Background_jobsArgs | Background_jobsFindManyArgs)
    ? Background_jobs 
    : S extends { select: any } & (Background_jobsArgs | Background_jobsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Background_jobs ? Background_jobs[P] : never
  } 
      : Background_jobs


  type Background_jobsCountArgs = Merge<
    Omit<Background_jobsFindManyArgs, 'select' | 'include'> & {
      select?: Background_jobsCountAggregateInputType | true
    }
  >

  export interface Background_jobsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Background_jobs that matches the filter.
     * @param {Background_jobsFindUniqueArgs} args - Arguments to find a Background_jobs
     * @example
     * // Get one Background_jobs
     * const background_jobs = await prisma.background_jobs.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends Background_jobsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, Background_jobsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Background_jobs'> extends True ? Prisma__Background_jobsClient<Background_jobsGetPayload<T>> : Prisma__Background_jobsClient<Background_jobsGetPayload<T> | null, null>

    /**
     * Find one Background_jobs that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {Background_jobsFindUniqueOrThrowArgs} args - Arguments to find a Background_jobs
     * @example
     * // Get one Background_jobs
     * const background_jobs = await prisma.background_jobs.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends Background_jobsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, Background_jobsFindUniqueOrThrowArgs>
    ): Prisma__Background_jobsClient<Background_jobsGetPayload<T>>

    /**
     * Find the first Background_jobs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Background_jobsFindFirstArgs} args - Arguments to find a Background_jobs
     * @example
     * // Get one Background_jobs
     * const background_jobs = await prisma.background_jobs.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends Background_jobsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, Background_jobsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Background_jobs'> extends True ? Prisma__Background_jobsClient<Background_jobsGetPayload<T>> : Prisma__Background_jobsClient<Background_jobsGetPayload<T> | null, null>

    /**
     * Find the first Background_jobs that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Background_jobsFindFirstOrThrowArgs} args - Arguments to find a Background_jobs
     * @example
     * // Get one Background_jobs
     * const background_jobs = await prisma.background_jobs.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends Background_jobsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, Background_jobsFindFirstOrThrowArgs>
    ): Prisma__Background_jobsClient<Background_jobsGetPayload<T>>

    /**
     * Find zero or more Background_jobs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Background_jobsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Background_jobs
     * const background_jobs = await prisma.background_jobs.findMany()
     * 
     * // Get first 10 Background_jobs
     * const background_jobs = await prisma.background_jobs.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const background_jobsWithIdOnly = await prisma.background_jobs.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends Background_jobsFindManyArgs>(
      args?: SelectSubset<T, Background_jobsFindManyArgs>
    ): PrismaPromise<Array<Background_jobsGetPayload<T>>>

    /**
     * Create a Background_jobs.
     * @param {Background_jobsCreateArgs} args - Arguments to create a Background_jobs.
     * @example
     * // Create one Background_jobs
     * const Background_jobs = await prisma.background_jobs.create({
     *   data: {
     *     // ... data to create a Background_jobs
     *   }
     * })
     * 
    **/
    create<T extends Background_jobsCreateArgs>(
      args: SelectSubset<T, Background_jobsCreateArgs>
    ): Prisma__Background_jobsClient<Background_jobsGetPayload<T>>

    /**
     * Create many Background_jobs.
     *     @param {Background_jobsCreateManyArgs} args - Arguments to create many Background_jobs.
     *     @example
     *     // Create many Background_jobs
     *     const background_jobs = await prisma.background_jobs.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends Background_jobsCreateManyArgs>(
      args?: SelectSubset<T, Background_jobsCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Background_jobs.
     * @param {Background_jobsDeleteArgs} args - Arguments to delete one Background_jobs.
     * @example
     * // Delete one Background_jobs
     * const Background_jobs = await prisma.background_jobs.delete({
     *   where: {
     *     // ... filter to delete one Background_jobs
     *   }
     * })
     * 
    **/
    delete<T extends Background_jobsDeleteArgs>(
      args: SelectSubset<T, Background_jobsDeleteArgs>
    ): Prisma__Background_jobsClient<Background_jobsGetPayload<T>>

    /**
     * Update one Background_jobs.
     * @param {Background_jobsUpdateArgs} args - Arguments to update one Background_jobs.
     * @example
     * // Update one Background_jobs
     * const background_jobs = await prisma.background_jobs.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends Background_jobsUpdateArgs>(
      args: SelectSubset<T, Background_jobsUpdateArgs>
    ): Prisma__Background_jobsClient<Background_jobsGetPayload<T>>

    /**
     * Delete zero or more Background_jobs.
     * @param {Background_jobsDeleteManyArgs} args - Arguments to filter Background_jobs to delete.
     * @example
     * // Delete a few Background_jobs
     * const { count } = await prisma.background_jobs.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends Background_jobsDeleteManyArgs>(
      args?: SelectSubset<T, Background_jobsDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Background_jobs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Background_jobsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Background_jobs
     * const background_jobs = await prisma.background_jobs.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends Background_jobsUpdateManyArgs>(
      args: SelectSubset<T, Background_jobsUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Background_jobs.
     * @param {Background_jobsUpsertArgs} args - Arguments to update or create a Background_jobs.
     * @example
     * // Update or create a Background_jobs
     * const background_jobs = await prisma.background_jobs.upsert({
     *   create: {
     *     // ... data to create a Background_jobs
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Background_jobs we want to update
     *   }
     * })
    **/
    upsert<T extends Background_jobsUpsertArgs>(
      args: SelectSubset<T, Background_jobsUpsertArgs>
    ): Prisma__Background_jobsClient<Background_jobsGetPayload<T>>

    /**
     * Count the number of Background_jobs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Background_jobsCountArgs} args - Arguments to filter Background_jobs to count.
     * @example
     * // Count the number of Background_jobs
     * const count = await prisma.background_jobs.count({
     *   where: {
     *     // ... the filter for the Background_jobs we want to count
     *   }
     * })
    **/
    count<T extends Background_jobsCountArgs>(
      args?: Subset<T, Background_jobsCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Background_jobsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Background_jobs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Background_jobsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Background_jobsAggregateArgs>(args: Subset<T, Background_jobsAggregateArgs>): PrismaPromise<GetBackground_jobsAggregateType<T>>

    /**
     * Group by Background_jobs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Background_jobsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends Background_jobsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: Background_jobsGroupByArgs['orderBy'] }
        : { orderBy?: Background_jobsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, Background_jobsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetBackground_jobsGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Background_jobs.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__Background_jobsClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';


    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Background_jobs base type for findUnique actions
   */
  export type Background_jobsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Background_jobs
     * 
    **/
    select?: Background_jobsSelect | null
    /**
     * Filter, which Background_jobs to fetch.
     * 
    **/
    where: Background_jobsWhereUniqueInput
  }

  /**
   * Background_jobs findUnique
   */
  export interface Background_jobsFindUniqueArgs extends Background_jobsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Background_jobs findUniqueOrThrow
   */
  export type Background_jobsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Background_jobs
     * 
    **/
    select?: Background_jobsSelect | null
    /**
     * Filter, which Background_jobs to fetch.
     * 
    **/
    where: Background_jobsWhereUniqueInput
  }


  /**
   * Background_jobs base type for findFirst actions
   */
  export type Background_jobsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Background_jobs
     * 
    **/
    select?: Background_jobsSelect | null
    /**
     * Filter, which Background_jobs to fetch.
     * 
    **/
    where?: Background_jobsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Background_jobs to fetch.
     * 
    **/
    orderBy?: Enumerable<Background_jobsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Background_jobs.
     * 
    **/
    cursor?: Background_jobsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Background_jobs from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Background_jobs.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Background_jobs.
     * 
    **/
    distinct?: Enumerable<Background_jobsScalarFieldEnum>
  }

  /**
   * Background_jobs findFirst
   */
  export interface Background_jobsFindFirstArgs extends Background_jobsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Background_jobs findFirstOrThrow
   */
  export type Background_jobsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Background_jobs
     * 
    **/
    select?: Background_jobsSelect | null
    /**
     * Filter, which Background_jobs to fetch.
     * 
    **/
    where?: Background_jobsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Background_jobs to fetch.
     * 
    **/
    orderBy?: Enumerable<Background_jobsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Background_jobs.
     * 
    **/
    cursor?: Background_jobsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Background_jobs from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Background_jobs.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Background_jobs.
     * 
    **/
    distinct?: Enumerable<Background_jobsScalarFieldEnum>
  }


  /**
   * Background_jobs findMany
   */
  export type Background_jobsFindManyArgs = {
    /**
     * Select specific fields to fetch from the Background_jobs
     * 
    **/
    select?: Background_jobsSelect | null
    /**
     * Filter, which Background_jobs to fetch.
     * 
    **/
    where?: Background_jobsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Background_jobs to fetch.
     * 
    **/
    orderBy?: Enumerable<Background_jobsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Background_jobs.
     * 
    **/
    cursor?: Background_jobsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Background_jobs from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Background_jobs.
     * 
    **/
    skip?: number
    distinct?: Enumerable<Background_jobsScalarFieldEnum>
  }


  /**
   * Background_jobs create
   */
  export type Background_jobsCreateArgs = {
    /**
     * Select specific fields to fetch from the Background_jobs
     * 
    **/
    select?: Background_jobsSelect | null
    /**
     * The data needed to create a Background_jobs.
     * 
    **/
    data: XOR<Background_jobsCreateInput, Background_jobsUncheckedCreateInput>
  }


  /**
   * Background_jobs createMany
   */
  export type Background_jobsCreateManyArgs = {
    /**
     * The data used to create many Background_jobs.
     * 
    **/
    data: Enumerable<Background_jobsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Background_jobs update
   */
  export type Background_jobsUpdateArgs = {
    /**
     * Select specific fields to fetch from the Background_jobs
     * 
    **/
    select?: Background_jobsSelect | null
    /**
     * The data needed to update a Background_jobs.
     * 
    **/
    data: XOR<Background_jobsUpdateInput, Background_jobsUncheckedUpdateInput>
    /**
     * Choose, which Background_jobs to update.
     * 
    **/
    where: Background_jobsWhereUniqueInput
  }


  /**
   * Background_jobs updateMany
   */
  export type Background_jobsUpdateManyArgs = {
    /**
     * The data used to update Background_jobs.
     * 
    **/
    data: XOR<Background_jobsUpdateManyMutationInput, Background_jobsUncheckedUpdateManyInput>
    /**
     * Filter which Background_jobs to update
     * 
    **/
    where?: Background_jobsWhereInput
  }


  /**
   * Background_jobs upsert
   */
  export type Background_jobsUpsertArgs = {
    /**
     * Select specific fields to fetch from the Background_jobs
     * 
    **/
    select?: Background_jobsSelect | null
    /**
     * The filter to search for the Background_jobs to update in case it exists.
     * 
    **/
    where: Background_jobsWhereUniqueInput
    /**
     * In case the Background_jobs found by the `where` argument doesn't exist, create a new Background_jobs with this data.
     * 
    **/
    create: XOR<Background_jobsCreateInput, Background_jobsUncheckedCreateInput>
    /**
     * In case the Background_jobs was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<Background_jobsUpdateInput, Background_jobsUncheckedUpdateInput>
  }


  /**
   * Background_jobs delete
   */
  export type Background_jobsDeleteArgs = {
    /**
     * Select specific fields to fetch from the Background_jobs
     * 
    **/
    select?: Background_jobsSelect | null
    /**
     * Filter which Background_jobs to delete.
     * 
    **/
    where: Background_jobsWhereUniqueInput
  }


  /**
   * Background_jobs deleteMany
   */
  export type Background_jobsDeleteManyArgs = {
    /**
     * Filter which Background_jobs to delete
     * 
    **/
    where?: Background_jobsWhereInput
  }


  /**
   * Background_jobs without action
   */
  export type Background_jobsArgs = {
    /**
     * Select specific fields to fetch from the Background_jobs
     * 
    **/
    select?: Background_jobsSelect | null
  }



  /**
   * Model Chat_room
   */


  export type AggregateChat_room = {
    _count: Chat_roomCountAggregateOutputType | null
    _min: Chat_roomMinAggregateOutputType | null
    _max: Chat_roomMaxAggregateOutputType | null
  }

  export type Chat_roomMinAggregateOutputType = {
    id: string | null
    timestamp: Date | null
    username: string | null
    message: string | null
  }

  export type Chat_roomMaxAggregateOutputType = {
    id: string | null
    timestamp: Date | null
    username: string | null
    message: string | null
  }

  export type Chat_roomCountAggregateOutputType = {
    id: number
    timestamp: number
    username: number
    message: number
    _all: number
  }


  export type Chat_roomMinAggregateInputType = {
    id?: true
    timestamp?: true
    username?: true
    message?: true
  }

  export type Chat_roomMaxAggregateInputType = {
    id?: true
    timestamp?: true
    username?: true
    message?: true
  }

  export type Chat_roomCountAggregateInputType = {
    id?: true
    timestamp?: true
    username?: true
    message?: true
    _all?: true
  }

  export type Chat_roomAggregateArgs = {
    /**
     * Filter which Chat_room to aggregate.
     * 
    **/
    where?: Chat_roomWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Chat_rooms to fetch.
     * 
    **/
    orderBy?: Enumerable<Chat_roomOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: Chat_roomWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Chat_rooms from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Chat_rooms.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Chat_rooms
    **/
    _count?: true | Chat_roomCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Chat_roomMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Chat_roomMaxAggregateInputType
  }

  export type GetChat_roomAggregateType<T extends Chat_roomAggregateArgs> = {
        [P in keyof T & keyof AggregateChat_room]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateChat_room[P]>
      : GetScalarType<T[P], AggregateChat_room[P]>
  }




  export type Chat_roomGroupByArgs = {
    where?: Chat_roomWhereInput
    orderBy?: Enumerable<Chat_roomOrderByWithAggregationInput>
    by: Array<Chat_roomScalarFieldEnum>
    having?: Chat_roomScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Chat_roomCountAggregateInputType | true
    _min?: Chat_roomMinAggregateInputType
    _max?: Chat_roomMaxAggregateInputType
  }


  export type Chat_roomGroupByOutputType = {
    id: string
    timestamp: Date
    username: string
    message: string
    _count: Chat_roomCountAggregateOutputType | null
    _min: Chat_roomMinAggregateOutputType | null
    _max: Chat_roomMaxAggregateOutputType | null
  }

  type GetChat_roomGroupByPayload<T extends Chat_roomGroupByArgs> = PrismaPromise<
    Array<
      PickArray<Chat_roomGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Chat_roomGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Chat_roomGroupByOutputType[P]>
            : GetScalarType<T[P], Chat_roomGroupByOutputType[P]>
        }
      >
    >


  export type Chat_roomSelect = {
    id?: boolean
    timestamp?: boolean
    username?: boolean
    message?: boolean
  }


  export type Chat_roomGetPayload<S extends boolean | null | undefined | Chat_roomArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Chat_room :
    S extends undefined ? never :
    S extends { include: any } & (Chat_roomArgs | Chat_roomFindManyArgs)
    ? Chat_room 
    : S extends { select: any } & (Chat_roomArgs | Chat_roomFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Chat_room ? Chat_room[P] : never
  } 
      : Chat_room


  type Chat_roomCountArgs = Merge<
    Omit<Chat_roomFindManyArgs, 'select' | 'include'> & {
      select?: Chat_roomCountAggregateInputType | true
    }
  >

  export interface Chat_roomDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Chat_room that matches the filter.
     * @param {Chat_roomFindUniqueArgs} args - Arguments to find a Chat_room
     * @example
     * // Get one Chat_room
     * const chat_room = await prisma.chat_room.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends Chat_roomFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, Chat_roomFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Chat_room'> extends True ? Prisma__Chat_roomClient<Chat_roomGetPayload<T>> : Prisma__Chat_roomClient<Chat_roomGetPayload<T> | null, null>

    /**
     * Find one Chat_room that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {Chat_roomFindUniqueOrThrowArgs} args - Arguments to find a Chat_room
     * @example
     * // Get one Chat_room
     * const chat_room = await prisma.chat_room.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends Chat_roomFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, Chat_roomFindUniqueOrThrowArgs>
    ): Prisma__Chat_roomClient<Chat_roomGetPayload<T>>

    /**
     * Find the first Chat_room that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Chat_roomFindFirstArgs} args - Arguments to find a Chat_room
     * @example
     * // Get one Chat_room
     * const chat_room = await prisma.chat_room.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends Chat_roomFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, Chat_roomFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Chat_room'> extends True ? Prisma__Chat_roomClient<Chat_roomGetPayload<T>> : Prisma__Chat_roomClient<Chat_roomGetPayload<T> | null, null>

    /**
     * Find the first Chat_room that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Chat_roomFindFirstOrThrowArgs} args - Arguments to find a Chat_room
     * @example
     * // Get one Chat_room
     * const chat_room = await prisma.chat_room.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends Chat_roomFindFirstOrThrowArgs>(
      args?: SelectSubset<T, Chat_roomFindFirstOrThrowArgs>
    ): Prisma__Chat_roomClient<Chat_roomGetPayload<T>>

    /**
     * Find zero or more Chat_rooms that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Chat_roomFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Chat_rooms
     * const chat_rooms = await prisma.chat_room.findMany()
     * 
     * // Get first 10 Chat_rooms
     * const chat_rooms = await prisma.chat_room.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const chat_roomWithIdOnly = await prisma.chat_room.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends Chat_roomFindManyArgs>(
      args?: SelectSubset<T, Chat_roomFindManyArgs>
    ): PrismaPromise<Array<Chat_roomGetPayload<T>>>

    /**
     * Create a Chat_room.
     * @param {Chat_roomCreateArgs} args - Arguments to create a Chat_room.
     * @example
     * // Create one Chat_room
     * const Chat_room = await prisma.chat_room.create({
     *   data: {
     *     // ... data to create a Chat_room
     *   }
     * })
     * 
    **/
    create<T extends Chat_roomCreateArgs>(
      args: SelectSubset<T, Chat_roomCreateArgs>
    ): Prisma__Chat_roomClient<Chat_roomGetPayload<T>>

    /**
     * Create many Chat_rooms.
     *     @param {Chat_roomCreateManyArgs} args - Arguments to create many Chat_rooms.
     *     @example
     *     // Create many Chat_rooms
     *     const chat_room = await prisma.chat_room.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends Chat_roomCreateManyArgs>(
      args?: SelectSubset<T, Chat_roomCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Chat_room.
     * @param {Chat_roomDeleteArgs} args - Arguments to delete one Chat_room.
     * @example
     * // Delete one Chat_room
     * const Chat_room = await prisma.chat_room.delete({
     *   where: {
     *     // ... filter to delete one Chat_room
     *   }
     * })
     * 
    **/
    delete<T extends Chat_roomDeleteArgs>(
      args: SelectSubset<T, Chat_roomDeleteArgs>
    ): Prisma__Chat_roomClient<Chat_roomGetPayload<T>>

    /**
     * Update one Chat_room.
     * @param {Chat_roomUpdateArgs} args - Arguments to update one Chat_room.
     * @example
     * // Update one Chat_room
     * const chat_room = await prisma.chat_room.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends Chat_roomUpdateArgs>(
      args: SelectSubset<T, Chat_roomUpdateArgs>
    ): Prisma__Chat_roomClient<Chat_roomGetPayload<T>>

    /**
     * Delete zero or more Chat_rooms.
     * @param {Chat_roomDeleteManyArgs} args - Arguments to filter Chat_rooms to delete.
     * @example
     * // Delete a few Chat_rooms
     * const { count } = await prisma.chat_room.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends Chat_roomDeleteManyArgs>(
      args?: SelectSubset<T, Chat_roomDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Chat_rooms.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Chat_roomUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Chat_rooms
     * const chat_room = await prisma.chat_room.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends Chat_roomUpdateManyArgs>(
      args: SelectSubset<T, Chat_roomUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Chat_room.
     * @param {Chat_roomUpsertArgs} args - Arguments to update or create a Chat_room.
     * @example
     * // Update or create a Chat_room
     * const chat_room = await prisma.chat_room.upsert({
     *   create: {
     *     // ... data to create a Chat_room
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Chat_room we want to update
     *   }
     * })
    **/
    upsert<T extends Chat_roomUpsertArgs>(
      args: SelectSubset<T, Chat_roomUpsertArgs>
    ): Prisma__Chat_roomClient<Chat_roomGetPayload<T>>

    /**
     * Count the number of Chat_rooms.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Chat_roomCountArgs} args - Arguments to filter Chat_rooms to count.
     * @example
     * // Count the number of Chat_rooms
     * const count = await prisma.chat_room.count({
     *   where: {
     *     // ... the filter for the Chat_rooms we want to count
     *   }
     * })
    **/
    count<T extends Chat_roomCountArgs>(
      args?: Subset<T, Chat_roomCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Chat_roomCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Chat_room.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Chat_roomAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Chat_roomAggregateArgs>(args: Subset<T, Chat_roomAggregateArgs>): PrismaPromise<GetChat_roomAggregateType<T>>

    /**
     * Group by Chat_room.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Chat_roomGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends Chat_roomGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: Chat_roomGroupByArgs['orderBy'] }
        : { orderBy?: Chat_roomGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, Chat_roomGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetChat_roomGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Chat_room.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__Chat_roomClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';


    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Chat_room base type for findUnique actions
   */
  export type Chat_roomFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Chat_room
     * 
    **/
    select?: Chat_roomSelect | null
    /**
     * Filter, which Chat_room to fetch.
     * 
    **/
    where: Chat_roomWhereUniqueInput
  }

  /**
   * Chat_room findUnique
   */
  export interface Chat_roomFindUniqueArgs extends Chat_roomFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Chat_room findUniqueOrThrow
   */
  export type Chat_roomFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Chat_room
     * 
    **/
    select?: Chat_roomSelect | null
    /**
     * Filter, which Chat_room to fetch.
     * 
    **/
    where: Chat_roomWhereUniqueInput
  }


  /**
   * Chat_room base type for findFirst actions
   */
  export type Chat_roomFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Chat_room
     * 
    **/
    select?: Chat_roomSelect | null
    /**
     * Filter, which Chat_room to fetch.
     * 
    **/
    where?: Chat_roomWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Chat_rooms to fetch.
     * 
    **/
    orderBy?: Enumerable<Chat_roomOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Chat_rooms.
     * 
    **/
    cursor?: Chat_roomWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Chat_rooms from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Chat_rooms.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Chat_rooms.
     * 
    **/
    distinct?: Enumerable<Chat_roomScalarFieldEnum>
  }

  /**
   * Chat_room findFirst
   */
  export interface Chat_roomFindFirstArgs extends Chat_roomFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Chat_room findFirstOrThrow
   */
  export type Chat_roomFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Chat_room
     * 
    **/
    select?: Chat_roomSelect | null
    /**
     * Filter, which Chat_room to fetch.
     * 
    **/
    where?: Chat_roomWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Chat_rooms to fetch.
     * 
    **/
    orderBy?: Enumerable<Chat_roomOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Chat_rooms.
     * 
    **/
    cursor?: Chat_roomWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Chat_rooms from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Chat_rooms.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Chat_rooms.
     * 
    **/
    distinct?: Enumerable<Chat_roomScalarFieldEnum>
  }


  /**
   * Chat_room findMany
   */
  export type Chat_roomFindManyArgs = {
    /**
     * Select specific fields to fetch from the Chat_room
     * 
    **/
    select?: Chat_roomSelect | null
    /**
     * Filter, which Chat_rooms to fetch.
     * 
    **/
    where?: Chat_roomWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Chat_rooms to fetch.
     * 
    **/
    orderBy?: Enumerable<Chat_roomOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Chat_rooms.
     * 
    **/
    cursor?: Chat_roomWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Chat_rooms from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Chat_rooms.
     * 
    **/
    skip?: number
    distinct?: Enumerable<Chat_roomScalarFieldEnum>
  }


  /**
   * Chat_room create
   */
  export type Chat_roomCreateArgs = {
    /**
     * Select specific fields to fetch from the Chat_room
     * 
    **/
    select?: Chat_roomSelect | null
    /**
     * The data needed to create a Chat_room.
     * 
    **/
    data: XOR<Chat_roomCreateInput, Chat_roomUncheckedCreateInput>
  }


  /**
   * Chat_room createMany
   */
  export type Chat_roomCreateManyArgs = {
    /**
     * The data used to create many Chat_rooms.
     * 
    **/
    data: Enumerable<Chat_roomCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Chat_room update
   */
  export type Chat_roomUpdateArgs = {
    /**
     * Select specific fields to fetch from the Chat_room
     * 
    **/
    select?: Chat_roomSelect | null
    /**
     * The data needed to update a Chat_room.
     * 
    **/
    data: XOR<Chat_roomUpdateInput, Chat_roomUncheckedUpdateInput>
    /**
     * Choose, which Chat_room to update.
     * 
    **/
    where: Chat_roomWhereUniqueInput
  }


  /**
   * Chat_room updateMany
   */
  export type Chat_roomUpdateManyArgs = {
    /**
     * The data used to update Chat_rooms.
     * 
    **/
    data: XOR<Chat_roomUpdateManyMutationInput, Chat_roomUncheckedUpdateManyInput>
    /**
     * Filter which Chat_rooms to update
     * 
    **/
    where?: Chat_roomWhereInput
  }


  /**
   * Chat_room upsert
   */
  export type Chat_roomUpsertArgs = {
    /**
     * Select specific fields to fetch from the Chat_room
     * 
    **/
    select?: Chat_roomSelect | null
    /**
     * The filter to search for the Chat_room to update in case it exists.
     * 
    **/
    where: Chat_roomWhereUniqueInput
    /**
     * In case the Chat_room found by the `where` argument doesn't exist, create a new Chat_room with this data.
     * 
    **/
    create: XOR<Chat_roomCreateInput, Chat_roomUncheckedCreateInput>
    /**
     * In case the Chat_room was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<Chat_roomUpdateInput, Chat_roomUncheckedUpdateInput>
  }


  /**
   * Chat_room delete
   */
  export type Chat_roomDeleteArgs = {
    /**
     * Select specific fields to fetch from the Chat_room
     * 
    **/
    select?: Chat_roomSelect | null
    /**
     * Filter which Chat_room to delete.
     * 
    **/
    where: Chat_roomWhereUniqueInput
  }


  /**
   * Chat_room deleteMany
   */
  export type Chat_roomDeleteManyArgs = {
    /**
     * Filter which Chat_rooms to delete
     * 
    **/
    where?: Chat_roomWhereInput
  }


  /**
   * Chat_room without action
   */
  export type Chat_roomArgs = {
    /**
     * Select specific fields to fetch from the Chat_room
     * 
    **/
    select?: Chat_roomSelect | null
  }



  /**
   * Model Commerce_orders
   */


  export type AggregateCommerce_orders = {
    _count: Commerce_ordersCountAggregateOutputType | null
    _avg: Commerce_ordersAvgAggregateOutputType | null
    _sum: Commerce_ordersSumAggregateOutputType | null
    _min: Commerce_ordersMinAggregateOutputType | null
    _max: Commerce_ordersMaxAggregateOutputType | null
  }

  export type Commerce_ordersAvgAggregateOutputType = {
    price_amount: number | null
  }

  export type Commerce_ordersSumAggregateOutputType = {
    price_amount: number | null
  }

  export type Commerce_ordersMinAggregateOutputType = {
    order_id: string | null
    timestamp: Date | null
    price_amount: number | null
    price_currency: string | null
    promo_code: string | null
    customer_full_name: string | null
    country: string | null
    product: string | null
  }

  export type Commerce_ordersMaxAggregateOutputType = {
    order_id: string | null
    timestamp: Date | null
    price_amount: number | null
    price_currency: string | null
    promo_code: string | null
    customer_full_name: string | null
    country: string | null
    product: string | null
  }

  export type Commerce_ordersCountAggregateOutputType = {
    order_id: number
    timestamp: number
    price_amount: number
    price_currency: number
    promo_code: number
    customer_full_name: number
    country: number
    product: number
    _all: number
  }


  export type Commerce_ordersAvgAggregateInputType = {
    price_amount?: true
  }

  export type Commerce_ordersSumAggregateInputType = {
    price_amount?: true
  }

  export type Commerce_ordersMinAggregateInputType = {
    order_id?: true
    timestamp?: true
    price_amount?: true
    price_currency?: true
    promo_code?: true
    customer_full_name?: true
    country?: true
    product?: true
  }

  export type Commerce_ordersMaxAggregateInputType = {
    order_id?: true
    timestamp?: true
    price_amount?: true
    price_currency?: true
    promo_code?: true
    customer_full_name?: true
    country?: true
    product?: true
  }

  export type Commerce_ordersCountAggregateInputType = {
    order_id?: true
    timestamp?: true
    price_amount?: true
    price_currency?: true
    promo_code?: true
    customer_full_name?: true
    country?: true
    product?: true
    _all?: true
  }

  export type Commerce_ordersAggregateArgs = {
    /**
     * Filter which Commerce_orders to aggregate.
     * 
    **/
    where?: Commerce_ordersWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Commerce_orders to fetch.
     * 
    **/
    orderBy?: Enumerable<Commerce_ordersOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: Commerce_ordersWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Commerce_orders from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Commerce_orders.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Commerce_orders
    **/
    _count?: true | Commerce_ordersCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Commerce_ordersAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Commerce_ordersSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Commerce_ordersMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Commerce_ordersMaxAggregateInputType
  }

  export type GetCommerce_ordersAggregateType<T extends Commerce_ordersAggregateArgs> = {
        [P in keyof T & keyof AggregateCommerce_orders]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateCommerce_orders[P]>
      : GetScalarType<T[P], AggregateCommerce_orders[P]>
  }




  export type Commerce_ordersGroupByArgs = {
    where?: Commerce_ordersWhereInput
    orderBy?: Enumerable<Commerce_ordersOrderByWithAggregationInput>
    by: Array<Commerce_ordersScalarFieldEnum>
    having?: Commerce_ordersScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Commerce_ordersCountAggregateInputType | true
    _avg?: Commerce_ordersAvgAggregateInputType
    _sum?: Commerce_ordersSumAggregateInputType
    _min?: Commerce_ordersMinAggregateInputType
    _max?: Commerce_ordersMaxAggregateInputType
  }


  export type Commerce_ordersGroupByOutputType = {
    order_id: string
    timestamp: Date
    price_amount: number
    price_currency: string
    promo_code: string | null
    customer_full_name: string
    country: string
    product: string
    _count: Commerce_ordersCountAggregateOutputType | null
    _avg: Commerce_ordersAvgAggregateOutputType | null
    _sum: Commerce_ordersSumAggregateOutputType | null
    _min: Commerce_ordersMinAggregateOutputType | null
    _max: Commerce_ordersMaxAggregateOutputType | null
  }

  type GetCommerce_ordersGroupByPayload<T extends Commerce_ordersGroupByArgs> = PrismaPromise<
    Array<
      PickArray<Commerce_ordersGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Commerce_ordersGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Commerce_ordersGroupByOutputType[P]>
            : GetScalarType<T[P], Commerce_ordersGroupByOutputType[P]>
        }
      >
    >


  export type Commerce_ordersSelect = {
    order_id?: boolean
    timestamp?: boolean
    price_amount?: boolean
    price_currency?: boolean
    promo_code?: boolean
    customer_full_name?: boolean
    country?: boolean
    product?: boolean
  }


  export type Commerce_ordersGetPayload<S extends boolean | null | undefined | Commerce_ordersArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Commerce_orders :
    S extends undefined ? never :
    S extends { include: any } & (Commerce_ordersArgs | Commerce_ordersFindManyArgs)
    ? Commerce_orders 
    : S extends { select: any } & (Commerce_ordersArgs | Commerce_ordersFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Commerce_orders ? Commerce_orders[P] : never
  } 
      : Commerce_orders


  type Commerce_ordersCountArgs = Merge<
    Omit<Commerce_ordersFindManyArgs, 'select' | 'include'> & {
      select?: Commerce_ordersCountAggregateInputType | true
    }
  >

  export interface Commerce_ordersDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Commerce_orders that matches the filter.
     * @param {Commerce_ordersFindUniqueArgs} args - Arguments to find a Commerce_orders
     * @example
     * // Get one Commerce_orders
     * const commerce_orders = await prisma.commerce_orders.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends Commerce_ordersFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, Commerce_ordersFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Commerce_orders'> extends True ? Prisma__Commerce_ordersClient<Commerce_ordersGetPayload<T>> : Prisma__Commerce_ordersClient<Commerce_ordersGetPayload<T> | null, null>

    /**
     * Find one Commerce_orders that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {Commerce_ordersFindUniqueOrThrowArgs} args - Arguments to find a Commerce_orders
     * @example
     * // Get one Commerce_orders
     * const commerce_orders = await prisma.commerce_orders.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends Commerce_ordersFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, Commerce_ordersFindUniqueOrThrowArgs>
    ): Prisma__Commerce_ordersClient<Commerce_ordersGetPayload<T>>

    /**
     * Find the first Commerce_orders that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Commerce_ordersFindFirstArgs} args - Arguments to find a Commerce_orders
     * @example
     * // Get one Commerce_orders
     * const commerce_orders = await prisma.commerce_orders.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends Commerce_ordersFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, Commerce_ordersFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Commerce_orders'> extends True ? Prisma__Commerce_ordersClient<Commerce_ordersGetPayload<T>> : Prisma__Commerce_ordersClient<Commerce_ordersGetPayload<T> | null, null>

    /**
     * Find the first Commerce_orders that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Commerce_ordersFindFirstOrThrowArgs} args - Arguments to find a Commerce_orders
     * @example
     * // Get one Commerce_orders
     * const commerce_orders = await prisma.commerce_orders.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends Commerce_ordersFindFirstOrThrowArgs>(
      args?: SelectSubset<T, Commerce_ordersFindFirstOrThrowArgs>
    ): Prisma__Commerce_ordersClient<Commerce_ordersGetPayload<T>>

    /**
     * Find zero or more Commerce_orders that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Commerce_ordersFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Commerce_orders
     * const commerce_orders = await prisma.commerce_orders.findMany()
     * 
     * // Get first 10 Commerce_orders
     * const commerce_orders = await prisma.commerce_orders.findMany({ take: 10 })
     * 
     * // Only select the `order_id`
     * const commerce_ordersWithOrder_idOnly = await prisma.commerce_orders.findMany({ select: { order_id: true } })
     * 
    **/
    findMany<T extends Commerce_ordersFindManyArgs>(
      args?: SelectSubset<T, Commerce_ordersFindManyArgs>
    ): PrismaPromise<Array<Commerce_ordersGetPayload<T>>>

    /**
     * Create a Commerce_orders.
     * @param {Commerce_ordersCreateArgs} args - Arguments to create a Commerce_orders.
     * @example
     * // Create one Commerce_orders
     * const Commerce_orders = await prisma.commerce_orders.create({
     *   data: {
     *     // ... data to create a Commerce_orders
     *   }
     * })
     * 
    **/
    create<T extends Commerce_ordersCreateArgs>(
      args: SelectSubset<T, Commerce_ordersCreateArgs>
    ): Prisma__Commerce_ordersClient<Commerce_ordersGetPayload<T>>

    /**
     * Create many Commerce_orders.
     *     @param {Commerce_ordersCreateManyArgs} args - Arguments to create many Commerce_orders.
     *     @example
     *     // Create many Commerce_orders
     *     const commerce_orders = await prisma.commerce_orders.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends Commerce_ordersCreateManyArgs>(
      args?: SelectSubset<T, Commerce_ordersCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Commerce_orders.
     * @param {Commerce_ordersDeleteArgs} args - Arguments to delete one Commerce_orders.
     * @example
     * // Delete one Commerce_orders
     * const Commerce_orders = await prisma.commerce_orders.delete({
     *   where: {
     *     // ... filter to delete one Commerce_orders
     *   }
     * })
     * 
    **/
    delete<T extends Commerce_ordersDeleteArgs>(
      args: SelectSubset<T, Commerce_ordersDeleteArgs>
    ): Prisma__Commerce_ordersClient<Commerce_ordersGetPayload<T>>

    /**
     * Update one Commerce_orders.
     * @param {Commerce_ordersUpdateArgs} args - Arguments to update one Commerce_orders.
     * @example
     * // Update one Commerce_orders
     * const commerce_orders = await prisma.commerce_orders.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends Commerce_ordersUpdateArgs>(
      args: SelectSubset<T, Commerce_ordersUpdateArgs>
    ): Prisma__Commerce_ordersClient<Commerce_ordersGetPayload<T>>

    /**
     * Delete zero or more Commerce_orders.
     * @param {Commerce_ordersDeleteManyArgs} args - Arguments to filter Commerce_orders to delete.
     * @example
     * // Delete a few Commerce_orders
     * const { count } = await prisma.commerce_orders.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends Commerce_ordersDeleteManyArgs>(
      args?: SelectSubset<T, Commerce_ordersDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Commerce_orders.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Commerce_ordersUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Commerce_orders
     * const commerce_orders = await prisma.commerce_orders.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends Commerce_ordersUpdateManyArgs>(
      args: SelectSubset<T, Commerce_ordersUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Commerce_orders.
     * @param {Commerce_ordersUpsertArgs} args - Arguments to update or create a Commerce_orders.
     * @example
     * // Update or create a Commerce_orders
     * const commerce_orders = await prisma.commerce_orders.upsert({
     *   create: {
     *     // ... data to create a Commerce_orders
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Commerce_orders we want to update
     *   }
     * })
    **/
    upsert<T extends Commerce_ordersUpsertArgs>(
      args: SelectSubset<T, Commerce_ordersUpsertArgs>
    ): Prisma__Commerce_ordersClient<Commerce_ordersGetPayload<T>>

    /**
     * Count the number of Commerce_orders.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Commerce_ordersCountArgs} args - Arguments to filter Commerce_orders to count.
     * @example
     * // Count the number of Commerce_orders
     * const count = await prisma.commerce_orders.count({
     *   where: {
     *     // ... the filter for the Commerce_orders we want to count
     *   }
     * })
    **/
    count<T extends Commerce_ordersCountArgs>(
      args?: Subset<T, Commerce_ordersCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Commerce_ordersCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Commerce_orders.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Commerce_ordersAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Commerce_ordersAggregateArgs>(args: Subset<T, Commerce_ordersAggregateArgs>): PrismaPromise<GetCommerce_ordersAggregateType<T>>

    /**
     * Group by Commerce_orders.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Commerce_ordersGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends Commerce_ordersGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: Commerce_ordersGroupByArgs['orderBy'] }
        : { orderBy?: Commerce_ordersGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, Commerce_ordersGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetCommerce_ordersGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Commerce_orders.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__Commerce_ordersClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';


    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Commerce_orders base type for findUnique actions
   */
  export type Commerce_ordersFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Commerce_orders
     * 
    **/
    select?: Commerce_ordersSelect | null
    /**
     * Filter, which Commerce_orders to fetch.
     * 
    **/
    where: Commerce_ordersWhereUniqueInput
  }

  /**
   * Commerce_orders findUnique
   */
  export interface Commerce_ordersFindUniqueArgs extends Commerce_ordersFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Commerce_orders findUniqueOrThrow
   */
  export type Commerce_ordersFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Commerce_orders
     * 
    **/
    select?: Commerce_ordersSelect | null
    /**
     * Filter, which Commerce_orders to fetch.
     * 
    **/
    where: Commerce_ordersWhereUniqueInput
  }


  /**
   * Commerce_orders base type for findFirst actions
   */
  export type Commerce_ordersFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Commerce_orders
     * 
    **/
    select?: Commerce_ordersSelect | null
    /**
     * Filter, which Commerce_orders to fetch.
     * 
    **/
    where?: Commerce_ordersWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Commerce_orders to fetch.
     * 
    **/
    orderBy?: Enumerable<Commerce_ordersOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Commerce_orders.
     * 
    **/
    cursor?: Commerce_ordersWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Commerce_orders from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Commerce_orders.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Commerce_orders.
     * 
    **/
    distinct?: Enumerable<Commerce_ordersScalarFieldEnum>
  }

  /**
   * Commerce_orders findFirst
   */
  export interface Commerce_ordersFindFirstArgs extends Commerce_ordersFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Commerce_orders findFirstOrThrow
   */
  export type Commerce_ordersFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Commerce_orders
     * 
    **/
    select?: Commerce_ordersSelect | null
    /**
     * Filter, which Commerce_orders to fetch.
     * 
    **/
    where?: Commerce_ordersWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Commerce_orders to fetch.
     * 
    **/
    orderBy?: Enumerable<Commerce_ordersOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Commerce_orders.
     * 
    **/
    cursor?: Commerce_ordersWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Commerce_orders from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Commerce_orders.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Commerce_orders.
     * 
    **/
    distinct?: Enumerable<Commerce_ordersScalarFieldEnum>
  }


  /**
   * Commerce_orders findMany
   */
  export type Commerce_ordersFindManyArgs = {
    /**
     * Select specific fields to fetch from the Commerce_orders
     * 
    **/
    select?: Commerce_ordersSelect | null
    /**
     * Filter, which Commerce_orders to fetch.
     * 
    **/
    where?: Commerce_ordersWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Commerce_orders to fetch.
     * 
    **/
    orderBy?: Enumerable<Commerce_ordersOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Commerce_orders.
     * 
    **/
    cursor?: Commerce_ordersWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Commerce_orders from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Commerce_orders.
     * 
    **/
    skip?: number
    distinct?: Enumerable<Commerce_ordersScalarFieldEnum>
  }


  /**
   * Commerce_orders create
   */
  export type Commerce_ordersCreateArgs = {
    /**
     * Select specific fields to fetch from the Commerce_orders
     * 
    **/
    select?: Commerce_ordersSelect | null
    /**
     * The data needed to create a Commerce_orders.
     * 
    **/
    data: XOR<Commerce_ordersCreateInput, Commerce_ordersUncheckedCreateInput>
  }


  /**
   * Commerce_orders createMany
   */
  export type Commerce_ordersCreateManyArgs = {
    /**
     * The data used to create many Commerce_orders.
     * 
    **/
    data: Enumerable<Commerce_ordersCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Commerce_orders update
   */
  export type Commerce_ordersUpdateArgs = {
    /**
     * Select specific fields to fetch from the Commerce_orders
     * 
    **/
    select?: Commerce_ordersSelect | null
    /**
     * The data needed to update a Commerce_orders.
     * 
    **/
    data: XOR<Commerce_ordersUpdateInput, Commerce_ordersUncheckedUpdateInput>
    /**
     * Choose, which Commerce_orders to update.
     * 
    **/
    where: Commerce_ordersWhereUniqueInput
  }


  /**
   * Commerce_orders updateMany
   */
  export type Commerce_ordersUpdateManyArgs = {
    /**
     * The data used to update Commerce_orders.
     * 
    **/
    data: XOR<Commerce_ordersUpdateManyMutationInput, Commerce_ordersUncheckedUpdateManyInput>
    /**
     * Filter which Commerce_orders to update
     * 
    **/
    where?: Commerce_ordersWhereInput
  }


  /**
   * Commerce_orders upsert
   */
  export type Commerce_ordersUpsertArgs = {
    /**
     * Select specific fields to fetch from the Commerce_orders
     * 
    **/
    select?: Commerce_ordersSelect | null
    /**
     * The filter to search for the Commerce_orders to update in case it exists.
     * 
    **/
    where: Commerce_ordersWhereUniqueInput
    /**
     * In case the Commerce_orders found by the `where` argument doesn't exist, create a new Commerce_orders with this data.
     * 
    **/
    create: XOR<Commerce_ordersCreateInput, Commerce_ordersUncheckedCreateInput>
    /**
     * In case the Commerce_orders was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<Commerce_ordersUpdateInput, Commerce_ordersUncheckedUpdateInput>
  }


  /**
   * Commerce_orders delete
   */
  export type Commerce_ordersDeleteArgs = {
    /**
     * Select specific fields to fetch from the Commerce_orders
     * 
    **/
    select?: Commerce_ordersSelect | null
    /**
     * Filter which Commerce_orders to delete.
     * 
    **/
    where: Commerce_ordersWhereUniqueInput
  }


  /**
   * Commerce_orders deleteMany
   */
  export type Commerce_ordersDeleteManyArgs = {
    /**
     * Filter which Commerce_orders to delete
     * 
    **/
    where?: Commerce_ordersWhereInput
  }


  /**
   * Commerce_orders without action
   */
  export type Commerce_ordersArgs = {
    /**
     * Select specific fields to fetch from the Commerce_orders
     * 
    **/
    select?: Commerce_ordersSelect | null
  }



  /**
   * Model Logs
   */


  export type AggregateLogs = {
    _count: LogsCountAggregateOutputType | null
    _min: LogsMinAggregateOutputType | null
    _max: LogsMaxAggregateOutputType | null
  }

  export type LogsMinAggregateOutputType = {
    id: string | null
    source_id: string | null
    timestamp: Date | null
    content: string | null
  }

  export type LogsMaxAggregateOutputType = {
    id: string | null
    source_id: string | null
    timestamp: Date | null
    content: string | null
  }

  export type LogsCountAggregateOutputType = {
    id: number
    source_id: number
    timestamp: number
    content: number
    _all: number
  }


  export type LogsMinAggregateInputType = {
    id?: true
    source_id?: true
    timestamp?: true
    content?: true
  }

  export type LogsMaxAggregateInputType = {
    id?: true
    source_id?: true
    timestamp?: true
    content?: true
  }

  export type LogsCountAggregateInputType = {
    id?: true
    source_id?: true
    timestamp?: true
    content?: true
    _all?: true
  }

  export type LogsAggregateArgs = {
    /**
     * Filter which Logs to aggregate.
     * 
    **/
    where?: LogsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Logs to fetch.
     * 
    **/
    orderBy?: Enumerable<LogsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: LogsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Logs from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Logs.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Logs
    **/
    _count?: true | LogsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: LogsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: LogsMaxAggregateInputType
  }

  export type GetLogsAggregateType<T extends LogsAggregateArgs> = {
        [P in keyof T & keyof AggregateLogs]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateLogs[P]>
      : GetScalarType<T[P], AggregateLogs[P]>
  }




  export type LogsGroupByArgs = {
    where?: LogsWhereInput
    orderBy?: Enumerable<LogsOrderByWithAggregationInput>
    by: Array<LogsScalarFieldEnum>
    having?: LogsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: LogsCountAggregateInputType | true
    _min?: LogsMinAggregateInputType
    _max?: LogsMaxAggregateInputType
  }


  export type LogsGroupByOutputType = {
    id: string
    source_id: string
    timestamp: Date
    content: string
    _count: LogsCountAggregateOutputType | null
    _min: LogsMinAggregateOutputType | null
    _max: LogsMaxAggregateOutputType | null
  }

  type GetLogsGroupByPayload<T extends LogsGroupByArgs> = PrismaPromise<
    Array<
      PickArray<LogsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof LogsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], LogsGroupByOutputType[P]>
            : GetScalarType<T[P], LogsGroupByOutputType[P]>
        }
      >
    >


  export type LogsSelect = {
    id?: boolean
    source_id?: boolean
    timestamp?: boolean
    content?: boolean
  }


  export type LogsGetPayload<S extends boolean | null | undefined | LogsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Logs :
    S extends undefined ? never :
    S extends { include: any } & (LogsArgs | LogsFindManyArgs)
    ? Logs 
    : S extends { select: any } & (LogsArgs | LogsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Logs ? Logs[P] : never
  } 
      : Logs


  type LogsCountArgs = Merge<
    Omit<LogsFindManyArgs, 'select' | 'include'> & {
      select?: LogsCountAggregateInputType | true
    }
  >

  export interface LogsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Logs that matches the filter.
     * @param {LogsFindUniqueArgs} args - Arguments to find a Logs
     * @example
     * // Get one Logs
     * const logs = await prisma.logs.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends LogsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, LogsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Logs'> extends True ? Prisma__LogsClient<LogsGetPayload<T>> : Prisma__LogsClient<LogsGetPayload<T> | null, null>

    /**
     * Find one Logs that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {LogsFindUniqueOrThrowArgs} args - Arguments to find a Logs
     * @example
     * // Get one Logs
     * const logs = await prisma.logs.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends LogsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, LogsFindUniqueOrThrowArgs>
    ): Prisma__LogsClient<LogsGetPayload<T>>

    /**
     * Find the first Logs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogsFindFirstArgs} args - Arguments to find a Logs
     * @example
     * // Get one Logs
     * const logs = await prisma.logs.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends LogsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, LogsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Logs'> extends True ? Prisma__LogsClient<LogsGetPayload<T>> : Prisma__LogsClient<LogsGetPayload<T> | null, null>

    /**
     * Find the first Logs that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogsFindFirstOrThrowArgs} args - Arguments to find a Logs
     * @example
     * // Get one Logs
     * const logs = await prisma.logs.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends LogsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, LogsFindFirstOrThrowArgs>
    ): Prisma__LogsClient<LogsGetPayload<T>>

    /**
     * Find zero or more Logs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Logs
     * const logs = await prisma.logs.findMany()
     * 
     * // Get first 10 Logs
     * const logs = await prisma.logs.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const logsWithIdOnly = await prisma.logs.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends LogsFindManyArgs>(
      args?: SelectSubset<T, LogsFindManyArgs>
    ): PrismaPromise<Array<LogsGetPayload<T>>>

    /**
     * Create a Logs.
     * @param {LogsCreateArgs} args - Arguments to create a Logs.
     * @example
     * // Create one Logs
     * const Logs = await prisma.logs.create({
     *   data: {
     *     // ... data to create a Logs
     *   }
     * })
     * 
    **/
    create<T extends LogsCreateArgs>(
      args: SelectSubset<T, LogsCreateArgs>
    ): Prisma__LogsClient<LogsGetPayload<T>>

    /**
     * Create many Logs.
     *     @param {LogsCreateManyArgs} args - Arguments to create many Logs.
     *     @example
     *     // Create many Logs
     *     const logs = await prisma.logs.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends LogsCreateManyArgs>(
      args?: SelectSubset<T, LogsCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Logs.
     * @param {LogsDeleteArgs} args - Arguments to delete one Logs.
     * @example
     * // Delete one Logs
     * const Logs = await prisma.logs.delete({
     *   where: {
     *     // ... filter to delete one Logs
     *   }
     * })
     * 
    **/
    delete<T extends LogsDeleteArgs>(
      args: SelectSubset<T, LogsDeleteArgs>
    ): Prisma__LogsClient<LogsGetPayload<T>>

    /**
     * Update one Logs.
     * @param {LogsUpdateArgs} args - Arguments to update one Logs.
     * @example
     * // Update one Logs
     * const logs = await prisma.logs.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends LogsUpdateArgs>(
      args: SelectSubset<T, LogsUpdateArgs>
    ): Prisma__LogsClient<LogsGetPayload<T>>

    /**
     * Delete zero or more Logs.
     * @param {LogsDeleteManyArgs} args - Arguments to filter Logs to delete.
     * @example
     * // Delete a few Logs
     * const { count } = await prisma.logs.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends LogsDeleteManyArgs>(
      args?: SelectSubset<T, LogsDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Logs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Logs
     * const logs = await prisma.logs.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends LogsUpdateManyArgs>(
      args: SelectSubset<T, LogsUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Logs.
     * @param {LogsUpsertArgs} args - Arguments to update or create a Logs.
     * @example
     * // Update or create a Logs
     * const logs = await prisma.logs.upsert({
     *   create: {
     *     // ... data to create a Logs
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Logs we want to update
     *   }
     * })
    **/
    upsert<T extends LogsUpsertArgs>(
      args: SelectSubset<T, LogsUpsertArgs>
    ): Prisma__LogsClient<LogsGetPayload<T>>

    /**
     * Count the number of Logs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogsCountArgs} args - Arguments to filter Logs to count.
     * @example
     * // Count the number of Logs
     * const count = await prisma.logs.count({
     *   where: {
     *     // ... the filter for the Logs we want to count
     *   }
     * })
    **/
    count<T extends LogsCountArgs>(
      args?: Subset<T, LogsCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], LogsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Logs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends LogsAggregateArgs>(args: Subset<T, LogsAggregateArgs>): PrismaPromise<GetLogsAggregateType<T>>

    /**
     * Group by Logs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LogsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends LogsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: LogsGroupByArgs['orderBy'] }
        : { orderBy?: LogsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, LogsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetLogsGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Logs.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__LogsClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';


    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Logs base type for findUnique actions
   */
  export type LogsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Logs
     * 
    **/
    select?: LogsSelect | null
    /**
     * Filter, which Logs to fetch.
     * 
    **/
    where: LogsWhereUniqueInput
  }

  /**
   * Logs findUnique
   */
  export interface LogsFindUniqueArgs extends LogsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Logs findUniqueOrThrow
   */
  export type LogsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Logs
     * 
    **/
    select?: LogsSelect | null
    /**
     * Filter, which Logs to fetch.
     * 
    **/
    where: LogsWhereUniqueInput
  }


  /**
   * Logs base type for findFirst actions
   */
  export type LogsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Logs
     * 
    **/
    select?: LogsSelect | null
    /**
     * Filter, which Logs to fetch.
     * 
    **/
    where?: LogsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Logs to fetch.
     * 
    **/
    orderBy?: Enumerable<LogsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Logs.
     * 
    **/
    cursor?: LogsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Logs from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Logs.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Logs.
     * 
    **/
    distinct?: Enumerable<LogsScalarFieldEnum>
  }

  /**
   * Logs findFirst
   */
  export interface LogsFindFirstArgs extends LogsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Logs findFirstOrThrow
   */
  export type LogsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Logs
     * 
    **/
    select?: LogsSelect | null
    /**
     * Filter, which Logs to fetch.
     * 
    **/
    where?: LogsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Logs to fetch.
     * 
    **/
    orderBy?: Enumerable<LogsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Logs.
     * 
    **/
    cursor?: LogsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Logs from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Logs.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Logs.
     * 
    **/
    distinct?: Enumerable<LogsScalarFieldEnum>
  }


  /**
   * Logs findMany
   */
  export type LogsFindManyArgs = {
    /**
     * Select specific fields to fetch from the Logs
     * 
    **/
    select?: LogsSelect | null
    /**
     * Filter, which Logs to fetch.
     * 
    **/
    where?: LogsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Logs to fetch.
     * 
    **/
    orderBy?: Enumerable<LogsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Logs.
     * 
    **/
    cursor?: LogsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Logs from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Logs.
     * 
    **/
    skip?: number
    distinct?: Enumerable<LogsScalarFieldEnum>
  }


  /**
   * Logs create
   */
  export type LogsCreateArgs = {
    /**
     * Select specific fields to fetch from the Logs
     * 
    **/
    select?: LogsSelect | null
    /**
     * The data needed to create a Logs.
     * 
    **/
    data: XOR<LogsCreateInput, LogsUncheckedCreateInput>
  }


  /**
   * Logs createMany
   */
  export type LogsCreateManyArgs = {
    /**
     * The data used to create many Logs.
     * 
    **/
    data: Enumerable<LogsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Logs update
   */
  export type LogsUpdateArgs = {
    /**
     * Select specific fields to fetch from the Logs
     * 
    **/
    select?: LogsSelect | null
    /**
     * The data needed to update a Logs.
     * 
    **/
    data: XOR<LogsUpdateInput, LogsUncheckedUpdateInput>
    /**
     * Choose, which Logs to update.
     * 
    **/
    where: LogsWhereUniqueInput
  }


  /**
   * Logs updateMany
   */
  export type LogsUpdateManyArgs = {
    /**
     * The data used to update Logs.
     * 
    **/
    data: XOR<LogsUpdateManyMutationInput, LogsUncheckedUpdateManyInput>
    /**
     * Filter which Logs to update
     * 
    **/
    where?: LogsWhereInput
  }


  /**
   * Logs upsert
   */
  export type LogsUpsertArgs = {
    /**
     * Select specific fields to fetch from the Logs
     * 
    **/
    select?: LogsSelect | null
    /**
     * The filter to search for the Logs to update in case it exists.
     * 
    **/
    where: LogsWhereUniqueInput
    /**
     * In case the Logs found by the `where` argument doesn't exist, create a new Logs with this data.
     * 
    **/
    create: XOR<LogsCreateInput, LogsUncheckedCreateInput>
    /**
     * In case the Logs was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<LogsUpdateInput, LogsUncheckedUpdateInput>
  }


  /**
   * Logs delete
   */
  export type LogsDeleteArgs = {
    /**
     * Select specific fields to fetch from the Logs
     * 
    **/
    select?: LogsSelect | null
    /**
     * Filter which Logs to delete.
     * 
    **/
    where: LogsWhereUniqueInput
  }


  /**
   * Logs deleteMany
   */
  export type LogsDeleteManyArgs = {
    /**
     * Filter which Logs to delete
     * 
    **/
    where?: LogsWhereInput
  }


  /**
   * Logs without action
   */
  export type LogsArgs = {
    /**
     * Select specific fields to fetch from the Logs
     * 
    **/
    select?: LogsSelect | null
  }



  /**
   * Model Monitoring
   */


  export type AggregateMonitoring = {
    _count: MonitoringCountAggregateOutputType | null
    _avg: MonitoringAvgAggregateOutputType | null
    _sum: MonitoringSumAggregateOutputType | null
    _min: MonitoringMinAggregateOutputType | null
    _max: MonitoringMaxAggregateOutputType | null
  }

  export type MonitoringAvgAggregateOutputType = {
    value: number | null
  }

  export type MonitoringSumAggregateOutputType = {
    value: number | null
  }

  export type MonitoringMinAggregateOutputType = {
    id: string | null
    timestamp: Date | null
    type: string | null
    value: number | null
  }

  export type MonitoringMaxAggregateOutputType = {
    id: string | null
    timestamp: Date | null
    type: string | null
    value: number | null
  }

  export type MonitoringCountAggregateOutputType = {
    id: number
    timestamp: number
    type: number
    value: number
    _all: number
  }


  export type MonitoringAvgAggregateInputType = {
    value?: true
  }

  export type MonitoringSumAggregateInputType = {
    value?: true
  }

  export type MonitoringMinAggregateInputType = {
    id?: true
    timestamp?: true
    type?: true
    value?: true
  }

  export type MonitoringMaxAggregateInputType = {
    id?: true
    timestamp?: true
    type?: true
    value?: true
  }

  export type MonitoringCountAggregateInputType = {
    id?: true
    timestamp?: true
    type?: true
    value?: true
    _all?: true
  }

  export type MonitoringAggregateArgs = {
    /**
     * Filter which Monitoring to aggregate.
     * 
    **/
    where?: MonitoringWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Monitorings to fetch.
     * 
    **/
    orderBy?: Enumerable<MonitoringOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: MonitoringWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Monitorings from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Monitorings.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Monitorings
    **/
    _count?: true | MonitoringCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: MonitoringAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: MonitoringSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: MonitoringMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: MonitoringMaxAggregateInputType
  }

  export type GetMonitoringAggregateType<T extends MonitoringAggregateArgs> = {
        [P in keyof T & keyof AggregateMonitoring]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateMonitoring[P]>
      : GetScalarType<T[P], AggregateMonitoring[P]>
  }




  export type MonitoringGroupByArgs = {
    where?: MonitoringWhereInput
    orderBy?: Enumerable<MonitoringOrderByWithAggregationInput>
    by: Array<MonitoringScalarFieldEnum>
    having?: MonitoringScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: MonitoringCountAggregateInputType | true
    _avg?: MonitoringAvgAggregateInputType
    _sum?: MonitoringSumAggregateInputType
    _min?: MonitoringMinAggregateInputType
    _max?: MonitoringMaxAggregateInputType
  }


  export type MonitoringGroupByOutputType = {
    id: string
    timestamp: Date
    type: string
    value: number
    _count: MonitoringCountAggregateOutputType | null
    _avg: MonitoringAvgAggregateOutputType | null
    _sum: MonitoringSumAggregateOutputType | null
    _min: MonitoringMinAggregateOutputType | null
    _max: MonitoringMaxAggregateOutputType | null
  }

  type GetMonitoringGroupByPayload<T extends MonitoringGroupByArgs> = PrismaPromise<
    Array<
      PickArray<MonitoringGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof MonitoringGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], MonitoringGroupByOutputType[P]>
            : GetScalarType<T[P], MonitoringGroupByOutputType[P]>
        }
      >
    >


  export type MonitoringSelect = {
    id?: boolean
    timestamp?: boolean
    type?: boolean
    value?: boolean
  }


  export type MonitoringGetPayload<S extends boolean | null | undefined | MonitoringArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Monitoring :
    S extends undefined ? never :
    S extends { include: any } & (MonitoringArgs | MonitoringFindManyArgs)
    ? Monitoring 
    : S extends { select: any } & (MonitoringArgs | MonitoringFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Monitoring ? Monitoring[P] : never
  } 
      : Monitoring


  type MonitoringCountArgs = Merge<
    Omit<MonitoringFindManyArgs, 'select' | 'include'> & {
      select?: MonitoringCountAggregateInputType | true
    }
  >

  export interface MonitoringDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Monitoring that matches the filter.
     * @param {MonitoringFindUniqueArgs} args - Arguments to find a Monitoring
     * @example
     * // Get one Monitoring
     * const monitoring = await prisma.monitoring.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends MonitoringFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, MonitoringFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Monitoring'> extends True ? Prisma__MonitoringClient<MonitoringGetPayload<T>> : Prisma__MonitoringClient<MonitoringGetPayload<T> | null, null>

    /**
     * Find one Monitoring that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {MonitoringFindUniqueOrThrowArgs} args - Arguments to find a Monitoring
     * @example
     * // Get one Monitoring
     * const monitoring = await prisma.monitoring.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends MonitoringFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, MonitoringFindUniqueOrThrowArgs>
    ): Prisma__MonitoringClient<MonitoringGetPayload<T>>

    /**
     * Find the first Monitoring that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MonitoringFindFirstArgs} args - Arguments to find a Monitoring
     * @example
     * // Get one Monitoring
     * const monitoring = await prisma.monitoring.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends MonitoringFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, MonitoringFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Monitoring'> extends True ? Prisma__MonitoringClient<MonitoringGetPayload<T>> : Prisma__MonitoringClient<MonitoringGetPayload<T> | null, null>

    /**
     * Find the first Monitoring that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MonitoringFindFirstOrThrowArgs} args - Arguments to find a Monitoring
     * @example
     * // Get one Monitoring
     * const monitoring = await prisma.monitoring.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends MonitoringFindFirstOrThrowArgs>(
      args?: SelectSubset<T, MonitoringFindFirstOrThrowArgs>
    ): Prisma__MonitoringClient<MonitoringGetPayload<T>>

    /**
     * Find zero or more Monitorings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MonitoringFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Monitorings
     * const monitorings = await prisma.monitoring.findMany()
     * 
     * // Get first 10 Monitorings
     * const monitorings = await prisma.monitoring.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const monitoringWithIdOnly = await prisma.monitoring.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends MonitoringFindManyArgs>(
      args?: SelectSubset<T, MonitoringFindManyArgs>
    ): PrismaPromise<Array<MonitoringGetPayload<T>>>

    /**
     * Create a Monitoring.
     * @param {MonitoringCreateArgs} args - Arguments to create a Monitoring.
     * @example
     * // Create one Monitoring
     * const Monitoring = await prisma.monitoring.create({
     *   data: {
     *     // ... data to create a Monitoring
     *   }
     * })
     * 
    **/
    create<T extends MonitoringCreateArgs>(
      args: SelectSubset<T, MonitoringCreateArgs>
    ): Prisma__MonitoringClient<MonitoringGetPayload<T>>

    /**
     * Create many Monitorings.
     *     @param {MonitoringCreateManyArgs} args - Arguments to create many Monitorings.
     *     @example
     *     // Create many Monitorings
     *     const monitoring = await prisma.monitoring.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends MonitoringCreateManyArgs>(
      args?: SelectSubset<T, MonitoringCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Monitoring.
     * @param {MonitoringDeleteArgs} args - Arguments to delete one Monitoring.
     * @example
     * // Delete one Monitoring
     * const Monitoring = await prisma.monitoring.delete({
     *   where: {
     *     // ... filter to delete one Monitoring
     *   }
     * })
     * 
    **/
    delete<T extends MonitoringDeleteArgs>(
      args: SelectSubset<T, MonitoringDeleteArgs>
    ): Prisma__MonitoringClient<MonitoringGetPayload<T>>

    /**
     * Update one Monitoring.
     * @param {MonitoringUpdateArgs} args - Arguments to update one Monitoring.
     * @example
     * // Update one Monitoring
     * const monitoring = await prisma.monitoring.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends MonitoringUpdateArgs>(
      args: SelectSubset<T, MonitoringUpdateArgs>
    ): Prisma__MonitoringClient<MonitoringGetPayload<T>>

    /**
     * Delete zero or more Monitorings.
     * @param {MonitoringDeleteManyArgs} args - Arguments to filter Monitorings to delete.
     * @example
     * // Delete a few Monitorings
     * const { count } = await prisma.monitoring.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends MonitoringDeleteManyArgs>(
      args?: SelectSubset<T, MonitoringDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Monitorings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MonitoringUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Monitorings
     * const monitoring = await prisma.monitoring.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends MonitoringUpdateManyArgs>(
      args: SelectSubset<T, MonitoringUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Monitoring.
     * @param {MonitoringUpsertArgs} args - Arguments to update or create a Monitoring.
     * @example
     * // Update or create a Monitoring
     * const monitoring = await prisma.monitoring.upsert({
     *   create: {
     *     // ... data to create a Monitoring
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Monitoring we want to update
     *   }
     * })
    **/
    upsert<T extends MonitoringUpsertArgs>(
      args: SelectSubset<T, MonitoringUpsertArgs>
    ): Prisma__MonitoringClient<MonitoringGetPayload<T>>

    /**
     * Count the number of Monitorings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MonitoringCountArgs} args - Arguments to filter Monitorings to count.
     * @example
     * // Count the number of Monitorings
     * const count = await prisma.monitoring.count({
     *   where: {
     *     // ... the filter for the Monitorings we want to count
     *   }
     * })
    **/
    count<T extends MonitoringCountArgs>(
      args?: Subset<T, MonitoringCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], MonitoringCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Monitoring.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MonitoringAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends MonitoringAggregateArgs>(args: Subset<T, MonitoringAggregateArgs>): PrismaPromise<GetMonitoringAggregateType<T>>

    /**
     * Group by Monitoring.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MonitoringGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends MonitoringGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: MonitoringGroupByArgs['orderBy'] }
        : { orderBy?: MonitoringGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, MonitoringGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetMonitoringGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Monitoring.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__MonitoringClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';


    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Monitoring base type for findUnique actions
   */
  export type MonitoringFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Monitoring
     * 
    **/
    select?: MonitoringSelect | null
    /**
     * Filter, which Monitoring to fetch.
     * 
    **/
    where: MonitoringWhereUniqueInput
  }

  /**
   * Monitoring findUnique
   */
  export interface MonitoringFindUniqueArgs extends MonitoringFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Monitoring findUniqueOrThrow
   */
  export type MonitoringFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Monitoring
     * 
    **/
    select?: MonitoringSelect | null
    /**
     * Filter, which Monitoring to fetch.
     * 
    **/
    where: MonitoringWhereUniqueInput
  }


  /**
   * Monitoring base type for findFirst actions
   */
  export type MonitoringFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Monitoring
     * 
    **/
    select?: MonitoringSelect | null
    /**
     * Filter, which Monitoring to fetch.
     * 
    **/
    where?: MonitoringWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Monitorings to fetch.
     * 
    **/
    orderBy?: Enumerable<MonitoringOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Monitorings.
     * 
    **/
    cursor?: MonitoringWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Monitorings from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Monitorings.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Monitorings.
     * 
    **/
    distinct?: Enumerable<MonitoringScalarFieldEnum>
  }

  /**
   * Monitoring findFirst
   */
  export interface MonitoringFindFirstArgs extends MonitoringFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Monitoring findFirstOrThrow
   */
  export type MonitoringFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Monitoring
     * 
    **/
    select?: MonitoringSelect | null
    /**
     * Filter, which Monitoring to fetch.
     * 
    **/
    where?: MonitoringWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Monitorings to fetch.
     * 
    **/
    orderBy?: Enumerable<MonitoringOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Monitorings.
     * 
    **/
    cursor?: MonitoringWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Monitorings from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Monitorings.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Monitorings.
     * 
    **/
    distinct?: Enumerable<MonitoringScalarFieldEnum>
  }


  /**
   * Monitoring findMany
   */
  export type MonitoringFindManyArgs = {
    /**
     * Select specific fields to fetch from the Monitoring
     * 
    **/
    select?: MonitoringSelect | null
    /**
     * Filter, which Monitorings to fetch.
     * 
    **/
    where?: MonitoringWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Monitorings to fetch.
     * 
    **/
    orderBy?: Enumerable<MonitoringOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Monitorings.
     * 
    **/
    cursor?: MonitoringWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Monitorings from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Monitorings.
     * 
    **/
    skip?: number
    distinct?: Enumerable<MonitoringScalarFieldEnum>
  }


  /**
   * Monitoring create
   */
  export type MonitoringCreateArgs = {
    /**
     * Select specific fields to fetch from the Monitoring
     * 
    **/
    select?: MonitoringSelect | null
    /**
     * The data needed to create a Monitoring.
     * 
    **/
    data: XOR<MonitoringCreateInput, MonitoringUncheckedCreateInput>
  }


  /**
   * Monitoring createMany
   */
  export type MonitoringCreateManyArgs = {
    /**
     * The data used to create many Monitorings.
     * 
    **/
    data: Enumerable<MonitoringCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Monitoring update
   */
  export type MonitoringUpdateArgs = {
    /**
     * Select specific fields to fetch from the Monitoring
     * 
    **/
    select?: MonitoringSelect | null
    /**
     * The data needed to update a Monitoring.
     * 
    **/
    data: XOR<MonitoringUpdateInput, MonitoringUncheckedUpdateInput>
    /**
     * Choose, which Monitoring to update.
     * 
    **/
    where: MonitoringWhereUniqueInput
  }


  /**
   * Monitoring updateMany
   */
  export type MonitoringUpdateManyArgs = {
    /**
     * The data used to update Monitorings.
     * 
    **/
    data: XOR<MonitoringUpdateManyMutationInput, MonitoringUncheckedUpdateManyInput>
    /**
     * Filter which Monitorings to update
     * 
    **/
    where?: MonitoringWhereInput
  }


  /**
   * Monitoring upsert
   */
  export type MonitoringUpsertArgs = {
    /**
     * Select specific fields to fetch from the Monitoring
     * 
    **/
    select?: MonitoringSelect | null
    /**
     * The filter to search for the Monitoring to update in case it exists.
     * 
    **/
    where: MonitoringWhereUniqueInput
    /**
     * In case the Monitoring found by the `where` argument doesn't exist, create a new Monitoring with this data.
     * 
    **/
    create: XOR<MonitoringCreateInput, MonitoringUncheckedCreateInput>
    /**
     * In case the Monitoring was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<MonitoringUpdateInput, MonitoringUncheckedUpdateInput>
  }


  /**
   * Monitoring delete
   */
  export type MonitoringDeleteArgs = {
    /**
     * Select specific fields to fetch from the Monitoring
     * 
    **/
    select?: MonitoringSelect | null
    /**
     * Filter which Monitoring to delete.
     * 
    **/
    where: MonitoringWhereUniqueInput
  }


  /**
   * Monitoring deleteMany
   */
  export type MonitoringDeleteManyArgs = {
    /**
     * Filter which Monitorings to delete
     * 
    **/
    where?: MonitoringWhereInput
  }


  /**
   * Monitoring without action
   */
  export type MonitoringArgs = {
    /**
     * Select specific fields to fetch from the Monitoring
     * 
    **/
    select?: MonitoringSelect | null
  }



  /**
   * Model Requests
   */


  export type AggregateRequests = {
    _count: RequestsCountAggregateOutputType | null
    _min: RequestsMinAggregateOutputType | null
    _max: RequestsMaxAggregateOutputType | null
  }

  export type RequestsMinAggregateOutputType = {
    id: string | null
    timestamp: Date | null
    path: string | null
    method: string | null
    processing: boolean | null
    cancelled: boolean | null
  }

  export type RequestsMaxAggregateOutputType = {
    id: string | null
    timestamp: Date | null
    path: string | null
    method: string | null
    processing: boolean | null
    cancelled: boolean | null
  }

  export type RequestsCountAggregateOutputType = {
    id: number
    timestamp: number
    path: number
    method: number
    data: number
    processing: number
    cancelled: number
    _all: number
  }


  export type RequestsMinAggregateInputType = {
    id?: true
    timestamp?: true
    path?: true
    method?: true
    processing?: true
    cancelled?: true
  }

  export type RequestsMaxAggregateInputType = {
    id?: true
    timestamp?: true
    path?: true
    method?: true
    processing?: true
    cancelled?: true
  }

  export type RequestsCountAggregateInputType = {
    id?: true
    timestamp?: true
    path?: true
    method?: true
    data?: true
    processing?: true
    cancelled?: true
    _all?: true
  }

  export type RequestsAggregateArgs = {
    /**
     * Filter which Requests to aggregate.
     * 
    **/
    where?: RequestsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Requests to fetch.
     * 
    **/
    orderBy?: Enumerable<RequestsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: RequestsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Requests from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Requests.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Requests
    **/
    _count?: true | RequestsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: RequestsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: RequestsMaxAggregateInputType
  }

  export type GetRequestsAggregateType<T extends RequestsAggregateArgs> = {
        [P in keyof T & keyof AggregateRequests]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateRequests[P]>
      : GetScalarType<T[P], AggregateRequests[P]>
  }




  export type RequestsGroupByArgs = {
    where?: RequestsWhereInput
    orderBy?: Enumerable<RequestsOrderByWithAggregationInput>
    by: Array<RequestsScalarFieldEnum>
    having?: RequestsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: RequestsCountAggregateInputType | true
    _min?: RequestsMinAggregateInputType
    _max?: RequestsMaxAggregateInputType
  }


  export type RequestsGroupByOutputType = {
    id: string
    timestamp: Date
    path: string
    method: string
    data: JsonValue | null
    processing: boolean
    cancelled: boolean
    _count: RequestsCountAggregateOutputType | null
    _min: RequestsMinAggregateOutputType | null
    _max: RequestsMaxAggregateOutputType | null
  }

  type GetRequestsGroupByPayload<T extends RequestsGroupByArgs> = PrismaPromise<
    Array<
      PickArray<RequestsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof RequestsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], RequestsGroupByOutputType[P]>
            : GetScalarType<T[P], RequestsGroupByOutputType[P]>
        }
      >
    >


  export type RequestsSelect = {
    id?: boolean
    timestamp?: boolean
    path?: boolean
    method?: boolean
    data?: boolean
    processing?: boolean
    cancelled?: boolean
    responses?: boolean | Requests$responsesArgs
    _count?: boolean | RequestsCountOutputTypeArgs
  }


  export type RequestsInclude = {
    responses?: boolean | Requests$responsesArgs
    _count?: boolean | RequestsCountOutputTypeArgs
  } 

  export type RequestsGetPayload<S extends boolean | null | undefined | RequestsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Requests :
    S extends undefined ? never :
    S extends { include: any } & (RequestsArgs | RequestsFindManyArgs)
    ? Requests  & {
    [P in TruthyKeys<S['include']>]:
        P extends 'responses' ? Array < ResponsesGetPayload<S['include'][P]>>  :
        P extends '_count' ? RequestsCountOutputTypeGetPayload<S['include'][P]> :  never
  } 
    : S extends { select: any } & (RequestsArgs | RequestsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
        P extends 'responses' ? Array < ResponsesGetPayload<S['select'][P]>>  :
        P extends '_count' ? RequestsCountOutputTypeGetPayload<S['select'][P]> :  P extends keyof Requests ? Requests[P] : never
  } 
      : Requests


  type RequestsCountArgs = Merge<
    Omit<RequestsFindManyArgs, 'select' | 'include'> & {
      select?: RequestsCountAggregateInputType | true
    }
  >

  export interface RequestsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Requests that matches the filter.
     * @param {RequestsFindUniqueArgs} args - Arguments to find a Requests
     * @example
     * // Get one Requests
     * const requests = await prisma.requests.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends RequestsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, RequestsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Requests'> extends True ? Prisma__RequestsClient<RequestsGetPayload<T>> : Prisma__RequestsClient<RequestsGetPayload<T> | null, null>

    /**
     * Find one Requests that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {RequestsFindUniqueOrThrowArgs} args - Arguments to find a Requests
     * @example
     * // Get one Requests
     * const requests = await prisma.requests.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends RequestsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, RequestsFindUniqueOrThrowArgs>
    ): Prisma__RequestsClient<RequestsGetPayload<T>>

    /**
     * Find the first Requests that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RequestsFindFirstArgs} args - Arguments to find a Requests
     * @example
     * // Get one Requests
     * const requests = await prisma.requests.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends RequestsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, RequestsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Requests'> extends True ? Prisma__RequestsClient<RequestsGetPayload<T>> : Prisma__RequestsClient<RequestsGetPayload<T> | null, null>

    /**
     * Find the first Requests that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RequestsFindFirstOrThrowArgs} args - Arguments to find a Requests
     * @example
     * // Get one Requests
     * const requests = await prisma.requests.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends RequestsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, RequestsFindFirstOrThrowArgs>
    ): Prisma__RequestsClient<RequestsGetPayload<T>>

    /**
     * Find zero or more Requests that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RequestsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Requests
     * const requests = await prisma.requests.findMany()
     * 
     * // Get first 10 Requests
     * const requests = await prisma.requests.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const requestsWithIdOnly = await prisma.requests.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends RequestsFindManyArgs>(
      args?: SelectSubset<T, RequestsFindManyArgs>
    ): PrismaPromise<Array<RequestsGetPayload<T>>>

    /**
     * Create a Requests.
     * @param {RequestsCreateArgs} args - Arguments to create a Requests.
     * @example
     * // Create one Requests
     * const Requests = await prisma.requests.create({
     *   data: {
     *     // ... data to create a Requests
     *   }
     * })
     * 
    **/
    create<T extends RequestsCreateArgs>(
      args: SelectSubset<T, RequestsCreateArgs>
    ): Prisma__RequestsClient<RequestsGetPayload<T>>

    /**
     * Create many Requests.
     *     @param {RequestsCreateManyArgs} args - Arguments to create many Requests.
     *     @example
     *     // Create many Requests
     *     const requests = await prisma.requests.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends RequestsCreateManyArgs>(
      args?: SelectSubset<T, RequestsCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Requests.
     * @param {RequestsDeleteArgs} args - Arguments to delete one Requests.
     * @example
     * // Delete one Requests
     * const Requests = await prisma.requests.delete({
     *   where: {
     *     // ... filter to delete one Requests
     *   }
     * })
     * 
    **/
    delete<T extends RequestsDeleteArgs>(
      args: SelectSubset<T, RequestsDeleteArgs>
    ): Prisma__RequestsClient<RequestsGetPayload<T>>

    /**
     * Update one Requests.
     * @param {RequestsUpdateArgs} args - Arguments to update one Requests.
     * @example
     * // Update one Requests
     * const requests = await prisma.requests.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends RequestsUpdateArgs>(
      args: SelectSubset<T, RequestsUpdateArgs>
    ): Prisma__RequestsClient<RequestsGetPayload<T>>

    /**
     * Delete zero or more Requests.
     * @param {RequestsDeleteManyArgs} args - Arguments to filter Requests to delete.
     * @example
     * // Delete a few Requests
     * const { count } = await prisma.requests.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends RequestsDeleteManyArgs>(
      args?: SelectSubset<T, RequestsDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Requests.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RequestsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Requests
     * const requests = await prisma.requests.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends RequestsUpdateManyArgs>(
      args: SelectSubset<T, RequestsUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Requests.
     * @param {RequestsUpsertArgs} args - Arguments to update or create a Requests.
     * @example
     * // Update or create a Requests
     * const requests = await prisma.requests.upsert({
     *   create: {
     *     // ... data to create a Requests
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Requests we want to update
     *   }
     * })
    **/
    upsert<T extends RequestsUpsertArgs>(
      args: SelectSubset<T, RequestsUpsertArgs>
    ): Prisma__RequestsClient<RequestsGetPayload<T>>

    /**
     * Count the number of Requests.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RequestsCountArgs} args - Arguments to filter Requests to count.
     * @example
     * // Count the number of Requests
     * const count = await prisma.requests.count({
     *   where: {
     *     // ... the filter for the Requests we want to count
     *   }
     * })
    **/
    count<T extends RequestsCountArgs>(
      args?: Subset<T, RequestsCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], RequestsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Requests.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RequestsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends RequestsAggregateArgs>(args: Subset<T, RequestsAggregateArgs>): PrismaPromise<GetRequestsAggregateType<T>>

    /**
     * Group by Requests.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RequestsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends RequestsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: RequestsGroupByArgs['orderBy'] }
        : { orderBy?: RequestsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, RequestsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetRequestsGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Requests.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__RequestsClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';

    responses<T extends Requests$responsesArgs= {}>(args?: Subset<T, Requests$responsesArgs>): PrismaPromise<Array<ResponsesGetPayload<T>>| Null>;

    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Requests base type for findUnique actions
   */
  export type RequestsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Requests
     * 
    **/
    select?: RequestsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: RequestsInclude | null
    /**
     * Filter, which Requests to fetch.
     * 
    **/
    where: RequestsWhereUniqueInput
  }

  /**
   * Requests findUnique
   */
  export interface RequestsFindUniqueArgs extends RequestsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Requests findUniqueOrThrow
   */
  export type RequestsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Requests
     * 
    **/
    select?: RequestsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: RequestsInclude | null
    /**
     * Filter, which Requests to fetch.
     * 
    **/
    where: RequestsWhereUniqueInput
  }


  /**
   * Requests base type for findFirst actions
   */
  export type RequestsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Requests
     * 
    **/
    select?: RequestsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: RequestsInclude | null
    /**
     * Filter, which Requests to fetch.
     * 
    **/
    where?: RequestsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Requests to fetch.
     * 
    **/
    orderBy?: Enumerable<RequestsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Requests.
     * 
    **/
    cursor?: RequestsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Requests from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Requests.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Requests.
     * 
    **/
    distinct?: Enumerable<RequestsScalarFieldEnum>
  }

  /**
   * Requests findFirst
   */
  export interface RequestsFindFirstArgs extends RequestsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Requests findFirstOrThrow
   */
  export type RequestsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Requests
     * 
    **/
    select?: RequestsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: RequestsInclude | null
    /**
     * Filter, which Requests to fetch.
     * 
    **/
    where?: RequestsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Requests to fetch.
     * 
    **/
    orderBy?: Enumerable<RequestsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Requests.
     * 
    **/
    cursor?: RequestsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Requests from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Requests.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Requests.
     * 
    **/
    distinct?: Enumerable<RequestsScalarFieldEnum>
  }


  /**
   * Requests findMany
   */
  export type RequestsFindManyArgs = {
    /**
     * Select specific fields to fetch from the Requests
     * 
    **/
    select?: RequestsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: RequestsInclude | null
    /**
     * Filter, which Requests to fetch.
     * 
    **/
    where?: RequestsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Requests to fetch.
     * 
    **/
    orderBy?: Enumerable<RequestsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Requests.
     * 
    **/
    cursor?: RequestsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Requests from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Requests.
     * 
    **/
    skip?: number
    distinct?: Enumerable<RequestsScalarFieldEnum>
  }


  /**
   * Requests create
   */
  export type RequestsCreateArgs = {
    /**
     * Select specific fields to fetch from the Requests
     * 
    **/
    select?: RequestsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: RequestsInclude | null
    /**
     * The data needed to create a Requests.
     * 
    **/
    data: XOR<RequestsCreateInput, RequestsUncheckedCreateInput>
  }


  /**
   * Requests createMany
   */
  export type RequestsCreateManyArgs = {
    /**
     * The data used to create many Requests.
     * 
    **/
    data: Enumerable<RequestsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Requests update
   */
  export type RequestsUpdateArgs = {
    /**
     * Select specific fields to fetch from the Requests
     * 
    **/
    select?: RequestsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: RequestsInclude | null
    /**
     * The data needed to update a Requests.
     * 
    **/
    data: XOR<RequestsUpdateInput, RequestsUncheckedUpdateInput>
    /**
     * Choose, which Requests to update.
     * 
    **/
    where: RequestsWhereUniqueInput
  }


  /**
   * Requests updateMany
   */
  export type RequestsUpdateManyArgs = {
    /**
     * The data used to update Requests.
     * 
    **/
    data: XOR<RequestsUpdateManyMutationInput, RequestsUncheckedUpdateManyInput>
    /**
     * Filter which Requests to update
     * 
    **/
    where?: RequestsWhereInput
  }


  /**
   * Requests upsert
   */
  export type RequestsUpsertArgs = {
    /**
     * Select specific fields to fetch from the Requests
     * 
    **/
    select?: RequestsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: RequestsInclude | null
    /**
     * The filter to search for the Requests to update in case it exists.
     * 
    **/
    where: RequestsWhereUniqueInput
    /**
     * In case the Requests found by the `where` argument doesn't exist, create a new Requests with this data.
     * 
    **/
    create: XOR<RequestsCreateInput, RequestsUncheckedCreateInput>
    /**
     * In case the Requests was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<RequestsUpdateInput, RequestsUncheckedUpdateInput>
  }


  /**
   * Requests delete
   */
  export type RequestsDeleteArgs = {
    /**
     * Select specific fields to fetch from the Requests
     * 
    **/
    select?: RequestsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: RequestsInclude | null
    /**
     * Filter which Requests to delete.
     * 
    **/
    where: RequestsWhereUniqueInput
  }


  /**
   * Requests deleteMany
   */
  export type RequestsDeleteManyArgs = {
    /**
     * Filter which Requests to delete
     * 
    **/
    where?: RequestsWhereInput
  }


  /**
   * Requests.responses
   */
  export type Requests$responsesArgs = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
    where?: ResponsesWhereInput
    orderBy?: Enumerable<ResponsesOrderByWithRelationInput>
    cursor?: ResponsesWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Enumerable<ResponsesScalarFieldEnum>
  }


  /**
   * Requests without action
   */
  export type RequestsArgs = {
    /**
     * Select specific fields to fetch from the Requests
     * 
    **/
    select?: RequestsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: RequestsInclude | null
  }



  /**
   * Model Responses
   */


  export type AggregateResponses = {
    _count: ResponsesCountAggregateOutputType | null
    _avg: ResponsesAvgAggregateOutputType | null
    _sum: ResponsesSumAggregateOutputType | null
    _min: ResponsesMinAggregateOutputType | null
    _max: ResponsesMaxAggregateOutputType | null
  }

  export type ResponsesAvgAggregateOutputType = {
    status_code: number | null
  }

  export type ResponsesSumAggregateOutputType = {
    status_code: number | null
  }

  export type ResponsesMinAggregateOutputType = {
    id: string | null
    timestamp: Date | null
    request_id: string | null
    status_code: number | null
  }

  export type ResponsesMaxAggregateOutputType = {
    id: string | null
    timestamp: Date | null
    request_id: string | null
    status_code: number | null
  }

  export type ResponsesCountAggregateOutputType = {
    id: number
    timestamp: number
    request_id: number
    status_code: number
    data: number
    _all: number
  }


  export type ResponsesAvgAggregateInputType = {
    status_code?: true
  }

  export type ResponsesSumAggregateInputType = {
    status_code?: true
  }

  export type ResponsesMinAggregateInputType = {
    id?: true
    timestamp?: true
    request_id?: true
    status_code?: true
  }

  export type ResponsesMaxAggregateInputType = {
    id?: true
    timestamp?: true
    request_id?: true
    status_code?: true
  }

  export type ResponsesCountAggregateInputType = {
    id?: true
    timestamp?: true
    request_id?: true
    status_code?: true
    data?: true
    _all?: true
  }

  export type ResponsesAggregateArgs = {
    /**
     * Filter which Responses to aggregate.
     * 
    **/
    where?: ResponsesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Responses to fetch.
     * 
    **/
    orderBy?: Enumerable<ResponsesOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: ResponsesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Responses from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Responses.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Responses
    **/
    _count?: true | ResponsesCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ResponsesAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ResponsesSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ResponsesMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ResponsesMaxAggregateInputType
  }

  export type GetResponsesAggregateType<T extends ResponsesAggregateArgs> = {
        [P in keyof T & keyof AggregateResponses]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateResponses[P]>
      : GetScalarType<T[P], AggregateResponses[P]>
  }




  export type ResponsesGroupByArgs = {
    where?: ResponsesWhereInput
    orderBy?: Enumerable<ResponsesOrderByWithAggregationInput>
    by: Array<ResponsesScalarFieldEnum>
    having?: ResponsesScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ResponsesCountAggregateInputType | true
    _avg?: ResponsesAvgAggregateInputType
    _sum?: ResponsesSumAggregateInputType
    _min?: ResponsesMinAggregateInputType
    _max?: ResponsesMaxAggregateInputType
  }


  export type ResponsesGroupByOutputType = {
    id: string
    timestamp: Date
    request_id: string
    status_code: number
    data: JsonValue | null
    _count: ResponsesCountAggregateOutputType | null
    _avg: ResponsesAvgAggregateOutputType | null
    _sum: ResponsesSumAggregateOutputType | null
    _min: ResponsesMinAggregateOutputType | null
    _max: ResponsesMaxAggregateOutputType | null
  }

  type GetResponsesGroupByPayload<T extends ResponsesGroupByArgs> = PrismaPromise<
    Array<
      PickArray<ResponsesGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ResponsesGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ResponsesGroupByOutputType[P]>
            : GetScalarType<T[P], ResponsesGroupByOutputType[P]>
        }
      >
    >


  export type ResponsesSelect = {
    id?: boolean
    timestamp?: boolean
    request_id?: boolean
    status_code?: boolean
    data?: boolean
    requests?: boolean | RequestsArgs
  }


  export type ResponsesInclude = {
    requests?: boolean | RequestsArgs
  } 

  export type ResponsesGetPayload<S extends boolean | null | undefined | ResponsesArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Responses :
    S extends undefined ? never :
    S extends { include: any } & (ResponsesArgs | ResponsesFindManyArgs)
    ? Responses  & {
    [P in TruthyKeys<S['include']>]:
        P extends 'requests' ? RequestsGetPayload<S['include'][P]> :  never
  } 
    : S extends { select: any } & (ResponsesArgs | ResponsesFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
        P extends 'requests' ? RequestsGetPayload<S['select'][P]> :  P extends keyof Responses ? Responses[P] : never
  } 
      : Responses


  type ResponsesCountArgs = Merge<
    Omit<ResponsesFindManyArgs, 'select' | 'include'> & {
      select?: ResponsesCountAggregateInputType | true
    }
  >

  export interface ResponsesDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Responses that matches the filter.
     * @param {ResponsesFindUniqueArgs} args - Arguments to find a Responses
     * @example
     * // Get one Responses
     * const responses = await prisma.responses.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends ResponsesFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, ResponsesFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Responses'> extends True ? Prisma__ResponsesClient<ResponsesGetPayload<T>> : Prisma__ResponsesClient<ResponsesGetPayload<T> | null, null>

    /**
     * Find one Responses that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {ResponsesFindUniqueOrThrowArgs} args - Arguments to find a Responses
     * @example
     * // Get one Responses
     * const responses = await prisma.responses.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends ResponsesFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, ResponsesFindUniqueOrThrowArgs>
    ): Prisma__ResponsesClient<ResponsesGetPayload<T>>

    /**
     * Find the first Responses that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ResponsesFindFirstArgs} args - Arguments to find a Responses
     * @example
     * // Get one Responses
     * const responses = await prisma.responses.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends ResponsesFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, ResponsesFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Responses'> extends True ? Prisma__ResponsesClient<ResponsesGetPayload<T>> : Prisma__ResponsesClient<ResponsesGetPayload<T> | null, null>

    /**
     * Find the first Responses that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ResponsesFindFirstOrThrowArgs} args - Arguments to find a Responses
     * @example
     * // Get one Responses
     * const responses = await prisma.responses.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends ResponsesFindFirstOrThrowArgs>(
      args?: SelectSubset<T, ResponsesFindFirstOrThrowArgs>
    ): Prisma__ResponsesClient<ResponsesGetPayload<T>>

    /**
     * Find zero or more Responses that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ResponsesFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Responses
     * const responses = await prisma.responses.findMany()
     * 
     * // Get first 10 Responses
     * const responses = await prisma.responses.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const responsesWithIdOnly = await prisma.responses.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends ResponsesFindManyArgs>(
      args?: SelectSubset<T, ResponsesFindManyArgs>
    ): PrismaPromise<Array<ResponsesGetPayload<T>>>

    /**
     * Create a Responses.
     * @param {ResponsesCreateArgs} args - Arguments to create a Responses.
     * @example
     * // Create one Responses
     * const Responses = await prisma.responses.create({
     *   data: {
     *     // ... data to create a Responses
     *   }
     * })
     * 
    **/
    create<T extends ResponsesCreateArgs>(
      args: SelectSubset<T, ResponsesCreateArgs>
    ): Prisma__ResponsesClient<ResponsesGetPayload<T>>

    /**
     * Create many Responses.
     *     @param {ResponsesCreateManyArgs} args - Arguments to create many Responses.
     *     @example
     *     // Create many Responses
     *     const responses = await prisma.responses.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends ResponsesCreateManyArgs>(
      args?: SelectSubset<T, ResponsesCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Responses.
     * @param {ResponsesDeleteArgs} args - Arguments to delete one Responses.
     * @example
     * // Delete one Responses
     * const Responses = await prisma.responses.delete({
     *   where: {
     *     // ... filter to delete one Responses
     *   }
     * })
     * 
    **/
    delete<T extends ResponsesDeleteArgs>(
      args: SelectSubset<T, ResponsesDeleteArgs>
    ): Prisma__ResponsesClient<ResponsesGetPayload<T>>

    /**
     * Update one Responses.
     * @param {ResponsesUpdateArgs} args - Arguments to update one Responses.
     * @example
     * // Update one Responses
     * const responses = await prisma.responses.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends ResponsesUpdateArgs>(
      args: SelectSubset<T, ResponsesUpdateArgs>
    ): Prisma__ResponsesClient<ResponsesGetPayload<T>>

    /**
     * Delete zero or more Responses.
     * @param {ResponsesDeleteManyArgs} args - Arguments to filter Responses to delete.
     * @example
     * // Delete a few Responses
     * const { count } = await prisma.responses.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends ResponsesDeleteManyArgs>(
      args?: SelectSubset<T, ResponsesDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Responses.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ResponsesUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Responses
     * const responses = await prisma.responses.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends ResponsesUpdateManyArgs>(
      args: SelectSubset<T, ResponsesUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Responses.
     * @param {ResponsesUpsertArgs} args - Arguments to update or create a Responses.
     * @example
     * // Update or create a Responses
     * const responses = await prisma.responses.upsert({
     *   create: {
     *     // ... data to create a Responses
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Responses we want to update
     *   }
     * })
    **/
    upsert<T extends ResponsesUpsertArgs>(
      args: SelectSubset<T, ResponsesUpsertArgs>
    ): Prisma__ResponsesClient<ResponsesGetPayload<T>>

    /**
     * Count the number of Responses.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ResponsesCountArgs} args - Arguments to filter Responses to count.
     * @example
     * // Count the number of Responses
     * const count = await prisma.responses.count({
     *   where: {
     *     // ... the filter for the Responses we want to count
     *   }
     * })
    **/
    count<T extends ResponsesCountArgs>(
      args?: Subset<T, ResponsesCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ResponsesCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Responses.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ResponsesAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ResponsesAggregateArgs>(args: Subset<T, ResponsesAggregateArgs>): PrismaPromise<GetResponsesAggregateType<T>>

    /**
     * Group by Responses.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ResponsesGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ResponsesGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ResponsesGroupByArgs['orderBy'] }
        : { orderBy?: ResponsesGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ResponsesGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetResponsesGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Responses.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__ResponsesClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';

    requests<T extends RequestsArgs= {}>(args?: Subset<T, RequestsArgs>): Prisma__RequestsClient<RequestsGetPayload<T> | Null>;

    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Responses base type for findUnique actions
   */
  export type ResponsesFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
    /**
     * Filter, which Responses to fetch.
     * 
    **/
    where: ResponsesWhereUniqueInput
  }

  /**
   * Responses findUnique
   */
  export interface ResponsesFindUniqueArgs extends ResponsesFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Responses findUniqueOrThrow
   */
  export type ResponsesFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
    /**
     * Filter, which Responses to fetch.
     * 
    **/
    where: ResponsesWhereUniqueInput
  }


  /**
   * Responses base type for findFirst actions
   */
  export type ResponsesFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
    /**
     * Filter, which Responses to fetch.
     * 
    **/
    where?: ResponsesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Responses to fetch.
     * 
    **/
    orderBy?: Enumerable<ResponsesOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Responses.
     * 
    **/
    cursor?: ResponsesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Responses from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Responses.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Responses.
     * 
    **/
    distinct?: Enumerable<ResponsesScalarFieldEnum>
  }

  /**
   * Responses findFirst
   */
  export interface ResponsesFindFirstArgs extends ResponsesFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Responses findFirstOrThrow
   */
  export type ResponsesFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
    /**
     * Filter, which Responses to fetch.
     * 
    **/
    where?: ResponsesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Responses to fetch.
     * 
    **/
    orderBy?: Enumerable<ResponsesOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Responses.
     * 
    **/
    cursor?: ResponsesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Responses from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Responses.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Responses.
     * 
    **/
    distinct?: Enumerable<ResponsesScalarFieldEnum>
  }


  /**
   * Responses findMany
   */
  export type ResponsesFindManyArgs = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
    /**
     * Filter, which Responses to fetch.
     * 
    **/
    where?: ResponsesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Responses to fetch.
     * 
    **/
    orderBy?: Enumerable<ResponsesOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Responses.
     * 
    **/
    cursor?: ResponsesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Responses from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Responses.
     * 
    **/
    skip?: number
    distinct?: Enumerable<ResponsesScalarFieldEnum>
  }


  /**
   * Responses create
   */
  export type ResponsesCreateArgs = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
    /**
     * The data needed to create a Responses.
     * 
    **/
    data: XOR<ResponsesCreateInput, ResponsesUncheckedCreateInput>
  }


  /**
   * Responses createMany
   */
  export type ResponsesCreateManyArgs = {
    /**
     * The data used to create many Responses.
     * 
    **/
    data: Enumerable<ResponsesCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Responses update
   */
  export type ResponsesUpdateArgs = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
    /**
     * The data needed to update a Responses.
     * 
    **/
    data: XOR<ResponsesUpdateInput, ResponsesUncheckedUpdateInput>
    /**
     * Choose, which Responses to update.
     * 
    **/
    where: ResponsesWhereUniqueInput
  }


  /**
   * Responses updateMany
   */
  export type ResponsesUpdateManyArgs = {
    /**
     * The data used to update Responses.
     * 
    **/
    data: XOR<ResponsesUpdateManyMutationInput, ResponsesUncheckedUpdateManyInput>
    /**
     * Filter which Responses to update
     * 
    **/
    where?: ResponsesWhereInput
  }


  /**
   * Responses upsert
   */
  export type ResponsesUpsertArgs = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
    /**
     * The filter to search for the Responses to update in case it exists.
     * 
    **/
    where: ResponsesWhereUniqueInput
    /**
     * In case the Responses found by the `where` argument doesn't exist, create a new Responses with this data.
     * 
    **/
    create: XOR<ResponsesCreateInput, ResponsesUncheckedCreateInput>
    /**
     * In case the Responses was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<ResponsesUpdateInput, ResponsesUncheckedUpdateInput>
  }


  /**
   * Responses delete
   */
  export type ResponsesDeleteArgs = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
    /**
     * Filter which Responses to delete.
     * 
    **/
    where: ResponsesWhereUniqueInput
  }


  /**
   * Responses deleteMany
   */
  export type ResponsesDeleteManyArgs = {
    /**
     * Filter which Responses to delete
     * 
    **/
    where?: ResponsesWhereInput
  }


  /**
   * Responses without action
   */
  export type ResponsesArgs = {
    /**
     * Select specific fields to fetch from the Responses
     * 
    **/
    select?: ResponsesSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: ResponsesInclude | null
  }



  /**
   * Enums
   */

  // Based on
  // https://github.com/microsoft/TypeScript/issues/3192#issuecomment-261720275

  export const Activity_eventsScalarFieldEnum: {
    id: 'id',
    source_user_id: 'source_user_id',
    target_user_id: 'target_user_id',
    activity_type: 'activity_type',
    timestamp: 'timestamp',
    message: 'message',
    action: 'action',
    read_at: 'read_at'
  };

  export type Activity_eventsScalarFieldEnum = (typeof Activity_eventsScalarFieldEnum)[keyof typeof Activity_eventsScalarFieldEnum]


  export const Background_jobsScalarFieldEnum: {
    id: 'id',
    timestamp: 'timestamp',
    payload: 'payload',
    completed: 'completed',
    cancelled: 'cancelled',
    progress: 'progress',
    result: 'result'
  };

  export type Background_jobsScalarFieldEnum = (typeof Background_jobsScalarFieldEnum)[keyof typeof Background_jobsScalarFieldEnum]


  export const Chat_roomScalarFieldEnum: {
    id: 'id',
    timestamp: 'timestamp',
    username: 'username',
    message: 'message'
  };

  export type Chat_roomScalarFieldEnum = (typeof Chat_roomScalarFieldEnum)[keyof typeof Chat_roomScalarFieldEnum]


  export const Commerce_ordersScalarFieldEnum: {
    order_id: 'order_id',
    timestamp: 'timestamp',
    price_amount: 'price_amount',
    price_currency: 'price_currency',
    promo_code: 'promo_code',
    customer_full_name: 'customer_full_name',
    country: 'country',
    product: 'product'
  };

  export type Commerce_ordersScalarFieldEnum = (typeof Commerce_ordersScalarFieldEnum)[keyof typeof Commerce_ordersScalarFieldEnum]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  export const JsonNullValueInput: {
    JsonNull: typeof JsonNull
  };

  export type JsonNullValueInput = (typeof JsonNullValueInput)[keyof typeof JsonNullValueInput]


  export const LogsScalarFieldEnum: {
    id: 'id',
    source_id: 'source_id',
    timestamp: 'timestamp',
    content: 'content'
  };

  export type LogsScalarFieldEnum = (typeof LogsScalarFieldEnum)[keyof typeof LogsScalarFieldEnum]


  export const MonitoringScalarFieldEnum: {
    id: 'id',
    timestamp: 'timestamp',
    type: 'type',
    value: 'value'
  };

  export type MonitoringScalarFieldEnum = (typeof MonitoringScalarFieldEnum)[keyof typeof MonitoringScalarFieldEnum]


  export const NullableJsonNullValueInput: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull
  };

  export type NullableJsonNullValueInput = (typeof NullableJsonNullValueInput)[keyof typeof NullableJsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const RequestsScalarFieldEnum: {
    id: 'id',
    timestamp: 'timestamp',
    path: 'path',
    method: 'method',
    data: 'data',
    processing: 'processing',
    cancelled: 'cancelled'
  };

  export type RequestsScalarFieldEnum = (typeof RequestsScalarFieldEnum)[keyof typeof RequestsScalarFieldEnum]


  export const ResponsesScalarFieldEnum: {
    id: 'id',
    timestamp: 'timestamp',
    request_id: 'request_id',
    status_code: 'status_code',
    data: 'data'
  };

  export type ResponsesScalarFieldEnum = (typeof ResponsesScalarFieldEnum)[keyof typeof ResponsesScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  /**
   * Deep Input Types
   */


  export type Activity_eventsWhereInput = {
    AND?: Enumerable<Activity_eventsWhereInput>
    OR?: Enumerable<Activity_eventsWhereInput>
    NOT?: Enumerable<Activity_eventsWhereInput>
    id?: UuidFilter | string
    source_user_id?: UuidFilter | string
    target_user_id?: UuidFilter | string
    activity_type?: StringFilter | string
    timestamp?: DateTimeFilter | Date | string
    message?: StringFilter | string
    action?: StringNullableFilter | string | null
    read_at?: DateTimeNullableFilter | Date | string | null
  }

  export type Activity_eventsOrderByWithRelationInput = {
    id?: SortOrder
    source_user_id?: SortOrder
    target_user_id?: SortOrder
    activity_type?: SortOrder
    timestamp?: SortOrder
    message?: SortOrder
    action?: SortOrder
    read_at?: SortOrder
  }

  export type Activity_eventsWhereUniqueInput = {
    id?: string
  }

  export type Activity_eventsOrderByWithAggregationInput = {
    id?: SortOrder
    source_user_id?: SortOrder
    target_user_id?: SortOrder
    activity_type?: SortOrder
    timestamp?: SortOrder
    message?: SortOrder
    action?: SortOrder
    read_at?: SortOrder
    _count?: Activity_eventsCountOrderByAggregateInput
    _max?: Activity_eventsMaxOrderByAggregateInput
    _min?: Activity_eventsMinOrderByAggregateInput
  }

  export type Activity_eventsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<Activity_eventsScalarWhereWithAggregatesInput>
    OR?: Enumerable<Activity_eventsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<Activity_eventsScalarWhereWithAggregatesInput>
    id?: UuidWithAggregatesFilter | string
    source_user_id?: UuidWithAggregatesFilter | string
    target_user_id?: UuidWithAggregatesFilter | string
    activity_type?: StringWithAggregatesFilter | string
    timestamp?: DateTimeWithAggregatesFilter | Date | string
    message?: StringWithAggregatesFilter | string
    action?: StringNullableWithAggregatesFilter | string | null
    read_at?: DateTimeNullableWithAggregatesFilter | Date | string | null
  }

  export type Background_jobsWhereInput = {
    AND?: Enumerable<Background_jobsWhereInput>
    OR?: Enumerable<Background_jobsWhereInput>
    NOT?: Enumerable<Background_jobsWhereInput>
    id?: UuidFilter | string
    timestamp?: DateTimeFilter | Date | string
    payload?: JsonFilter
    completed?: BoolFilter | boolean
    cancelled?: BoolFilter | boolean
    progress?: FloatFilter | number
    result?: JsonNullableFilter
  }

  export type Background_jobsOrderByWithRelationInput = {
    id?: SortOrder
    timestamp?: SortOrder
    payload?: SortOrder
    completed?: SortOrder
    cancelled?: SortOrder
    progress?: SortOrder
    result?: SortOrder
  }

  export type Background_jobsWhereUniqueInput = {
    id?: string
  }

  export type Background_jobsOrderByWithAggregationInput = {
    id?: SortOrder
    timestamp?: SortOrder
    payload?: SortOrder
    completed?: SortOrder
    cancelled?: SortOrder
    progress?: SortOrder
    result?: SortOrder
    _count?: Background_jobsCountOrderByAggregateInput
    _avg?: Background_jobsAvgOrderByAggregateInput
    _max?: Background_jobsMaxOrderByAggregateInput
    _min?: Background_jobsMinOrderByAggregateInput
    _sum?: Background_jobsSumOrderByAggregateInput
  }

  export type Background_jobsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<Background_jobsScalarWhereWithAggregatesInput>
    OR?: Enumerable<Background_jobsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<Background_jobsScalarWhereWithAggregatesInput>
    id?: UuidWithAggregatesFilter | string
    timestamp?: DateTimeWithAggregatesFilter | Date | string
    payload?: JsonWithAggregatesFilter
    completed?: BoolWithAggregatesFilter | boolean
    cancelled?: BoolWithAggregatesFilter | boolean
    progress?: FloatWithAggregatesFilter | number
    result?: JsonNullableWithAggregatesFilter
  }

  export type Chat_roomWhereInput = {
    AND?: Enumerable<Chat_roomWhereInput>
    OR?: Enumerable<Chat_roomWhereInput>
    NOT?: Enumerable<Chat_roomWhereInput>
    id?: UuidFilter | string
    timestamp?: DateTimeFilter | Date | string
    username?: StringFilter | string
    message?: StringFilter | string
  }

  export type Chat_roomOrderByWithRelationInput = {
    id?: SortOrder
    timestamp?: SortOrder
    username?: SortOrder
    message?: SortOrder
  }

  export type Chat_roomWhereUniqueInput = {
    id?: string
  }

  export type Chat_roomOrderByWithAggregationInput = {
    id?: SortOrder
    timestamp?: SortOrder
    username?: SortOrder
    message?: SortOrder
    _count?: Chat_roomCountOrderByAggregateInput
    _max?: Chat_roomMaxOrderByAggregateInput
    _min?: Chat_roomMinOrderByAggregateInput
  }

  export type Chat_roomScalarWhereWithAggregatesInput = {
    AND?: Enumerable<Chat_roomScalarWhereWithAggregatesInput>
    OR?: Enumerable<Chat_roomScalarWhereWithAggregatesInput>
    NOT?: Enumerable<Chat_roomScalarWhereWithAggregatesInput>
    id?: UuidWithAggregatesFilter | string
    timestamp?: DateTimeWithAggregatesFilter | Date | string
    username?: StringWithAggregatesFilter | string
    message?: StringWithAggregatesFilter | string
  }

  export type Commerce_ordersWhereInput = {
    AND?: Enumerable<Commerce_ordersWhereInput>
    OR?: Enumerable<Commerce_ordersWhereInput>
    NOT?: Enumerable<Commerce_ordersWhereInput>
    order_id?: UuidFilter | string
    timestamp?: DateTimeFilter | Date | string
    price_amount?: FloatFilter | number
    price_currency?: StringFilter | string
    promo_code?: StringNullableFilter | string | null
    customer_full_name?: StringFilter | string
    country?: StringFilter | string
    product?: StringFilter | string
  }

  export type Commerce_ordersOrderByWithRelationInput = {
    order_id?: SortOrder
    timestamp?: SortOrder
    price_amount?: SortOrder
    price_currency?: SortOrder
    promo_code?: SortOrder
    customer_full_name?: SortOrder
    country?: SortOrder
    product?: SortOrder
  }

  export type Commerce_ordersWhereUniqueInput = {
    order_id?: string
  }

  export type Commerce_ordersOrderByWithAggregationInput = {
    order_id?: SortOrder
    timestamp?: SortOrder
    price_amount?: SortOrder
    price_currency?: SortOrder
    promo_code?: SortOrder
    customer_full_name?: SortOrder
    country?: SortOrder
    product?: SortOrder
    _count?: Commerce_ordersCountOrderByAggregateInput
    _avg?: Commerce_ordersAvgOrderByAggregateInput
    _max?: Commerce_ordersMaxOrderByAggregateInput
    _min?: Commerce_ordersMinOrderByAggregateInput
    _sum?: Commerce_ordersSumOrderByAggregateInput
  }

  export type Commerce_ordersScalarWhereWithAggregatesInput = {
    AND?: Enumerable<Commerce_ordersScalarWhereWithAggregatesInput>
    OR?: Enumerable<Commerce_ordersScalarWhereWithAggregatesInput>
    NOT?: Enumerable<Commerce_ordersScalarWhereWithAggregatesInput>
    order_id?: UuidWithAggregatesFilter | string
    timestamp?: DateTimeWithAggregatesFilter | Date | string
    price_amount?: FloatWithAggregatesFilter | number
    price_currency?: StringWithAggregatesFilter | string
    promo_code?: StringNullableWithAggregatesFilter | string | null
    customer_full_name?: StringWithAggregatesFilter | string
    country?: StringWithAggregatesFilter | string
    product?: StringWithAggregatesFilter | string
  }

  export type LogsWhereInput = {
    AND?: Enumerable<LogsWhereInput>
    OR?: Enumerable<LogsWhereInput>
    NOT?: Enumerable<LogsWhereInput>
    id?: UuidFilter | string
    source_id?: UuidFilter | string
    timestamp?: DateTimeFilter | Date | string
    content?: StringFilter | string
  }

  export type LogsOrderByWithRelationInput = {
    id?: SortOrder
    source_id?: SortOrder
    timestamp?: SortOrder
    content?: SortOrder
  }

  export type LogsWhereUniqueInput = {
    id?: string
  }

  export type LogsOrderByWithAggregationInput = {
    id?: SortOrder
    source_id?: SortOrder
    timestamp?: SortOrder
    content?: SortOrder
    _count?: LogsCountOrderByAggregateInput
    _max?: LogsMaxOrderByAggregateInput
    _min?: LogsMinOrderByAggregateInput
  }

  export type LogsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<LogsScalarWhereWithAggregatesInput>
    OR?: Enumerable<LogsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<LogsScalarWhereWithAggregatesInput>
    id?: UuidWithAggregatesFilter | string
    source_id?: UuidWithAggregatesFilter | string
    timestamp?: DateTimeWithAggregatesFilter | Date | string
    content?: StringWithAggregatesFilter | string
  }

  export type MonitoringWhereInput = {
    AND?: Enumerable<MonitoringWhereInput>
    OR?: Enumerable<MonitoringWhereInput>
    NOT?: Enumerable<MonitoringWhereInput>
    id?: UuidFilter | string
    timestamp?: DateTimeFilter | Date | string
    type?: StringFilter | string
    value?: FloatFilter | number
  }

  export type MonitoringOrderByWithRelationInput = {
    id?: SortOrder
    timestamp?: SortOrder
    type?: SortOrder
    value?: SortOrder
  }

  export type MonitoringWhereUniqueInput = {
    id?: string
  }

  export type MonitoringOrderByWithAggregationInput = {
    id?: SortOrder
    timestamp?: SortOrder
    type?: SortOrder
    value?: SortOrder
    _count?: MonitoringCountOrderByAggregateInput
    _avg?: MonitoringAvgOrderByAggregateInput
    _max?: MonitoringMaxOrderByAggregateInput
    _min?: MonitoringMinOrderByAggregateInput
    _sum?: MonitoringSumOrderByAggregateInput
  }

  export type MonitoringScalarWhereWithAggregatesInput = {
    AND?: Enumerable<MonitoringScalarWhereWithAggregatesInput>
    OR?: Enumerable<MonitoringScalarWhereWithAggregatesInput>
    NOT?: Enumerable<MonitoringScalarWhereWithAggregatesInput>
    id?: UuidWithAggregatesFilter | string
    timestamp?: DateTimeWithAggregatesFilter | Date | string
    type?: StringWithAggregatesFilter | string
    value?: FloatWithAggregatesFilter | number
  }

  export type RequestsWhereInput = {
    AND?: Enumerable<RequestsWhereInput>
    OR?: Enumerable<RequestsWhereInput>
    NOT?: Enumerable<RequestsWhereInput>
    id?: UuidFilter | string
    timestamp?: DateTimeFilter | Date | string
    path?: StringFilter | string
    method?: StringFilter | string
    data?: JsonNullableFilter
    processing?: BoolFilter | boolean
    cancelled?: BoolFilter | boolean
    responses?: ResponsesListRelationFilter
  }

  export type RequestsOrderByWithRelationInput = {
    id?: SortOrder
    timestamp?: SortOrder
    path?: SortOrder
    method?: SortOrder
    data?: SortOrder
    processing?: SortOrder
    cancelled?: SortOrder
    responses?: ResponsesOrderByRelationAggregateInput
  }

  export type RequestsWhereUniqueInput = {
    id?: string
  }

  export type RequestsOrderByWithAggregationInput = {
    id?: SortOrder
    timestamp?: SortOrder
    path?: SortOrder
    method?: SortOrder
    data?: SortOrder
    processing?: SortOrder
    cancelled?: SortOrder
    _count?: RequestsCountOrderByAggregateInput
    _max?: RequestsMaxOrderByAggregateInput
    _min?: RequestsMinOrderByAggregateInput
  }

  export type RequestsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<RequestsScalarWhereWithAggregatesInput>
    OR?: Enumerable<RequestsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<RequestsScalarWhereWithAggregatesInput>
    id?: UuidWithAggregatesFilter | string
    timestamp?: DateTimeWithAggregatesFilter | Date | string
    path?: StringWithAggregatesFilter | string
    method?: StringWithAggregatesFilter | string
    data?: JsonNullableWithAggregatesFilter
    processing?: BoolWithAggregatesFilter | boolean
    cancelled?: BoolWithAggregatesFilter | boolean
  }

  export type ResponsesWhereInput = {
    AND?: Enumerable<ResponsesWhereInput>
    OR?: Enumerable<ResponsesWhereInput>
    NOT?: Enumerable<ResponsesWhereInput>
    id?: UuidFilter | string
    timestamp?: DateTimeFilter | Date | string
    request_id?: UuidFilter | string
    status_code?: IntFilter | number
    data?: JsonNullableFilter
    requests?: XOR<RequestsRelationFilter, RequestsWhereInput>
  }

  export type ResponsesOrderByWithRelationInput = {
    id?: SortOrder
    timestamp?: SortOrder
    request_id?: SortOrder
    status_code?: SortOrder
    data?: SortOrder
    requests?: RequestsOrderByWithRelationInput
  }

  export type ResponsesWhereUniqueInput = {
    id?: string
  }

  export type ResponsesOrderByWithAggregationInput = {
    id?: SortOrder
    timestamp?: SortOrder
    request_id?: SortOrder
    status_code?: SortOrder
    data?: SortOrder
    _count?: ResponsesCountOrderByAggregateInput
    _avg?: ResponsesAvgOrderByAggregateInput
    _max?: ResponsesMaxOrderByAggregateInput
    _min?: ResponsesMinOrderByAggregateInput
    _sum?: ResponsesSumOrderByAggregateInput
  }

  export type ResponsesScalarWhereWithAggregatesInput = {
    AND?: Enumerable<ResponsesScalarWhereWithAggregatesInput>
    OR?: Enumerable<ResponsesScalarWhereWithAggregatesInput>
    NOT?: Enumerable<ResponsesScalarWhereWithAggregatesInput>
    id?: UuidWithAggregatesFilter | string
    timestamp?: DateTimeWithAggregatesFilter | Date | string
    request_id?: UuidWithAggregatesFilter | string
    status_code?: IntWithAggregatesFilter | number
    data?: JsonNullableWithAggregatesFilter
  }

  export type Activity_eventsCreateInput = {
    id: string
    source_user_id: string
    target_user_id: string
    activity_type: string
    timestamp: Date | string
    message: string
    action?: string | null
    read_at?: Date | string | null
  }

  export type Activity_eventsUncheckedCreateInput = {
    id: string
    source_user_id: string
    target_user_id: string
    activity_type: string
    timestamp: Date | string
    message: string
    action?: string | null
    read_at?: Date | string | null
  }

  export type Activity_eventsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    source_user_id?: StringFieldUpdateOperationsInput | string
    target_user_id?: StringFieldUpdateOperationsInput | string
    activity_type?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    message?: StringFieldUpdateOperationsInput | string
    action?: NullableStringFieldUpdateOperationsInput | string | null
    read_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type Activity_eventsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    source_user_id?: StringFieldUpdateOperationsInput | string
    target_user_id?: StringFieldUpdateOperationsInput | string
    activity_type?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    message?: StringFieldUpdateOperationsInput | string
    action?: NullableStringFieldUpdateOperationsInput | string | null
    read_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type Activity_eventsCreateManyInput = {
    id: string
    source_user_id: string
    target_user_id: string
    activity_type: string
    timestamp: Date | string
    message: string
    action?: string | null
    read_at?: Date | string | null
  }

  export type Activity_eventsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    source_user_id?: StringFieldUpdateOperationsInput | string
    target_user_id?: StringFieldUpdateOperationsInput | string
    activity_type?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    message?: StringFieldUpdateOperationsInput | string
    action?: NullableStringFieldUpdateOperationsInput | string | null
    read_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type Activity_eventsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    source_user_id?: StringFieldUpdateOperationsInput | string
    target_user_id?: StringFieldUpdateOperationsInput | string
    activity_type?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    message?: StringFieldUpdateOperationsInput | string
    action?: NullableStringFieldUpdateOperationsInput | string | null
    read_at?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type Background_jobsCreateInput = {
    id: string
    timestamp: Date | string
    payload: JsonNullValueInput | InputJsonValue
    completed: boolean
    cancelled: boolean
    progress: number
    result?: NullableJsonNullValueInput | InputJsonValue
  }

  export type Background_jobsUncheckedCreateInput = {
    id: string
    timestamp: Date | string
    payload: JsonNullValueInput | InputJsonValue
    completed: boolean
    cancelled: boolean
    progress: number
    result?: NullableJsonNullValueInput | InputJsonValue
  }

  export type Background_jobsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    payload?: JsonNullValueInput | InputJsonValue
    completed?: BoolFieldUpdateOperationsInput | boolean
    cancelled?: BoolFieldUpdateOperationsInput | boolean
    progress?: FloatFieldUpdateOperationsInput | number
    result?: NullableJsonNullValueInput | InputJsonValue
  }

  export type Background_jobsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    payload?: JsonNullValueInput | InputJsonValue
    completed?: BoolFieldUpdateOperationsInput | boolean
    cancelled?: BoolFieldUpdateOperationsInput | boolean
    progress?: FloatFieldUpdateOperationsInput | number
    result?: NullableJsonNullValueInput | InputJsonValue
  }

  export type Background_jobsCreateManyInput = {
    id: string
    timestamp: Date | string
    payload: JsonNullValueInput | InputJsonValue
    completed: boolean
    cancelled: boolean
    progress: number
    result?: NullableJsonNullValueInput | InputJsonValue
  }

  export type Background_jobsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    payload?: JsonNullValueInput | InputJsonValue
    completed?: BoolFieldUpdateOperationsInput | boolean
    cancelled?: BoolFieldUpdateOperationsInput | boolean
    progress?: FloatFieldUpdateOperationsInput | number
    result?: NullableJsonNullValueInput | InputJsonValue
  }

  export type Background_jobsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    payload?: JsonNullValueInput | InputJsonValue
    completed?: BoolFieldUpdateOperationsInput | boolean
    cancelled?: BoolFieldUpdateOperationsInput | boolean
    progress?: FloatFieldUpdateOperationsInput | number
    result?: NullableJsonNullValueInput | InputJsonValue
  }

  export type Chat_roomCreateInput = {
    id: string
    timestamp: Date | string
    username: string
    message: string
  }

  export type Chat_roomUncheckedCreateInput = {
    id: string
    timestamp: Date | string
    username: string
    message: string
  }

  export type Chat_roomUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    username?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
  }

  export type Chat_roomUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    username?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
  }

  export type Chat_roomCreateManyInput = {
    id: string
    timestamp: Date | string
    username: string
    message: string
  }

  export type Chat_roomUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    username?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
  }

  export type Chat_roomUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    username?: StringFieldUpdateOperationsInput | string
    message?: StringFieldUpdateOperationsInput | string
  }

  export type Commerce_ordersCreateInput = {
    order_id: string
    timestamp: Date | string
    price_amount: number
    price_currency: string
    promo_code?: string | null
    customer_full_name: string
    country: string
    product: string
  }

  export type Commerce_ordersUncheckedCreateInput = {
    order_id: string
    timestamp: Date | string
    price_amount: number
    price_currency: string
    promo_code?: string | null
    customer_full_name: string
    country: string
    product: string
  }

  export type Commerce_ordersUpdateInput = {
    order_id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    price_amount?: FloatFieldUpdateOperationsInput | number
    price_currency?: StringFieldUpdateOperationsInput | string
    promo_code?: NullableStringFieldUpdateOperationsInput | string | null
    customer_full_name?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    product?: StringFieldUpdateOperationsInput | string
  }

  export type Commerce_ordersUncheckedUpdateInput = {
    order_id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    price_amount?: FloatFieldUpdateOperationsInput | number
    price_currency?: StringFieldUpdateOperationsInput | string
    promo_code?: NullableStringFieldUpdateOperationsInput | string | null
    customer_full_name?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    product?: StringFieldUpdateOperationsInput | string
  }

  export type Commerce_ordersCreateManyInput = {
    order_id: string
    timestamp: Date | string
    price_amount: number
    price_currency: string
    promo_code?: string | null
    customer_full_name: string
    country: string
    product: string
  }

  export type Commerce_ordersUpdateManyMutationInput = {
    order_id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    price_amount?: FloatFieldUpdateOperationsInput | number
    price_currency?: StringFieldUpdateOperationsInput | string
    promo_code?: NullableStringFieldUpdateOperationsInput | string | null
    customer_full_name?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    product?: StringFieldUpdateOperationsInput | string
  }

  export type Commerce_ordersUncheckedUpdateManyInput = {
    order_id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    price_amount?: FloatFieldUpdateOperationsInput | number
    price_currency?: StringFieldUpdateOperationsInput | string
    promo_code?: NullableStringFieldUpdateOperationsInput | string | null
    customer_full_name?: StringFieldUpdateOperationsInput | string
    country?: StringFieldUpdateOperationsInput | string
    product?: StringFieldUpdateOperationsInput | string
  }

  export type LogsCreateInput = {
    id: string
    source_id: string
    timestamp: Date | string
    content: string
  }

  export type LogsUncheckedCreateInput = {
    id: string
    source_id: string
    timestamp: Date | string
    content: string
  }

  export type LogsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    source_id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    content?: StringFieldUpdateOperationsInput | string
  }

  export type LogsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    source_id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    content?: StringFieldUpdateOperationsInput | string
  }

  export type LogsCreateManyInput = {
    id: string
    source_id: string
    timestamp: Date | string
    content: string
  }

  export type LogsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    source_id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    content?: StringFieldUpdateOperationsInput | string
  }

  export type LogsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    source_id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    content?: StringFieldUpdateOperationsInput | string
  }

  export type MonitoringCreateInput = {
    id: string
    timestamp: Date | string
    type: string
    value: number
  }

  export type MonitoringUncheckedCreateInput = {
    id: string
    timestamp: Date | string
    type: string
    value: number
  }

  export type MonitoringUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    type?: StringFieldUpdateOperationsInput | string
    value?: FloatFieldUpdateOperationsInput | number
  }

  export type MonitoringUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    type?: StringFieldUpdateOperationsInput | string
    value?: FloatFieldUpdateOperationsInput | number
  }

  export type MonitoringCreateManyInput = {
    id: string
    timestamp: Date | string
    type: string
    value: number
  }

  export type MonitoringUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    type?: StringFieldUpdateOperationsInput | string
    value?: FloatFieldUpdateOperationsInput | number
  }

  export type MonitoringUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    type?: StringFieldUpdateOperationsInput | string
    value?: FloatFieldUpdateOperationsInput | number
  }

  export type RequestsCreateInput = {
    id: string
    timestamp: Date | string
    path: string
    method: string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing: boolean
    cancelled: boolean
    responses?: ResponsesCreateNestedManyWithoutRequestsInput
  }

  export type RequestsUncheckedCreateInput = {
    id: string
    timestamp: Date | string
    path: string
    method: string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing: boolean
    cancelled: boolean
    responses?: ResponsesUncheckedCreateNestedManyWithoutRequestsInput
  }

  export type RequestsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    path?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing?: BoolFieldUpdateOperationsInput | boolean
    cancelled?: BoolFieldUpdateOperationsInput | boolean
    responses?: ResponsesUpdateManyWithoutRequestsNestedInput
  }

  export type RequestsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    path?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing?: BoolFieldUpdateOperationsInput | boolean
    cancelled?: BoolFieldUpdateOperationsInput | boolean
    responses?: ResponsesUncheckedUpdateManyWithoutRequestsNestedInput
  }

  export type RequestsCreateManyInput = {
    id: string
    timestamp: Date | string
    path: string
    method: string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing: boolean
    cancelled: boolean
  }

  export type RequestsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    path?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing?: BoolFieldUpdateOperationsInput | boolean
    cancelled?: BoolFieldUpdateOperationsInput | boolean
  }

  export type RequestsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    path?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing?: BoolFieldUpdateOperationsInput | boolean
    cancelled?: BoolFieldUpdateOperationsInput | boolean
  }

  export type ResponsesCreateInput = {
    id: string
    timestamp: Date | string
    status_code: number
    data?: NullableJsonNullValueInput | InputJsonValue
    requests: RequestsCreateNestedOneWithoutResponsesInput
  }

  export type ResponsesUncheckedCreateInput = {
    id: string
    timestamp: Date | string
    request_id: string
    status_code: number
    data?: NullableJsonNullValueInput | InputJsonValue
  }

  export type ResponsesUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    status_code?: IntFieldUpdateOperationsInput | number
    data?: NullableJsonNullValueInput | InputJsonValue
    requests?: RequestsUpdateOneRequiredWithoutResponsesNestedInput
  }

  export type ResponsesUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    request_id?: StringFieldUpdateOperationsInput | string
    status_code?: IntFieldUpdateOperationsInput | number
    data?: NullableJsonNullValueInput | InputJsonValue
  }

  export type ResponsesCreateManyInput = {
    id: string
    timestamp: Date | string
    request_id: string
    status_code: number
    data?: NullableJsonNullValueInput | InputJsonValue
  }

  export type ResponsesUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    status_code?: IntFieldUpdateOperationsInput | number
    data?: NullableJsonNullValueInput | InputJsonValue
  }

  export type ResponsesUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    request_id?: StringFieldUpdateOperationsInput | string
    status_code?: IntFieldUpdateOperationsInput | number
    data?: NullableJsonNullValueInput | InputJsonValue
  }

  export type UuidFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    mode?: QueryMode
    not?: NestedUuidFilter | string
  }

  export type StringFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    mode?: QueryMode
    not?: NestedStringFilter | string
  }

  export type DateTimeFilter = {
    equals?: Date | string
    in?: Enumerable<Date> | Enumerable<string>
    notIn?: Enumerable<Date> | Enumerable<string>
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeFilter | Date | string
  }

  export type StringNullableFilter = {
    equals?: string | null
    in?: Enumerable<string> | null
    notIn?: Enumerable<string> | null
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    mode?: QueryMode
    not?: NestedStringNullableFilter | string | null
  }

  export type DateTimeNullableFilter = {
    equals?: Date | string | null
    in?: Enumerable<Date> | Enumerable<string> | null
    notIn?: Enumerable<Date> | Enumerable<string> | null
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeNullableFilter | Date | string | null
  }

  export type Activity_eventsCountOrderByAggregateInput = {
    id?: SortOrder
    source_user_id?: SortOrder
    target_user_id?: SortOrder
    activity_type?: SortOrder
    timestamp?: SortOrder
    message?: SortOrder
    action?: SortOrder
    read_at?: SortOrder
  }

  export type Activity_eventsMaxOrderByAggregateInput = {
    id?: SortOrder
    source_user_id?: SortOrder
    target_user_id?: SortOrder
    activity_type?: SortOrder
    timestamp?: SortOrder
    message?: SortOrder
    action?: SortOrder
    read_at?: SortOrder
  }

  export type Activity_eventsMinOrderByAggregateInput = {
    id?: SortOrder
    source_user_id?: SortOrder
    target_user_id?: SortOrder
    activity_type?: SortOrder
    timestamp?: SortOrder
    message?: SortOrder
    action?: SortOrder
    read_at?: SortOrder
  }

  export type UuidWithAggregatesFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    mode?: QueryMode
    not?: NestedUuidWithAggregatesFilter | string
    _count?: NestedIntFilter
    _min?: NestedStringFilter
    _max?: NestedStringFilter
  }

  export type StringWithAggregatesFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter | string
    _count?: NestedIntFilter
    _min?: NestedStringFilter
    _max?: NestedStringFilter
  }

  export type DateTimeWithAggregatesFilter = {
    equals?: Date | string
    in?: Enumerable<Date> | Enumerable<string>
    notIn?: Enumerable<Date> | Enumerable<string>
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeWithAggregatesFilter | Date | string
    _count?: NestedIntFilter
    _min?: NestedDateTimeFilter
    _max?: NestedDateTimeFilter
  }

  export type StringNullableWithAggregatesFilter = {
    equals?: string | null
    in?: Enumerable<string> | null
    notIn?: Enumerable<string> | null
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter | string | null
    _count?: NestedIntNullableFilter
    _min?: NestedStringNullableFilter
    _max?: NestedStringNullableFilter
  }

  export type DateTimeNullableWithAggregatesFilter = {
    equals?: Date | string | null
    in?: Enumerable<Date> | Enumerable<string> | null
    notIn?: Enumerable<Date> | Enumerable<string> | null
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeNullableWithAggregatesFilter | Date | string | null
    _count?: NestedIntNullableFilter
    _min?: NestedDateTimeNullableFilter
    _max?: NestedDateTimeNullableFilter
  }
  export type JsonFilter = 
    | PatchUndefined<
        Either<Required<JsonFilterBase>, Exclude<keyof Required<JsonFilterBase>, 'path'>>,
        Required<JsonFilterBase>
      >
    | OptionalFlat<Omit<Required<JsonFilterBase>, 'path'>>

  export type JsonFilterBase = {
    equals?: InputJsonValue | JsonNullValueFilter
    path?: Array<string>
    string_contains?: string
    string_starts_with?: string
    string_ends_with?: string
    array_contains?: InputJsonValue | null
    array_starts_with?: InputJsonValue | null
    array_ends_with?: InputJsonValue | null
    lt?: InputJsonValue
    lte?: InputJsonValue
    gt?: InputJsonValue
    gte?: InputJsonValue
    not?: InputJsonValue | JsonNullValueFilter
  }

  export type BoolFilter = {
    equals?: boolean
    not?: NestedBoolFilter | boolean
  }

  export type FloatFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatFilter | number
  }
  export type JsonNullableFilter = 
    | PatchUndefined<
        Either<Required<JsonNullableFilterBase>, Exclude<keyof Required<JsonNullableFilterBase>, 'path'>>,
        Required<JsonNullableFilterBase>
      >
    | OptionalFlat<Omit<Required<JsonNullableFilterBase>, 'path'>>

  export type JsonNullableFilterBase = {
    equals?: InputJsonValue | JsonNullValueFilter
    path?: Array<string>
    string_contains?: string
    string_starts_with?: string
    string_ends_with?: string
    array_contains?: InputJsonValue | null
    array_starts_with?: InputJsonValue | null
    array_ends_with?: InputJsonValue | null
    lt?: InputJsonValue
    lte?: InputJsonValue
    gt?: InputJsonValue
    gte?: InputJsonValue
    not?: InputJsonValue | JsonNullValueFilter
  }

  export type Background_jobsCountOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    payload?: SortOrder
    completed?: SortOrder
    cancelled?: SortOrder
    progress?: SortOrder
    result?: SortOrder
  }

  export type Background_jobsAvgOrderByAggregateInput = {
    progress?: SortOrder
  }

  export type Background_jobsMaxOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    completed?: SortOrder
    cancelled?: SortOrder
    progress?: SortOrder
  }

  export type Background_jobsMinOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    completed?: SortOrder
    cancelled?: SortOrder
    progress?: SortOrder
  }

  export type Background_jobsSumOrderByAggregateInput = {
    progress?: SortOrder
  }
  export type JsonWithAggregatesFilter = 
    | PatchUndefined<
        Either<Required<JsonWithAggregatesFilterBase>, Exclude<keyof Required<JsonWithAggregatesFilterBase>, 'path'>>,
        Required<JsonWithAggregatesFilterBase>
      >
    | OptionalFlat<Omit<Required<JsonWithAggregatesFilterBase>, 'path'>>

  export type JsonWithAggregatesFilterBase = {
    equals?: InputJsonValue | JsonNullValueFilter
    path?: Array<string>
    string_contains?: string
    string_starts_with?: string
    string_ends_with?: string
    array_contains?: InputJsonValue | null
    array_starts_with?: InputJsonValue | null
    array_ends_with?: InputJsonValue | null
    lt?: InputJsonValue
    lte?: InputJsonValue
    gt?: InputJsonValue
    gte?: InputJsonValue
    not?: InputJsonValue | JsonNullValueFilter
    _count?: NestedIntFilter
    _min?: NestedJsonFilter
    _max?: NestedJsonFilter
  }

  export type BoolWithAggregatesFilter = {
    equals?: boolean
    not?: NestedBoolWithAggregatesFilter | boolean
    _count?: NestedIntFilter
    _min?: NestedBoolFilter
    _max?: NestedBoolFilter
  }

  export type FloatWithAggregatesFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatWithAggregatesFilter | number
    _count?: NestedIntFilter
    _avg?: NestedFloatFilter
    _sum?: NestedFloatFilter
    _min?: NestedFloatFilter
    _max?: NestedFloatFilter
  }
  export type JsonNullableWithAggregatesFilter = 
    | PatchUndefined<
        Either<Required<JsonNullableWithAggregatesFilterBase>, Exclude<keyof Required<JsonNullableWithAggregatesFilterBase>, 'path'>>,
        Required<JsonNullableWithAggregatesFilterBase>
      >
    | OptionalFlat<Omit<Required<JsonNullableWithAggregatesFilterBase>, 'path'>>

  export type JsonNullableWithAggregatesFilterBase = {
    equals?: InputJsonValue | JsonNullValueFilter
    path?: Array<string>
    string_contains?: string
    string_starts_with?: string
    string_ends_with?: string
    array_contains?: InputJsonValue | null
    array_starts_with?: InputJsonValue | null
    array_ends_with?: InputJsonValue | null
    lt?: InputJsonValue
    lte?: InputJsonValue
    gt?: InputJsonValue
    gte?: InputJsonValue
    not?: InputJsonValue | JsonNullValueFilter
    _count?: NestedIntNullableFilter
    _min?: NestedJsonNullableFilter
    _max?: NestedJsonNullableFilter
  }

  export type Chat_roomCountOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    username?: SortOrder
    message?: SortOrder
  }

  export type Chat_roomMaxOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    username?: SortOrder
    message?: SortOrder
  }

  export type Chat_roomMinOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    username?: SortOrder
    message?: SortOrder
  }

  export type Commerce_ordersCountOrderByAggregateInput = {
    order_id?: SortOrder
    timestamp?: SortOrder
    price_amount?: SortOrder
    price_currency?: SortOrder
    promo_code?: SortOrder
    customer_full_name?: SortOrder
    country?: SortOrder
    product?: SortOrder
  }

  export type Commerce_ordersAvgOrderByAggregateInput = {
    price_amount?: SortOrder
  }

  export type Commerce_ordersMaxOrderByAggregateInput = {
    order_id?: SortOrder
    timestamp?: SortOrder
    price_amount?: SortOrder
    price_currency?: SortOrder
    promo_code?: SortOrder
    customer_full_name?: SortOrder
    country?: SortOrder
    product?: SortOrder
  }

  export type Commerce_ordersMinOrderByAggregateInput = {
    order_id?: SortOrder
    timestamp?: SortOrder
    price_amount?: SortOrder
    price_currency?: SortOrder
    promo_code?: SortOrder
    customer_full_name?: SortOrder
    country?: SortOrder
    product?: SortOrder
  }

  export type Commerce_ordersSumOrderByAggregateInput = {
    price_amount?: SortOrder
  }

  export type LogsCountOrderByAggregateInput = {
    id?: SortOrder
    source_id?: SortOrder
    timestamp?: SortOrder
    content?: SortOrder
  }

  export type LogsMaxOrderByAggregateInput = {
    id?: SortOrder
    source_id?: SortOrder
    timestamp?: SortOrder
    content?: SortOrder
  }

  export type LogsMinOrderByAggregateInput = {
    id?: SortOrder
    source_id?: SortOrder
    timestamp?: SortOrder
    content?: SortOrder
  }

  export type MonitoringCountOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    type?: SortOrder
    value?: SortOrder
  }

  export type MonitoringAvgOrderByAggregateInput = {
    value?: SortOrder
  }

  export type MonitoringMaxOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    type?: SortOrder
    value?: SortOrder
  }

  export type MonitoringMinOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    type?: SortOrder
    value?: SortOrder
  }

  export type MonitoringSumOrderByAggregateInput = {
    value?: SortOrder
  }

  export type ResponsesListRelationFilter = {
    every?: ResponsesWhereInput
    some?: ResponsesWhereInput
    none?: ResponsesWhereInput
  }

  export type ResponsesOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type RequestsCountOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    path?: SortOrder
    method?: SortOrder
    data?: SortOrder
    processing?: SortOrder
    cancelled?: SortOrder
  }

  export type RequestsMaxOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    path?: SortOrder
    method?: SortOrder
    processing?: SortOrder
    cancelled?: SortOrder
  }

  export type RequestsMinOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    path?: SortOrder
    method?: SortOrder
    processing?: SortOrder
    cancelled?: SortOrder
  }

  export type IntFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntFilter | number
  }

  export type RequestsRelationFilter = {
    is?: RequestsWhereInput
    isNot?: RequestsWhereInput
  }

  export type ResponsesCountOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    request_id?: SortOrder
    status_code?: SortOrder
    data?: SortOrder
  }

  export type ResponsesAvgOrderByAggregateInput = {
    status_code?: SortOrder
  }

  export type ResponsesMaxOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    request_id?: SortOrder
    status_code?: SortOrder
  }

  export type ResponsesMinOrderByAggregateInput = {
    id?: SortOrder
    timestamp?: SortOrder
    request_id?: SortOrder
    status_code?: SortOrder
  }

  export type ResponsesSumOrderByAggregateInput = {
    status_code?: SortOrder
  }

  export type IntWithAggregatesFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntWithAggregatesFilter | number
    _count?: NestedIntFilter
    _avg?: NestedFloatFilter
    _sum?: NestedIntFilter
    _min?: NestedIntFilter
    _max?: NestedIntFilter
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type ResponsesCreateNestedManyWithoutRequestsInput = {
    create?: XOR<Enumerable<ResponsesCreateWithoutRequestsInput>, Enumerable<ResponsesUncheckedCreateWithoutRequestsInput>>
    connectOrCreate?: Enumerable<ResponsesCreateOrConnectWithoutRequestsInput>
    createMany?: ResponsesCreateManyRequestsInputEnvelope
    connect?: Enumerable<ResponsesWhereUniqueInput>
  }

  export type ResponsesUncheckedCreateNestedManyWithoutRequestsInput = {
    create?: XOR<Enumerable<ResponsesCreateWithoutRequestsInput>, Enumerable<ResponsesUncheckedCreateWithoutRequestsInput>>
    connectOrCreate?: Enumerable<ResponsesCreateOrConnectWithoutRequestsInput>
    createMany?: ResponsesCreateManyRequestsInputEnvelope
    connect?: Enumerable<ResponsesWhereUniqueInput>
  }

  export type ResponsesUpdateManyWithoutRequestsNestedInput = {
    create?: XOR<Enumerable<ResponsesCreateWithoutRequestsInput>, Enumerable<ResponsesUncheckedCreateWithoutRequestsInput>>
    connectOrCreate?: Enumerable<ResponsesCreateOrConnectWithoutRequestsInput>
    upsert?: Enumerable<ResponsesUpsertWithWhereUniqueWithoutRequestsInput>
    createMany?: ResponsesCreateManyRequestsInputEnvelope
    set?: Enumerable<ResponsesWhereUniqueInput>
    disconnect?: Enumerable<ResponsesWhereUniqueInput>
    delete?: Enumerable<ResponsesWhereUniqueInput>
    connect?: Enumerable<ResponsesWhereUniqueInput>
    update?: Enumerable<ResponsesUpdateWithWhereUniqueWithoutRequestsInput>
    updateMany?: Enumerable<ResponsesUpdateManyWithWhereWithoutRequestsInput>
    deleteMany?: Enumerable<ResponsesScalarWhereInput>
  }

  export type ResponsesUncheckedUpdateManyWithoutRequestsNestedInput = {
    create?: XOR<Enumerable<ResponsesCreateWithoutRequestsInput>, Enumerable<ResponsesUncheckedCreateWithoutRequestsInput>>
    connectOrCreate?: Enumerable<ResponsesCreateOrConnectWithoutRequestsInput>
    upsert?: Enumerable<ResponsesUpsertWithWhereUniqueWithoutRequestsInput>
    createMany?: ResponsesCreateManyRequestsInputEnvelope
    set?: Enumerable<ResponsesWhereUniqueInput>
    disconnect?: Enumerable<ResponsesWhereUniqueInput>
    delete?: Enumerable<ResponsesWhereUniqueInput>
    connect?: Enumerable<ResponsesWhereUniqueInput>
    update?: Enumerable<ResponsesUpdateWithWhereUniqueWithoutRequestsInput>
    updateMany?: Enumerable<ResponsesUpdateManyWithWhereWithoutRequestsInput>
    deleteMany?: Enumerable<ResponsesScalarWhereInput>
  }

  export type RequestsCreateNestedOneWithoutResponsesInput = {
    create?: XOR<RequestsCreateWithoutResponsesInput, RequestsUncheckedCreateWithoutResponsesInput>
    connectOrCreate?: RequestsCreateOrConnectWithoutResponsesInput
    connect?: RequestsWhereUniqueInput
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type RequestsUpdateOneRequiredWithoutResponsesNestedInput = {
    create?: XOR<RequestsCreateWithoutResponsesInput, RequestsUncheckedCreateWithoutResponsesInput>
    connectOrCreate?: RequestsCreateOrConnectWithoutResponsesInput
    upsert?: RequestsUpsertWithoutResponsesInput
    connect?: RequestsWhereUniqueInput
    update?: XOR<RequestsUpdateWithoutResponsesInput, RequestsUncheckedUpdateWithoutResponsesInput>
  }

  export type NestedUuidFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    not?: NestedUuidFilter | string
  }

  export type NestedStringFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    not?: NestedStringFilter | string
  }

  export type NestedDateTimeFilter = {
    equals?: Date | string
    in?: Enumerable<Date> | Enumerable<string>
    notIn?: Enumerable<Date> | Enumerable<string>
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeFilter | Date | string
  }

  export type NestedStringNullableFilter = {
    equals?: string | null
    in?: Enumerable<string> | null
    notIn?: Enumerable<string> | null
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    not?: NestedStringNullableFilter | string | null
  }

  export type NestedDateTimeNullableFilter = {
    equals?: Date | string | null
    in?: Enumerable<Date> | Enumerable<string> | null
    notIn?: Enumerable<Date> | Enumerable<string> | null
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeNullableFilter | Date | string | null
  }

  export type NestedUuidWithAggregatesFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    not?: NestedUuidWithAggregatesFilter | string
    _count?: NestedIntFilter
    _min?: NestedStringFilter
    _max?: NestedStringFilter
  }

  export type NestedIntFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntFilter | number
  }

  export type NestedStringWithAggregatesFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    not?: NestedStringWithAggregatesFilter | string
    _count?: NestedIntFilter
    _min?: NestedStringFilter
    _max?: NestedStringFilter
  }

  export type NestedDateTimeWithAggregatesFilter = {
    equals?: Date | string
    in?: Enumerable<Date> | Enumerable<string>
    notIn?: Enumerable<Date> | Enumerable<string>
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeWithAggregatesFilter | Date | string
    _count?: NestedIntFilter
    _min?: NestedDateTimeFilter
    _max?: NestedDateTimeFilter
  }

  export type NestedStringNullableWithAggregatesFilter = {
    equals?: string | null
    in?: Enumerable<string> | null
    notIn?: Enumerable<string> | null
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    not?: NestedStringNullableWithAggregatesFilter | string | null
    _count?: NestedIntNullableFilter
    _min?: NestedStringNullableFilter
    _max?: NestedStringNullableFilter
  }

  export type NestedIntNullableFilter = {
    equals?: number | null
    in?: Enumerable<number> | null
    notIn?: Enumerable<number> | null
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntNullableFilter | number | null
  }

  export type NestedDateTimeNullableWithAggregatesFilter = {
    equals?: Date | string | null
    in?: Enumerable<Date> | Enumerable<string> | null
    notIn?: Enumerable<Date> | Enumerable<string> | null
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeNullableWithAggregatesFilter | Date | string | null
    _count?: NestedIntNullableFilter
    _min?: NestedDateTimeNullableFilter
    _max?: NestedDateTimeNullableFilter
  }

  export type NestedBoolFilter = {
    equals?: boolean
    not?: NestedBoolFilter | boolean
  }

  export type NestedFloatFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatFilter | number
  }
  export type NestedJsonFilter = 
    | PatchUndefined<
        Either<Required<NestedJsonFilterBase>, Exclude<keyof Required<NestedJsonFilterBase>, 'path'>>,
        Required<NestedJsonFilterBase>
      >
    | OptionalFlat<Omit<Required<NestedJsonFilterBase>, 'path'>>

  export type NestedJsonFilterBase = {
    equals?: InputJsonValue | JsonNullValueFilter
    path?: Array<string>
    string_contains?: string
    string_starts_with?: string
    string_ends_with?: string
    array_contains?: InputJsonValue | null
    array_starts_with?: InputJsonValue | null
    array_ends_with?: InputJsonValue | null
    lt?: InputJsonValue
    lte?: InputJsonValue
    gt?: InputJsonValue
    gte?: InputJsonValue
    not?: InputJsonValue | JsonNullValueFilter
  }

  export type NestedBoolWithAggregatesFilter = {
    equals?: boolean
    not?: NestedBoolWithAggregatesFilter | boolean
    _count?: NestedIntFilter
    _min?: NestedBoolFilter
    _max?: NestedBoolFilter
  }

  export type NestedFloatWithAggregatesFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatWithAggregatesFilter | number
    _count?: NestedIntFilter
    _avg?: NestedFloatFilter
    _sum?: NestedFloatFilter
    _min?: NestedFloatFilter
    _max?: NestedFloatFilter
  }
  export type NestedJsonNullableFilter = 
    | PatchUndefined<
        Either<Required<NestedJsonNullableFilterBase>, Exclude<keyof Required<NestedJsonNullableFilterBase>, 'path'>>,
        Required<NestedJsonNullableFilterBase>
      >
    | OptionalFlat<Omit<Required<NestedJsonNullableFilterBase>, 'path'>>

  export type NestedJsonNullableFilterBase = {
    equals?: InputJsonValue | JsonNullValueFilter
    path?: Array<string>
    string_contains?: string
    string_starts_with?: string
    string_ends_with?: string
    array_contains?: InputJsonValue | null
    array_starts_with?: InputJsonValue | null
    array_ends_with?: InputJsonValue | null
    lt?: InputJsonValue
    lte?: InputJsonValue
    gt?: InputJsonValue
    gte?: InputJsonValue
    not?: InputJsonValue | JsonNullValueFilter
  }

  export type NestedIntWithAggregatesFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntWithAggregatesFilter | number
    _count?: NestedIntFilter
    _avg?: NestedFloatFilter
    _sum?: NestedIntFilter
    _min?: NestedIntFilter
    _max?: NestedIntFilter
  }

  export type ResponsesCreateWithoutRequestsInput = {
    id: string
    timestamp: Date | string
    status_code: number
    data?: NullableJsonNullValueInput | InputJsonValue
  }

  export type ResponsesUncheckedCreateWithoutRequestsInput = {
    id: string
    timestamp: Date | string
    status_code: number
    data?: NullableJsonNullValueInput | InputJsonValue
  }

  export type ResponsesCreateOrConnectWithoutRequestsInput = {
    where: ResponsesWhereUniqueInput
    create: XOR<ResponsesCreateWithoutRequestsInput, ResponsesUncheckedCreateWithoutRequestsInput>
  }

  export type ResponsesCreateManyRequestsInputEnvelope = {
    data: Enumerable<ResponsesCreateManyRequestsInput>
    skipDuplicates?: boolean
  }

  export type ResponsesUpsertWithWhereUniqueWithoutRequestsInput = {
    where: ResponsesWhereUniqueInput
    update: XOR<ResponsesUpdateWithoutRequestsInput, ResponsesUncheckedUpdateWithoutRequestsInput>
    create: XOR<ResponsesCreateWithoutRequestsInput, ResponsesUncheckedCreateWithoutRequestsInput>
  }

  export type ResponsesUpdateWithWhereUniqueWithoutRequestsInput = {
    where: ResponsesWhereUniqueInput
    data: XOR<ResponsesUpdateWithoutRequestsInput, ResponsesUncheckedUpdateWithoutRequestsInput>
  }

  export type ResponsesUpdateManyWithWhereWithoutRequestsInput = {
    where: ResponsesScalarWhereInput
    data: XOR<ResponsesUpdateManyMutationInput, ResponsesUncheckedUpdateManyWithoutResponsesInput>
  }

  export type ResponsesScalarWhereInput = {
    AND?: Enumerable<ResponsesScalarWhereInput>
    OR?: Enumerable<ResponsesScalarWhereInput>
    NOT?: Enumerable<ResponsesScalarWhereInput>
    id?: UuidFilter | string
    timestamp?: DateTimeFilter | Date | string
    request_id?: UuidFilter | string
    status_code?: IntFilter | number
    data?: JsonNullableFilter
  }

  export type RequestsCreateWithoutResponsesInput = {
    id: string
    timestamp: Date | string
    path: string
    method: string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing: boolean
    cancelled: boolean
  }

  export type RequestsUncheckedCreateWithoutResponsesInput = {
    id: string
    timestamp: Date | string
    path: string
    method: string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing: boolean
    cancelled: boolean
  }

  export type RequestsCreateOrConnectWithoutResponsesInput = {
    where: RequestsWhereUniqueInput
    create: XOR<RequestsCreateWithoutResponsesInput, RequestsUncheckedCreateWithoutResponsesInput>
  }

  export type RequestsUpsertWithoutResponsesInput = {
    update: XOR<RequestsUpdateWithoutResponsesInput, RequestsUncheckedUpdateWithoutResponsesInput>
    create: XOR<RequestsCreateWithoutResponsesInput, RequestsUncheckedCreateWithoutResponsesInput>
  }

  export type RequestsUpdateWithoutResponsesInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    path?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing?: BoolFieldUpdateOperationsInput | boolean
    cancelled?: BoolFieldUpdateOperationsInput | boolean
  }

  export type RequestsUncheckedUpdateWithoutResponsesInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    path?: StringFieldUpdateOperationsInput | string
    method?: StringFieldUpdateOperationsInput | string
    data?: NullableJsonNullValueInput | InputJsonValue
    processing?: BoolFieldUpdateOperationsInput | boolean
    cancelled?: BoolFieldUpdateOperationsInput | boolean
  }

  export type ResponsesCreateManyRequestsInput = {
    id: string
    timestamp: Date | string
    status_code: number
    data?: NullableJsonNullValueInput | InputJsonValue
  }

  export type ResponsesUpdateWithoutRequestsInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    status_code?: IntFieldUpdateOperationsInput | number
    data?: NullableJsonNullValueInput | InputJsonValue
  }

  export type ResponsesUncheckedUpdateWithoutRequestsInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    status_code?: IntFieldUpdateOperationsInput | number
    data?: NullableJsonNullValueInput | InputJsonValue
  }

  export type ResponsesUncheckedUpdateManyWithoutResponsesInput = {
    id?: StringFieldUpdateOperationsInput | string
    timestamp?: DateTimeFieldUpdateOperationsInput | Date | string
    status_code?: IntFieldUpdateOperationsInput | number
    data?: NullableJsonNullValueInput | InputJsonValue
  }



  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}