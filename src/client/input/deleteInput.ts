import { SelectInput } from './findInput'

export interface DeleteInput<T> {
  where: Partial<T>
  select?: SelectInput<T>
}

export interface DeleteManyInput<T> {
  where?: Partial<T>
}
