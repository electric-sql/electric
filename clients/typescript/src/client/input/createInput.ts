export interface CreateInput<Data extends object, Select, Include> {
  data: Data
  select?: Select
  include?: Include
}

export interface CreateManyInput<T> {
  data: Array<T>
  skipDuplicates?: boolean
}
