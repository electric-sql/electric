// We define Prisma's `SelectSubset` type here because TypeScript does not support higher kinded types
// in practice, this means we cannot pass the `SelectSubset` type constructor as a type argument to a class.
// We cannot just import this type from the Prisma library because it is part of the generated Prisma client.
export type SelectSubset<T, U> = {
  [key in keyof T]: key extends keyof U ? T[key] : never
} & (T extends SelectAndInclude
  ? 'Please either choose `select` or `include`.'
  : object)

type SelectAndInclude = {
  select: any
  include: any
}
