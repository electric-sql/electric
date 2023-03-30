import { ElectricNamespace } from '../../electric/namespace'
import { DatabaseAdapter } from '../../electric/adapter'
import { Notifier } from '../../notifiers'
import { DBDescription, TableDescription } from './dbDescription'
import { Table } from './table'

export type DalTables<DB extends DBDescription<any>> = {
  [Tbl in keyof DB['tables']]: DB['tables'][Tbl] extends TableDescription<
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

// Extends the ElectricNamespace with a `db` property that is the client of the data access library
export class DalNamespace<
  DB extends DBDescription<any>
> extends ElectricNamespace {
  private constructor(
    public db: DalTables<DB>,
    adapter: DatabaseAdapter,
    notifier: Notifier
  ) {
    super(adapter, notifier)
  }

  // Builds the DAL namespace from a `dbDescription` object
  static create<DB extends DBDescription<any>>(
    dbDescription: DB,
    electric: ElectricNamespace
  ): DalNamespace<DB> {
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
    ) as DalTables<DB>

    // Now inform each table about all tables
    Object.keys(dal).forEach((tableName) => {
      dal[tableName].setTables(new Map(Object.entries(dal)))
    })

    return new DalNamespace(dal, electric.adapter, electric.notifier)
  }
}
