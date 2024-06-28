import { NarrowCreateData, NarrowInclude, NarrowSelect } from './inputNarrowing'

export interface CreateInput<Data extends object, Select, Include> {
  data: NarrowCreateData<Data>
  select?: NarrowSelect<Select>
  include?: NarrowInclude<Include>
}

export interface CreateManyInput<T> {
  data: Array<T>
  skipDuplicates?: boolean
}
