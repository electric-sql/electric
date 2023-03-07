import { SelectInput } from './findInput'

export interface UpsertInput<T> {
  select?: SelectInput<T>
  where: Partial<T>
  create: T
  update: Partial<T>
}
