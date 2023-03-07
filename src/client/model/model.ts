import { CreateInput, CreateManyInput } from '../input/createInput'
import { Selected } from '../util/types'
import { BatchPayload } from '../output/batchPayload'
import { FindInput, FindUniqueInput } from '../input/findInput'
import { UpdateInput, UpdateManyInput } from '../input/updateInput'
import { UpsertInput } from '../input/upsertInput'
import { DeleteInput, DeleteManyInput } from '../input/deleteInput'
import { QualifiedTablename } from '../../util/tablename'
import { DbSchemas } from './dalNamespace'

export interface Model<T extends DbSchemas> {
  live: LiveQueryInterface<T>

  create<Input extends CreateInput<T>>(i: Input): Promise<Selected<T, Input>>
  createMany(i: CreateManyInput<T[]>): Promise<BatchPayload>

  // Find queries are overloaded to support live queries.
  // Live queries return additional information about the tables
  // which is needed to listen to changes to these tables.
  findUnique<Input extends FindUniqueInput<T>>(
    i: Input
  ): Promise<Selected<T, Input> | null>
  findFirst<Input extends FindInput<T>>(
    i: Input
  ): Promise<Selected<T, Input> | null>
  findMany<Input extends FindInput<T>>(
    i: Input
  ): Promise<Array<Selected<T, Input>>>

  update<Input extends UpdateInput<T>>(i: Input): Promise<Selected<T, Input>>
  updateMany(i: UpdateManyInput<T>): Promise<BatchPayload>
  upsert<Input extends UpsertInput<T>>(i: Input): Promise<Selected<T, Input>>

  delete<Input extends DeleteInput<T>>(i: Input): Promise<Selected<T, Input>>
  deleteMany(i: DeleteManyInput<T>): Promise<BatchPayload>
}

// Interface for the live query API.
// The queries' return types are slightly different
// as their result is wrapped inside a `LiveResult`
// object that contains additional information about the table names.
export interface LiveQueryInterface<T extends DbSchemas> {
  findUnique<Input extends FindUniqueInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Selected<T, Input> | null>>
  findFirst<Input extends FindInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Selected<T, Input> | null>>
  findMany<Input extends FindInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Array<Selected<T, Input>>>>
}

export class LiveResult<T> {
  constructor(public result: T, public tablenames: QualifiedTablename[]) {}
}
