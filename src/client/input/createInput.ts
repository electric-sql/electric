import { SelectInput } from './findInput'

export interface CreateInput<T> {
  data: T
  select?: SelectInput<T>
}

export interface CreateManyInput<T> {
  data: T
  skipDuplicates?: boolean
}
