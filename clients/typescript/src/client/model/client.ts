import { ElectricNamespace } from '../../electric/namespace'
import { DatabaseAdapter } from '../../electric/adapter'
import { Notifier } from '../../notifiers'
import { DbSchema, TableSchema } from './schema'
import { Table } from './table'

export type ClientTables<DB extends DbSchema<any>> = {
  [Tbl in keyof DB['tables']]: DB['tables'][Tbl] extends TableSchema<
    infer T,
    infer CreateData,
    infer UpdateData,
    infer Select,
    infer Where,
    infer WhereUnique,
    infer Include,
    infer OrderBy,
    infer ScalarFieldEnum,
    infer GetPayload
  >
    ? Table<
        T,
        CreateData,
        UpdateData,
        Select,
        Where,
        WhereUnique,
        Include,
        OrderBy,
        ScalarFieldEnum,
        GetPayload
      >
    : never
}

// Electric client
// Extends the ElectricNamespace with a `db` property
// providing the data access library for each DB table
export class ElectricClient<
  DB extends DbSchema<any>
> extends ElectricNamespace {
  private constructor(
    public db: ClientTables<DB>,
    adapter: DatabaseAdapter,
    notifier: Notifier
  ) {
    super(adapter, notifier)
  }

  // Builds the DAL namespace from a `dbDescription` object
  static create<DB extends DbSchema<any>>(
    dbDescription: DB,
    electric: ElectricNamespace
  ): ElectricClient<DB> {
    const tables = dbDescription.extendedTables
    const createTable = (tableName: string) => {
      return new Table(
        tableName,
        electric.adapter,
        electric.notifier,
        dbDescription
      )
    }

    // Create all tables
    const dal = Object.fromEntries(
      Object.keys(tables).map((tableName) => {
        return [tableName, createTable(tableName)]
      })
    ) as ClientTables<DB>

    // Now inform each table about all tables
    Object.keys(dal).forEach((tableName) => {
      dal[tableName].setTables(new Map(Object.entries(dal)))
    })

    return new ElectricClient(dal, electric.adapter, electric.notifier)
  }
}
