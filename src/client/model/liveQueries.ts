import { LiveQueryInterface, LiveResult } from './model'
import { QualifiedTablename } from '../../util/tablename'
import { FindInput, FindUniqueInput } from '../input/findInput'
import { Selected } from '../util/types'
import { Table } from './table'

// This class wraps a table supporting CRUD operations and provides live queries on top.
// The live queries below return a function which can be used in combination with the `useLiveQuery` hook.
// That hook expects the function to return a `Promise<LiveResult<T>>` which can be used to
// fetch the query result as well as the names of the tables used by the query.
// The table names are then used by the hook to re-run the query every time the table changes.
export class LiveQueries<T extends Record<string, any>>
  implements LiveQueryInterface<T>
{
  constructor(
    private _table: Table<T>,
    private _qualifiedTableName: QualifiedTablename
  ) {}

  findUnique<Input extends FindUniqueInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Selected<T, Input> | null>> {
    return this.makeLiveResult(this._table.findUnique(i))
  }

  findFirst<Input extends FindInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Selected<T, Input> | null>> {
    return this.makeLiveResult(this._table.findFirst(i))
  }

  findMany<Input extends FindInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Array<Selected<T, Input>>>> {
    return this.makeLiveResult(this._table.findMany(i))
  }

  private makeLiveResult<T>(prom: Promise<T>): () => Promise<LiveResult<T>> {
    return () => {
      return prom.then((res) => {
        return new LiveResult(res, [this._qualifiedTableName])
      }) as Promise<LiveResult<T>>
    }
  }
}
