import { OrderByInput } from './orderByInput'

export type SelectInput<T> = { [field in keyof T]?: boolean }

export interface FindInput<T> {
  where?: Partial<T>
  select?: SelectInput<T> // A partial of T but where the fields have boolean values that indicate whether or not to select them
  distinct?: string[]
  take?: number
  skip?: number
  orderBy?: OrderByInput<T> | OrderByInput<T>[]
}

// TODO: We should enforce both on the type level and at runtime that at least one unique field is provided as Prisma does.
//       cf. https://www.prisma.io/docs/reference/api-reference/prisma-client-reference#filter-on-non-unique-fields-with-userwhereuniqueinput
//       But this information is not present in the generated Zod schema so we will need to infer it ourselves
//       either by modifying the zod generator or by writing our own generator or by introspecting the Prisma schema --> with DMMF? but this is in Prisma client i think
export interface FindUniqueInput<T> {
  where: Partial<T>
  select?: SelectInput<T>
}
