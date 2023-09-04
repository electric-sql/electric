import { Satellite, ShapeSubscription } from '../../satellite'

export type TableName = string

export type Shape = {
  tables: TableName[]
}

export interface IShapeManager {
  sync(shape: Shape): Promise<ShapeSubscription>
  hasBeenSubscribed(table: TableName): boolean
}

abstract class BaseShapeManager implements IShapeManager {
  protected tablesPreviouslySubscribed: Set<TableName>

  constructor() {
    this.tablesPreviouslySubscribed = new Set()
  }

  abstract sync(shape: Shape): Promise<ShapeSubscription>
  public hasBeenSubscribed(table: TableName): boolean {
    return this.tablesPreviouslySubscribed.has(table)
  }
}

export class ShapeManager extends BaseShapeManager {
  protected satellite: Satellite

  constructor(satellite: Satellite) {
    super()
    this.satellite = satellite
  }

  async sync(shape: Shape): Promise<ShapeSubscription> {
    // Convert the shape to the format expected by the Satellite process
    const shapeDef = {
      selects: shape.tables.map((tbl) => ({ tablename: tbl })),
    }

    const sub = await this.satellite.subscribe([shapeDef])

    const dataReceivedProm = sub.synced.then(() => {
      // When all data is received
      // we store the fact that these tables are synced
      shape.tables.forEach((tbl) => this.tablesPreviouslySubscribed.add(tbl))
    })

    return {
      synced: dataReceivedProm,
    }
  }

  hasBeenSubscribed(table: TableName): boolean {
    return this.tablesPreviouslySubscribed.has(table)
  }
}

export class ShapeManagerMock extends BaseShapeManager {
  constructor() {
    super()
  }

  override async sync(shape: Shape): Promise<ShapeSubscription> {
    // Do not contact the server but directly store the synced tables
    shape.tables.forEach((tbl) => this.tablesPreviouslySubscribed.add(tbl))

    return {
      synced: Promise.resolve(),
    }
  }
}
