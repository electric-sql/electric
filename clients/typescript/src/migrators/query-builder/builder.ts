import { ForeignKey } from '../triggers'
import { QualifiedTablename, Row, SqlValue, Statement } from '../../util'

export type Dialect = 'SQLite' | 'Postgres'
export abstract class QueryBuilder {
  abstract readonly dialect: Dialect
  abstract readonly paramSign: '?' | '$'
  abstract readonly defaultNamespace: 'main' | 'public'

  /**
   * The autoincrementing integer primary key type for the current SQL dialect.
   */
  abstract readonly AUTOINCREMENT_PK: string

  /**
   * The type to use for BLOB for the current SQL dialect.
   */
  abstract readonly BLOB: string

  /**
   * Queries the version of SQLite/Postgres we are using.
   */
  abstract readonly getVersion: string

  /**
   * Depending on the dialect, defers or disables foreign key checks for the duration of the transaction.
   */
  abstract readonly deferOrDisableFKsForTx: string

  /**
   * Returns the given query if the current SQL dialect is PostgreSQL.
   */
  abstract pgOnly(query: string): string

  /**
   * Returns the given query if the current SQL dialect is SQLite.
   */
  abstract sqliteOnly(query: string): string

  /**
   * Makes the i-th positional parameter,
   * e.g. '$3' For Postgres when `i` is 3
   *      and always '?' for SQLite
   */
  abstract makePositionalParam(i: number): string

  /**
   * Checks if the given table exists.
   */
  abstract tableExists(table: QualifiedTablename): Statement

  /**
   * Counts tables whose name is included in `tableNames`.
   */
  abstract countTablesIn(tableNames: string[]): Statement

  /**
   * Converts a column value to a hexidecimal string.
   */
  abstract toHex(column: string): string

  /**
   * Converts a hexidecimal string to a hex value.
   */
  abstract hexValue(hexString: string): string

  /**
   * Create an index on a table.
   */
  abstract createIndex(
    indexName: string,
    onTable: QualifiedTablename,
    columns: string[]
  ): string

  /**
   * Fetches the names of all tables that are not in `notIn`.
   */
  abstract getLocalTableNames(notIn?: string[]): Statement

  /**
   * Fetches information about the columns of a table.
   * The information includes all column names, their type,
   * whether or not they are nullable, and whether they are part of the PK.
   */
  abstract getTableInfo(table: QualifiedTablename): Statement

  /**
   * Insert a row into a table, ignoring it if it already exists.
   */
  abstract insertOrIgnore(
    table: QualifiedTablename,
    columns: string[],
    values: SqlValue[]
  ): Statement

  /**
   * Insert a row into a table, replacing it if it already exists.
   */
  abstract insertOrReplace(
    table: QualifiedTablename,
    columns: string[],
    values: Array<SqlValue>,
    conflictCols: string[],
    updateCols: string[]
  ): Statement

  /**
   * Insert a row into a table.
   * If it already exists we update the provided columns `updateCols`
   * with the provided values `updateVals`
   */
  abstract insertOrReplaceWith(
    table: QualifiedTablename,
    columns: string[],
    values: Array<SqlValue>,
    conflictCols: string[],
    updateCols: string[],
    updateVals: SqlValue[]
  ): Statement

  /**
   * Inserts a batch of rows into a table, replacing them if they already exist.
   */
  abstract batchedInsertOrReplace(
    table: QualifiedTablename,
    columns: string[],
    records: Array<Record<string, SqlValue>>,
    conflictCols: string[],
    updateCols: string[],
    maxSqlParameters: number
  ): Statement[]

  /**
   * Drop a trigger if it exists.
   */
  abstract dropTriggerIfExists(
    triggerName: string,
    table: QualifiedTablename
  ): string

  /**
   * Create a trigger that prevents updates to the primary key.
   */
  abstract createNoFkUpdateTrigger(
    table: QualifiedTablename,
    pk: string[]
  ): string[]

  /**
   * Creates or replaces a trigger that prevents updates to the primary key.
   */
  createOrReplaceNoFkUpdateTrigger(
    table: QualifiedTablename,
    pk: string[]
  ): string[] {
    return [
      this.dropTriggerIfExists(
        `update_ensure_${table.namespace}_${table.tablename}_primarykey`,
        table
      ),
      ...this.createNoFkUpdateTrigger(table, pk),
    ]
  }

