import { Satellite, ShapeSubscription } from '../../satellite'
import { Shape } from '../../satellite/shapes/types'

export type TableName = string

export type SyncStatus =
  | {
      status: 'exchanging'
      oldServerId: string | undefined
      newServerId: string | undefined
    }
  | {
      status: 'requested'
      serverId: string
    }
  | {
      status: 'finishing_exchange'
      serverId: string
    }
  | {
      status: 'active'
      serverId: string
    }
  | undefined

export interface IShapeManager2 {
  subscribe(shapes: Shape[], key?: string): Promise<ShapeSubscription>
  unsubscribe(keys: string[]): Promise<void>
  syncStatus(key: string): SyncStatus
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
    const sub = await this.satellite.subscribe([shape])
    const tables = getTableNames(shape)
    const dataReceivedProm = sub.synced.then(() => {
      // When all data is received
      // we store the fact that these tables are synced
      tables.forEach((tbl) => this.tablesPreviouslySubscribed.add(tbl))
    })

    return {
      key: sub.key,
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
    getTableNames(shape).forEach((tbl) =>
      this.tablesPreviouslySubscribed.add(tbl)
    )

    return {
      key: 'unknown',
      synced: Promise.resolve(),
    }
  }
}

function getTableNames(shape: Shape): Array<TableName> {
  return [
    shape.tablename,
    ...(shape.include ?? []).flatMap((rel) => getTableNames(rel.select)),
  ]
}
