import {
  NarrowInclude,
  NarrowSelect,
  NarrowUpdateData,
  NarrowUpdateManyData,
  NarrowUpsertCreate,
} from './inputNarrowing'

export interface UpsertInput<Create, Update, Select, WhereUnique, Include> {
  select?: NarrowSelect<Select>
  where: WhereUnique
  create: NarrowUpsertCreate<Create>
  update: NarrowUpdateManyData<NarrowUpdateData<Update>>
  include?: NarrowInclude<Include>
}
