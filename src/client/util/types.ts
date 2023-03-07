// Picks only the properties that are set to true
// `P in keyof T` introduces `P` which stores all the properties that are present in T
// `as F[P]` is used to take the type of that field in the selection
// if it is true then we pick the property `P`
// otherwise we take `never` which will exclude this property
// finally we map the picked properties to their type in `T`
import { SelectInput } from '../input/findInput'

export type PickSelectedProperties<T, F extends SelectInput<T>> = {
  [P in keyof T as F[P] extends true ? P : never]: T[P]
}

export type Selected<T extends Record<string, any>, Input> = Input extends {
  select: SelectInput<T>
} // check  if the input defines a selection
  ? PickSelectedProperties<T, Input['select']> // pick the selected properties
  : T // there is no selection so the object contains all fields
