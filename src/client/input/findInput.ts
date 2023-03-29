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

// TODO: We should enforce both on the type level and at runtime that at least one unique field is provided as Prisma does.
//       cf. https://www.prisma.io/docs/reference/api-reference/prisma-client-reference#filter-on-non-unique-fields-with-userwhereuniqueinput
//       But this information is not present in the generated Zod schema so we will need to infer it ourselves
//       either by modifying the zod generator or by writing our own generator or by introspecting the Prisma schema --> with DMMF? but this is in Prisma client i think
export interface FindUniqueInput<Select, Where, Include> {
  where: Where
  select?: Select
  include?: Include
}
