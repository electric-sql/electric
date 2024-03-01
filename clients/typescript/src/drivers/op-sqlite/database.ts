import { OPSQLiteConnection } from '@op-engineering/op-sqlite'
import { DbName } from '../../util'

export interface Database
  extends Pick<OPSQLiteConnection, 'executeAsync' | 'executeBatchAsync'> {
  dbName: DbName
}
