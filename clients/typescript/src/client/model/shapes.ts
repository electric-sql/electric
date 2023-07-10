import { Satellite, Sub } from '../../satellite'

export type TableName = string

export type Shape = {
  tables: TableName[]
}

interface IShapeManager {
  init(satellite: Satellite): void
  sync(shape: Shape): Promise<Sub>
  isSynced(table: TableName): boolean
}

export class ShapeManager implements IShapeManager {
  protected syncedTables: Set<TableName>
  protected satellite?: Satellite

  constructor() {
    this.syncedTables = new Set()
  }

  init(satellite: Satellite) {
    this.satellite = satellite
  }

  async sync(shape: Shape): Promise<Sub> {
    if (this.satellite === undefined)
      throw new Error(
        'Shape cannot be synced because the `ShapeManager` is not yet initialised.'
      )

    // Convert the shape to the format expected by the Satellite process
    const shapeDef = {
      selects: shape.tables.map((tbl) => {
        return {
          tablename: tbl,
        }
      }),
    }

    const sub = await this.satellite.subscribe([shapeDef])

    const dataReceivedProm = sub.dataReceived.then(() => {
      // When all data is received
      // we store the fact that these tables are synced
      shape.tables.forEach((tbl) => this.syncedTables.add(tbl))
    })

    return {
      dataReceived: dataReceivedProm,
    }
  }

  isSynced(table: TableName): boolean {
    return this.syncedTables.has(table)
  }
}

export class ShapeManagerMock extends ShapeManager {
  constructor() {
    super()
  }

  override async sync(shape: Shape): Promise<Sub> {
    // Do not contact the server but directly store the synced tables
    shape.tables.forEach((tbl) => this.syncedTables.add(tbl))

    return {
      dataReceived: Promise.resolve(),
    }
  }
}

// a shape manager singleton
export const shapeManager = new ShapeManager()
