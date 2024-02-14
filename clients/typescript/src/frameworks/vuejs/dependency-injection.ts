import { provide, inject } from 'vue'

import { ElectricClient } from '../../client/model/client'
import { DbSchema } from '../../client/model'

interface ElectricDependencyInjector<S extends ElectricClient<DbSchema<any>>> {
  provideElectric: (electric: S) => void
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
 */
export function makeElectricDependencyInjector<
  S extends ElectricClient<DbSchema<any>>
>(): ElectricDependencyInjector<S> {
  const provideElectric = (electric: S): void => provide(ElectricKey, electric)

  const injectElectric = (): S | undefined => inject(ElectricKey)

  return {
    provideElectric,
    injectElectric,
  }
}

// TODO(msfstef): turn into Vue plugin? how to preserve type?
