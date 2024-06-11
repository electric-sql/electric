import { DbSchema, TableName, TableSchemas } from './schema'
import { IShapeManager } from './shapes'
import { ShapeSubscription } from '../../satellite'
import { Rel, Shape } from '../../satellite/shapes/types'
import { DbSchema as DatabaseSchema } from '../util/relations'
import { makeSqlWhereClause } from './table'

type ShapeInput = Record<string, any>

export type ShapeInputWithTable = ShapeInput & {
  table: TableName
}

export function sync(
  shapeManager: IShapeManager,
  dbDescription: DatabaseSchema,
  i: ShapeInputWithTable,
  key?: string
): Promise<ShapeSubscription> {
  // Check which table the user wants to sync
  const tableName = i.table

  if (
    tableName === undefined ||
    tableName === null ||
    tableName === '' ||
    typeof tableName !== 'string'
  ) {
    throw new Error(
      'Cannot sync the requested shape. Table name must be a non-empty string'
    )
  }

  // Remove the table name from the input
  const input: ShapeInput = i
  delete input.table

  // Compute the shape from the user input
  // FIXME: remove type cast below when we remove the DAL
  //        `dbDescription` is missing the Zod schemas but they are not used in this sync API
  const schema = new DbSchema(dbDescription as unknown as TableSchemas, [], [])
  const shape = computeShape(schema, tableName, i)
  return shapeManager.subscribe([shape], key)
}

function computeShape(
  dbSchema: DbSchema<TableSchemas>,
  tableName: TableName,
  i: ShapeInput
): Shape {
  // Recursively go over the included fields
  const include = i.include ?? {}
  const where = i.where ?? ''
  const includedFields = Object.keys(include)
  const includedTables = includedFields.map((field: string): Rel => {
    // Fetch the table that is included
    const relatedTableName = dbSchema.getRelatedTable(tableName, field)
    const fkk = dbSchema.getForeignKey(tableName, field)

    // And follow nested includes
    const includedObj = (include as any)[field]
    if (
      typeof includedObj === 'object' &&
      !Array.isArray(includedObj) &&
      includedObj !== null
    ) {
      // There is a nested include, follow it
      return {
        foreignKey: [fkk],
        select: computeShape(dbSchema, relatedTableName, includedObj),
      }
    } else if (typeof includedObj === 'boolean' && includedObj) {
      return {
        foreignKey: [fkk],
        select: {
          tablename: relatedTableName,
        },
      }
    } else {
      throw new Error(
        `Unexpected value in include tree for sync: ${JSON.stringify(
          includedObj
        )}`
      )
    }
  })

  const whereClause = makeSqlWhereClause(where)
  return {
    tablename: tableName,
    include: includedTables,
    ...(whereClause === '' ? {} : { where: whereClause }),
  }
}
