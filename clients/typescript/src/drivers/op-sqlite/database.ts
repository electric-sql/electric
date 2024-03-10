import { OPSQLiteConnection } from '@op-engineering/op-sqlite'

export type Database = Pick<OPSQLiteConnection, 'executeAsync' | 'executeBatchAsync'> 