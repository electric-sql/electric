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

/**
 * Removes fields that are in `Drop` from `T` and from
 * all objects that are recursively reachable from `T`.
 */
export type Removed<T, Drop> = T extends object
  ? {
      // taken from: https://stackoverflow.com/questions/65888383/typing-recursive-function-removing-property-from-object
      [K in keyof T]: K extends Drop ? never : Removed<T[K], Drop>
      // Note that we can't rewrite it as:
      //  [K in Exclude<keyof T, Drop>]: Removed<T[K], Drop>
      // because the type needs to be homomorphic
      // in order to keep property modifiers
      // such as optional properties and readonly properties
      // (cf. https://stackoverflow.com/questions/56140221/why-is-this-mapped-type-removing-the-decorator-how-can-we-achieve-a-similar)
    }
  : T

/**
 * Removes fields from `T` that are in `DropKey` and whose type is in `DropType`.
 * It does this for all objects that are recursively reachable from `T`.
 */
export type RemovedType<T, DropKey, DropType> = T extends object
  ? {
      // drops fields whose key extends `DropKey` and whose type extends `DropType`
      [K in keyof T]: K extends DropKey
        ? T[K] extends DropType
          ? never
          : RemovedType<T[K], DropKey, DropType>
        : RemovedType<T[K], DropKey, DropType>
    }
  : T