  /**
   * Modifies the trigger setting for the table identified by its tablename and namespace.
   */
  abstract setTriggerSetting(table: QualifiedTablename, value: 0 | 1): string

  /**
   * Create a trigger that logs operations into the oplog.
   */
  abstract createOplogTrigger(
    opType: 'INSERT' | 'UPDATE' | 'DELETE',
    table: QualifiedTablename,
    newPKs: string,
    newRows: string,
    oldRows: string
  ): string[]

  createOrReplaceOplogTrigger(
    opType: 'INSERT' | 'UPDATE' | 'DELETE',
    table: QualifiedTablename,
    newPKs: string,
    newRows: string,
    oldRows: string
  ): string[] {
    return [
      this.dropTriggerIfExists(
        `${opType.toLowerCase()}_${table.namespace}_${
          table.tablename
        }_into_oplog`,
        table
      ),
      ...this.createOplogTrigger(opType, table, newPKs, newRows, oldRows),
    ]
  }

  /**
   * Creates or replaces a trigger that logs insertions into the oplog.
   */
  createOrReplaceInsertTrigger = this.createOrReplaceOplogTrigger.bind(
    this,
    'INSERT'
  )

  /**
   * Creates or replaces a trigger that logs updates into the oplog.
   */
  createOrReplaceUpdateTrigger = this.createOrReplaceOplogTrigger.bind(
    this,
    'UPDATE'
  )

  /**
   * Creates or replaces a trigger that logs deletions into the oplog.
   */
  createOrReplaceDeleteTrigger = this.createOrReplaceOplogTrigger.bind(
    this,
    'DELETE'
  )

  /**
   * Creates a trigger that logs compensations for operations into the oplog.
   */
  abstract createFkCompensationTrigger(
    opType: 'INSERT' | 'UPDATE',
    table: QualifiedTablename,
    childKey: string,
    fkTable: QualifiedTablename,
    joinedFkPKs: string,
    foreignKey: ForeignKey
  ): string[]

  createOrReplaceFkCompensationTrigger(
    opType: 'INSERT' | 'UPDATE',
    table: QualifiedTablename,
    childKey: string,
    fkTable: QualifiedTablename,
    joinedFkPKs: string,
    foreignKey: ForeignKey
  ): string[] {
    return [
      this.dropTriggerIfExists(
        `compensation_${opType.toLowerCase()}_${table.namespace}_${
          table.tablename
        }_${childKey}_into_oplog`,
        table
      ),
      ...this.createFkCompensationTrigger(
        opType,
        table,
        childKey,
        fkTable,
        joinedFkPKs,
        foreignKey
      ),
    ]
  }

  /**
   * Creates a trigger that logs compensations for insertions into the oplog.
   */
  createOrReplaceInsertCompensationTrigger =
    this.createOrReplaceFkCompensationTrigger.bind(this, 'INSERT')

  /**
   * Creates a trigger that logs compensations for updates into the oplog.
   */
  createOrReplaceUpdateCompensationTrigger =
    this.createOrReplaceFkCompensationTrigger.bind(this, 'UPDATE')

  /**
   * For each affected shadow row, set new tag array, unless the last oplog operation was a DELETE
   */
  abstract setTagsForShadowRows(
    oplogTable: QualifiedTablename,
    shadowTable: QualifiedTablename
  ): string

  /**
   * Deletes any shadow rows where the last oplog operation was a `DELETE`
   */
  abstract removeDeletedShadowRows(
    oplogTable: QualifiedTablename,
    shadowTable: QualifiedTablename
  ): string

  /**
   * Generates IN clause for a WHERE statement, checking that the given
   * columns have a value present in the given tupleArgs array
   */
  protected abstract createInClause(
    columns: string[],
    args: (string | string[])[]
  ): string

