import { ForeignKey } from '../triggers'
import { QualifiedTablename, SqlValue, Statement } from '../../util'

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
   * Defers foreign key checks for the current transaction.
   */
  abstract readonly deferForeignKeys: string

  /**
   * Queries the version of SQLite/Postgres we are using.
   */
  abstract readonly getVersion: string

  /**
   * Disables foreign key checks.
   */
  abstract readonly disableForeignKeys: string

  /**
   * Returns the given query if the current SQL dialect is PostgreSQL.
   */
  abstract pgOnly(query: string): string

  /**
   * Returns an array containing the given query if the current SQL dialect is PostgreSQL.
   */
  abstract pgOnlyQuery(query: string): string[]

  /**
   * Returns the given query if the current SQL dialect is SQLite.
   */
  abstract sqliteOnly(query: string): string

  /**
   * Returns an array containing the given query if the current SQL dialect is SQLite.
   */
  abstract sqliteOnlyQuery(query: string): string[]

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
   * Counts tables whose name is included in `tables`.
   * The count is returned as `countName`.
   */
  abstract countTablesIn(countName: string, tables: string[]): Statement

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
  prepareInsertBatchedStatements(
    baseSql: string,
    columns: string[],
    records: Record<string, SqlValue>[],
    maxParameters: number,
    suffixSql = ''
  ): Statement[] {
    const stmts: Statement[] = []
    const columnCount = columns.length
    const recordCount = records.length
    let processed = 0
    let positionalParam = 1
    const pos = (i: number) => `${this.makePositionalParam(i)}`
    const makeInsertPattern = () => {
      return ` (${Array.from(
        { length: columnCount },
        () => `${pos(positionalParam++)}`
      ).join(', ')})`
    }

    // Largest number below maxSqlParamers that evenly divides by column count,
    // divided by columnCount, giving the amount of rows we can insert at once
    const batchMaxSize =
      (maxParameters - (maxParameters % columnCount)) / columnCount
    while (processed < recordCount) {
      positionalParam = 1 // start counting parameters from 1 again
      const currentInsertCount = Math.min(recordCount - processed, batchMaxSize)
      let sql =
        baseSql +
        Array.from({ length: currentInsertCount }, makeInsertPattern).join(',')

      if (suffixSql !== '') {
        sql += ' ' + suffixSql
      }

      const args = records
        .slice(processed, processed + currentInsertCount)
        .flatMap((record) => columns.map((col) => record[col] as SqlValue))

      processed += currentInsertCount
      stmts.push({ sql, args })
    }
    return stmts
  }
}
