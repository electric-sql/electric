type SqlValue =
  | string
  | number
  | null
  | bigint
  | Uint8Array
  | Int8Array
  | ArrayBuffer

export type ParamsType = SqlValue[] | [{ [key: string]: SqlValue }?]
export type ResultType = { [column: string]: SqlValue }

export type ArgsType<Params extends ParamsType> = Params extends SqlValue[]
  ? SqlValue[]
  : [{ [key: string]: SqlValue }]

export type SqliteWrapper = {
  /**
   * Execute raw SQL
   */
  exec<
    T extends { [column: string]: SqlValue } = { [column: string]: SqlValue },
  >(
    sql: string
  ): Promise<T | undefined>

  /**
   * Prepare a statement
   */
  prepare<P extends ParamsType>(sql: string): SQLiteStatement<P>

  /**
   * Execute a function within a transaction
   * The transaction will be committed if the function resolves without error
   * The transaction will be rolled back if the function throws an error
   */
  transaction<T = ResultType>(fn: (db: SqliteWrapper) => Promise<T>): Promise<T>

  close: () => void

  // acquire(): Promise<void>

  // release(): void
}

export type SQLiteStatement<Params extends ParamsType> = {
  /**
   * Run the prepared statement with parameters
   * Accepts either an array of parameters or an object of named parameters
   */
  run(
    ...params: Params extends SqlValue[]
      ? SqlValue[]
      : [{ [key: string]: SqlValue }]
  ): Promise<void>

  /**
   * Get a single row from the prepared statement
   * Accepts either an array of parameters or an object of named parameters
   */
  get<Result extends ResultType = ResultType>(
    ...params: ArgsType<Params>
  ): Promise<Result | undefined>

  /**
   * Get all rows from the prepared statement
   * Accepts either an array of parameters or an object of named parameters
   */
  all<Result extends ResultType>(...params: ArgsType<Params>): Promise<Result[]>

  /**
   * Finalize the prepared statement
   */
  finalize: () => number | undefined
}
