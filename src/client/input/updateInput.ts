import { FindUniqueInput } from './findInput'

export interface UpdateInput<Data, Select, Where, Include>
  extends FindUniqueInput<Select, Where, Include> {
  data: Data
}

export interface UpdateManyInput<Data, Where> {
  data: Data
  where?: Where
}
