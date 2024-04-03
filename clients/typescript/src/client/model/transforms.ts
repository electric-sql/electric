import { Satellite } from '../../satellite'
import { Record } from '../../util'

export interface IReplicationTransformManager {
  setTableTransform(
    tableName: string,
    transformInbound: (row: Record) => Record,
    transformOtbound: (row: Record) => Record
  ): void
  clearTableTransform(tableName: string): void
}

export class ReplicationTransformManager
  implements IReplicationTransformManager
{
  constructor(private satellite: Satellite) {}

  setTableTransform(
    tableName: string,
    transformInbound: (row: Record) => Record,
    transformOtbound: (row: Record) => Record
  ): void {
    this.satellite.setReplicationTransform(
      tableName,
      transformInbound,
      transformOtbound
    )
  }

  clearTableTransform(tableName: string): void {
    this.satellite.clearReplicationTransform(tableName)
  }
}
