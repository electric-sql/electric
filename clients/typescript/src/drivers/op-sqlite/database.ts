import { OPSQLiteConnection } from '@op-engineering/op-sqlite'
import { DbName } from '../../util'

type OriginalDatabase = OPSQLiteConnection

export interface Database
  extends Pick<OriginalDatabase, 'executeAsync' | 'executeBatchAsync'> {
  dbName: DbName
}
