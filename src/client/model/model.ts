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
  create<Input extends CreateInput<T>>(i: Input): Promise<Selected<T, Input>>
  createMany(i: CreateManyInput<T[]>): Promise<BatchPayload>

  findUnique<Input extends FindUniqueInput<T>>(
    i: Input
  ): Promise<Selected<T, Input> | null>
  findFirst<Input extends FindInput<T>>(
    i: Input
  ): Promise<Selected<T, Input> | null>
  findMany<Input extends FindInput<T>>(
    i: Input
  ): Promise<Array<Selected<T, Input>>>

  // Live queries
  // The queries' return types are slightly different
  // as their result is wrapped inside a `LiveResult`
  // object that contains additional information about the table names.
  liveUnique<Input extends FindUniqueInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Selected<T, Input> | null>>
  liveFirst<Input extends FindInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Selected<T, Input> | null>>
  liveMany<Input extends FindInput<T>>(
    i: Input
  ): () => Promise<LiveResult<Array<Selected<T, Input>>>>

  update<Input extends UpdateInput<T>>(i: Input): Promise<Selected<T, Input>>
  updateMany(i: UpdateManyInput<T>): Promise<BatchPayload>
  upsert<Input extends UpsertInput<T>>(i: Input): Promise<Selected<T, Input>>

  delete<Input extends DeleteInput<T>>(i: Input): Promise<Selected<T, Input>>
  deleteMany(i: DeleteManyInput<T>): Promise<BatchPayload>
}

export class LiveResult<T> {
  constructor(public result: T, public tablenames: QualifiedTablename[]) {}
}
