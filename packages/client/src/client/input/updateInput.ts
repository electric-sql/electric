import { FindUniqueInput } from './findInput'
import {
  NarrowUpdateData,
  NarrowUpdateManyData,
  NarrowWhere,
} from './inputNarrowing'

export interface UpdateInput<Data, Select, Where, Include>
  extends FindUniqueInput<Select, Where, Include> {
  data: NarrowUpdateManyData<NarrowUpdateData<Data>>
}

export interface UpdateManyInput<Data, Where> {
  data: NarrowUpdateManyData<Data>
  where?: NarrowWhere<Where>
}
