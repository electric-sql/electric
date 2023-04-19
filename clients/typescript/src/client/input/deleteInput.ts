export interface DeleteInput<Select, WhereUnique, Include> {
  where: WhereUnique
  select?: Select
  include?: Include
}

export interface DeleteManyInput<Where> {
  where?: Where
}
