import { Satellite } from '../../satellite'

export type TableName = string

export type Shape = {
  tables: TableName[]
}

interface IShapeManager {
  init(satellite: Satellite): void
  sync(shape: Shape): Promise<void>
  isSynced(table: TableName): boolean
}

class ShapeManager implements IShapeManager {
  protected syncedTables: Set<TableName>
  protected satellite?: Satellite

  constructor() {
    this.syncedTables = new Set()
  }

  init(satellite: Satellite) {
    this.satellite = satellite
  }

  async sync(shape: Shape): Promise<void> {
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
    await this.satellite.subscribe([shapeDef])

    // Now that the subscription is active we can store the synced tables
    shape.tables.forEach(this.syncedTables.add)
  }

  isSynced(table: TableName): boolean {
    return this.syncedTables.has(table)
  }
}

export class ShapeManagerMock extends ShapeManager {
  constructor() {
    super()
  }

  override async sync(shape: Shape): Promise<void> {
    // Do not contact the server but directly store the synced tables
    shape.tables.forEach((tbl) => this.syncedTables.add(tbl))
    // method returns and promise will resolve
    // as if the server acknowledged the subscription
  }
}

// a shape manager singleton
export const shapeManager = new ShapeManager()
