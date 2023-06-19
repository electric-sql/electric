import { NarrowInclude, NarrowSelect, NarrowWhere } from './inputNarrowing'

export interface DeleteInput<Select, WhereUnique, Include> {
  where: WhereUnique
  select?: NarrowSelect<Select>
  include?: NarrowInclude<Include>
}

export interface DeleteManyInput<Where> {
  where?: NarrowWhere<Where>
}
