import { FindUniqueInput } from './findInput'

export interface UpdateInput<T> extends FindUniqueInput<T> {
  data: Partial<T>
}

export interface UpdateManyInput<T> {
  data: Partial<T>
  where?: Partial<T>
}
