//import { SelectInput } from './findInput'
//import { isNullish } from '../util/toZod'

/*
    data:
     - map over fields of T:
        - if it is a relation field:
           - recursively wrap the type inside an object with a create field whose value is of type T

    The type is not very accurate but enforcing that e.g. the FK is not provided on incoming
    relations is very hard because it would require somehow passing for every relation
    which field is the relation field, the from field, the to field, etc.
    and this seems beyond what you can do on the type level
 */

/*
export interface NestedCreate<T> {
  create: T
}
 */

// FIXME: we want to recursively call DataWithRelations here
//        but we need to pass the RelationFields of that type...
//        but we don't have this information here... would require some lookup
//        OR: RelationFields record maps relation fields to their relation fields
//        e.g. { profile: {  } }

//Record<keyof T, boolean> // no: map props of T to Relations or
/*type Relations<T> = {
  [P in keyof T as T[P] extends object ? ]?:
}*/

/*
type DataWithRelations<T> = {
  //, RelationFields extends Record<keyof T, boolean>> = {
  [P in keyof T]: isNullish<T[P]> extends true
    ? DataWithRelations<Exclude<T[P], undefined | null>> | undefined | null // we have a Nullish<T[P]>, call ourselves recursively on T[P] and wrap it back into a nullish type
    : T[P] extends object
    ? NestedCreate<T[P]>
    : T[P]
}
 */

/*
     Original type:
       type User =


 */

export interface CreateInput<Data extends object, Select, Include> {
  data: Data
  select?: Select
  include?: Include
}

export interface CreateManyInput<T> {
  data: Array<T>
  skipDuplicates?: boolean
}
