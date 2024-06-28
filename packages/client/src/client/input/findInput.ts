import {
  NarrowInclude,
  NarrowOrderBy,
  NarrowSelect,
  NarrowWhere,
} from './inputNarrowing'

export interface FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum> {
  where?: NarrowWhere<Where>
  select?: NarrowSelect<Select>
  include?: NarrowInclude<Include>
  distinct?: ScalarFieldEnum[]
  take?: number
  skip?: number
  orderBy?: NarrowOrderBy<OrderBy | OrderBy[]>
}

export interface FindUniqueInput<Select, Where, Include> {
  where: Where
  select?: NarrowSelect<Select>
  include?: NarrowInclude<Include>
}
