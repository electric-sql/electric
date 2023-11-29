
/**
 * Client
**/

import * as runtime from './runtime/library';
type UnwrapPromise<P extends any> = P extends Promise<infer R> ? R : P
type UnwrapTuple<Tuple extends readonly unknown[]> = {
  [K in keyof Tuple]: K extends `${number}` ? Tuple[K] extends Prisma.PrismaPromise<infer X> ? X : UnwrapPromise<Tuple[K]> : UnwrapPromise<Tuple[K]>
};

export type PrismaPromise<T> = runtime.Types.Public.PrismaPromise<T>


/**
 * Model Items
 * 
 */
export type Items = {
  id: string
  content: string
  content_text_null: string | null
  content_text_null_default: string | null
  intvalue_null: number | null
  intvalue_null_default: number | null
}

/**
 * Model OtherItems
 * 
 */
export type OtherItems = {
  id: string
  content: string
  item_id: string | null
}

/**
 * Model Timestamps
 * 
 */
export type Timestamps = {
  id: string
  created_at: Date
  updated_at: Date
}

/**
 * Model Datetimes
 * 
 */
export type Datetimes = {
  id: string
  d: Date
  t: Date
}

/**
 * Model Bools
 * 
 */
export type Bools = {
  id: string
  b: boolean | null
}

/**
 * Model Uuids
 * 
 */
export type Uuids = {
  /**
   * @zod.string.uuid()
   */
  id: string
}

/**
 * Model Ints
 * 
 */
export type Ints = {
  id: string
  /**
   * @zod.number.int().gte(-32768).lte(32767)
   */
  i2: number | null
  /**
   * @zod.number.int().gte(-2147483648).lte(2147483647)
   */
  i4: number | null
  i8: bigint | null
}

/**
 * Model Floats
 * 
 */
export type Floats = {
  id: string
  /**
   * @zod.custom.use(z.number().or(z.nan()))
   */
  f8: number | null
}