  /**
   * Prepare multiple batched insert statements for an array of records.
   *
   * Since SQLite only supports a limited amount of positional `?` parameters,
   * we generate multiple insert statements with each one being filled as much
   * as possible from the given data. All statements are derived from same `baseSql` -
   * the positional parameters will be appended to this string.
   *
   * @param baseSql base SQL string to which inserts should be appended
   * @param columns columns that describe records
   * @param records records to be inserted
   * @param maxParameters max parameters this SQLite can accept - determines batching factor
   * @param suffixSql optional SQL string to append to each insert statement
   * @returns array of statements ready to be executed by the adapter
   */
  prepareInsertBatchedStatements<T extends Row>(
    baseSql: string,
    columns: Extract<keyof T, string>[],
    records: Row[],
    maxParameters: number,
    suffixSql = ''
  ): Statement[] {
    const stmts: Statement[] = []
    const columnCount = columns.length
    const recordCount = records.length
    // Amount of rows we can insert at once
    const batchMaxSize = Math.floor(maxParameters / columnCount)

    // keep a temporary join array for joining strings, to avoid
    // the overhead of generating a new array every time
    const tempColJoinArray = Array.from({ length: columnCount })

    let processed = 0
    let prevInsertCount = -1
    let insertPattern = ''
    while (processed < recordCount) {
      const currentInsertCount = Math.min(recordCount - processed, batchMaxSize)

      // cache insert pattern as it is going to be the same for every batch
      // of `batchMaxSize` - ideally we can externalize this cache since for a
      // given adapter this is _always_ going to be the same
      if (currentInsertCount !== prevInsertCount) {
        insertPattern = Array.from(
          { length: currentInsertCount },
          (_, recordIdx) => {
            for (let i = 0; i < columnCount; i++) {
              tempColJoinArray[i] = this.makePositionalParam(
                recordIdx * columnCount + i + 1
              )
            }
            return ` (${tempColJoinArray.join(', ')})`
          }
        ).join(',')
      }

      let sql = baseSql + insertPattern

      if (suffixSql !== '') {
        sql += ' ' + suffixSql
      }

      const args = []
      for (let i = 0; i < currentInsertCount; i++) {
        for (let j = 0; j < columnCount; j++) {
          args.push(records[processed + i][columns[j]] as SqlValue)
        }
      }

      processed += currentInsertCount
      prevInsertCount = currentInsertCount
      stmts.push({ sql, args })
    }
    return stmts
  }

  /**
   * Prepare multiple batched DELETE statements for an array of records.
   *
   * Since SQLite only supports a limited amount of positional `?` parameters,
   * we generate multiple delete statements with each one being filled as much
   * as possible from the given data. This function only supports column equality checks
   *
   * @param baseSql base SQL string to which inserts should be appended
   * @param columns columns that describe records
   * @param records records to be inserted
   * @param maxParameters max parameters this SQLite can accept - determines batching factor
   * @param suffixSql optional SQL string to append to each insert statement
   * @returns array of statements ready to be executed by the adapter
   */
  public prepareDeleteBatchedStatements<T extends Row>(
    baseSql: string,
    columns: Extract<keyof T, string>[],
    records: T[],
    maxParameters: number,
    suffixSql = ''
  ): Statement[] {
    const stmts: Statement[] = []
    const columnCount = columns.length
    const recordCount = records.length
    const isSingleColumnQuery = columnCount === 1
    // Amount of rows we can delete at once
    const batchMaxSize = Math.floor(maxParameters / columnCount)

    let processed = 0
    let prevDeleteCount = -1
    let deletePattern = ''
    while (processed < recordCount) {
      const currentDeleteCount = Math.min(recordCount - processed, batchMaxSize)

      // cache delete pattern as it is going to be the same for every batch
      // of `batchMaxSize` - ideally we can externalize this cache since for a
      // given adapter this is _always_ going to be the same
      if (currentDeleteCount !== prevDeleteCount) {
        deletePattern =
          ' ' +
          this.createInClause(
            columns,
            Array.from({ length: currentDeleteCount }, (_, recordIdx) =>
              isSingleColumnQuery
                ? this.makePositionalParam(recordIdx + 1)
                : Array.from({ length: columnCount }, (_, colIdx) =>
                    this.makePositionalParam(
                      recordIdx * columnCount + colIdx + 1
                    )
                  )
            )
          )
      }
      let sql = baseSql + deletePattern

      if (suffixSql !== '') {
        sql += ' ' + suffixSql
      }

      const args = []
      for (let i = 0; i < currentDeleteCount; i++) {
        for (let j = 0; j < columnCount; j++) {
          args.push(records[processed + i][columns[j]] as SqlValue)
        }
      }

      processed += currentDeleteCount
      prevDeleteCount = currentDeleteCount
      stmts.push({ sql, args })
    }
    return stmts
  }

  public makeQT(tablename: string): QualifiedTablename {
    return new QualifiedTablename(this.defaultNamespace, tablename)
  }
}
