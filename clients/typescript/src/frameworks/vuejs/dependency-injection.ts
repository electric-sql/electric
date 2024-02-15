import { provide, inject, unref, ShallowRef } from 'vue'

import { ElectricClient } from '../../client/model/client'
import { DbSchema } from '../../client/model'
interface ElectricDependencyInjection<S extends ElectricClient<DbSchema<any>>> {
  provideElectric: (
    electric: ShallowRef<S | undefined> | (S | undefined)
  ) => void
  injectElectric: () => S | undefined
}

const ElectricKey = Symbol('ElectricProvider')

/**
 * Call this function to get an Electric provider and injector for your Vue application.
 * We can't provide a predefined provider and injector because that would lose type information
 * as the types depend on the type of the database `S` that's provides as a type argument.
 *
 * @example
 * This example loses information about the concrete DB tables:
 * ```
 * provide<ElectricClient>(ElectricKey, electric)
 *
 * // generic DB type, no type-safe client
 * const { db } = inject(ElectricKey)
 * ```
 *
 * @returns An object with two functions: `provideElectric` and `injectElectric`.
 *
 */
export function makeElectricDependencyInjector<
  S extends ElectricClient<DbSchema<any>>
>(): ElectricDependencyInjection<S> {
  const provideElectric = (
    electric: ShallowRef<S | undefined> | (S | undefined)
  ): void => provide(ElectricKey, electric)

  const injectElectric = (): S | undefined => {
    const electric = inject<ShallowRef<S> | S>(ElectricKey)
    return unref(electric)
  }

  return {
    provideElectric,
    injectElectric,
  }
}

// TODO(msfstef): turn into Vue plugin? how to preserve type?