/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Items
 * const items = await prisma.items.findMany()
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
   * // Fetch zero or more Items
   * const items = await prisma.items.findMany()
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
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

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
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

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
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;

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
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<this, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use">) => Promise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<R>

      /**
   * `prisma.items`: Exposes CRUD operations for the **Items** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Items
    * const items = await prisma.items.findMany()
    * ```
    */
  get items(): Prisma.ItemsDelegate<GlobalReject>;

  /**
   * `prisma.otherItems`: Exposes CRUD operations for the **OtherItems** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more OtherItems
    * const otherItems = await prisma.otherItems.findMany()
    * ```
    */
  get otherItems(): Prisma.OtherItemsDelegate<GlobalReject>;

  /**
   * `prisma.timestamps`: Exposes CRUD operations for the **Timestamps** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Timestamps
    * const timestamps = await prisma.timestamps.findMany()
    * ```
    */
  get timestamps(): Prisma.TimestampsDelegate<GlobalReject>;

  /**
   * `prisma.datetimes`: Exposes CRUD operations for the **Datetimes** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Datetimes
    * const datetimes = await prisma.datetimes.findMany()
    * ```
    */
  get datetimes(): Prisma.DatetimesDelegate<GlobalReject>;

  /**
   * `prisma.bools`: Exposes CRUD operations for the **Bools** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Bools
    * const bools = await prisma.bools.findMany()
    * ```
    */
  get bools(): Prisma.BoolsDelegate<GlobalReject>;

  /**
   * `prisma.uuids`: Exposes CRUD operations for the **Uuids** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Uuids
    * const uuids = await prisma.uuids.findMany()
    * ```
    */
  get uuids(): Prisma.UuidsDelegate<GlobalReject>;

  /**
   * `prisma.ints`: Exposes CRUD operations for the **Ints** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Ints
    * const ints = await prisma.ints.findMany()
    * ```
    */
  get ints(): Prisma.IntsDelegate<GlobalReject>;

  /**
   * `prisma.floats`: Exposes CRUD operations for the **Floats** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Floats
    * const floats = await prisma.floats.findMany()
    * ```
    */
  get floats(): Prisma.FloatsDelegate<GlobalReject>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = runtime.Types.Public.PrismaPromise<T>

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
   * Prisma Client JS version: 4.15.0
   * Query Engine version: 8fbc245156db7124f997f4cecdd8d1219e360944
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

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;

  export function validator<V>(): <S>(select: runtime.Types.Utils.LegacyExact<S, V>) => S;

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


  export const ModelName: {
    Items: 'Items',
    OtherItems: 'OtherItems',
    Timestamps: 'Timestamps',
    Datetimes: 'Datetimes',
    Bools: 'Bools',
    Uuids: 'Uuids',
    Ints: 'Ints',
    Floats: 'Floats'
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
   * Models
   */

  /**
   * Model Items
   */


  export type AggregateItems = {
    _count: ItemsCountAggregateOutputType | null
    _avg: ItemsAvgAggregateOutputType | null
    _sum: ItemsSumAggregateOutputType | null
    _min: ItemsMinAggregateOutputType | null
    _max: ItemsMaxAggregateOutputType | null
  }

  export type ItemsAvgAggregateOutputType = {
    intvalue_null: number | null
    intvalue_null_default: number | null
  }

  export type ItemsSumAggregateOutputType = {
    intvalue_null: number | null
    intvalue_null_default: number | null
  }

  export type ItemsMinAggregateOutputType = {
    id: string | null
    content: string | null
    content_text_null: string | null
    content_text_null_default: string | null
    intvalue_null: number | null
    intvalue_null_default: number | null
  }

  export type ItemsMaxAggregateOutputType = {
    id: string | null
    content: string | null
    content_text_null: string | null
    content_text_null_default: string | null
    intvalue_null: number | null
    intvalue_null_default: number | null
  }

  export type ItemsCountAggregateOutputType = {
    id: number
    content: number
    content_text_null: number
    content_text_null_default: number
    intvalue_null: number
    intvalue_null_default: number
    _all: number
  }


  export type ItemsAvgAggregateInputType = {
    intvalue_null?: true
    intvalue_null_default?: true
  }

  export type ItemsSumAggregateInputType = {
    intvalue_null?: true
    intvalue_null_default?: true
  }

  export type ItemsMinAggregateInputType = {
    id?: true
    content?: true
    content_text_null?: true
    content_text_null_default?: true
    intvalue_null?: true
    intvalue_null_default?: true
  }

  export type ItemsMaxAggregateInputType = {
    id?: true
    content?: true
    content_text_null?: true
    content_text_null_default?: true
    intvalue_null?: true
    intvalue_null_default?: true
  }

  export type ItemsCountAggregateInputType = {
    id?: true
    content?: true
    content_text_null?: true
    content_text_null_default?: true
    intvalue_null?: true
    intvalue_null_default?: true
    _all?: true
  }

  export type ItemsAggregateArgs = {
    /**
     * Filter which Items to aggregate.
     */
    where?: ItemsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Items to fetch.
     */
    orderBy?: Enumerable<ItemsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ItemsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Items from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Items.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Items
    **/
    _count?: true | ItemsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: ItemsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: ItemsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ItemsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ItemsMaxAggregateInputType
  }

  export type GetItemsAggregateType<T extends ItemsAggregateArgs> = {
        [P in keyof T & keyof AggregateItems]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateItems[P]>
      : GetScalarType<T[P], AggregateItems[P]>
  }




  export type ItemsGroupByArgs = {
    where?: ItemsWhereInput
    orderBy?: Enumerable<ItemsOrderByWithAggregationInput>
    by: ItemsScalarFieldEnum[]
    having?: ItemsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ItemsCountAggregateInputType | true
    _avg?: ItemsAvgAggregateInputType
    _sum?: ItemsSumAggregateInputType
    _min?: ItemsMinAggregateInputType
    _max?: ItemsMaxAggregateInputType
  }


  export type ItemsGroupByOutputType = {
    id: string
    content: string
    content_text_null: string | null
    content_text_null_default: string | null
    intvalue_null: number | null
    intvalue_null_default: number | null
    _count: ItemsCountAggregateOutputType | null
    _avg: ItemsAvgAggregateOutputType | null
    _sum: ItemsSumAggregateOutputType | null
    _min: ItemsMinAggregateOutputType | null
    _max: ItemsMaxAggregateOutputType | null
  }

  type GetItemsGroupByPayload<T extends ItemsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickArray<ItemsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ItemsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ItemsGroupByOutputType[P]>
            : GetScalarType<T[P], ItemsGroupByOutputType[P]>
        }
      >
    >


  export type ItemsSelect = {
    id?: boolean
    content?: boolean
    content_text_null?: boolean
    content_text_null_default?: boolean
    intvalue_null?: boolean
    intvalue_null_default?: boolean
    other_items?: boolean | OtherItemsArgs
  }


  export type ItemsInclude = {
    other_items?: boolean | OtherItemsArgs
  }

  export type ItemsGetPayload<S extends boolean | null | undefined | ItemsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Items :
    S extends undefined ? never :
    S extends { include: any } & (ItemsArgs | ItemsFindManyArgs)
    ? Items  & {
    [P in TruthyKeys<S['include']>]:
        P extends 'other_items' ? OtherItemsGetPayload<S['include'][P]> | null :  never
  } 
    : S extends { select: any } & (ItemsArgs | ItemsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
        P extends 'other_items' ? OtherItemsGetPayload<S['select'][P]> | null :  P extends keyof Items ? Items[P] : never
  } 
      : Items


  type ItemsCountArgs = 
    Omit<ItemsFindManyArgs, 'select' | 'include'> & {
      select?: ItemsCountAggregateInputType | true
    }

  export interface ItemsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {

    /**
     * Find zero or one Items that matches the filter.
     * @param {ItemsFindUniqueArgs} args - Arguments to find a Items
     * @example
     * // Get one Items
     * const items = await prisma.items.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends ItemsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, ItemsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Items'> extends True ? Prisma__ItemsClient<ItemsGetPayload<T>> : Prisma__ItemsClient<ItemsGetPayload<T> | null, null>

    /**
     * Find one Items that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {ItemsFindUniqueOrThrowArgs} args - Arguments to find a Items
     * @example
     * // Get one Items
     * const items = await prisma.items.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends ItemsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, ItemsFindUniqueOrThrowArgs>
    ): Prisma__ItemsClient<ItemsGetPayload<T>>

    /**
     * Find the first Items that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ItemsFindFirstArgs} args - Arguments to find a Items
     * @example
     * // Get one Items
     * const items = await prisma.items.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends ItemsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, ItemsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Items'> extends True ? Prisma__ItemsClient<ItemsGetPayload<T>> : Prisma__ItemsClient<ItemsGetPayload<T> | null, null>

    /**
     * Find the first Items that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ItemsFindFirstOrThrowArgs} args - Arguments to find a Items
     * @example
     * // Get one Items
     * const items = await prisma.items.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends ItemsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, ItemsFindFirstOrThrowArgs>
    ): Prisma__ItemsClient<ItemsGetPayload<T>>

    /**
     * Find zero or more Items that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ItemsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Items
     * const items = await prisma.items.findMany()
     * 
     * // Get first 10 Items
     * const items = await prisma.items.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const itemsWithIdOnly = await prisma.items.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends ItemsFindManyArgs>(
      args?: SelectSubset<T, ItemsFindManyArgs>
    ): Prisma.PrismaPromise<Array<ItemsGetPayload<T>>>

    /**
     * Create a Items.
     * @param {ItemsCreateArgs} args - Arguments to create a Items.
     * @example
     * // Create one Items
     * const Items = await prisma.items.create({
     *   data: {
     *     // ... data to create a Items
     *   }
     * })
     * 
    **/
    create<T extends ItemsCreateArgs>(
      args: SelectSubset<T, ItemsCreateArgs>
    ): Prisma__ItemsClient<ItemsGetPayload<T>>

    /**
     * Create many Items.
     *     @param {ItemsCreateManyArgs} args - Arguments to create many Items.
     *     @example
     *     // Create many Items
     *     const items = await prisma.items.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends ItemsCreateManyArgs>(
      args?: SelectSubset<T, ItemsCreateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a Items.
     * @param {ItemsDeleteArgs} args - Arguments to delete one Items.
     * @example
     * // Delete one Items
     * const Items = await prisma.items.delete({
     *   where: {
     *     // ... filter to delete one Items
     *   }
     * })
     * 
    **/
    delete<T extends ItemsDeleteArgs>(
      args: SelectSubset<T, ItemsDeleteArgs>
    ): Prisma__ItemsClient<ItemsGetPayload<T>>

    /**
     * Update one Items.
     * @param {ItemsUpdateArgs} args - Arguments to update one Items.
     * @example
     * // Update one Items
     * const items = await prisma.items.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends ItemsUpdateArgs>(
      args: SelectSubset<T, ItemsUpdateArgs>
    ): Prisma__ItemsClient<ItemsGetPayload<T>>

    /**
     * Delete zero or more Items.
     * @param {ItemsDeleteManyArgs} args - Arguments to filter Items to delete.
     * @example
     * // Delete a few Items
     * const { count } = await prisma.items.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends ItemsDeleteManyArgs>(
      args?: SelectSubset<T, ItemsDeleteManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Items.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ItemsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Items
     * const items = await prisma.items.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends ItemsUpdateManyArgs>(
      args: SelectSubset<T, ItemsUpdateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Items.
     * @param {ItemsUpsertArgs} args - Arguments to update or create a Items.
     * @example
     * // Update or create a Items
     * const items = await prisma.items.upsert({
     *   create: {
     *     // ... data to create a Items
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Items we want to update
     *   }
     * })
    **/
    upsert<T extends ItemsUpsertArgs>(
      args: SelectSubset<T, ItemsUpsertArgs>
    ): Prisma__ItemsClient<ItemsGetPayload<T>>

    /**
     * Count the number of Items.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ItemsCountArgs} args - Arguments to filter Items to count.
     * @example
     * // Count the number of Items
     * const count = await prisma.items.count({
     *   where: {
     *     // ... the filter for the Items we want to count
     *   }
     * })
    **/
    count<T extends ItemsCountArgs>(
      args?: Subset<T, ItemsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ItemsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Items.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ItemsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends ItemsAggregateArgs>(args: Subset<T, ItemsAggregateArgs>): Prisma.PrismaPromise<GetItemsAggregateType<T>>

    /**
     * Group by Items.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ItemsGroupByArgs} args - Group by arguments.
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
      T extends ItemsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ItemsGroupByArgs['orderBy'] }
        : { orderBy?: ItemsGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, ItemsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetItemsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Items.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__ItemsClient<T, Null = never> implements Prisma.PrismaPromise<T> {
    private readonly _dmmf;
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
    readonly [Symbol.toStringTag]: 'PrismaPromise';
    constructor(_dmmf: runtime.DMMFClass, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);

    other_items<T extends OtherItemsArgs= {}>(args?: Subset<T, OtherItemsArgs>): Prisma__OtherItemsClient<OtherItemsGetPayload<T> | Null>;

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
   * Items base type for findUnique actions
   */
  export type ItemsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Items
     */
    select?: ItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ItemsInclude | null
    /**
     * Filter, which Items to fetch.
     */
    where: ItemsWhereUniqueInput
  }

  /**
   * Items findUnique
   */
  export interface ItemsFindUniqueArgs extends ItemsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Items findUniqueOrThrow
   */
  export type ItemsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Items
     */
    select?: ItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ItemsInclude | null
    /**
     * Filter, which Items to fetch.
     */
    where: ItemsWhereUniqueInput
  }


  /**
   * Items base type for findFirst actions
   */
  export type ItemsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Items
     */
    select?: ItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ItemsInclude | null
    /**
     * Filter, which Items to fetch.
     */
    where?: ItemsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Items to fetch.
     */
    orderBy?: Enumerable<ItemsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Items.
     */
    cursor?: ItemsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Items from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Items.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Items.
     */
    distinct?: Enumerable<ItemsScalarFieldEnum>
  }

  /**
   * Items findFirst
   */
  export interface ItemsFindFirstArgs extends ItemsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Items findFirstOrThrow
   */
  export type ItemsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Items
     */
    select?: ItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ItemsInclude | null
    /**
     * Filter, which Items to fetch.
     */
    where?: ItemsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Items to fetch.
     */
    orderBy?: Enumerable<ItemsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Items.
     */
    cursor?: ItemsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Items from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Items.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Items.
     */
    distinct?: Enumerable<ItemsScalarFieldEnum>
  }


  /**
   * Items findMany
   */
  export type ItemsFindManyArgs = {
    /**
     * Select specific fields to fetch from the Items
     */
    select?: ItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ItemsInclude | null
    /**
     * Filter, which Items to fetch.
     */
    where?: ItemsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Items to fetch.
     */
    orderBy?: Enumerable<ItemsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Items.
     */
    cursor?: ItemsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Items from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Items.
     */
    skip?: number
    distinct?: Enumerable<ItemsScalarFieldEnum>
  }


  /**
   * Items create
   */
  export type ItemsCreateArgs = {
    /**
     * Select specific fields to fetch from the Items
     */
    select?: ItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ItemsInclude | null
    /**
     * The data needed to create a Items.
     */
    data: XOR<ItemsCreateInput, ItemsUncheckedCreateInput>
  }


  /**
   * Items createMany
   */
  export type ItemsCreateManyArgs = {
    /**
     * The data used to create many Items.
     */
    data: Enumerable<ItemsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Items update
   */
  export type ItemsUpdateArgs = {
    /**
     * Select specific fields to fetch from the Items
     */
    select?: ItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ItemsInclude | null
    /**
     * The data needed to update a Items.
     */
    data: XOR<ItemsUpdateInput, ItemsUncheckedUpdateInput>
    /**
     * Choose, which Items to update.
     */
    where: ItemsWhereUniqueInput
  }


  /**
   * Items updateMany
   */
  export type ItemsUpdateManyArgs = {
    /**
     * The data used to update Items.
     */
    data: XOR<ItemsUpdateManyMutationInput, ItemsUncheckedUpdateManyInput>
    /**
     * Filter which Items to update
     */
    where?: ItemsWhereInput
  }


  /**
   * Items upsert
   */
  export type ItemsUpsertArgs = {
    /**
     * Select specific fields to fetch from the Items
     */
    select?: ItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ItemsInclude | null
    /**
     * The filter to search for the Items to update in case it exists.
     */
    where: ItemsWhereUniqueInput
    /**
     * In case the Items found by the `where` argument doesn't exist, create a new Items with this data.
     */
    create: XOR<ItemsCreateInput, ItemsUncheckedCreateInput>
    /**
     * In case the Items was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ItemsUpdateInput, ItemsUncheckedUpdateInput>
  }


  /**
   * Items delete
   */
  export type ItemsDeleteArgs = {
    /**
     * Select specific fields to fetch from the Items
     */
    select?: ItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ItemsInclude | null
    /**
     * Filter which Items to delete.
     */
    where: ItemsWhereUniqueInput
  }


  /**
   * Items deleteMany
   */
  export type ItemsDeleteManyArgs = {
    /**
     * Filter which Items to delete
     */
    where?: ItemsWhereInput
  }


  /**
   * Items without action
   */
  export type ItemsArgs = {
    /**
     * Select specific fields to fetch from the Items
     */
    select?: ItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ItemsInclude | null
  }



  /**
   * Model OtherItems
   */


  export type AggregateOtherItems = {
    _count: OtherItemsCountAggregateOutputType | null
    _min: OtherItemsMinAggregateOutputType | null
    _max: OtherItemsMaxAggregateOutputType | null
  }

  export type OtherItemsMinAggregateOutputType = {
    id: string | null
    content: string | null
    item_id: string | null
  }

  export type OtherItemsMaxAggregateOutputType = {
    id: string | null
    content: string | null
    item_id: string | null
  }

  export type OtherItemsCountAggregateOutputType = {
    id: number
    content: number
    item_id: number
    _all: number
  }


  export type OtherItemsMinAggregateInputType = {
    id?: true
    content?: true
    item_id?: true
  }

  export type OtherItemsMaxAggregateInputType = {
    id?: true
    content?: true
    item_id?: true
  }

  export type OtherItemsCountAggregateInputType = {
    id?: true
    content?: true
    item_id?: true
    _all?: true
  }

  export type OtherItemsAggregateArgs = {
    /**
     * Filter which OtherItems to aggregate.
     */
    where?: OtherItemsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OtherItems to fetch.
     */
    orderBy?: Enumerable<OtherItemsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: OtherItemsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OtherItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OtherItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned OtherItems
    **/
    _count?: true | OtherItemsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: OtherItemsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: OtherItemsMaxAggregateInputType
  }

  export type GetOtherItemsAggregateType<T extends OtherItemsAggregateArgs> = {
        [P in keyof T & keyof AggregateOtherItems]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateOtherItems[P]>
      : GetScalarType<T[P], AggregateOtherItems[P]>
  }




  export type OtherItemsGroupByArgs = {
    where?: OtherItemsWhereInput
    orderBy?: Enumerable<OtherItemsOrderByWithAggregationInput>
    by: OtherItemsScalarFieldEnum[]
    having?: OtherItemsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: OtherItemsCountAggregateInputType | true
    _min?: OtherItemsMinAggregateInputType
    _max?: OtherItemsMaxAggregateInputType
  }


  export type OtherItemsGroupByOutputType = {
    id: string
    content: string
    item_id: string | null
    _count: OtherItemsCountAggregateOutputType | null
    _min: OtherItemsMinAggregateOutputType | null
    _max: OtherItemsMaxAggregateOutputType | null
  }

  type GetOtherItemsGroupByPayload<T extends OtherItemsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickArray<OtherItemsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof OtherItemsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], OtherItemsGroupByOutputType[P]>
            : GetScalarType<T[P], OtherItemsGroupByOutputType[P]>
        }
      >
    >


  export type OtherItemsSelect = {
    id?: boolean
    content?: boolean
    item_id?: boolean
    items?: boolean | ItemsArgs
  }


  export type OtherItemsInclude = {
    items?: boolean | ItemsArgs
  }

  export type OtherItemsGetPayload<S extends boolean | null | undefined | OtherItemsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? OtherItems :
    S extends undefined ? never :
    S extends { include: any } & (OtherItemsArgs | OtherItemsFindManyArgs)
    ? OtherItems  & {
    [P in TruthyKeys<S['include']>]:
        P extends 'items' ? ItemsGetPayload<S['include'][P]> | null :  never
  } 
    : S extends { select: any } & (OtherItemsArgs | OtherItemsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
        P extends 'items' ? ItemsGetPayload<S['select'][P]> | null :  P extends keyof OtherItems ? OtherItems[P] : never
  } 
      : OtherItems


  type OtherItemsCountArgs = 
    Omit<OtherItemsFindManyArgs, 'select' | 'include'> & {
      select?: OtherItemsCountAggregateInputType | true
    }

  export interface OtherItemsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {

    /**
     * Find zero or one OtherItems that matches the filter.
     * @param {OtherItemsFindUniqueArgs} args - Arguments to find a OtherItems
     * @example
     * // Get one OtherItems
     * const otherItems = await prisma.otherItems.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends OtherItemsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, OtherItemsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'OtherItems'> extends True ? Prisma__OtherItemsClient<OtherItemsGetPayload<T>> : Prisma__OtherItemsClient<OtherItemsGetPayload<T> | null, null>

    /**
     * Find one OtherItems that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {OtherItemsFindUniqueOrThrowArgs} args - Arguments to find a OtherItems
     * @example
     * // Get one OtherItems
     * const otherItems = await prisma.otherItems.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends OtherItemsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, OtherItemsFindUniqueOrThrowArgs>
    ): Prisma__OtherItemsClient<OtherItemsGetPayload<T>>

    /**
     * Find the first OtherItems that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OtherItemsFindFirstArgs} args - Arguments to find a OtherItems
     * @example
     * // Get one OtherItems
     * const otherItems = await prisma.otherItems.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends OtherItemsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, OtherItemsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'OtherItems'> extends True ? Prisma__OtherItemsClient<OtherItemsGetPayload<T>> : Prisma__OtherItemsClient<OtherItemsGetPayload<T> | null, null>

    /**
     * Find the first OtherItems that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OtherItemsFindFirstOrThrowArgs} args - Arguments to find a OtherItems
     * @example
     * // Get one OtherItems
     * const otherItems = await prisma.otherItems.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends OtherItemsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, OtherItemsFindFirstOrThrowArgs>
    ): Prisma__OtherItemsClient<OtherItemsGetPayload<T>>

    /**
     * Find zero or more OtherItems that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OtherItemsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all OtherItems
     * const otherItems = await prisma.otherItems.findMany()
     * 
     * // Get first 10 OtherItems
     * const otherItems = await prisma.otherItems.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const otherItemsWithIdOnly = await prisma.otherItems.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends OtherItemsFindManyArgs>(
      args?: SelectSubset<T, OtherItemsFindManyArgs>
    ): Prisma.PrismaPromise<Array<OtherItemsGetPayload<T>>>

    /**
     * Create a OtherItems.
     * @param {OtherItemsCreateArgs} args - Arguments to create a OtherItems.
     * @example
     * // Create one OtherItems
     * const OtherItems = await prisma.otherItems.create({
     *   data: {
     *     // ... data to create a OtherItems
     *   }
     * })
     * 
    **/
    create<T extends OtherItemsCreateArgs>(
      args: SelectSubset<T, OtherItemsCreateArgs>
    ): Prisma__OtherItemsClient<OtherItemsGetPayload<T>>

    /**
     * Create many OtherItems.
     *     @param {OtherItemsCreateManyArgs} args - Arguments to create many OtherItems.
     *     @example
     *     // Create many OtherItems
     *     const otherItems = await prisma.otherItems.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends OtherItemsCreateManyArgs>(
      args?: SelectSubset<T, OtherItemsCreateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a OtherItems.
     * @param {OtherItemsDeleteArgs} args - Arguments to delete one OtherItems.
     * @example
     * // Delete one OtherItems
     * const OtherItems = await prisma.otherItems.delete({
     *   where: {
     *     // ... filter to delete one OtherItems
     *   }
     * })
     * 
    **/
    delete<T extends OtherItemsDeleteArgs>(
      args: SelectSubset<T, OtherItemsDeleteArgs>
    ): Prisma__OtherItemsClient<OtherItemsGetPayload<T>>

    /**
     * Update one OtherItems.
     * @param {OtherItemsUpdateArgs} args - Arguments to update one OtherItems.
     * @example
     * // Update one OtherItems
     * const otherItems = await prisma.otherItems.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends OtherItemsUpdateArgs>(
      args: SelectSubset<T, OtherItemsUpdateArgs>
    ): Prisma__OtherItemsClient<OtherItemsGetPayload<T>>

    /**
     * Delete zero or more OtherItems.
     * @param {OtherItemsDeleteManyArgs} args - Arguments to filter OtherItems to delete.
     * @example
     * // Delete a few OtherItems
     * const { count } = await prisma.otherItems.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends OtherItemsDeleteManyArgs>(
      args?: SelectSubset<T, OtherItemsDeleteManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more OtherItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OtherItemsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many OtherItems
     * const otherItems = await prisma.otherItems.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends OtherItemsUpdateManyArgs>(
      args: SelectSubset<T, OtherItemsUpdateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one OtherItems.
     * @param {OtherItemsUpsertArgs} args - Arguments to update or create a OtherItems.
     * @example
     * // Update or create a OtherItems
     * const otherItems = await prisma.otherItems.upsert({
     *   create: {
     *     // ... data to create a OtherItems
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the OtherItems we want to update
     *   }
     * })
    **/
    upsert<T extends OtherItemsUpsertArgs>(
      args: SelectSubset<T, OtherItemsUpsertArgs>
    ): Prisma__OtherItemsClient<OtherItemsGetPayload<T>>

    /**
     * Count the number of OtherItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OtherItemsCountArgs} args - Arguments to filter OtherItems to count.
     * @example
     * // Count the number of OtherItems
     * const count = await prisma.otherItems.count({
     *   where: {
     *     // ... the filter for the OtherItems we want to count
     *   }
     * })
    **/
    count<T extends OtherItemsCountArgs>(
      args?: Subset<T, OtherItemsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], OtherItemsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a OtherItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OtherItemsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends OtherItemsAggregateArgs>(args: Subset<T, OtherItemsAggregateArgs>): Prisma.PrismaPromise<GetOtherItemsAggregateType<T>>

    /**
     * Group by OtherItems.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OtherItemsGroupByArgs} args - Group by arguments.
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
      T extends OtherItemsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: OtherItemsGroupByArgs['orderBy'] }
        : { orderBy?: OtherItemsGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, OtherItemsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetOtherItemsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for OtherItems.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__OtherItemsClient<T, Null = never> implements Prisma.PrismaPromise<T> {
    private readonly _dmmf;
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
    readonly [Symbol.toStringTag]: 'PrismaPromise';
    constructor(_dmmf: runtime.DMMFClass, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);

    items<T extends ItemsArgs= {}>(args?: Subset<T, ItemsArgs>): Prisma__ItemsClient<ItemsGetPayload<T> | Null>;

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
   * OtherItems base type for findUnique actions
   */
  export type OtherItemsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the OtherItems
     */
    select?: OtherItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OtherItemsInclude | null
    /**
     * Filter, which OtherItems to fetch.
     */
    where: OtherItemsWhereUniqueInput
  }

  /**
   * OtherItems findUnique
   */
  export interface OtherItemsFindUniqueArgs extends OtherItemsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * OtherItems findUniqueOrThrow
   */
  export type OtherItemsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the OtherItems
     */
    select?: OtherItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OtherItemsInclude | null
    /**
     * Filter, which OtherItems to fetch.
     */
    where: OtherItemsWhereUniqueInput
  }


  /**
   * OtherItems base type for findFirst actions
   */
  export type OtherItemsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the OtherItems
     */
    select?: OtherItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OtherItemsInclude | null
    /**
     * Filter, which OtherItems to fetch.
     */
    where?: OtherItemsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OtherItems to fetch.
     */
    orderBy?: Enumerable<OtherItemsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for OtherItems.
     */
    cursor?: OtherItemsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OtherItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OtherItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of OtherItems.
     */
    distinct?: Enumerable<OtherItemsScalarFieldEnum>
  }

  /**
   * OtherItems findFirst
   */
  export interface OtherItemsFindFirstArgs extends OtherItemsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * OtherItems findFirstOrThrow
   */
  export type OtherItemsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the OtherItems
     */
    select?: OtherItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OtherItemsInclude | null
    /**
     * Filter, which OtherItems to fetch.
     */
    where?: OtherItemsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OtherItems to fetch.
     */
    orderBy?: Enumerable<OtherItemsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for OtherItems.
     */
    cursor?: OtherItemsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OtherItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OtherItems.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of OtherItems.
     */
    distinct?: Enumerable<OtherItemsScalarFieldEnum>
  }


  /**
   * OtherItems findMany
   */
  export type OtherItemsFindManyArgs = {
    /**
     * Select specific fields to fetch from the OtherItems
     */
    select?: OtherItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OtherItemsInclude | null
    /**
     * Filter, which OtherItems to fetch.
     */
    where?: OtherItemsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OtherItems to fetch.
     */
    orderBy?: Enumerable<OtherItemsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing OtherItems.
     */
    cursor?: OtherItemsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OtherItems from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OtherItems.
     */
    skip?: number
    distinct?: Enumerable<OtherItemsScalarFieldEnum>
  }


  /**
   * OtherItems create
   */
  export type OtherItemsCreateArgs = {
    /**
     * Select specific fields to fetch from the OtherItems
     */
    select?: OtherItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OtherItemsInclude | null
    /**
     * The data needed to create a OtherItems.
     */
    data: XOR<OtherItemsCreateInput, OtherItemsUncheckedCreateInput>
  }


  /**
   * OtherItems createMany
   */
  export type OtherItemsCreateManyArgs = {
    /**
     * The data used to create many OtherItems.
     */
    data: Enumerable<OtherItemsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * OtherItems update
   */
  export type OtherItemsUpdateArgs = {
    /**
     * Select specific fields to fetch from the OtherItems
     */
    select?: OtherItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OtherItemsInclude | null
    /**
     * The data needed to update a OtherItems.
     */
    data: XOR<OtherItemsUpdateInput, OtherItemsUncheckedUpdateInput>
    /**
     * Choose, which OtherItems to update.
     */
    where: OtherItemsWhereUniqueInput
  }


  /**
   * OtherItems updateMany
   */
  export type OtherItemsUpdateManyArgs = {
    /**
     * The data used to update OtherItems.
     */
    data: XOR<OtherItemsUpdateManyMutationInput, OtherItemsUncheckedUpdateManyInput>
    /**
     * Filter which OtherItems to update
     */
    where?: OtherItemsWhereInput
  }


  /**
   * OtherItems upsert
   */
  export type OtherItemsUpsertArgs = {
    /**
     * Select specific fields to fetch from the OtherItems
     */
    select?: OtherItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OtherItemsInclude | null
    /**
     * The filter to search for the OtherItems to update in case it exists.
     */
    where: OtherItemsWhereUniqueInput
    /**
     * In case the OtherItems found by the `where` argument doesn't exist, create a new OtherItems with this data.
     */
    create: XOR<OtherItemsCreateInput, OtherItemsUncheckedCreateInput>
    /**
     * In case the OtherItems was found with the provided `where` argument, update it with this data.
     */
    update: XOR<OtherItemsUpdateInput, OtherItemsUncheckedUpdateInput>
  }


  /**
   * OtherItems delete
   */
  export type OtherItemsDeleteArgs = {
    /**
     * Select specific fields to fetch from the OtherItems
     */
    select?: OtherItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OtherItemsInclude | null
    /**
     * Filter which OtherItems to delete.
     */
    where: OtherItemsWhereUniqueInput
  }


  /**
   * OtherItems deleteMany
   */
  export type OtherItemsDeleteManyArgs = {
    /**
     * Filter which OtherItems to delete
     */
    where?: OtherItemsWhereInput
  }


  /**
   * OtherItems without action
   */
  export type OtherItemsArgs = {
    /**
     * Select specific fields to fetch from the OtherItems
     */
    select?: OtherItemsSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OtherItemsInclude | null
  }



  /**
   * Model Timestamps
   */


  export type AggregateTimestamps = {
    _count: TimestampsCountAggregateOutputType | null
    _min: TimestampsMinAggregateOutputType | null
    _max: TimestampsMaxAggregateOutputType | null
  }

  export type TimestampsMinAggregateOutputType = {
    id: string | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type TimestampsMaxAggregateOutputType = {
    id: string | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type TimestampsCountAggregateOutputType = {
    id: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type TimestampsMinAggregateInputType = {
    id?: true
    created_at?: true
    updated_at?: true
  }

  export type TimestampsMaxAggregateInputType = {
    id?: true
    created_at?: true
    updated_at?: true
  }

  export type TimestampsCountAggregateInputType = {
    id?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type TimestampsAggregateArgs = {
    /**
     * Filter which Timestamps to aggregate.
     */
    where?: TimestampsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Timestamps to fetch.
     */
    orderBy?: Enumerable<TimestampsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TimestampsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Timestamps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Timestamps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Timestamps
    **/
    _count?: true | TimestampsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TimestampsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TimestampsMaxAggregateInputType
  }

  export type GetTimestampsAggregateType<T extends TimestampsAggregateArgs> = {
        [P in keyof T & keyof AggregateTimestamps]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTimestamps[P]>
      : GetScalarType<T[P], AggregateTimestamps[P]>
  }




  export type TimestampsGroupByArgs = {
    where?: TimestampsWhereInput
    orderBy?: Enumerable<TimestampsOrderByWithAggregationInput>
    by: TimestampsScalarFieldEnum[]
    having?: TimestampsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TimestampsCountAggregateInputType | true
    _min?: TimestampsMinAggregateInputType
    _max?: TimestampsMaxAggregateInputType
  }


  export type TimestampsGroupByOutputType = {
    id: string
    created_at: Date
    updated_at: Date
    _count: TimestampsCountAggregateOutputType | null
    _min: TimestampsMinAggregateOutputType | null
    _max: TimestampsMaxAggregateOutputType | null
  }

  type GetTimestampsGroupByPayload<T extends TimestampsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickArray<TimestampsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TimestampsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TimestampsGroupByOutputType[P]>
            : GetScalarType<T[P], TimestampsGroupByOutputType[P]>
        }
      >
    >


  export type TimestampsSelect = {
    id?: boolean
    created_at?: boolean
    updated_at?: boolean
  }


  export type TimestampsGetPayload<S extends boolean | null | undefined | TimestampsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Timestamps :
    S extends undefined ? never :
    S extends { include: any } & (TimestampsArgs | TimestampsFindManyArgs)
    ? Timestamps 
    : S extends { select: any } & (TimestampsArgs | TimestampsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Timestamps ? Timestamps[P] : never
  } 
      : Timestamps


  type TimestampsCountArgs = 
    Omit<TimestampsFindManyArgs, 'select' | 'include'> & {
      select?: TimestampsCountAggregateInputType | true
    }

  export interface TimestampsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {

    /**
     * Find zero or one Timestamps that matches the filter.
     * @param {TimestampsFindUniqueArgs} args - Arguments to find a Timestamps
     * @example
     * // Get one Timestamps
     * const timestamps = await prisma.timestamps.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends TimestampsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, TimestampsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Timestamps'> extends True ? Prisma__TimestampsClient<TimestampsGetPayload<T>> : Prisma__TimestampsClient<TimestampsGetPayload<T> | null, null>

    /**
     * Find one Timestamps that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {TimestampsFindUniqueOrThrowArgs} args - Arguments to find a Timestamps
     * @example
     * // Get one Timestamps
     * const timestamps = await prisma.timestamps.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends TimestampsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, TimestampsFindUniqueOrThrowArgs>
    ): Prisma__TimestampsClient<TimestampsGetPayload<T>>

    /**
     * Find the first Timestamps that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TimestampsFindFirstArgs} args - Arguments to find a Timestamps
     * @example
     * // Get one Timestamps
     * const timestamps = await prisma.timestamps.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends TimestampsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, TimestampsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Timestamps'> extends True ? Prisma__TimestampsClient<TimestampsGetPayload<T>> : Prisma__TimestampsClient<TimestampsGetPayload<T> | null, null>

    /**
     * Find the first Timestamps that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TimestampsFindFirstOrThrowArgs} args - Arguments to find a Timestamps
     * @example
     * // Get one Timestamps
     * const timestamps = await prisma.timestamps.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends TimestampsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, TimestampsFindFirstOrThrowArgs>
    ): Prisma__TimestampsClient<TimestampsGetPayload<T>>

    /**
     * Find zero or more Timestamps that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TimestampsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Timestamps
     * const timestamps = await prisma.timestamps.findMany()
     * 
     * // Get first 10 Timestamps
     * const timestamps = await prisma.timestamps.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const timestampsWithIdOnly = await prisma.timestamps.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends TimestampsFindManyArgs>(
      args?: SelectSubset<T, TimestampsFindManyArgs>
    ): Prisma.PrismaPromise<Array<TimestampsGetPayload<T>>>

    /**
     * Create a Timestamps.
     * @param {TimestampsCreateArgs} args - Arguments to create a Timestamps.
     * @example
     * // Create one Timestamps
     * const Timestamps = await prisma.timestamps.create({
     *   data: {
     *     // ... data to create a Timestamps
     *   }
     * })
     * 
    **/
    create<T extends TimestampsCreateArgs>(
      args: SelectSubset<T, TimestampsCreateArgs>
    ): Prisma__TimestampsClient<TimestampsGetPayload<T>>

    /**
     * Create many Timestamps.
     *     @param {TimestampsCreateManyArgs} args - Arguments to create many Timestamps.
     *     @example
     *     // Create many Timestamps
     *     const timestamps = await prisma.timestamps.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends TimestampsCreateManyArgs>(
      args?: SelectSubset<T, TimestampsCreateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a Timestamps.
     * @param {TimestampsDeleteArgs} args - Arguments to delete one Timestamps.
     * @example
     * // Delete one Timestamps
     * const Timestamps = await prisma.timestamps.delete({
     *   where: {
     *     // ... filter to delete one Timestamps
     *   }
     * })
     * 
    **/
    delete<T extends TimestampsDeleteArgs>(
      args: SelectSubset<T, TimestampsDeleteArgs>
    ): Prisma__TimestampsClient<TimestampsGetPayload<T>>

    /**
     * Update one Timestamps.
     * @param {TimestampsUpdateArgs} args - Arguments to update one Timestamps.
     * @example
     * // Update one Timestamps
     * const timestamps = await prisma.timestamps.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends TimestampsUpdateArgs>(
      args: SelectSubset<T, TimestampsUpdateArgs>
    ): Prisma__TimestampsClient<TimestampsGetPayload<T>>

    /**
     * Delete zero or more Timestamps.
     * @param {TimestampsDeleteManyArgs} args - Arguments to filter Timestamps to delete.
     * @example
     * // Delete a few Timestamps
     * const { count } = await prisma.timestamps.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends TimestampsDeleteManyArgs>(
      args?: SelectSubset<T, TimestampsDeleteManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Timestamps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TimestampsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Timestamps
     * const timestamps = await prisma.timestamps.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends TimestampsUpdateManyArgs>(
      args: SelectSubset<T, TimestampsUpdateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Timestamps.
     * @param {TimestampsUpsertArgs} args - Arguments to update or create a Timestamps.
     * @example
     * // Update or create a Timestamps
     * const timestamps = await prisma.timestamps.upsert({
     *   create: {
     *     // ... data to create a Timestamps
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Timestamps we want to update
     *   }
     * })
    **/
    upsert<T extends TimestampsUpsertArgs>(
      args: SelectSubset<T, TimestampsUpsertArgs>
    ): Prisma__TimestampsClient<TimestampsGetPayload<T>>

    /**
     * Count the number of Timestamps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TimestampsCountArgs} args - Arguments to filter Timestamps to count.
     * @example
     * // Count the number of Timestamps
     * const count = await prisma.timestamps.count({
     *   where: {
     *     // ... the filter for the Timestamps we want to count
     *   }
     * })
    **/
    count<T extends TimestampsCountArgs>(
      args?: Subset<T, TimestampsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TimestampsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Timestamps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TimestampsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends TimestampsAggregateArgs>(args: Subset<T, TimestampsAggregateArgs>): Prisma.PrismaPromise<GetTimestampsAggregateType<T>>

    /**
     * Group by Timestamps.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TimestampsGroupByArgs} args - Group by arguments.
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
      T extends TimestampsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TimestampsGroupByArgs['orderBy'] }
        : { orderBy?: TimestampsGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, TimestampsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTimestampsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Timestamps.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__TimestampsClient<T, Null = never> implements Prisma.PrismaPromise<T> {
    private readonly _dmmf;
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
    readonly [Symbol.toStringTag]: 'PrismaPromise';
    constructor(_dmmf: runtime.DMMFClass, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);


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
   * Timestamps base type for findUnique actions
   */
  export type TimestampsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Timestamps
     */
    select?: TimestampsSelect | null
    /**
     * Filter, which Timestamps to fetch.
     */
    where: TimestampsWhereUniqueInput
  }

  /**
   * Timestamps findUnique
   */
  export interface TimestampsFindUniqueArgs extends TimestampsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Timestamps findUniqueOrThrow
   */
  export type TimestampsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Timestamps
     */
    select?: TimestampsSelect | null
    /**
     * Filter, which Timestamps to fetch.
     */
    where: TimestampsWhereUniqueInput
  }


  /**
   * Timestamps base type for findFirst actions
   */
  export type TimestampsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Timestamps
     */
    select?: TimestampsSelect | null
    /**
     * Filter, which Timestamps to fetch.
     */
    where?: TimestampsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Timestamps to fetch.
     */
    orderBy?: Enumerable<TimestampsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Timestamps.
     */
    cursor?: TimestampsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Timestamps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Timestamps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Timestamps.
     */
    distinct?: Enumerable<TimestampsScalarFieldEnum>
  }

  /**
   * Timestamps findFirst
   */
  export interface TimestampsFindFirstArgs extends TimestampsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Timestamps findFirstOrThrow
   */
  export type TimestampsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Timestamps
     */
    select?: TimestampsSelect | null
    /**
     * Filter, which Timestamps to fetch.
     */
    where?: TimestampsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Timestamps to fetch.
     */
    orderBy?: Enumerable<TimestampsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Timestamps.
     */
    cursor?: TimestampsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Timestamps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Timestamps.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Timestamps.
     */
    distinct?: Enumerable<TimestampsScalarFieldEnum>
  }


  /**
   * Timestamps findMany
   */
  export type TimestampsFindManyArgs = {
    /**
     * Select specific fields to fetch from the Timestamps
     */
    select?: TimestampsSelect | null
    /**
     * Filter, which Timestamps to fetch.
     */
    where?: TimestampsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Timestamps to fetch.
     */
    orderBy?: Enumerable<TimestampsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Timestamps.
     */
    cursor?: TimestampsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Timestamps from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Timestamps.
     */
    skip?: number
    distinct?: Enumerable<TimestampsScalarFieldEnum>
  }


  /**
   * Timestamps create
   */
  export type TimestampsCreateArgs = {
    /**
     * Select specific fields to fetch from the Timestamps
     */
    select?: TimestampsSelect | null
    /**
     * The data needed to create a Timestamps.
     */
    data: XOR<TimestampsCreateInput, TimestampsUncheckedCreateInput>
  }


  /**
   * Timestamps createMany
   */
  export type TimestampsCreateManyArgs = {
    /**
     * The data used to create many Timestamps.
     */
    data: Enumerable<TimestampsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Timestamps update
   */
  export type TimestampsUpdateArgs = {
    /**
     * Select specific fields to fetch from the Timestamps
     */
    select?: TimestampsSelect | null
    /**
     * The data needed to update a Timestamps.
     */
    data: XOR<TimestampsUpdateInput, TimestampsUncheckedUpdateInput>
    /**
     * Choose, which Timestamps to update.
     */
    where: TimestampsWhereUniqueInput
  }


  /**
   * Timestamps updateMany
   */
  export type TimestampsUpdateManyArgs = {
    /**
     * The data used to update Timestamps.
     */
    data: XOR<TimestampsUpdateManyMutationInput, TimestampsUncheckedUpdateManyInput>
    /**
     * Filter which Timestamps to update
     */
    where?: TimestampsWhereInput
  }


  /**
   * Timestamps upsert
   */
  export type TimestampsUpsertArgs = {
    /**
     * Select specific fields to fetch from the Timestamps
     */
    select?: TimestampsSelect | null
    /**
     * The filter to search for the Timestamps to update in case it exists.
     */
    where: TimestampsWhereUniqueInput
    /**
     * In case the Timestamps found by the `where` argument doesn't exist, create a new Timestamps with this data.
     */
    create: XOR<TimestampsCreateInput, TimestampsUncheckedCreateInput>
    /**
     * In case the Timestamps was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TimestampsUpdateInput, TimestampsUncheckedUpdateInput>
  }


  /**
   * Timestamps delete
   */
  export type TimestampsDeleteArgs = {
    /**
     * Select specific fields to fetch from the Timestamps
     */
    select?: TimestampsSelect | null
    /**
     * Filter which Timestamps to delete.
     */
    where: TimestampsWhereUniqueInput
  }


  /**
   * Timestamps deleteMany
   */
  export type TimestampsDeleteManyArgs = {
    /**
     * Filter which Timestamps to delete
     */
    where?: TimestampsWhereInput
  }


  /**
   * Timestamps without action
   */
  export type TimestampsArgs = {
    /**
     * Select specific fields to fetch from the Timestamps
     */
    select?: TimestampsSelect | null
  }



  /**
   * Model Datetimes
   */


  export type AggregateDatetimes = {
    _count: DatetimesCountAggregateOutputType | null
    _min: DatetimesMinAggregateOutputType | null
    _max: DatetimesMaxAggregateOutputType | null
  }

  export type DatetimesMinAggregateOutputType = {
    id: string | null
    d: Date | null
    t: Date | null
  }

  export type DatetimesMaxAggregateOutputType = {
    id: string | null
    d: Date | null
    t: Date | null
  }

  export type DatetimesCountAggregateOutputType = {
    id: number
    d: number
    t: number
    _all: number
  }


  export type DatetimesMinAggregateInputType = {
    id?: true
    d?: true
    t?: true
  }

  export type DatetimesMaxAggregateInputType = {
    id?: true
    d?: true
    t?: true
  }

  export type DatetimesCountAggregateInputType = {
    id?: true
    d?: true
    t?: true
    _all?: true
  }

  export type DatetimesAggregateArgs = {
    /**
     * Filter which Datetimes to aggregate.
     */
    where?: DatetimesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Datetimes to fetch.
     */
    orderBy?: Enumerable<DatetimesOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: DatetimesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Datetimes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Datetimes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Datetimes
    **/
    _count?: true | DatetimesCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: DatetimesMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: DatetimesMaxAggregateInputType
  }

  export type GetDatetimesAggregateType<T extends DatetimesAggregateArgs> = {
        [P in keyof T & keyof AggregateDatetimes]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDatetimes[P]>
      : GetScalarType<T[P], AggregateDatetimes[P]>
  }




  export type DatetimesGroupByArgs = {
    where?: DatetimesWhereInput
    orderBy?: Enumerable<DatetimesOrderByWithAggregationInput>
    by: DatetimesScalarFieldEnum[]
    having?: DatetimesScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: DatetimesCountAggregateInputType | true
    _min?: DatetimesMinAggregateInputType
    _max?: DatetimesMaxAggregateInputType
  }


  export type DatetimesGroupByOutputType = {
    id: string
    d: Date
    t: Date
    _count: DatetimesCountAggregateOutputType | null
    _min: DatetimesMinAggregateOutputType | null
    _max: DatetimesMaxAggregateOutputType | null
  }

  type GetDatetimesGroupByPayload<T extends DatetimesGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickArray<DatetimesGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof DatetimesGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], DatetimesGroupByOutputType[P]>
            : GetScalarType<T[P], DatetimesGroupByOutputType[P]>
        }
      >
    >


  export type DatetimesSelect = {
    id?: boolean
    d?: boolean
    t?: boolean
  }


  export type DatetimesGetPayload<S extends boolean | null | undefined | DatetimesArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Datetimes :
    S extends undefined ? never :
    S extends { include: any } & (DatetimesArgs | DatetimesFindManyArgs)
    ? Datetimes 
    : S extends { select: any } & (DatetimesArgs | DatetimesFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Datetimes ? Datetimes[P] : never
  } 
      : Datetimes


  type DatetimesCountArgs = 
    Omit<DatetimesFindManyArgs, 'select' | 'include'> & {
      select?: DatetimesCountAggregateInputType | true
    }

  export interface DatetimesDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {

    /**
     * Find zero or one Datetimes that matches the filter.
     * @param {DatetimesFindUniqueArgs} args - Arguments to find a Datetimes
     * @example
     * // Get one Datetimes
     * const datetimes = await prisma.datetimes.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends DatetimesFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, DatetimesFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Datetimes'> extends True ? Prisma__DatetimesClient<DatetimesGetPayload<T>> : Prisma__DatetimesClient<DatetimesGetPayload<T> | null, null>

    /**
     * Find one Datetimes that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {DatetimesFindUniqueOrThrowArgs} args - Arguments to find a Datetimes
     * @example
     * // Get one Datetimes
     * const datetimes = await prisma.datetimes.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends DatetimesFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, DatetimesFindUniqueOrThrowArgs>
    ): Prisma__DatetimesClient<DatetimesGetPayload<T>>

    /**
     * Find the first Datetimes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DatetimesFindFirstArgs} args - Arguments to find a Datetimes
     * @example
     * // Get one Datetimes
     * const datetimes = await prisma.datetimes.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends DatetimesFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, DatetimesFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Datetimes'> extends True ? Prisma__DatetimesClient<DatetimesGetPayload<T>> : Prisma__DatetimesClient<DatetimesGetPayload<T> | null, null>

    /**
     * Find the first Datetimes that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DatetimesFindFirstOrThrowArgs} args - Arguments to find a Datetimes
     * @example
     * // Get one Datetimes
     * const datetimes = await prisma.datetimes.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends DatetimesFindFirstOrThrowArgs>(
      args?: SelectSubset<T, DatetimesFindFirstOrThrowArgs>
    ): Prisma__DatetimesClient<DatetimesGetPayload<T>>

    /**
     * Find zero or more Datetimes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DatetimesFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Datetimes
     * const datetimes = await prisma.datetimes.findMany()
     * 
     * // Get first 10 Datetimes
     * const datetimes = await prisma.datetimes.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const datetimesWithIdOnly = await prisma.datetimes.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends DatetimesFindManyArgs>(
      args?: SelectSubset<T, DatetimesFindManyArgs>
    ): Prisma.PrismaPromise<Array<DatetimesGetPayload<T>>>

    /**
     * Create a Datetimes.
     * @param {DatetimesCreateArgs} args - Arguments to create a Datetimes.
     * @example
     * // Create one Datetimes
     * const Datetimes = await prisma.datetimes.create({
     *   data: {
     *     // ... data to create a Datetimes
     *   }
     * })
     * 
    **/
    create<T extends DatetimesCreateArgs>(
      args: SelectSubset<T, DatetimesCreateArgs>
    ): Prisma__DatetimesClient<DatetimesGetPayload<T>>

    /**
     * Create many Datetimes.
     *     @param {DatetimesCreateManyArgs} args - Arguments to create many Datetimes.
     *     @example
     *     // Create many Datetimes
     *     const datetimes = await prisma.datetimes.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends DatetimesCreateManyArgs>(
      args?: SelectSubset<T, DatetimesCreateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a Datetimes.
     * @param {DatetimesDeleteArgs} args - Arguments to delete one Datetimes.
     * @example
     * // Delete one Datetimes
     * const Datetimes = await prisma.datetimes.delete({
     *   where: {
     *     // ... filter to delete one Datetimes
     *   }
     * })
     * 
    **/
    delete<T extends DatetimesDeleteArgs>(
      args: SelectSubset<T, DatetimesDeleteArgs>
    ): Prisma__DatetimesClient<DatetimesGetPayload<T>>

    /**
     * Update one Datetimes.
     * @param {DatetimesUpdateArgs} args - Arguments to update one Datetimes.
     * @example
     * // Update one Datetimes
     * const datetimes = await prisma.datetimes.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends DatetimesUpdateArgs>(
      args: SelectSubset<T, DatetimesUpdateArgs>
    ): Prisma__DatetimesClient<DatetimesGetPayload<T>>

    /**
     * Delete zero or more Datetimes.
     * @param {DatetimesDeleteManyArgs} args - Arguments to filter Datetimes to delete.
     * @example
     * // Delete a few Datetimes
     * const { count } = await prisma.datetimes.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends DatetimesDeleteManyArgs>(
      args?: SelectSubset<T, DatetimesDeleteManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Datetimes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DatetimesUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Datetimes
     * const datetimes = await prisma.datetimes.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends DatetimesUpdateManyArgs>(
      args: SelectSubset<T, DatetimesUpdateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Datetimes.
     * @param {DatetimesUpsertArgs} args - Arguments to update or create a Datetimes.
     * @example
     * // Update or create a Datetimes
     * const datetimes = await prisma.datetimes.upsert({
     *   create: {
     *     // ... data to create a Datetimes
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Datetimes we want to update
     *   }
     * })
    **/
    upsert<T extends DatetimesUpsertArgs>(
      args: SelectSubset<T, DatetimesUpsertArgs>
    ): Prisma__DatetimesClient<DatetimesGetPayload<T>>

    /**
     * Count the number of Datetimes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DatetimesCountArgs} args - Arguments to filter Datetimes to count.
     * @example
     * // Count the number of Datetimes
     * const count = await prisma.datetimes.count({
     *   where: {
     *     // ... the filter for the Datetimes we want to count
     *   }
     * })
    **/
    count<T extends DatetimesCountArgs>(
      args?: Subset<T, DatetimesCountArgs>,
    ): Prisma.PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], DatetimesCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Datetimes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DatetimesAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends DatetimesAggregateArgs>(args: Subset<T, DatetimesAggregateArgs>): Prisma.PrismaPromise<GetDatetimesAggregateType<T>>

    /**
     * Group by Datetimes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DatetimesGroupByArgs} args - Group by arguments.
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
      T extends DatetimesGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: DatetimesGroupByArgs['orderBy'] }
        : { orderBy?: DatetimesGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, DatetimesGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDatetimesGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Datetimes.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__DatetimesClient<T, Null = never> implements Prisma.PrismaPromise<T> {
    private readonly _dmmf;
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
    readonly [Symbol.toStringTag]: 'PrismaPromise';
    constructor(_dmmf: runtime.DMMFClass, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);


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
   * Datetimes base type for findUnique actions
   */
  export type DatetimesFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Datetimes
     */
    select?: DatetimesSelect | null
    /**
     * Filter, which Datetimes to fetch.
     */
    where: DatetimesWhereUniqueInput
  }

  /**
   * Datetimes findUnique
   */
  export interface DatetimesFindUniqueArgs extends DatetimesFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Datetimes findUniqueOrThrow
   */
  export type DatetimesFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Datetimes
     */
    select?: DatetimesSelect | null
    /**
     * Filter, which Datetimes to fetch.
     */
    where: DatetimesWhereUniqueInput
  }


  /**
   * Datetimes base type for findFirst actions
   */
  export type DatetimesFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Datetimes
     */
    select?: DatetimesSelect | null
    /**
     * Filter, which Datetimes to fetch.
     */
    where?: DatetimesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Datetimes to fetch.
     */
    orderBy?: Enumerable<DatetimesOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Datetimes.
     */
    cursor?: DatetimesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Datetimes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Datetimes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Datetimes.
     */
    distinct?: Enumerable<DatetimesScalarFieldEnum>
  }

  /**
   * Datetimes findFirst
   */
  export interface DatetimesFindFirstArgs extends DatetimesFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Datetimes findFirstOrThrow
   */
  export type DatetimesFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Datetimes
     */
    select?: DatetimesSelect | null
    /**
     * Filter, which Datetimes to fetch.
     */
    where?: DatetimesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Datetimes to fetch.
     */
    orderBy?: Enumerable<DatetimesOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Datetimes.
     */
    cursor?: DatetimesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Datetimes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Datetimes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Datetimes.
     */
    distinct?: Enumerable<DatetimesScalarFieldEnum>
  }


  /**
   * Datetimes findMany
   */
  export type DatetimesFindManyArgs = {
    /**
     * Select specific fields to fetch from the Datetimes
     */
    select?: DatetimesSelect | null
    /**
     * Filter, which Datetimes to fetch.
     */
    where?: DatetimesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Datetimes to fetch.
     */
    orderBy?: Enumerable<DatetimesOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Datetimes.
     */
    cursor?: DatetimesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Datetimes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Datetimes.
     */
    skip?: number
    distinct?: Enumerable<DatetimesScalarFieldEnum>
  }


  /**
   * Datetimes create
   */
  export type DatetimesCreateArgs = {
    /**
     * Select specific fields to fetch from the Datetimes
     */
    select?: DatetimesSelect | null
    /**
     * The data needed to create a Datetimes.
     */
    data: XOR<DatetimesCreateInput, DatetimesUncheckedCreateInput>
  }


  /**
   * Datetimes createMany
   */
  export type DatetimesCreateManyArgs = {
    /**
     * The data used to create many Datetimes.
     */
    data: Enumerable<DatetimesCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Datetimes update
   */
  export type DatetimesUpdateArgs = {
    /**
     * Select specific fields to fetch from the Datetimes
     */
    select?: DatetimesSelect | null
    /**
     * The data needed to update a Datetimes.
     */
    data: XOR<DatetimesUpdateInput, DatetimesUncheckedUpdateInput>
    /**
     * Choose, which Datetimes to update.
     */
    where: DatetimesWhereUniqueInput
  }


  /**
   * Datetimes updateMany
   */
  export type DatetimesUpdateManyArgs = {
    /**
     * The data used to update Datetimes.
     */
    data: XOR<DatetimesUpdateManyMutationInput, DatetimesUncheckedUpdateManyInput>
    /**
     * Filter which Datetimes to update
     */
    where?: DatetimesWhereInput
  }


  /**
   * Datetimes upsert
   */
  export type DatetimesUpsertArgs = {
    /**
     * Select specific fields to fetch from the Datetimes
     */
    select?: DatetimesSelect | null
    /**
     * The filter to search for the Datetimes to update in case it exists.
     */
    where: DatetimesWhereUniqueInput
    /**
     * In case the Datetimes found by the `where` argument doesn't exist, create a new Datetimes with this data.
     */
    create: XOR<DatetimesCreateInput, DatetimesUncheckedCreateInput>
    /**
     * In case the Datetimes was found with the provided `where` argument, update it with this data.
     */
    update: XOR<DatetimesUpdateInput, DatetimesUncheckedUpdateInput>
  }


  /**
   * Datetimes delete
   */
  export type DatetimesDeleteArgs = {
    /**
     * Select specific fields to fetch from the Datetimes
     */
    select?: DatetimesSelect | null
    /**
     * Filter which Datetimes to delete.
     */
    where: DatetimesWhereUniqueInput
  }


  /**
   * Datetimes deleteMany
   */
  export type DatetimesDeleteManyArgs = {
    /**
     * Filter which Datetimes to delete
     */
    where?: DatetimesWhereInput
  }


  /**
   * Datetimes without action
   */
  export type DatetimesArgs = {
    /**
     * Select specific fields to fetch from the Datetimes
     */
    select?: DatetimesSelect | null
  }



  /**
   * Model Bools
   */


  export type AggregateBools = {
    _count: BoolsCountAggregateOutputType | null
    _min: BoolsMinAggregateOutputType | null
    _max: BoolsMaxAggregateOutputType | null
  }

  export type BoolsMinAggregateOutputType = {
    id: string | null
    b: boolean | null
  }

  export type BoolsMaxAggregateOutputType = {
    id: string | null
    b: boolean | null
  }

  export type BoolsCountAggregateOutputType = {
    id: number
    b: number
    _all: number
  }


  export type BoolsMinAggregateInputType = {
    id?: true
    b?: true
  }

  export type BoolsMaxAggregateInputType = {
    id?: true
    b?: true
  }

  export type BoolsCountAggregateInputType = {
    id?: true
    b?: true
    _all?: true
  }

  export type BoolsAggregateArgs = {
    /**
     * Filter which Bools to aggregate.
     */
    where?: BoolsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Bools to fetch.
     */
    orderBy?: Enumerable<BoolsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: BoolsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Bools from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Bools.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Bools
    **/
    _count?: true | BoolsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: BoolsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: BoolsMaxAggregateInputType
  }

  export type GetBoolsAggregateType<T extends BoolsAggregateArgs> = {
        [P in keyof T & keyof AggregateBools]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateBools[P]>
      : GetScalarType<T[P], AggregateBools[P]>
  }




  export type BoolsGroupByArgs = {
    where?: BoolsWhereInput
    orderBy?: Enumerable<BoolsOrderByWithAggregationInput>
    by: BoolsScalarFieldEnum[]
    having?: BoolsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: BoolsCountAggregateInputType | true
    _min?: BoolsMinAggregateInputType
    _max?: BoolsMaxAggregateInputType
  }


  export type BoolsGroupByOutputType = {
    id: string
    b: boolean | null
    _count: BoolsCountAggregateOutputType | null
    _min: BoolsMinAggregateOutputType | null
    _max: BoolsMaxAggregateOutputType | null
  }

  type GetBoolsGroupByPayload<T extends BoolsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickArray<BoolsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof BoolsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], BoolsGroupByOutputType[P]>
            : GetScalarType<T[P], BoolsGroupByOutputType[P]>
        }
      >
    >


  export type BoolsSelect = {
    id?: boolean
    b?: boolean
  }


  export type BoolsGetPayload<S extends boolean | null | undefined | BoolsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Bools :
    S extends undefined ? never :
    S extends { include: any } & (BoolsArgs | BoolsFindManyArgs)
    ? Bools 
    : S extends { select: any } & (BoolsArgs | BoolsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Bools ? Bools[P] : never
  } 
      : Bools


  type BoolsCountArgs = 
    Omit<BoolsFindManyArgs, 'select' | 'include'> & {
      select?: BoolsCountAggregateInputType | true
    }

  export interface BoolsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {

    /**
     * Find zero or one Bools that matches the filter.
     * @param {BoolsFindUniqueArgs} args - Arguments to find a Bools
     * @example
     * // Get one Bools
     * const bools = await prisma.bools.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends BoolsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, BoolsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Bools'> extends True ? Prisma__BoolsClient<BoolsGetPayload<T>> : Prisma__BoolsClient<BoolsGetPayload<T> | null, null>

    /**
     * Find one Bools that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {BoolsFindUniqueOrThrowArgs} args - Arguments to find a Bools
     * @example
     * // Get one Bools
     * const bools = await prisma.bools.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends BoolsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, BoolsFindUniqueOrThrowArgs>
    ): Prisma__BoolsClient<BoolsGetPayload<T>>

    /**
     * Find the first Bools that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BoolsFindFirstArgs} args - Arguments to find a Bools
     * @example
     * // Get one Bools
     * const bools = await prisma.bools.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends BoolsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, BoolsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Bools'> extends True ? Prisma__BoolsClient<BoolsGetPayload<T>> : Prisma__BoolsClient<BoolsGetPayload<T> | null, null>

    /**
     * Find the first Bools that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BoolsFindFirstOrThrowArgs} args - Arguments to find a Bools
     * @example
     * // Get one Bools
     * const bools = await prisma.bools.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends BoolsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, BoolsFindFirstOrThrowArgs>
    ): Prisma__BoolsClient<BoolsGetPayload<T>>

    /**
     * Find zero or more Bools that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BoolsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Bools
     * const bools = await prisma.bools.findMany()
     * 
     * // Get first 10 Bools
     * const bools = await prisma.bools.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const boolsWithIdOnly = await prisma.bools.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends BoolsFindManyArgs>(
      args?: SelectSubset<T, BoolsFindManyArgs>
    ): Prisma.PrismaPromise<Array<BoolsGetPayload<T>>>

    /**
     * Create a Bools.
     * @param {BoolsCreateArgs} args - Arguments to create a Bools.
     * @example
     * // Create one Bools
     * const Bools = await prisma.bools.create({
     *   data: {
     *     // ... data to create a Bools
     *   }
     * })
     * 
    **/
    create<T extends BoolsCreateArgs>(
      args: SelectSubset<T, BoolsCreateArgs>
    ): Prisma__BoolsClient<BoolsGetPayload<T>>

    /**
     * Create many Bools.
     *     @param {BoolsCreateManyArgs} args - Arguments to create many Bools.
     *     @example
     *     // Create many Bools
     *     const bools = await prisma.bools.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends BoolsCreateManyArgs>(
      args?: SelectSubset<T, BoolsCreateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a Bools.
     * @param {BoolsDeleteArgs} args - Arguments to delete one Bools.
     * @example
     * // Delete one Bools
     * const Bools = await prisma.bools.delete({
     *   where: {
     *     // ... filter to delete one Bools
     *   }
     * })
     * 
    **/
    delete<T extends BoolsDeleteArgs>(
      args: SelectSubset<T, BoolsDeleteArgs>
    ): Prisma__BoolsClient<BoolsGetPayload<T>>

    /**
     * Update one Bools.
     * @param {BoolsUpdateArgs} args - Arguments to update one Bools.
     * @example
     * // Update one Bools
     * const bools = await prisma.bools.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends BoolsUpdateArgs>(
      args: SelectSubset<T, BoolsUpdateArgs>
    ): Prisma__BoolsClient<BoolsGetPayload<T>>

    /**
     * Delete zero or more Bools.
     * @param {BoolsDeleteManyArgs} args - Arguments to filter Bools to delete.
     * @example
     * // Delete a few Bools
     * const { count } = await prisma.bools.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends BoolsDeleteManyArgs>(
      args?: SelectSubset<T, BoolsDeleteManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Bools.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BoolsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Bools
     * const bools = await prisma.bools.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends BoolsUpdateManyArgs>(
      args: SelectSubset<T, BoolsUpdateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Bools.
     * @param {BoolsUpsertArgs} args - Arguments to update or create a Bools.
     * @example
     * // Update or create a Bools
     * const bools = await prisma.bools.upsert({
     *   create: {
     *     // ... data to create a Bools
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Bools we want to update
     *   }
     * })
    **/
    upsert<T extends BoolsUpsertArgs>(
      args: SelectSubset<T, BoolsUpsertArgs>
    ): Prisma__BoolsClient<BoolsGetPayload<T>>

    /**
     * Count the number of Bools.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BoolsCountArgs} args - Arguments to filter Bools to count.
     * @example
     * // Count the number of Bools
     * const count = await prisma.bools.count({
     *   where: {
     *     // ... the filter for the Bools we want to count
     *   }
     * })
    **/
    count<T extends BoolsCountArgs>(
      args?: Subset<T, BoolsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], BoolsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Bools.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BoolsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends BoolsAggregateArgs>(args: Subset<T, BoolsAggregateArgs>): Prisma.PrismaPromise<GetBoolsAggregateType<T>>

    /**
     * Group by Bools.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BoolsGroupByArgs} args - Group by arguments.
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
      T extends BoolsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: BoolsGroupByArgs['orderBy'] }
        : { orderBy?: BoolsGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, BoolsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetBoolsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Bools.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__BoolsClient<T, Null = never> implements Prisma.PrismaPromise<T> {
    private readonly _dmmf;
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
    readonly [Symbol.toStringTag]: 'PrismaPromise';
    constructor(_dmmf: runtime.DMMFClass, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);


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
   * Bools base type for findUnique actions
   */
  export type BoolsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Bools
     */
    select?: BoolsSelect | null
    /**
     * Filter, which Bools to fetch.
     */
    where: BoolsWhereUniqueInput
  }

  /**
   * Bools findUnique
   */
  export interface BoolsFindUniqueArgs extends BoolsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Bools findUniqueOrThrow
   */
  export type BoolsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Bools
     */
    select?: BoolsSelect | null
    /**
     * Filter, which Bools to fetch.
     */
    where: BoolsWhereUniqueInput
  }


  /**
   * Bools base type for findFirst actions
   */
  export type BoolsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Bools
     */
    select?: BoolsSelect | null
    /**
     * Filter, which Bools to fetch.
     */
    where?: BoolsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Bools to fetch.
     */
    orderBy?: Enumerable<BoolsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Bools.
     */
    cursor?: BoolsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Bools from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Bools.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Bools.
     */
    distinct?: Enumerable<BoolsScalarFieldEnum>
  }

  /**
   * Bools findFirst
   */
  export interface BoolsFindFirstArgs extends BoolsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Bools findFirstOrThrow
   */
  export type BoolsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Bools
     */
    select?: BoolsSelect | null
    /**
     * Filter, which Bools to fetch.
     */
    where?: BoolsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Bools to fetch.
     */
    orderBy?: Enumerable<BoolsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Bools.
     */
    cursor?: BoolsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Bools from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Bools.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Bools.
     */
    distinct?: Enumerable<BoolsScalarFieldEnum>
  }


  /**
   * Bools findMany
   */
  export type BoolsFindManyArgs = {
    /**
     * Select specific fields to fetch from the Bools
     */
    select?: BoolsSelect | null
    /**
     * Filter, which Bools to fetch.
     */
    where?: BoolsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Bools to fetch.
     */
    orderBy?: Enumerable<BoolsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Bools.
     */
    cursor?: BoolsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Bools from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Bools.
     */
    skip?: number
    distinct?: Enumerable<BoolsScalarFieldEnum>
  }


  /**
   * Bools create
   */
  export type BoolsCreateArgs = {
    /**
     * Select specific fields to fetch from the Bools
     */
    select?: BoolsSelect | null
    /**
     * The data needed to create a Bools.
     */
    data: XOR<BoolsCreateInput, BoolsUncheckedCreateInput>
  }


  /**
   * Bools createMany
   */
  export type BoolsCreateManyArgs = {
    /**
     * The data used to create many Bools.
     */
    data: Enumerable<BoolsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Bools update
   */
  export type BoolsUpdateArgs = {
    /**
     * Select specific fields to fetch from the Bools
     */
    select?: BoolsSelect | null
    /**
     * The data needed to update a Bools.
     */
    data: XOR<BoolsUpdateInput, BoolsUncheckedUpdateInput>
    /**
     * Choose, which Bools to update.
     */
    where: BoolsWhereUniqueInput
  }


  /**
   * Bools updateMany
   */
  export type BoolsUpdateManyArgs = {
    /**
     * The data used to update Bools.
     */
    data: XOR<BoolsUpdateManyMutationInput, BoolsUncheckedUpdateManyInput>
    /**
     * Filter which Bools to update
     */
    where?: BoolsWhereInput
  }


  /**
   * Bools upsert
   */
  export type BoolsUpsertArgs = {
    /**
     * Select specific fields to fetch from the Bools
     */
    select?: BoolsSelect | null
    /**
     * The filter to search for the Bools to update in case it exists.
     */
    where: BoolsWhereUniqueInput
    /**
     * In case the Bools found by the `where` argument doesn't exist, create a new Bools with this data.
     */
    create: XOR<BoolsCreateInput, BoolsUncheckedCreateInput>
    /**
     * In case the Bools was found with the provided `where` argument, update it with this data.
     */
    update: XOR<BoolsUpdateInput, BoolsUncheckedUpdateInput>
  }


  /**
   * Bools delete
   */
  export type BoolsDeleteArgs = {
    /**
     * Select specific fields to fetch from the Bools
     */
    select?: BoolsSelect | null
    /**
     * Filter which Bools to delete.
     */
    where: BoolsWhereUniqueInput
  }


  /**
   * Bools deleteMany
   */
  export type BoolsDeleteManyArgs = {
    /**
     * Filter which Bools to delete
     */
    where?: BoolsWhereInput
  }


  /**
   * Bools without action
   */
  export type BoolsArgs = {
    /**
     * Select specific fields to fetch from the Bools
     */
    select?: BoolsSelect | null
  }



  /**
   * Model Uuids
   */


  export type AggregateUuids = {
    _count: UuidsCountAggregateOutputType | null
    _min: UuidsMinAggregateOutputType | null
    _max: UuidsMaxAggregateOutputType | null
  }

  export type UuidsMinAggregateOutputType = {
    id: string | null
  }

  export type UuidsMaxAggregateOutputType = {
    id: string | null
  }

  export type UuidsCountAggregateOutputType = {
    id: number
    _all: number
  }


  export type UuidsMinAggregateInputType = {
    id?: true
  }

  export type UuidsMaxAggregateInputType = {
    id?: true
  }

  export type UuidsCountAggregateInputType = {
    id?: true
    _all?: true
  }

  export type UuidsAggregateArgs = {
    /**
     * Filter which Uuids to aggregate.
     */
    where?: UuidsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Uuids to fetch.
     */
    orderBy?: Enumerable<UuidsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UuidsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Uuids from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Uuids.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Uuids
    **/
    _count?: true | UuidsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UuidsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UuidsMaxAggregateInputType
  }

  export type GetUuidsAggregateType<T extends UuidsAggregateArgs> = {
        [P in keyof T & keyof AggregateUuids]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUuids[P]>
      : GetScalarType<T[P], AggregateUuids[P]>
  }




  export type UuidsGroupByArgs = {
    where?: UuidsWhereInput
    orderBy?: Enumerable<UuidsOrderByWithAggregationInput>
    by: UuidsScalarFieldEnum[]
    having?: UuidsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UuidsCountAggregateInputType | true
    _min?: UuidsMinAggregateInputType
    _max?: UuidsMaxAggregateInputType
  }


  export type UuidsGroupByOutputType = {
    id: string
    _count: UuidsCountAggregateOutputType | null
    _min: UuidsMinAggregateOutputType | null
    _max: UuidsMaxAggregateOutputType | null
  }

  type GetUuidsGroupByPayload<T extends UuidsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickArray<UuidsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UuidsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UuidsGroupByOutputType[P]>
            : GetScalarType<T[P], UuidsGroupByOutputType[P]>
        }
      >
    >


  export type UuidsSelect = {
    id?: boolean
  }


  export type UuidsGetPayload<S extends boolean | null | undefined | UuidsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Uuids :
    S extends undefined ? never :
    S extends { include: any } & (UuidsArgs | UuidsFindManyArgs)
    ? Uuids 
    : S extends { select: any } & (UuidsArgs | UuidsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Uuids ? Uuids[P] : never
  } 
      : Uuids


  type UuidsCountArgs = 
    Omit<UuidsFindManyArgs, 'select' | 'include'> & {
      select?: UuidsCountAggregateInputType | true
    }

  export interface UuidsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {

    /**
     * Find zero or one Uuids that matches the filter.
     * @param {UuidsFindUniqueArgs} args - Arguments to find a Uuids
     * @example
     * // Get one Uuids
     * const uuids = await prisma.uuids.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends UuidsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, UuidsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Uuids'> extends True ? Prisma__UuidsClient<UuidsGetPayload<T>> : Prisma__UuidsClient<UuidsGetPayload<T> | null, null>

    /**
     * Find one Uuids that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {UuidsFindUniqueOrThrowArgs} args - Arguments to find a Uuids
     * @example
     * // Get one Uuids
     * const uuids = await prisma.uuids.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends UuidsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, UuidsFindUniqueOrThrowArgs>
    ): Prisma__UuidsClient<UuidsGetPayload<T>>

    /**
     * Find the first Uuids that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UuidsFindFirstArgs} args - Arguments to find a Uuids
     * @example
     * // Get one Uuids
     * const uuids = await prisma.uuids.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends UuidsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, UuidsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Uuids'> extends True ? Prisma__UuidsClient<UuidsGetPayload<T>> : Prisma__UuidsClient<UuidsGetPayload<T> | null, null>

    /**
     * Find the first Uuids that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UuidsFindFirstOrThrowArgs} args - Arguments to find a Uuids
     * @example
     * // Get one Uuids
     * const uuids = await prisma.uuids.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends UuidsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, UuidsFindFirstOrThrowArgs>
    ): Prisma__UuidsClient<UuidsGetPayload<T>>

    /**
     * Find zero or more Uuids that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UuidsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Uuids
     * const uuids = await prisma.uuids.findMany()
     * 
     * // Get first 10 Uuids
     * const uuids = await prisma.uuids.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const uuidsWithIdOnly = await prisma.uuids.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends UuidsFindManyArgs>(
      args?: SelectSubset<T, UuidsFindManyArgs>
    ): Prisma.PrismaPromise<Array<UuidsGetPayload<T>>>

    /**
     * Create a Uuids.
     * @param {UuidsCreateArgs} args - Arguments to create a Uuids.
     * @example
     * // Create one Uuids
     * const Uuids = await prisma.uuids.create({
     *   data: {
     *     // ... data to create a Uuids
     *   }
     * })
     * 
    **/
    create<T extends UuidsCreateArgs>(
      args: SelectSubset<T, UuidsCreateArgs>
    ): Prisma__UuidsClient<UuidsGetPayload<T>>

    /**
     * Create many Uuids.
     *     @param {UuidsCreateManyArgs} args - Arguments to create many Uuids.
     *     @example
     *     // Create many Uuids
     *     const uuids = await prisma.uuids.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends UuidsCreateManyArgs>(
      args?: SelectSubset<T, UuidsCreateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a Uuids.
     * @param {UuidsDeleteArgs} args - Arguments to delete one Uuids.
     * @example
     * // Delete one Uuids
     * const Uuids = await prisma.uuids.delete({
     *   where: {
     *     // ... filter to delete one Uuids
     *   }
     * })
     * 
    **/
    delete<T extends UuidsDeleteArgs>(
      args: SelectSubset<T, UuidsDeleteArgs>
    ): Prisma__UuidsClient<UuidsGetPayload<T>>

    /**
     * Update one Uuids.
     * @param {UuidsUpdateArgs} args - Arguments to update one Uuids.
     * @example
     * // Update one Uuids
     * const uuids = await prisma.uuids.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends UuidsUpdateArgs>(
      args: SelectSubset<T, UuidsUpdateArgs>
    ): Prisma__UuidsClient<UuidsGetPayload<T>>

    /**
     * Delete zero or more Uuids.
     * @param {UuidsDeleteManyArgs} args - Arguments to filter Uuids to delete.
     * @example
     * // Delete a few Uuids
     * const { count } = await prisma.uuids.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends UuidsDeleteManyArgs>(
      args?: SelectSubset<T, UuidsDeleteManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Uuids.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UuidsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Uuids
     * const uuids = await prisma.uuids.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends UuidsUpdateManyArgs>(
      args: SelectSubset<T, UuidsUpdateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Uuids.
     * @param {UuidsUpsertArgs} args - Arguments to update or create a Uuids.
     * @example
     * // Update or create a Uuids
     * const uuids = await prisma.uuids.upsert({
     *   create: {
     *     // ... data to create a Uuids
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Uuids we want to update
     *   }
     * })
    **/
    upsert<T extends UuidsUpsertArgs>(
      args: SelectSubset<T, UuidsUpsertArgs>
    ): Prisma__UuidsClient<UuidsGetPayload<T>>

    /**
     * Count the number of Uuids.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UuidsCountArgs} args - Arguments to filter Uuids to count.
     * @example
     * // Count the number of Uuids
     * const count = await prisma.uuids.count({
     *   where: {
     *     // ... the filter for the Uuids we want to count
     *   }
     * })
    **/
    count<T extends UuidsCountArgs>(
      args?: Subset<T, UuidsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UuidsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Uuids.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UuidsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends UuidsAggregateArgs>(args: Subset<T, UuidsAggregateArgs>): Prisma.PrismaPromise<GetUuidsAggregateType<T>>

    /**
     * Group by Uuids.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UuidsGroupByArgs} args - Group by arguments.
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
      T extends UuidsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UuidsGroupByArgs['orderBy'] }
        : { orderBy?: UuidsGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, UuidsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUuidsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Uuids.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__UuidsClient<T, Null = never> implements Prisma.PrismaPromise<T> {
    private readonly _dmmf;
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
    readonly [Symbol.toStringTag]: 'PrismaPromise';
    constructor(_dmmf: runtime.DMMFClass, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);


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
   * Uuids base type for findUnique actions
   */
  export type UuidsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Uuids
     */
    select?: UuidsSelect | null
    /**
     * Filter, which Uuids to fetch.
     */
    where: UuidsWhereUniqueInput
  }

  /**
   * Uuids findUnique
   */
  export interface UuidsFindUniqueArgs extends UuidsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Uuids findUniqueOrThrow
   */
  export type UuidsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Uuids
     */
    select?: UuidsSelect | null
    /**
     * Filter, which Uuids to fetch.
     */
    where: UuidsWhereUniqueInput
  }


  /**
   * Uuids base type for findFirst actions
   */
  export type UuidsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Uuids
     */
    select?: UuidsSelect | null
    /**
     * Filter, which Uuids to fetch.
     */
    where?: UuidsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Uuids to fetch.
     */
    orderBy?: Enumerable<UuidsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Uuids.
     */
    cursor?: UuidsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Uuids from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Uuids.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Uuids.
     */
    distinct?: Enumerable<UuidsScalarFieldEnum>
  }

  /**
   * Uuids findFirst
   */
  export interface UuidsFindFirstArgs extends UuidsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Uuids findFirstOrThrow
   */
  export type UuidsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Uuids
     */
    select?: UuidsSelect | null
    /**
     * Filter, which Uuids to fetch.
     */
    where?: UuidsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Uuids to fetch.
     */
    orderBy?: Enumerable<UuidsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Uuids.
     */
    cursor?: UuidsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Uuids from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Uuids.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Uuids.
     */
    distinct?: Enumerable<UuidsScalarFieldEnum>
  }


  /**
   * Uuids findMany
   */
  export type UuidsFindManyArgs = {
    /**
     * Select specific fields to fetch from the Uuids
     */
    select?: UuidsSelect | null
    /**
     * Filter, which Uuids to fetch.
     */
    where?: UuidsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Uuids to fetch.
     */
    orderBy?: Enumerable<UuidsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Uuids.
     */
    cursor?: UuidsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Uuids from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Uuids.
     */
    skip?: number
    distinct?: Enumerable<UuidsScalarFieldEnum>
  }


  /**
   * Uuids create
   */
  export type UuidsCreateArgs = {
    /**
     * Select specific fields to fetch from the Uuids
     */
    select?: UuidsSelect | null
    /**
     * The data needed to create a Uuids.
     */
    data: XOR<UuidsCreateInput, UuidsUncheckedCreateInput>
  }


  /**
   * Uuids createMany
   */
  export type UuidsCreateManyArgs = {
    /**
     * The data used to create many Uuids.
     */
    data: Enumerable<UuidsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Uuids update
   */
  export type UuidsUpdateArgs = {
    /**
     * Select specific fields to fetch from the Uuids
     */
    select?: UuidsSelect | null
    /**
     * The data needed to update a Uuids.
     */
    data: XOR<UuidsUpdateInput, UuidsUncheckedUpdateInput>
    /**
     * Choose, which Uuids to update.
     */
    where: UuidsWhereUniqueInput
  }


  /**
   * Uuids updateMany
   */
  export type UuidsUpdateManyArgs = {
    /**
     * The data used to update Uuids.
     */
    data: XOR<UuidsUpdateManyMutationInput, UuidsUncheckedUpdateManyInput>
    /**
     * Filter which Uuids to update
     */
    where?: UuidsWhereInput
  }


  /**
   * Uuids upsert
   */
  export type UuidsUpsertArgs = {
    /**
     * Select specific fields to fetch from the Uuids
     */
    select?: UuidsSelect | null
    /**
     * The filter to search for the Uuids to update in case it exists.
     */
    where: UuidsWhereUniqueInput
    /**
     * In case the Uuids found by the `where` argument doesn't exist, create a new Uuids with this data.
     */
    create: XOR<UuidsCreateInput, UuidsUncheckedCreateInput>
    /**
     * In case the Uuids was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UuidsUpdateInput, UuidsUncheckedUpdateInput>
  }


  /**
   * Uuids delete
   */
  export type UuidsDeleteArgs = {
    /**
     * Select specific fields to fetch from the Uuids
     */
    select?: UuidsSelect | null
    /**
     * Filter which Uuids to delete.
     */
    where: UuidsWhereUniqueInput
  }


  /**
   * Uuids deleteMany
   */
  export type UuidsDeleteManyArgs = {
    /**
     * Filter which Uuids to delete
     */
    where?: UuidsWhereInput
  }


  /**
   * Uuids without action
   */
  export type UuidsArgs = {
    /**
     * Select specific fields to fetch from the Uuids
     */
    select?: UuidsSelect | null
  }



  /**
   * Model Ints
   */


  export type AggregateInts = {
    _count: IntsCountAggregateOutputType | null
    _avg: IntsAvgAggregateOutputType | null
    _sum: IntsSumAggregateOutputType | null
    _min: IntsMinAggregateOutputType | null
    _max: IntsMaxAggregateOutputType | null
  }

  export type IntsAvgAggregateOutputType = {
    i2: number | null
    i4: number | null
    i8: number | null
  }

  export type IntsSumAggregateOutputType = {
    i2: number | null
    i4: number | null
    i8: bigint | null
  }

  export type IntsMinAggregateOutputType = {
    id: string | null
    i2: number | null
    i4: number | null
    i8: bigint | null
  }

  export type IntsMaxAggregateOutputType = {
    id: string | null
    i2: number | null
    i4: number | null
    i8: bigint | null
  }

  export type IntsCountAggregateOutputType = {
    id: number
    i2: number
    i4: number
    i8: number
    _all: number
  }


  export type IntsAvgAggregateInputType = {
    i2?: true
    i4?: true
    i8?: true
  }

  export type IntsSumAggregateInputType = {
    i2?: true
    i4?: true
    i8?: true
  }

  export type IntsMinAggregateInputType = {
    id?: true
    i2?: true
    i4?: true
    i8?: true
  }

  export type IntsMaxAggregateInputType = {
    id?: true
    i2?: true
    i4?: true
    i8?: true
  }

  export type IntsCountAggregateInputType = {
    id?: true
    i2?: true
    i4?: true
    i8?: true
    _all?: true
  }

  export type IntsAggregateArgs = {
    /**
     * Filter which Ints to aggregate.
     */
    where?: IntsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Ints to fetch.
     */
    orderBy?: Enumerable<IntsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: IntsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Ints from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Ints.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Ints
    **/
    _count?: true | IntsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: IntsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: IntsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: IntsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: IntsMaxAggregateInputType
  }

  export type GetIntsAggregateType<T extends IntsAggregateArgs> = {
        [P in keyof T & keyof AggregateInts]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateInts[P]>
      : GetScalarType<T[P], AggregateInts[P]>
  }




  export type IntsGroupByArgs = {
    where?: IntsWhereInput
    orderBy?: Enumerable<IntsOrderByWithAggregationInput>
    by: IntsScalarFieldEnum[]
    having?: IntsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: IntsCountAggregateInputType | true
    _avg?: IntsAvgAggregateInputType
    _sum?: IntsSumAggregateInputType
    _min?: IntsMinAggregateInputType
    _max?: IntsMaxAggregateInputType
  }


  export type IntsGroupByOutputType = {
    id: string
    i2: number | null
    i4: number | null
    i8: bigint | null
    _count: IntsCountAggregateOutputType | null
    _avg: IntsAvgAggregateOutputType | null
    _sum: IntsSumAggregateOutputType | null
    _min: IntsMinAggregateOutputType | null
    _max: IntsMaxAggregateOutputType | null
  }

  type GetIntsGroupByPayload<T extends IntsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickArray<IntsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof IntsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], IntsGroupByOutputType[P]>
            : GetScalarType<T[P], IntsGroupByOutputType[P]>
        }
      >
    >


  export type IntsSelect = {
    id?: boolean
    i2?: boolean
    i4?: boolean
    i8?: boolean
  }


  export type IntsGetPayload<S extends boolean | null | undefined | IntsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Ints :
    S extends undefined ? never :
    S extends { include: any } & (IntsArgs | IntsFindManyArgs)
    ? Ints 
    : S extends { select: any } & (IntsArgs | IntsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Ints ? Ints[P] : never
  } 
      : Ints


  type IntsCountArgs = 
    Omit<IntsFindManyArgs, 'select' | 'include'> & {
      select?: IntsCountAggregateInputType | true
    }

  export interface IntsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {

    /**
     * Find zero or one Ints that matches the filter.
     * @param {IntsFindUniqueArgs} args - Arguments to find a Ints
     * @example
     * // Get one Ints
     * const ints = await prisma.ints.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends IntsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, IntsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Ints'> extends True ? Prisma__IntsClient<IntsGetPayload<T>> : Prisma__IntsClient<IntsGetPayload<T> | null, null>

    /**
     * Find one Ints that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {IntsFindUniqueOrThrowArgs} args - Arguments to find a Ints
     * @example
     * // Get one Ints
     * const ints = await prisma.ints.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends IntsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, IntsFindUniqueOrThrowArgs>
    ): Prisma__IntsClient<IntsGetPayload<T>>

    /**
     * Find the first Ints that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IntsFindFirstArgs} args - Arguments to find a Ints
     * @example
     * // Get one Ints
     * const ints = await prisma.ints.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends IntsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, IntsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Ints'> extends True ? Prisma__IntsClient<IntsGetPayload<T>> : Prisma__IntsClient<IntsGetPayload<T> | null, null>

    /**
     * Find the first Ints that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IntsFindFirstOrThrowArgs} args - Arguments to find a Ints
     * @example
     * // Get one Ints
     * const ints = await prisma.ints.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends IntsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, IntsFindFirstOrThrowArgs>
    ): Prisma__IntsClient<IntsGetPayload<T>>

    /**
     * Find zero or more Ints that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IntsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Ints
     * const ints = await prisma.ints.findMany()
     * 
     * // Get first 10 Ints
     * const ints = await prisma.ints.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const intsWithIdOnly = await prisma.ints.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends IntsFindManyArgs>(
      args?: SelectSubset<T, IntsFindManyArgs>
    ): Prisma.PrismaPromise<Array<IntsGetPayload<T>>>

    /**
     * Create a Ints.
     * @param {IntsCreateArgs} args - Arguments to create a Ints.
     * @example
     * // Create one Ints
     * const Ints = await prisma.ints.create({
     *   data: {
     *     // ... data to create a Ints
     *   }
     * })
     * 
    **/
    create<T extends IntsCreateArgs>(
      args: SelectSubset<T, IntsCreateArgs>
    ): Prisma__IntsClient<IntsGetPayload<T>>

    /**
     * Create many Ints.
     *     @param {IntsCreateManyArgs} args - Arguments to create many Ints.
     *     @example
     *     // Create many Ints
     *     const ints = await prisma.ints.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends IntsCreateManyArgs>(
      args?: SelectSubset<T, IntsCreateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a Ints.
     * @param {IntsDeleteArgs} args - Arguments to delete one Ints.
     * @example
     * // Delete one Ints
     * const Ints = await prisma.ints.delete({
     *   where: {
     *     // ... filter to delete one Ints
     *   }
     * })
     * 
    **/
    delete<T extends IntsDeleteArgs>(
      args: SelectSubset<T, IntsDeleteArgs>
    ): Prisma__IntsClient<IntsGetPayload<T>>

    /**
     * Update one Ints.
     * @param {IntsUpdateArgs} args - Arguments to update one Ints.
     * @example
     * // Update one Ints
     * const ints = await prisma.ints.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends IntsUpdateArgs>(
      args: SelectSubset<T, IntsUpdateArgs>
    ): Prisma__IntsClient<IntsGetPayload<T>>

    /**
     * Delete zero or more Ints.
     * @param {IntsDeleteManyArgs} args - Arguments to filter Ints to delete.
     * @example
     * // Delete a few Ints
     * const { count } = await prisma.ints.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends IntsDeleteManyArgs>(
      args?: SelectSubset<T, IntsDeleteManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Ints.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IntsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Ints
     * const ints = await prisma.ints.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends IntsUpdateManyArgs>(
      args: SelectSubset<T, IntsUpdateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Ints.
     * @param {IntsUpsertArgs} args - Arguments to update or create a Ints.
     * @example
     * // Update or create a Ints
     * const ints = await prisma.ints.upsert({
     *   create: {
     *     // ... data to create a Ints
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Ints we want to update
     *   }
     * })
    **/
    upsert<T extends IntsUpsertArgs>(
      args: SelectSubset<T, IntsUpsertArgs>
    ): Prisma__IntsClient<IntsGetPayload<T>>

    /**
     * Count the number of Ints.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IntsCountArgs} args - Arguments to filter Ints to count.
     * @example
     * // Count the number of Ints
     * const count = await prisma.ints.count({
     *   where: {
     *     // ... the filter for the Ints we want to count
     *   }
     * })
    **/
    count<T extends IntsCountArgs>(
      args?: Subset<T, IntsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], IntsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Ints.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IntsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends IntsAggregateArgs>(args: Subset<T, IntsAggregateArgs>): Prisma.PrismaPromise<GetIntsAggregateType<T>>

    /**
     * Group by Ints.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IntsGroupByArgs} args - Group by arguments.
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
      T extends IntsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: IntsGroupByArgs['orderBy'] }
        : { orderBy?: IntsGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, IntsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetIntsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Ints.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__IntsClient<T, Null = never> implements Prisma.PrismaPromise<T> {
    private readonly _dmmf;
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
    readonly [Symbol.toStringTag]: 'PrismaPromise';
    constructor(_dmmf: runtime.DMMFClass, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);


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
   * Ints base type for findUnique actions
   */
  export type IntsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Ints
     */
    select?: IntsSelect | null
    /**
     * Filter, which Ints to fetch.
     */
    where: IntsWhereUniqueInput
  }

  /**
   * Ints findUnique
   */
  export interface IntsFindUniqueArgs extends IntsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Ints findUniqueOrThrow
   */
  export type IntsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Ints
     */
    select?: IntsSelect | null
    /**
     * Filter, which Ints to fetch.
     */
    where: IntsWhereUniqueInput
  }


  /**
   * Ints base type for findFirst actions
   */
  export type IntsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Ints
     */
    select?: IntsSelect | null
    /**
     * Filter, which Ints to fetch.
     */
    where?: IntsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Ints to fetch.
     */
    orderBy?: Enumerable<IntsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Ints.
     */
    cursor?: IntsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Ints from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Ints.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Ints.
     */
    distinct?: Enumerable<IntsScalarFieldEnum>
  }

  /**
   * Ints findFirst
   */
  export interface IntsFindFirstArgs extends IntsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Ints findFirstOrThrow
   */
  export type IntsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Ints
     */
    select?: IntsSelect | null
    /**
     * Filter, which Ints to fetch.
     */
    where?: IntsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Ints to fetch.
     */
    orderBy?: Enumerable<IntsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Ints.
     */
    cursor?: IntsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Ints from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Ints.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Ints.
     */
    distinct?: Enumerable<IntsScalarFieldEnum>
  }


  /**
   * Ints findMany
   */
  export type IntsFindManyArgs = {
    /**
     * Select specific fields to fetch from the Ints
     */
    select?: IntsSelect | null
    /**
     * Filter, which Ints to fetch.
     */
    where?: IntsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Ints to fetch.
     */
    orderBy?: Enumerable<IntsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Ints.
     */
    cursor?: IntsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Ints from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Ints.
     */
    skip?: number
    distinct?: Enumerable<IntsScalarFieldEnum>
  }


  /**
   * Ints create
   */
  export type IntsCreateArgs = {
    /**
     * Select specific fields to fetch from the Ints
     */
    select?: IntsSelect | null
    /**
     * The data needed to create a Ints.
     */
    data: XOR<IntsCreateInput, IntsUncheckedCreateInput>
  }


  /**
   * Ints createMany
   */
  export type IntsCreateManyArgs = {
    /**
     * The data used to create many Ints.
     */
    data: Enumerable<IntsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Ints update
   */
  export type IntsUpdateArgs = {
    /**
     * Select specific fields to fetch from the Ints
     */
    select?: IntsSelect | null
    /**
     * The data needed to update a Ints.
     */
    data: XOR<IntsUpdateInput, IntsUncheckedUpdateInput>
    /**
     * Choose, which Ints to update.
     */
    where: IntsWhereUniqueInput
  }


  /**
   * Ints updateMany
   */
  export type IntsUpdateManyArgs = {
    /**
     * The data used to update Ints.
     */
    data: XOR<IntsUpdateManyMutationInput, IntsUncheckedUpdateManyInput>
    /**
     * Filter which Ints to update
     */
    where?: IntsWhereInput
  }


  /**
   * Ints upsert
   */
  export type IntsUpsertArgs = {
    /**
     * Select specific fields to fetch from the Ints
     */
    select?: IntsSelect | null
    /**
     * The filter to search for the Ints to update in case it exists.
     */
    where: IntsWhereUniqueInput
    /**
     * In case the Ints found by the `where` argument doesn't exist, create a new Ints with this data.
     */
    create: XOR<IntsCreateInput, IntsUncheckedCreateInput>
    /**
     * In case the Ints was found with the provided `where` argument, update it with this data.
     */
    update: XOR<IntsUpdateInput, IntsUncheckedUpdateInput>
  }


  /**
   * Ints delete
   */
  export type IntsDeleteArgs = {
    /**
     * Select specific fields to fetch from the Ints
     */
    select?: IntsSelect | null
    /**
     * Filter which Ints to delete.
     */
    where: IntsWhereUniqueInput
  }


  /**
   * Ints deleteMany
   */
  export type IntsDeleteManyArgs = {
    /**
     * Filter which Ints to delete
     */
    where?: IntsWhereInput
  }


  /**
   * Ints without action
   */
  export type IntsArgs = {
    /**
     * Select specific fields to fetch from the Ints
     */
    select?: IntsSelect | null
  }



  /**
   * Model Floats
   */


  export type AggregateFloats = {
    _count: FloatsCountAggregateOutputType | null
    _avg: FloatsAvgAggregateOutputType | null
    _sum: FloatsSumAggregateOutputType | null
    _min: FloatsMinAggregateOutputType | null
    _max: FloatsMaxAggregateOutputType | null
  }

  export type FloatsAvgAggregateOutputType = {
    f8: number | null
  }

  export type FloatsSumAggregateOutputType = {
    f8: number | null
  }

  export type FloatsMinAggregateOutputType = {
    id: string | null
    f8: number | null
  }

  export type FloatsMaxAggregateOutputType = {
    id: string | null
    f8: number | null
  }

  export type FloatsCountAggregateOutputType = {
    id: number
    f8: number
    _all: number
  }


  export type FloatsAvgAggregateInputType = {
    f8?: true
  }

  export type FloatsSumAggregateInputType = {
    f8?: true
  }

  export type FloatsMinAggregateInputType = {
    id?: true
    f8?: true
  }

  export type FloatsMaxAggregateInputType = {
    id?: true
    f8?: true
  }

  export type FloatsCountAggregateInputType = {
    id?: true
    f8?: true
    _all?: true
  }

  export type FloatsAggregateArgs = {
    /**
     * Filter which Floats to aggregate.
     */
    where?: FloatsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Floats to fetch.
     */
    orderBy?: Enumerable<FloatsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: FloatsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Floats from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Floats.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Floats
    **/
    _count?: true | FloatsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: FloatsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: FloatsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: FloatsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: FloatsMaxAggregateInputType
  }

  export type GetFloatsAggregateType<T extends FloatsAggregateArgs> = {
        [P in keyof T & keyof AggregateFloats]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateFloats[P]>
      : GetScalarType<T[P], AggregateFloats[P]>
  }




  export type FloatsGroupByArgs = {
    where?: FloatsWhereInput
    orderBy?: Enumerable<FloatsOrderByWithAggregationInput>
    by: FloatsScalarFieldEnum[]
    having?: FloatsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: FloatsCountAggregateInputType | true
    _avg?: FloatsAvgAggregateInputType
    _sum?: FloatsSumAggregateInputType
    _min?: FloatsMinAggregateInputType
    _max?: FloatsMaxAggregateInputType
  }


  export type FloatsGroupByOutputType = {
    id: string
    f8: number | null
    _count: FloatsCountAggregateOutputType | null
    _avg: FloatsAvgAggregateOutputType | null
    _sum: FloatsSumAggregateOutputType | null
    _min: FloatsMinAggregateOutputType | null
    _max: FloatsMaxAggregateOutputType | null
  }

  type GetFloatsGroupByPayload<T extends FloatsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickArray<FloatsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof FloatsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], FloatsGroupByOutputType[P]>
            : GetScalarType<T[P], FloatsGroupByOutputType[P]>
        }
      >
    >


  export type FloatsSelect = {
    id?: boolean
    f8?: boolean
  }


  export type FloatsGetPayload<S extends boolean | null | undefined | FloatsArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Floats :
    S extends undefined ? never :
    S extends { include: any } & (FloatsArgs | FloatsFindManyArgs)
    ? Floats 
    : S extends { select: any } & (FloatsArgs | FloatsFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof Floats ? Floats[P] : never
  } 
      : Floats


  type FloatsCountArgs = 
    Omit<FloatsFindManyArgs, 'select' | 'include'> & {
      select?: FloatsCountAggregateInputType | true
    }

  export interface FloatsDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {

    /**
     * Find zero or one Floats that matches the filter.
     * @param {FloatsFindUniqueArgs} args - Arguments to find a Floats
     * @example
     * // Get one Floats
     * const floats = await prisma.floats.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends FloatsFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, FloatsFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Floats'> extends True ? Prisma__FloatsClient<FloatsGetPayload<T>> : Prisma__FloatsClient<FloatsGetPayload<T> | null, null>

    /**
     * Find one Floats that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {FloatsFindUniqueOrThrowArgs} args - Arguments to find a Floats
     * @example
     * // Get one Floats
     * const floats = await prisma.floats.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends FloatsFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, FloatsFindUniqueOrThrowArgs>
    ): Prisma__FloatsClient<FloatsGetPayload<T>>

    /**
     * Find the first Floats that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FloatsFindFirstArgs} args - Arguments to find a Floats
     * @example
     * // Get one Floats
     * const floats = await prisma.floats.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends FloatsFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, FloatsFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Floats'> extends True ? Prisma__FloatsClient<FloatsGetPayload<T>> : Prisma__FloatsClient<FloatsGetPayload<T> | null, null>

    /**
     * Find the first Floats that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FloatsFindFirstOrThrowArgs} args - Arguments to find a Floats
     * @example
     * // Get one Floats
     * const floats = await prisma.floats.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends FloatsFindFirstOrThrowArgs>(
      args?: SelectSubset<T, FloatsFindFirstOrThrowArgs>
    ): Prisma__FloatsClient<FloatsGetPayload<T>>

    /**
     * Find zero or more Floats that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FloatsFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Floats
     * const floats = await prisma.floats.findMany()
     * 
     * // Get first 10 Floats
     * const floats = await prisma.floats.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const floatsWithIdOnly = await prisma.floats.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends FloatsFindManyArgs>(
      args?: SelectSubset<T, FloatsFindManyArgs>
    ): Prisma.PrismaPromise<Array<FloatsGetPayload<T>>>

    /**
     * Create a Floats.
     * @param {FloatsCreateArgs} args - Arguments to create a Floats.
     * @example
     * // Create one Floats
     * const Floats = await prisma.floats.create({
     *   data: {
     *     // ... data to create a Floats
     *   }
     * })
     * 
    **/
    create<T extends FloatsCreateArgs>(
      args: SelectSubset<T, FloatsCreateArgs>
    ): Prisma__FloatsClient<FloatsGetPayload<T>>

    /**
     * Create many Floats.
     *     @param {FloatsCreateManyArgs} args - Arguments to create many Floats.
     *     @example
     *     // Create many Floats
     *     const floats = await prisma.floats.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends FloatsCreateManyArgs>(
      args?: SelectSubset<T, FloatsCreateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a Floats.
     * @param {FloatsDeleteArgs} args - Arguments to delete one Floats.
     * @example
     * // Delete one Floats
     * const Floats = await prisma.floats.delete({
     *   where: {
     *     // ... filter to delete one Floats
     *   }
     * })
     * 
    **/
    delete<T extends FloatsDeleteArgs>(
      args: SelectSubset<T, FloatsDeleteArgs>
    ): Prisma__FloatsClient<FloatsGetPayload<T>>

    /**
     * Update one Floats.
     * @param {FloatsUpdateArgs} args - Arguments to update one Floats.
     * @example
     * // Update one Floats
     * const floats = await prisma.floats.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends FloatsUpdateArgs>(
      args: SelectSubset<T, FloatsUpdateArgs>
    ): Prisma__FloatsClient<FloatsGetPayload<T>>

    /**
     * Delete zero or more Floats.
     * @param {FloatsDeleteManyArgs} args - Arguments to filter Floats to delete.
     * @example
     * // Delete a few Floats
     * const { count } = await prisma.floats.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends FloatsDeleteManyArgs>(
      args?: SelectSubset<T, FloatsDeleteManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Floats.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FloatsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Floats
     * const floats = await prisma.floats.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends FloatsUpdateManyArgs>(
      args: SelectSubset<T, FloatsUpdateManyArgs>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Floats.
     * @param {FloatsUpsertArgs} args - Arguments to update or create a Floats.
     * @example
     * // Update or create a Floats
     * const floats = await prisma.floats.upsert({
     *   create: {
     *     // ... data to create a Floats
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Floats we want to update
     *   }
     * })
    **/
    upsert<T extends FloatsUpsertArgs>(
      args: SelectSubset<T, FloatsUpsertArgs>
    ): Prisma__FloatsClient<FloatsGetPayload<T>>

    /**
     * Count the number of Floats.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FloatsCountArgs} args - Arguments to filter Floats to count.
     * @example
     * // Count the number of Floats
     * const count = await prisma.floats.count({
     *   where: {
     *     // ... the filter for the Floats we want to count
     *   }
     * })
    **/
    count<T extends FloatsCountArgs>(
      args?: Subset<T, FloatsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], FloatsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Floats.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FloatsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends FloatsAggregateArgs>(args: Subset<T, FloatsAggregateArgs>): Prisma.PrismaPromise<GetFloatsAggregateType<T>>

    /**
     * Group by Floats.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {FloatsGroupByArgs} args - Group by arguments.
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
      T extends FloatsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: FloatsGroupByArgs['orderBy'] }
        : { orderBy?: FloatsGroupByArgs['orderBy'] },
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
    >(args: SubsetIntersection<T, FloatsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetFloatsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Floats.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__FloatsClient<T, Null = never> implements Prisma.PrismaPromise<T> {
    private readonly _dmmf;
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
    readonly [Symbol.toStringTag]: 'PrismaPromise';
    constructor(_dmmf: runtime.DMMFClass, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);


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
   * Floats base type for findUnique actions
   */
  export type FloatsFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Floats
     */
    select?: FloatsSelect | null
    /**
     * Filter, which Floats to fetch.
     */
    where: FloatsWhereUniqueInput
  }

  /**
   * Floats findUnique
   */
  export interface FloatsFindUniqueArgs extends FloatsFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Floats findUniqueOrThrow
   */
  export type FloatsFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Floats
     */
    select?: FloatsSelect | null
    /**
     * Filter, which Floats to fetch.
     */
    where: FloatsWhereUniqueInput
  }


  /**
   * Floats base type for findFirst actions
   */
  export type FloatsFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Floats
     */
    select?: FloatsSelect | null
    /**
     * Filter, which Floats to fetch.
     */
    where?: FloatsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Floats to fetch.
     */
    orderBy?: Enumerable<FloatsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Floats.
     */
    cursor?: FloatsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Floats from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Floats.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Floats.
     */
    distinct?: Enumerable<FloatsScalarFieldEnum>
  }

  /**
   * Floats findFirst
   */
  export interface FloatsFindFirstArgs extends FloatsFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Floats findFirstOrThrow
   */
  export type FloatsFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Floats
     */
    select?: FloatsSelect | null
    /**
     * Filter, which Floats to fetch.
     */
    where?: FloatsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Floats to fetch.
     */
    orderBy?: Enumerable<FloatsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Floats.
     */
    cursor?: FloatsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Floats from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Floats.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Floats.
     */
    distinct?: Enumerable<FloatsScalarFieldEnum>
  }


  /**
   * Floats findMany
   */
  export type FloatsFindManyArgs = {
    /**
     * Select specific fields to fetch from the Floats
     */
    select?: FloatsSelect | null
    /**
     * Filter, which Floats to fetch.
     */
    where?: FloatsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Floats to fetch.
     */
    orderBy?: Enumerable<FloatsOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Floats.
     */
    cursor?: FloatsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Floats from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Floats.
     */
    skip?: number
    distinct?: Enumerable<FloatsScalarFieldEnum>
  }


  /**
   * Floats create
   */
  export type FloatsCreateArgs = {
    /**
     * Select specific fields to fetch from the Floats
     */
    select?: FloatsSelect | null
    /**
     * The data needed to create a Floats.
     */
    data: XOR<FloatsCreateInput, FloatsUncheckedCreateInput>
  }


  /**
   * Floats createMany
   */
  export type FloatsCreateManyArgs = {
    /**
     * The data used to create many Floats.
     */
    data: Enumerable<FloatsCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Floats update
   */
  export type FloatsUpdateArgs = {
    /**
     * Select specific fields to fetch from the Floats
     */
    select?: FloatsSelect | null
    /**
     * The data needed to update a Floats.
     */
    data: XOR<FloatsUpdateInput, FloatsUncheckedUpdateInput>
    /**
     * Choose, which Floats to update.
     */
    where: FloatsWhereUniqueInput
  }


  /**
   * Floats updateMany
   */
  export type FloatsUpdateManyArgs = {
    /**
     * The data used to update Floats.
     */
    data: XOR<FloatsUpdateManyMutationInput, FloatsUncheckedUpdateManyInput>
    /**
     * Filter which Floats to update
     */
    where?: FloatsWhereInput
  }


  /**
   * Floats upsert
   */
  export type FloatsUpsertArgs = {
    /**
     * Select specific fields to fetch from the Floats
     */
    select?: FloatsSelect | null
    /**
     * The filter to search for the Floats to update in case it exists.
     */
    where: FloatsWhereUniqueInput
    /**
     * In case the Floats found by the `where` argument doesn't exist, create a new Floats with this data.
     */
    create: XOR<FloatsCreateInput, FloatsUncheckedCreateInput>
    /**
     * In case the Floats was found with the provided `where` argument, update it with this data.
     */
    update: XOR<FloatsUpdateInput, FloatsUncheckedUpdateInput>
  }


  /**
   * Floats delete
   */
  export type FloatsDeleteArgs = {
    /**
     * Select specific fields to fetch from the Floats
     */
    select?: FloatsSelect | null
    /**
     * Filter which Floats to delete.
     */
    where: FloatsWhereUniqueInput
  }


  /**
   * Floats deleteMany
   */
  export type FloatsDeleteManyArgs = {
    /**
     * Filter which Floats to delete
     */
    where?: FloatsWhereInput
  }


  /**
   * Floats without action
   */
  export type FloatsArgs = {
    /**
     * Select specific fields to fetch from the Floats
     */
    select?: FloatsSelect | null
  }



  /**
   * Enums
   */

  export const BoolsScalarFieldEnum: {
    id: 'id',
    b: 'b'
  };

  export type BoolsScalarFieldEnum = (typeof BoolsScalarFieldEnum)[keyof typeof BoolsScalarFieldEnum]


  export const DatetimesScalarFieldEnum: {
    id: 'id',
    d: 'd',
    t: 't'
  };

  export type DatetimesScalarFieldEnum = (typeof DatetimesScalarFieldEnum)[keyof typeof DatetimesScalarFieldEnum]


  export const FloatsScalarFieldEnum: {
    id: 'id',
    f8: 'f8'
  };

  export type FloatsScalarFieldEnum = (typeof FloatsScalarFieldEnum)[keyof typeof FloatsScalarFieldEnum]


  export const IntsScalarFieldEnum: {
    id: 'id',
    i2: 'i2',
    i4: 'i4',
    i8: 'i8'
  };

  export type IntsScalarFieldEnum = (typeof IntsScalarFieldEnum)[keyof typeof IntsScalarFieldEnum]


  export const ItemsScalarFieldEnum: {
    id: 'id',
    content: 'content',
    content_text_null: 'content_text_null',
    content_text_null_default: 'content_text_null_default',
    intvalue_null: 'intvalue_null',
    intvalue_null_default: 'intvalue_null_default'
  };

  export type ItemsScalarFieldEnum = (typeof ItemsScalarFieldEnum)[keyof typeof ItemsScalarFieldEnum]


  export const OtherItemsScalarFieldEnum: {
    id: 'id',
    content: 'content',
    item_id: 'item_id'
  };

  export type OtherItemsScalarFieldEnum = (typeof OtherItemsScalarFieldEnum)[keyof typeof OtherItemsScalarFieldEnum]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const TimestampsScalarFieldEnum: {
    id: 'id',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type TimestampsScalarFieldEnum = (typeof TimestampsScalarFieldEnum)[keyof typeof TimestampsScalarFieldEnum]


  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const UuidsScalarFieldEnum: {
    id: 'id'
  };

  export type UuidsScalarFieldEnum = (typeof UuidsScalarFieldEnum)[keyof typeof UuidsScalarFieldEnum]


  /**
   * Deep Input Types
   */


  export type ItemsWhereInput = {
    AND?: Enumerable<ItemsWhereInput>
    OR?: Enumerable<ItemsWhereInput>
    NOT?: Enumerable<ItemsWhereInput>
    id?: StringFilter | string
    content?: StringFilter | string
    content_text_null?: StringNullableFilter | string | null
    content_text_null_default?: StringNullableFilter | string | null
    intvalue_null?: IntNullableFilter | number | null
    intvalue_null_default?: IntNullableFilter | number | null
    other_items?: XOR<OtherItemsRelationFilter, OtherItemsWhereInput> | null
  }

  export type ItemsOrderByWithRelationInput = {
    id?: SortOrder
    content?: SortOrder
    content_text_null?: SortOrder
    content_text_null_default?: SortOrder
    intvalue_null?: SortOrder
    intvalue_null_default?: SortOrder
    other_items?: OtherItemsOrderByWithRelationInput
  }

  export type ItemsWhereUniqueInput = {
    id?: string
  }

  export type ItemsOrderByWithAggregationInput = {
    id?: SortOrder
    content?: SortOrder
    content_text_null?: SortOrder
    content_text_null_default?: SortOrder
    intvalue_null?: SortOrder
    intvalue_null_default?: SortOrder
    _count?: ItemsCountOrderByAggregateInput
    _avg?: ItemsAvgOrderByAggregateInput
    _max?: ItemsMaxOrderByAggregateInput
    _min?: ItemsMinOrderByAggregateInput
    _sum?: ItemsSumOrderByAggregateInput
  }

  export type ItemsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<ItemsScalarWhereWithAggregatesInput>
    OR?: Enumerable<ItemsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<ItemsScalarWhereWithAggregatesInput>
    id?: StringWithAggregatesFilter | string
    content?: StringWithAggregatesFilter | string
    content_text_null?: StringNullableWithAggregatesFilter | string | null
    content_text_null_default?: StringNullableWithAggregatesFilter | string | null
    intvalue_null?: IntNullableWithAggregatesFilter | number | null
    intvalue_null_default?: IntNullableWithAggregatesFilter | number | null
  }

  export type OtherItemsWhereInput = {
    AND?: Enumerable<OtherItemsWhereInput>
    OR?: Enumerable<OtherItemsWhereInput>
    NOT?: Enumerable<OtherItemsWhereInput>
    id?: StringFilter | string
    content?: StringFilter | string
    item_id?: StringNullableFilter | string | null
    items?: XOR<ItemsRelationFilter, ItemsWhereInput> | null
  }

  export type OtherItemsOrderByWithRelationInput = {
    id?: SortOrder
    content?: SortOrder
    item_id?: SortOrder
    items?: ItemsOrderByWithRelationInput
  }

  export type OtherItemsWhereUniqueInput = {
    id?: string
    item_id?: string
  }

  export type OtherItemsOrderByWithAggregationInput = {
    id?: SortOrder
    content?: SortOrder
    item_id?: SortOrder
    _count?: OtherItemsCountOrderByAggregateInput
    _max?: OtherItemsMaxOrderByAggregateInput
    _min?: OtherItemsMinOrderByAggregateInput
  }

  export type OtherItemsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<OtherItemsScalarWhereWithAggregatesInput>
    OR?: Enumerable<OtherItemsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<OtherItemsScalarWhereWithAggregatesInput>
    id?: StringWithAggregatesFilter | string
    content?: StringWithAggregatesFilter | string
    item_id?: StringNullableWithAggregatesFilter | string | null
  }

  export type TimestampsWhereInput = {
    AND?: Enumerable<TimestampsWhereInput>
    OR?: Enumerable<TimestampsWhereInput>
    NOT?: Enumerable<TimestampsWhereInput>
    id?: StringFilter | string
    created_at?: DateTimeFilter | Date | string
    updated_at?: DateTimeFilter | Date | string
  }

  export type TimestampsOrderByWithRelationInput = {
    id?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type TimestampsWhereUniqueInput = {
    id?: string
  }

  export type TimestampsOrderByWithAggregationInput = {
    id?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: TimestampsCountOrderByAggregateInput
    _max?: TimestampsMaxOrderByAggregateInput
    _min?: TimestampsMinOrderByAggregateInput
  }

  export type TimestampsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<TimestampsScalarWhereWithAggregatesInput>
    OR?: Enumerable<TimestampsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<TimestampsScalarWhereWithAggregatesInput>
    id?: StringWithAggregatesFilter | string
    created_at?: DateTimeWithAggregatesFilter | Date | string
    updated_at?: DateTimeWithAggregatesFilter | Date | string
  }

  export type DatetimesWhereInput = {
    AND?: Enumerable<DatetimesWhereInput>
    OR?: Enumerable<DatetimesWhereInput>
    NOT?: Enumerable<DatetimesWhereInput>
    id?: StringFilter | string
    d?: DateTimeFilter | Date | string
    t?: DateTimeFilter | Date | string
  }

  export type DatetimesOrderByWithRelationInput = {
    id?: SortOrder
    d?: SortOrder
    t?: SortOrder
  }

  export type DatetimesWhereUniqueInput = {
    id?: string
  }

  export type DatetimesOrderByWithAggregationInput = {
    id?: SortOrder
    d?: SortOrder
    t?: SortOrder
    _count?: DatetimesCountOrderByAggregateInput
    _max?: DatetimesMaxOrderByAggregateInput
    _min?: DatetimesMinOrderByAggregateInput
  }

  export type DatetimesScalarWhereWithAggregatesInput = {
    AND?: Enumerable<DatetimesScalarWhereWithAggregatesInput>
    OR?: Enumerable<DatetimesScalarWhereWithAggregatesInput>
    NOT?: Enumerable<DatetimesScalarWhereWithAggregatesInput>
    id?: StringWithAggregatesFilter | string
    d?: DateTimeWithAggregatesFilter | Date | string
    t?: DateTimeWithAggregatesFilter | Date | string
  }

  export type BoolsWhereInput = {
    AND?: Enumerable<BoolsWhereInput>
    OR?: Enumerable<BoolsWhereInput>
    NOT?: Enumerable<BoolsWhereInput>
    id?: StringFilter | string
    b?: BoolNullableFilter | boolean | null
  }

  export type BoolsOrderByWithRelationInput = {
    id?: SortOrder
    b?: SortOrder
  }

  export type BoolsWhereUniqueInput = {
    id?: string
  }

  export type BoolsOrderByWithAggregationInput = {
    id?: SortOrder
    b?: SortOrder
    _count?: BoolsCountOrderByAggregateInput
    _max?: BoolsMaxOrderByAggregateInput
    _min?: BoolsMinOrderByAggregateInput
  }

  export type BoolsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<BoolsScalarWhereWithAggregatesInput>
    OR?: Enumerable<BoolsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<BoolsScalarWhereWithAggregatesInput>
    id?: StringWithAggregatesFilter | string
    b?: BoolNullableWithAggregatesFilter | boolean | null
  }

  export type UuidsWhereInput = {
    AND?: Enumerable<UuidsWhereInput>
    OR?: Enumerable<UuidsWhereInput>
    NOT?: Enumerable<UuidsWhereInput>
    id?: UuidFilter | string
  }

  export type UuidsOrderByWithRelationInput = {
    id?: SortOrder
  }

  export type UuidsWhereUniqueInput = {
    id?: string
  }

  export type UuidsOrderByWithAggregationInput = {
    id?: SortOrder
    _count?: UuidsCountOrderByAggregateInput
    _max?: UuidsMaxOrderByAggregateInput
    _min?: UuidsMinOrderByAggregateInput
  }

  export type UuidsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<UuidsScalarWhereWithAggregatesInput>
    OR?: Enumerable<UuidsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<UuidsScalarWhereWithAggregatesInput>
    id?: UuidWithAggregatesFilter | string
  }

  export type IntsWhereInput = {
    AND?: Enumerable<IntsWhereInput>
    OR?: Enumerable<IntsWhereInput>
    NOT?: Enumerable<IntsWhereInput>
    id?: StringFilter | string
    i2?: IntNullableFilter | number | null
    i4?: IntNullableFilter | number | null
    i8?: BigIntNullableFilter | bigint | number | null
  }

  export type IntsOrderByWithRelationInput = {
    id?: SortOrder
    i2?: SortOrder
    i4?: SortOrder
    i8?: SortOrder
  }

  export type IntsWhereUniqueInput = {
    id?: string
  }

  export type IntsOrderByWithAggregationInput = {
    id?: SortOrder
    i2?: SortOrder
    i4?: SortOrder
    i8?: SortOrder
    _count?: IntsCountOrderByAggregateInput
    _avg?: IntsAvgOrderByAggregateInput
    _max?: IntsMaxOrderByAggregateInput
    _min?: IntsMinOrderByAggregateInput
    _sum?: IntsSumOrderByAggregateInput
  }

  export type IntsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<IntsScalarWhereWithAggregatesInput>
    OR?: Enumerable<IntsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<IntsScalarWhereWithAggregatesInput>
    id?: StringWithAggregatesFilter | string
    i2?: IntNullableWithAggregatesFilter | number | null
    i4?: IntNullableWithAggregatesFilter | number | null
    i8?: BigIntNullableWithAggregatesFilter | bigint | number | null
  }

  export type FloatsWhereInput = {
    AND?: Enumerable<FloatsWhereInput>
    OR?: Enumerable<FloatsWhereInput>
    NOT?: Enumerable<FloatsWhereInput>
    id?: StringFilter | string
    f8?: FloatNullableFilter | number | null
  }

  export type FloatsOrderByWithRelationInput = {
    id?: SortOrder
    f8?: SortOrder
  }

  export type FloatsWhereUniqueInput = {
    id?: string
  }

  export type FloatsOrderByWithAggregationInput = {
    id?: SortOrder
    f8?: SortOrder
    _count?: FloatsCountOrderByAggregateInput
    _avg?: FloatsAvgOrderByAggregateInput
    _max?: FloatsMaxOrderByAggregateInput
    _min?: FloatsMinOrderByAggregateInput
    _sum?: FloatsSumOrderByAggregateInput
  }

  export type FloatsScalarWhereWithAggregatesInput = {
    AND?: Enumerable<FloatsScalarWhereWithAggregatesInput>
    OR?: Enumerable<FloatsScalarWhereWithAggregatesInput>
    NOT?: Enumerable<FloatsScalarWhereWithAggregatesInput>
    id?: StringWithAggregatesFilter | string
    f8?: FloatNullableWithAggregatesFilter | number | null
  }

  export type ItemsCreateInput = {
    id: string
    content: string
    content_text_null?: string | null
    content_text_null_default?: string | null
    intvalue_null?: number | null
    intvalue_null_default?: number | null
    other_items?: OtherItemsCreateNestedOneWithoutItemsInput
  }

  export type ItemsUncheckedCreateInput = {
    id: string
    content: string
    content_text_null?: string | null
    content_text_null_default?: string | null
    intvalue_null?: number | null
    intvalue_null_default?: number | null
    other_items?: OtherItemsUncheckedCreateNestedOneWithoutItemsInput
  }

  export type ItemsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    content_text_null?: NullableStringFieldUpdateOperationsInput | string | null
    content_text_null_default?: NullableStringFieldUpdateOperationsInput | string | null
    intvalue_null?: NullableIntFieldUpdateOperationsInput | number | null
    intvalue_null_default?: NullableIntFieldUpdateOperationsInput | number | null
    other_items?: OtherItemsUpdateOneWithoutItemsNestedInput
  }

  export type ItemsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    content_text_null?: NullableStringFieldUpdateOperationsInput | string | null
    content_text_null_default?: NullableStringFieldUpdateOperationsInput | string | null
    intvalue_null?: NullableIntFieldUpdateOperationsInput | number | null
    intvalue_null_default?: NullableIntFieldUpdateOperationsInput | number | null
    other_items?: OtherItemsUncheckedUpdateOneWithoutItemsNestedInput
  }

  export type ItemsCreateManyInput = {
    id: string
    content: string
    content_text_null?: string | null
    content_text_null_default?: string | null
    intvalue_null?: number | null
    intvalue_null_default?: number | null
  }

  export type ItemsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    content_text_null?: NullableStringFieldUpdateOperationsInput | string | null
    content_text_null_default?: NullableStringFieldUpdateOperationsInput | string | null
    intvalue_null?: NullableIntFieldUpdateOperationsInput | number | null
    intvalue_null_default?: NullableIntFieldUpdateOperationsInput | number | null
  }

  export type ItemsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    content_text_null?: NullableStringFieldUpdateOperationsInput | string | null
    content_text_null_default?: NullableStringFieldUpdateOperationsInput | string | null
    intvalue_null?: NullableIntFieldUpdateOperationsInput | number | null
    intvalue_null_default?: NullableIntFieldUpdateOperationsInput | number | null
  }

  export type OtherItemsCreateInput = {
    id: string
    content: string
    items?: ItemsCreateNestedOneWithoutOther_itemsInput
  }

  export type OtherItemsUncheckedCreateInput = {
    id: string
    content: string
    item_id?: string | null
  }

  export type OtherItemsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    items?: ItemsUpdateOneWithoutOther_itemsNestedInput
  }

  export type OtherItemsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    item_id?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type OtherItemsCreateManyInput = {
    id: string
    content: string
    item_id?: string | null
  }

  export type OtherItemsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
  }

  export type OtherItemsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    item_id?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type TimestampsCreateInput = {
    id: string
    created_at: Date | string
    updated_at: Date | string
  }

  export type TimestampsUncheckedCreateInput = {
    id: string
    created_at: Date | string
    updated_at: Date | string
  }

  export type TimestampsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TimestampsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TimestampsCreateManyInput = {
    id: string
    created_at: Date | string
    updated_at: Date | string
  }

  export type TimestampsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TimestampsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type DatetimesCreateInput = {
    id: string
    d: Date | string
    t: Date | string
  }

  export type DatetimesUncheckedCreateInput = {
    id: string
    d: Date | string
    t: Date | string
  }

  export type DatetimesUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    d?: DateTimeFieldUpdateOperationsInput | Date | string
    t?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type DatetimesUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    d?: DateTimeFieldUpdateOperationsInput | Date | string
    t?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type DatetimesCreateManyInput = {
    id: string
    d: Date | string
    t: Date | string
  }

  export type DatetimesUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    d?: DateTimeFieldUpdateOperationsInput | Date | string
    t?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type DatetimesUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    d?: DateTimeFieldUpdateOperationsInput | Date | string
    t?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BoolsCreateInput = {
    id: string
    b?: boolean | null
  }

  export type BoolsUncheckedCreateInput = {
    id: string
    b?: boolean | null
  }

  export type BoolsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    b?: NullableBoolFieldUpdateOperationsInput | boolean | null
  }

  export type BoolsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    b?: NullableBoolFieldUpdateOperationsInput | boolean | null
  }

  export type BoolsCreateManyInput = {
    id: string
    b?: boolean | null
  }

  export type BoolsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    b?: NullableBoolFieldUpdateOperationsInput | boolean | null
  }

  export type BoolsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    b?: NullableBoolFieldUpdateOperationsInput | boolean | null
  }

  export type UuidsCreateInput = {
    id: string
  }

  export type UuidsUncheckedCreateInput = {
    id: string
  }

  export type UuidsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
  }

  export type UuidsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
  }

  export type UuidsCreateManyInput = {
    id: string
  }

  export type UuidsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
  }

  export type UuidsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
  }

  export type IntsCreateInput = {
    id: string
    i2?: number | null
    i4?: number | null
    i8?: bigint | number | null
  }

  export type IntsUncheckedCreateInput = {
    id: string
    i2?: number | null
    i4?: number | null
    i8?: bigint | number | null
  }

  export type IntsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    i2?: NullableIntFieldUpdateOperationsInput | number | null
    i4?: NullableIntFieldUpdateOperationsInput | number | null
    i8?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
  }

  export type IntsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    i2?: NullableIntFieldUpdateOperationsInput | number | null
    i4?: NullableIntFieldUpdateOperationsInput | number | null
    i8?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
  }

  export type IntsCreateManyInput = {
    id: string
    i2?: number | null
    i4?: number | null
    i8?: bigint | number | null
  }

  export type IntsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    i2?: NullableIntFieldUpdateOperationsInput | number | null
    i4?: NullableIntFieldUpdateOperationsInput | number | null
    i8?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
  }

  export type IntsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    i2?: NullableIntFieldUpdateOperationsInput | number | null
    i4?: NullableIntFieldUpdateOperationsInput | number | null
    i8?: NullableBigIntFieldUpdateOperationsInput | bigint | number | null
  }

  export type FloatsCreateInput = {
    id: string
    f8?: number | null
  }

  export type FloatsUncheckedCreateInput = {
    id: string
    f8?: number | null
  }

  export type FloatsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    f8?: NullableFloatFieldUpdateOperationsInput | number | null
  }

  export type FloatsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    f8?: NullableFloatFieldUpdateOperationsInput | number | null
  }

  export type FloatsCreateManyInput = {
    id: string
    f8?: number | null
  }

  export type FloatsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    f8?: NullableFloatFieldUpdateOperationsInput | number | null
  }

  export type FloatsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    f8?: NullableFloatFieldUpdateOperationsInput | number | null
  }

  export type StringFilter = {
    equals?: string
    in?: Enumerable<string> | string
    notIn?: Enumerable<string> | string
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

  export type StringNullableFilter = {
    equals?: string | null
    in?: Enumerable<string> | string | null
    notIn?: Enumerable<string> | string | null
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

  export type IntNullableFilter = {
    equals?: number | null
    in?: Enumerable<number> | number | null
    notIn?: Enumerable<number> | number | null
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntNullableFilter | number | null
  }

  export type OtherItemsRelationFilter = {
    is?: OtherItemsWhereInput | null
    isNot?: OtherItemsWhereInput | null
  }

  export type ItemsCountOrderByAggregateInput = {
    id?: SortOrder
    content?: SortOrder
    content_text_null?: SortOrder
    content_text_null_default?: SortOrder
    intvalue_null?: SortOrder
    intvalue_null_default?: SortOrder
  }

  export type ItemsAvgOrderByAggregateInput = {
    intvalue_null?: SortOrder
    intvalue_null_default?: SortOrder
  }

  export type ItemsMaxOrderByAggregateInput = {
    id?: SortOrder
    content?: SortOrder
    content_text_null?: SortOrder
    content_text_null_default?: SortOrder
    intvalue_null?: SortOrder
    intvalue_null_default?: SortOrder
  }

  export type ItemsMinOrderByAggregateInput = {
    id?: SortOrder
    content?: SortOrder
    content_text_null?: SortOrder
    content_text_null_default?: SortOrder
    intvalue_null?: SortOrder
    intvalue_null_default?: SortOrder
  }

  export type ItemsSumOrderByAggregateInput = {
    intvalue_null?: SortOrder
    intvalue_null_default?: SortOrder
  }

  export type StringWithAggregatesFilter = {
    equals?: string
    in?: Enumerable<string> | string
    notIn?: Enumerable<string> | string
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

  export type StringNullableWithAggregatesFilter = {
    equals?: string | null
    in?: Enumerable<string> | string | null
    notIn?: Enumerable<string> | string | null
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

  export type IntNullableWithAggregatesFilter = {
    equals?: number | null
    in?: Enumerable<number> | number | null
    notIn?: Enumerable<number> | number | null
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntNullableWithAggregatesFilter | number | null
    _count?: NestedIntNullableFilter
    _avg?: NestedFloatNullableFilter
    _sum?: NestedIntNullableFilter
    _min?: NestedIntNullableFilter
    _max?: NestedIntNullableFilter
  }

  export type ItemsRelationFilter = {
    is?: ItemsWhereInput | null
    isNot?: ItemsWhereInput | null
  }

  export type OtherItemsCountOrderByAggregateInput = {
    id?: SortOrder
    content?: SortOrder
    item_id?: SortOrder
  }

  export type OtherItemsMaxOrderByAggregateInput = {
    id?: SortOrder
    content?: SortOrder
    item_id?: SortOrder
  }

  export type OtherItemsMinOrderByAggregateInput = {
    id?: SortOrder
    content?: SortOrder
    item_id?: SortOrder
  }

  export type DateTimeFilter = {
    equals?: Date | string
    in?: Enumerable<Date> | Enumerable<string> | Date | string
    notIn?: Enumerable<Date> | Enumerable<string> | Date | string
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeFilter | Date | string
  }

  export type TimestampsCountOrderByAggregateInput = {
    id?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type TimestampsMaxOrderByAggregateInput = {
    id?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type TimestampsMinOrderByAggregateInput = {
    id?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type DateTimeWithAggregatesFilter = {
    equals?: Date | string
    in?: Enumerable<Date> | Enumerable<string> | Date | string
    notIn?: Enumerable<Date> | Enumerable<string> | Date | string
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeWithAggregatesFilter | Date | string
    _count?: NestedIntFilter
    _min?: NestedDateTimeFilter
    _max?: NestedDateTimeFilter
  }

  export type DatetimesCountOrderByAggregateInput = {
    id?: SortOrder
    d?: SortOrder
    t?: SortOrder
  }

  export type DatetimesMaxOrderByAggregateInput = {
    id?: SortOrder
    d?: SortOrder
    t?: SortOrder
  }

  export type DatetimesMinOrderByAggregateInput = {
    id?: SortOrder
    d?: SortOrder
    t?: SortOrder
  }

  export type BoolNullableFilter = {
    equals?: boolean | null
    not?: NestedBoolNullableFilter | boolean | null
  }

  export type BoolsCountOrderByAggregateInput = {
    id?: SortOrder
    b?: SortOrder
  }

  export type BoolsMaxOrderByAggregateInput = {
    id?: SortOrder
    b?: SortOrder
  }

  export type BoolsMinOrderByAggregateInput = {
    id?: SortOrder
    b?: SortOrder
  }

  export type BoolNullableWithAggregatesFilter = {
    equals?: boolean | null
    not?: NestedBoolNullableWithAggregatesFilter | boolean | null
    _count?: NestedIntNullableFilter
    _min?: NestedBoolNullableFilter
    _max?: NestedBoolNullableFilter
  }

  export type UuidFilter = {
    equals?: string
    in?: Enumerable<string> | string
    notIn?: Enumerable<string> | string
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    mode?: QueryMode
    not?: NestedUuidFilter | string
  }

  export type UuidsCountOrderByAggregateInput = {
    id?: SortOrder
  }

  export type UuidsMaxOrderByAggregateInput = {
    id?: SortOrder
  }

  export type UuidsMinOrderByAggregateInput = {
    id?: SortOrder
  }

  export type UuidWithAggregatesFilter = {
    equals?: string
    in?: Enumerable<string> | string
    notIn?: Enumerable<string> | string
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

  export type BigIntNullableFilter = {
    equals?: bigint | number | null
    in?: Enumerable<bigint> | Enumerable<number> | bigint | number | null
    notIn?: Enumerable<bigint> | Enumerable<number> | bigint | number | null
    lt?: bigint | number
    lte?: bigint | number
    gt?: bigint | number
    gte?: bigint | number
    not?: NestedBigIntNullableFilter | bigint | number | null
  }

  export type IntsCountOrderByAggregateInput = {
    id?: SortOrder
    i2?: SortOrder
    i4?: SortOrder
    i8?: SortOrder
  }

  export type IntsAvgOrderByAggregateInput = {
    i2?: SortOrder
    i4?: SortOrder
    i8?: SortOrder
  }

  export type IntsMaxOrderByAggregateInput = {
    id?: SortOrder
    i2?: SortOrder
    i4?: SortOrder
    i8?: SortOrder
  }

  export type IntsMinOrderByAggregateInput = {
    id?: SortOrder
    i2?: SortOrder
    i4?: SortOrder
    i8?: SortOrder
  }

  export type IntsSumOrderByAggregateInput = {
    i2?: SortOrder
    i4?: SortOrder
    i8?: SortOrder
  }

  export type BigIntNullableWithAggregatesFilter = {
    equals?: bigint | number | null
    in?: Enumerable<bigint> | Enumerable<number> | bigint | number | null
    notIn?: Enumerable<bigint> | Enumerable<number> | bigint | number | null
    lt?: bigint | number
    lte?: bigint | number
    gt?: bigint | number
    gte?: bigint | number
    not?: NestedBigIntNullableWithAggregatesFilter | bigint | number | null
    _count?: NestedIntNullableFilter
    _avg?: NestedFloatNullableFilter
    _sum?: NestedBigIntNullableFilter
    _min?: NestedBigIntNullableFilter
    _max?: NestedBigIntNullableFilter
  }

  export type FloatNullableFilter = {
    equals?: number | null
    in?: Enumerable<number> | number | null
    notIn?: Enumerable<number> | number | null
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatNullableFilter | number | null
  }

  export type FloatsCountOrderByAggregateInput = {
    id?: SortOrder
    f8?: SortOrder
  }

  export type FloatsAvgOrderByAggregateInput = {
    f8?: SortOrder
  }

  export type FloatsMaxOrderByAggregateInput = {
    id?: SortOrder
    f8?: SortOrder
  }

  export type FloatsMinOrderByAggregateInput = {
    id?: SortOrder
    f8?: SortOrder
  }

  export type FloatsSumOrderByAggregateInput = {
    f8?: SortOrder
  }

  export type FloatNullableWithAggregatesFilter = {
    equals?: number | null
    in?: Enumerable<number> | number | null
    notIn?: Enumerable<number> | number | null
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatNullableWithAggregatesFilter | number | null
    _count?: NestedIntNullableFilter
    _avg?: NestedFloatNullableFilter
    _sum?: NestedFloatNullableFilter
    _min?: NestedFloatNullableFilter
    _max?: NestedFloatNullableFilter
  }

  export type OtherItemsCreateNestedOneWithoutItemsInput = {
    create?: XOR<OtherItemsCreateWithoutItemsInput, OtherItemsUncheckedCreateWithoutItemsInput>
    connectOrCreate?: OtherItemsCreateOrConnectWithoutItemsInput
    connect?: OtherItemsWhereUniqueInput
  }

  export type OtherItemsUncheckedCreateNestedOneWithoutItemsInput = {
    create?: XOR<OtherItemsCreateWithoutItemsInput, OtherItemsUncheckedCreateWithoutItemsInput>
    connectOrCreate?: OtherItemsCreateOrConnectWithoutItemsInput
    connect?: OtherItemsWhereUniqueInput
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type OtherItemsUpdateOneWithoutItemsNestedInput = {
    create?: XOR<OtherItemsCreateWithoutItemsInput, OtherItemsUncheckedCreateWithoutItemsInput>
    connectOrCreate?: OtherItemsCreateOrConnectWithoutItemsInput
    upsert?: OtherItemsUpsertWithoutItemsInput
    disconnect?: boolean
    delete?: boolean
    connect?: OtherItemsWhereUniqueInput
    update?: XOR<OtherItemsUpdateWithoutItemsInput, OtherItemsUncheckedUpdateWithoutItemsInput>
  }

  export type OtherItemsUncheckedUpdateOneWithoutItemsNestedInput = {
    create?: XOR<OtherItemsCreateWithoutItemsInput, OtherItemsUncheckedCreateWithoutItemsInput>
    connectOrCreate?: OtherItemsCreateOrConnectWithoutItemsInput
    upsert?: OtherItemsUpsertWithoutItemsInput
    disconnect?: boolean
    delete?: boolean
    connect?: OtherItemsWhereUniqueInput
    update?: XOR<OtherItemsUpdateWithoutItemsInput, OtherItemsUncheckedUpdateWithoutItemsInput>
  }

  export type ItemsCreateNestedOneWithoutOther_itemsInput = {
    create?: XOR<ItemsCreateWithoutOther_itemsInput, ItemsUncheckedCreateWithoutOther_itemsInput>
    connectOrCreate?: ItemsCreateOrConnectWithoutOther_itemsInput
    connect?: ItemsWhereUniqueInput
  }

  export type ItemsUpdateOneWithoutOther_itemsNestedInput = {
    create?: XOR<ItemsCreateWithoutOther_itemsInput, ItemsUncheckedCreateWithoutOther_itemsInput>
    connectOrCreate?: ItemsCreateOrConnectWithoutOther_itemsInput
    upsert?: ItemsUpsertWithoutOther_itemsInput
    disconnect?: boolean
    delete?: boolean
    connect?: ItemsWhereUniqueInput
    update?: XOR<ItemsUpdateWithoutOther_itemsInput, ItemsUncheckedUpdateWithoutOther_itemsInput>
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type NullableBoolFieldUpdateOperationsInput = {
    set?: boolean | null
  }

  export type NullableBigIntFieldUpdateOperationsInput = {
    set?: bigint | number | null
    increment?: bigint | number
    decrement?: bigint | number
    multiply?: bigint | number
    divide?: bigint | number
  }

  export type NullableFloatFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NestedStringFilter = {
    equals?: string
    in?: Enumerable<string> | string
    notIn?: Enumerable<string> | string
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    not?: NestedStringFilter | string
  }

  export type NestedStringNullableFilter = {
    equals?: string | null
    in?: Enumerable<string> | string | null
    notIn?: Enumerable<string> | string | null
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    not?: NestedStringNullableFilter | string | null
  }

  export type NestedIntNullableFilter = {
    equals?: number | null
    in?: Enumerable<number> | number | null
    notIn?: Enumerable<number> | number | null
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntNullableFilter | number | null
  }

  export type NestedStringWithAggregatesFilter = {
    equals?: string
    in?: Enumerable<string> | string
    notIn?: Enumerable<string> | string
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

  export type NestedIntFilter = {
    equals?: number
    in?: Enumerable<number> | number
    notIn?: Enumerable<number> | number
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntFilter | number
  }

  export type NestedStringNullableWithAggregatesFilter = {
    equals?: string | null
    in?: Enumerable<string> | string | null
    notIn?: Enumerable<string> | string | null
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

  export type NestedIntNullableWithAggregatesFilter = {
    equals?: number | null
    in?: Enumerable<number> | number | null
    notIn?: Enumerable<number> | number | null
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntNullableWithAggregatesFilter | number | null
    _count?: NestedIntNullableFilter
    _avg?: NestedFloatNullableFilter
    _sum?: NestedIntNullableFilter
    _min?: NestedIntNullableFilter
    _max?: NestedIntNullableFilter
  }

  export type NestedFloatNullableFilter = {
    equals?: number | null
    in?: Enumerable<number> | number | null
    notIn?: Enumerable<number> | number | null
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatNullableFilter | number | null
  }

  export type NestedDateTimeFilter = {
    equals?: Date | string
    in?: Enumerable<Date> | Enumerable<string> | Date | string
    notIn?: Enumerable<Date> | Enumerable<string> | Date | string
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeFilter | Date | string
  }

  export type NestedDateTimeWithAggregatesFilter = {
    equals?: Date | string
    in?: Enumerable<Date> | Enumerable<string> | Date | string
    notIn?: Enumerable<Date> | Enumerable<string> | Date | string
    lt?: Date | string
    lte?: Date | string
    gt?: Date | string
    gte?: Date | string
    not?: NestedDateTimeWithAggregatesFilter | Date | string
    _count?: NestedIntFilter
    _min?: NestedDateTimeFilter
    _max?: NestedDateTimeFilter
  }

  export type NestedBoolNullableFilter = {
    equals?: boolean | null
    not?: NestedBoolNullableFilter | boolean | null
  }

  export type NestedBoolNullableWithAggregatesFilter = {
    equals?: boolean | null
    not?: NestedBoolNullableWithAggregatesFilter | boolean | null
    _count?: NestedIntNullableFilter
    _min?: NestedBoolNullableFilter
    _max?: NestedBoolNullableFilter
  }

  export type NestedUuidFilter = {
    equals?: string
    in?: Enumerable<string> | string
    notIn?: Enumerable<string> | string
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    not?: NestedUuidFilter | string
  }

  export type NestedUuidWithAggregatesFilter = {
    equals?: string
    in?: Enumerable<string> | string
    notIn?: Enumerable<string> | string
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    not?: NestedUuidWithAggregatesFilter | string
    _count?: NestedIntFilter
    _min?: NestedStringFilter
    _max?: NestedStringFilter
  }

  export type NestedBigIntNullableFilter = {
    equals?: bigint | number | null
    in?: Enumerable<bigint> | Enumerable<number> | bigint | number | null
    notIn?: Enumerable<bigint> | Enumerable<number> | bigint | number | null
    lt?: bigint | number
    lte?: bigint | number
    gt?: bigint | number
    gte?: bigint | number
    not?: NestedBigIntNullableFilter | bigint | number | null
  }

  export type NestedBigIntNullableWithAggregatesFilter = {
    equals?: bigint | number | null
    in?: Enumerable<bigint> | Enumerable<number> | bigint | number | null
    notIn?: Enumerable<bigint> | Enumerable<number> | bigint | number | null
    lt?: bigint | number
    lte?: bigint | number
    gt?: bigint | number
    gte?: bigint | number
    not?: NestedBigIntNullableWithAggregatesFilter | bigint | number | null
    _count?: NestedIntNullableFilter
    _avg?: NestedFloatNullableFilter
    _sum?: NestedBigIntNullableFilter
    _min?: NestedBigIntNullableFilter
    _max?: NestedBigIntNullableFilter
  }

  export type NestedFloatNullableWithAggregatesFilter = {
    equals?: number | null
    in?: Enumerable<number> | number | null
    notIn?: Enumerable<number> | number | null
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatNullableWithAggregatesFilter | number | null
    _count?: NestedIntNullableFilter
    _avg?: NestedFloatNullableFilter
    _sum?: NestedFloatNullableFilter
    _min?: NestedFloatNullableFilter
    _max?: NestedFloatNullableFilter
  }

  export type OtherItemsCreateWithoutItemsInput = {
    id: string
    content: string
  }

  export type OtherItemsUncheckedCreateWithoutItemsInput = {
    id: string
    content: string
  }

  export type OtherItemsCreateOrConnectWithoutItemsInput = {
    where: OtherItemsWhereUniqueInput
    create: XOR<OtherItemsCreateWithoutItemsInput, OtherItemsUncheckedCreateWithoutItemsInput>
  }

  export type OtherItemsUpsertWithoutItemsInput = {
    update: XOR<OtherItemsUpdateWithoutItemsInput, OtherItemsUncheckedUpdateWithoutItemsInput>
    create: XOR<OtherItemsCreateWithoutItemsInput, OtherItemsUncheckedCreateWithoutItemsInput>
  }

  export type OtherItemsUpdateWithoutItemsInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
  }

  export type OtherItemsUncheckedUpdateWithoutItemsInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
  }

  export type ItemsCreateWithoutOther_itemsInput = {
    id: string
    content: string
    content_text_null?: string | null
    content_text_null_default?: string | null
    intvalue_null?: number | null
    intvalue_null_default?: number | null
  }

  export type ItemsUncheckedCreateWithoutOther_itemsInput = {
    id: string
    content: string
    content_text_null?: string | null
    content_text_null_default?: string | null
    intvalue_null?: number | null
    intvalue_null_default?: number | null
  }

  export type ItemsCreateOrConnectWithoutOther_itemsInput = {
    where: ItemsWhereUniqueInput
    create: XOR<ItemsCreateWithoutOther_itemsInput, ItemsUncheckedCreateWithoutOther_itemsInput>
  }

  export type ItemsUpsertWithoutOther_itemsInput = {
    update: XOR<ItemsUpdateWithoutOther_itemsInput, ItemsUncheckedUpdateWithoutOther_itemsInput>
    create: XOR<ItemsCreateWithoutOther_itemsInput, ItemsUncheckedCreateWithoutOther_itemsInput>
  }

  export type ItemsUpdateWithoutOther_itemsInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    content_text_null?: NullableStringFieldUpdateOperationsInput | string | null
    content_text_null_default?: NullableStringFieldUpdateOperationsInput | string | null
    intvalue_null?: NullableIntFieldUpdateOperationsInput | number | null
    intvalue_null_default?: NullableIntFieldUpdateOperationsInput | number | null
  }

  export type ItemsUncheckedUpdateWithoutOther_itemsInput = {
    id?: StringFieldUpdateOperationsInput | string
    content?: StringFieldUpdateOperationsInput | string
    content_text_null?: NullableStringFieldUpdateOperationsInput | string | null
    content_text_null_default?: NullableStringFieldUpdateOperationsInput | string | null
    intvalue_null?: NullableIntFieldUpdateOperationsInput | number | null
    intvalue_null_default?: NullableIntFieldUpdateOperationsInput | number | null
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