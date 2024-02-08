import { ForeignKey } from '../triggers'
import { QualifiedTablename } from '../../util'

export abstract class QueryBuilder {
  /**
   * The autoincrementing integer primary key type for the current SQL dialect.
   */
  abstract readonly AUTOINCREMENT_PK: string

  /**
   * The type to use for BLOB for the current SQL dialect.
   */
  abstract readonly BLOB: string

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
   * Create an index on a table.
   */
  abstract createIndex(
    indexName: string,
    onTable: QualifiedTablename,
    columns: string[]
  ): string

  /**
   * Insert a row into a table, ignoring it if it already exists.
   */
  abstract insertOrIgnore(
    schema: string,
    table: string,
    columns: string[],
    values: string[]
  ): string

  /**
   * Drop a trigger if it exists.
   */
  abstract dropTriggerIfExists(
    triggerName: string,
    namespace: string,
    tablename: string
  ): string

  /**
   * Create a trigger that prevents updates to the primary key.
   */
  abstract createNoFkUpdateTrigger(
    namespace: string,
    tablename: string,
    pk: string[]
  ): string[]

  /**
   * Creates or replaces a trigger that prevents updates to the primary key.
   */
  createOrReplaceNoFkUpdateTrigger(
    namespace: string,
    tablename: string,
    pk: string[]
  ): string[] {
    return [
      this.dropTriggerIfExists(
        `update_ensure_${namespace}_${tablename}_primarykey`,
        namespace,
        tablename
      ),
      ...this.createNoFkUpdateTrigger(namespace, tablename, pk),
    ]
  }

  /**
   * Create a trigger that logs operations into the oplog.
   */
  abstract createOplogTrigger(
    opType: 'INSERT' | 'UPDATE' | 'DELETE',
    namespace: string,
    tableName: string,
    newPKs: string,
    newRows: string,
    oldRows: string
  ): string[]

  createOrReplaceOplogTrigger(
    opType: 'INSERT' | 'UPDATE' | 'DELETE',
    namespace: string,
    tableName: string,
    newPKs: string,
    newRows: string,
    oldRows: string
  ): string[] {
    return [
      this.dropTriggerIfExists(
        `${opType.toLowerCase()}_${namespace}_${tableName}_into_oplog`,
        namespace,
        tableName
      ),
      ...this.createOplogTrigger(
        opType,
        namespace,
        tableName,
        newPKs,
        newRows,
        oldRows
      ),
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
    namespace: string,
    tableName: string,
    childKey: string,
    fkTableNamespace: string,
    fkTableName: string,
    joinedFkPKs: string,
    foreignKey: ForeignKey
  ): string[]

  createOrReplaceFkCompensationTrigger(
    opType: 'INSERT' | 'UPDATE',
    namespace: string,
    tableName: string,
    childKey: string,
    fkTableNamespace: string,
    fkTableName: string,
    joinedFkPKs: string,
    foreignKey: ForeignKey
  ): string[] {
    return [
      this.dropTriggerIfExists(
        `compensation_${opType.toLowerCase()}_${namespace}_${tableName}_${childKey}_into_oplog`,
        namespace,
        tableName
      ),
      ...this.createFkCompensationTrigger(
        opType,
        namespace,
        tableName,
        childKey,
        fkTableNamespace,
        fkTableName,
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
}
