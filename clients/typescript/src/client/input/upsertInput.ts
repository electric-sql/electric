export interface UpsertInput<Create, Update, Select, WhereUnique, Include> {
  select?: Select
  where: WhereUnique
  create: Create
  update: Update
  include?: Include
}
