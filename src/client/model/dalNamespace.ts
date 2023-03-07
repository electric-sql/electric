import { ZObject } from '../validation/schemas'
import { ElectricNamespace } from '../../electric/namespace'
import { DatabaseAdapter } from '../../electric/adapter'
import { Notifier } from '../../notifiers'
import { Table } from './table'

export type TableName = string
export type DbSchemas = Record<TableName, any>

export type Schema<T> = ZObject<T>

// Fetches the object type out of the schema
// e.g. GetObjectTypeFromSchema<Schema<A>> = A
type GetObjectTypeFromSchema<T> = T extends Schema<infer O> // bind the type of the object for which this is a schema
  ? O
  : never

// Maps the schemas in T to tables
// For an object of type { a: Schema<A>, b: Schema<B>, ... }
// this will map the type to: { a: Table<A>, b: Table<B>, ... }
export type DalTables<T extends Record<TableName, Schema<any>>> = {
  [Tbl in keyof T]: Table<GetObjectTypeFromSchema<T[Tbl]>>
}

// Extends the ElectricNamespace with a `dal` property containing the tables of the DAL
export class DalNamespace<T extends DbSchemas> extends ElectricNamespace {
  private constructor(
    public dal: DalTables<T>,
    adapter: DatabaseAdapter,
    notifier: Notifier
  ) {
    super(adapter, notifier)
  }

  // Builds a DAL namespace from a `schemas` object containing the schema of every DB table and the electric namespace
  // TODO: we want to say that S extends Record<TableName, Schema<any>>
  //       but this is not possible because concrete schemas aren't subtypes of Schema<any> ...
  static create<S extends DbSchemas>(
    schemas: S,
    electric: ElectricNamespace
  ): DalNamespace<S> {
    const tables: Array<[keyof S, Table<any>]> = Object.keys(schemas).map(
      (tableName) => {
        const schema = schemas[tableName]
        return [
          tableName,
          new Table(tableName, schema, electric.adapter, electric.notifier),
        ]
      }
    )

    const dal = tables.reduce((ns, [tableName, tbl]) => {
      ns[tableName] = tbl as any
      return ns
    }, {} as Partial<DalTables<S>>) as DalTables<S>

    return new DalNamespace(dal, electric.adapter, electric.notifier)
  }
}
