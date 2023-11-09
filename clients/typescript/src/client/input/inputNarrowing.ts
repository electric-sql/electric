import { Removed, RemovedType } from '../util/types.js'

/*
 * This file defines types that are used
 * to narrow the Prisma-generated types
 * to contain only the features that are supported.
 */

/**
 * Narrows the type of create data to remove unsupported properties.
 */
export type NarrowCreateData<T> = Removed<
  T,
  | 'connectOrCreate'
  | 'createMany'
  | 'connect'
  | 'upsert'
  | 'set'
  | 'disconnect'
  | 'delete'
  | 'update'
  | 'updateMany'
  | 'deleteMany'
>

export type NarrowUpdateData<T> = Removed<
  T,
  | 'create'
  | 'connectOrCreate'
  | 'createMany'
  | 'connect'
  | 'upsert'
  | 'set'
  | 'disconnect'
  | 'delete'
  | 'deleteMany'
>

export type NarrowUpsertCreate<T> = Removed<
  T,
  'connectOrCreate' | 'createMany' | 'connect'
>

/**
 * Narrows the type of update data to remove unsupported properties.
 */
export type NarrowUpdateManyData<T> = Removed<
  T,
  'set' | 'increment' | 'decrement' | 'multiply' | 'divide'
>

type StripPrimitives<T> = T extends object ? T : never // strips primitives from union types
type OnlyPrimitives<T> = StripPrimitives<T> extends never ? T : never // contains only primitives if nothing is left after stripping all primitives
type StripRelationFields<T> = T extends object // filter out object properties
  ? T extends (infer V)[] // if it is an array of type V[]
    ? StripRelationFields<V>[] // recursively filter out object properties in the type of the elements V
    : {
        // otherwise it is an object
        // remove properties whose type contains an object,
        // e.g. author?: boolean | UserArgs
        //      is a relation property and UserArgs is an object,
        //      so we remove such properties
        [K in keyof T]: OnlyPrimitives<T[K]>
      }
  : T

/**
 * Narrow include types to remove the unsupported `_count` and `cursor` properties.
 */
export type NarrowInclude<T> = Removed<T, '_count' | 'cursor'>

/**
 * Narrows select types to remove the unsupported `_count` and `cursor` properties
 * but also related fields as we do not yet support selecting related objects.
 */
export type NarrowSelect<T> = NarrowInclude<StripRelationFields<T>>
// TODO: remove `StripRelationFields` once we support selecting related objects

/**
 * Narrows where types by removing the unsupported relational filters
 * and removing Prisma's `QueryMode` because it is used for case-insensitive search
 * (cf. https://www.prisma.io/docs/concepts/components/prisma-client/filtering-and-sorting#case-insensitive-filtering)
 * but that is not supported at the moment because of differences between SQLite and Postgres.
 */
export type NarrowWhere<T> = RemovedType<
  Removed<T, 'every' | 'some' | 'none'>,
  'mode',
  'default' | 'insensitive' | undefined
>

export type NarrowOrderBy<T> = StripRelationFields<T>

/**
 * Narrows the type of create arguments to remove unsupported properties.
 */
/*
type NarrowCreateArgs<T extends CreateInput<object, any, any>> = {
  select?: NarrowSelect<T['select']>
  include?: NarrowSelect<T['include']>
  data: NarrowCreateData<T['data']>
}
 */
