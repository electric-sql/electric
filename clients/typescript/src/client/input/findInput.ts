//export type SelectInput<T> = { [field in keyof T]?: boolean }

export interface FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum> {
  where?: Where
  select?: Select
  include?: Include
  distinct?: ScalarFieldEnum[]
  take?: number
  skip?: number
  orderBy?: OrderBy | OrderBy[]
}

export interface FindUniqueInput<Select, Where, Include> {
  where: Where
  select?: Select
  include?: Include
}
