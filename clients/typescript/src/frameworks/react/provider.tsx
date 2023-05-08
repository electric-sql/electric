import React, { createContext, useContext } from 'react'

import { ElectricClient } from '../../client/model/client'
import { DbSchema } from '../../client/model'

interface Props<S extends ElectricClient<DbSchema<any>>> {
  children?: React.ReactNode
  db?: S
}

interface ElectricContext<S extends ElectricClient<DbSchema<any>>> {
  ElectricContext: React.Context<S | undefined>
  useElectric: () => S | undefined
  ElectricProvider: ({ children, db }: Props<S>) => JSX.Element
}

/**
 * This "static" context is used internally by our React hooks to access the {@link ElectricClient}.
 * It loses information about the actual types of the DB tables,
 * but we don't need that information in the React hooks.
 * However, users preferably don't lose this type information,
 * therefore, they can use {@link makeElectricContext}.
 */
let ElectricContext: React.Context<ElectricClient<DbSchema<any>> | undefined> =
  createContext<ElectricClient<DbSchema<any>> | undefined>(undefined)

export { ElectricContext }

/**
 * Call this function to create an Electric context, provider, and subscriber for your React application.
 * We can't provide a predefined context, provider, and subscriber because that would lose type information
 * as the types depend on the type of the database `S` that's provides as a type argument.
 *
 * @example
 * This example loses information about the concrete DB tables:
 * ```
 * const ctx = createContext<ElectricClient>()
 * ```
 */
export function makeElectricContext<
  S extends ElectricClient<DbSchema<any>>
>(): ElectricContext<S> {
  const ctx = createContext<S | undefined>(undefined)

  ElectricContext = ctx as any
  const useElectric = () => useContext(ctx)

  const provider = ({ children, db }: Props<S>) => {
    return <ctx.Provider value={db}>{children}</ctx.Provider>
  }

  return {
    ElectricContext: ctx,
    useElectric: useElectric,
    ElectricProvider: provider,
  }
}
