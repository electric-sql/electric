import { RunResult } from '../../electric/adapter'
import { QueryBuilder } from 'squel'

export interface DB<T> {
  run(
    statement: string,
    successCallback?: (tx: DB<T>, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void
  run(
    statement: QueryBuilder,
    successCallback?: (tx: DB<T>, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void
  query(
    statement: string,
    successCallback: (tx: DB<T>, res: Partial<T>[]) => void,
    errorCallback?: (error: any) => void
  ): void
  query(
    statement: QueryBuilder,
    successCallback: (tx: DB<T>, res: Partial<T>[]) => void,
    errorCallback?: (error: any) => void
  ): void
}
