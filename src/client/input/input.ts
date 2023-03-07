import { CreateInput } from './createInput'
import { FindInput, FindUniqueInput } from './findInput'
import { UpdateInput, UpdateManyInput } from './updateInput'
import { DeleteInput, DeleteManyInput } from './deleteInput'

export type Input<T> =
  | CreateInput<T>
  | CreateInput<T[]>
  | FindInput<T>
  | FindUniqueInput<T>
  | UpdateInput<T>
  | UpdateManyInput<T>
  | DeleteInput<T>
  | DeleteManyInput<T>

export enum InputTypes {
  Create = 'Create',
  CreateMany = 'CreateMany',
  Find = 'Find',
  FindUnique = 'FindUnique',
  Update = 'Update',
  UpdateMany = 'UpdateMany',
  Upsert = 'Upsert',
  Delete = 'Delete',
  DeleteMany = 'DeleteMany',
}
