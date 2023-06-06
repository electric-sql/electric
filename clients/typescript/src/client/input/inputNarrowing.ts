import { Removed, RemovedType } from '../util/types'

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

/**
 * Narrows select types to remove the unsupported `_count` and `cursor` properties.
 */
export type NarrowSelect<T> = Removed<T, '_count' | 'cursor'>

export type NarrowInclude<T> = NarrowSelect<T>

/**
 * Narrows where types by removing the unsupported relational filters
 * and removing Prisma's `QueryMode` because it is used for case-insensitive search
 * (cf. https://www.prisma.io/docs/concepts/components/prisma-client/filtering-and-sorting#case-insensitive-filtering)
 * but that is not supported at the moment because of differences between SQLite and Postgres.
 */
export type NarrowWhere<T> = RemovedType<
  Removed<T, 'every' | 'some' | 'none'>,
  'mode',
  'default' | 'insensitive' | 'undefined'
>

export type NarrowOrderBy<T> = Removed<T, '_count'>

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
