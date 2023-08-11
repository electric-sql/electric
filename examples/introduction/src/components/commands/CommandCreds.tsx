import React, { ReactNode, createContext, useContext, useEffect, useState } from 'react'
import { useElectric } from '../../electric'
import { getCachedSessionId, getExistingDemo } from '../../session'
import { getOrSetTabId } from '../../tab'

import ElectricProvider from '../ElectricProvider'
import SessionProvider from '../SessionProvider'

export type CommandCredsData = {
  demoId: string,
  demoName: string,
  sessionId: string
}

export const CommandCredsContext = createContext<CommandCredsData>(null)

export const useCommandCreds = () => {
  return useContext(CommandCredsContext)
}

type ProviderProps = {
  children: ReactNode,
  demoName: string
}

const CommandCredsProvider = ({ children, demoName }: ProviderProps) => {
  const { db } = useElectric()!
  const [ creds, setCreds ] = useState<CommandCredsData>()

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      // XXX when we have https://github.com/electric-sql/electric/pull/311
      // we can add a shape subscription for demos here if we want. That
      // will prevent reading from an unsynced table warnings.

      const sessionId = getCachedSessionId()
      const demo = await getExistingDemo(db, sessionId, demoName)

      if (!isMounted || demo === null) {
        return
      }

      setCreds({
        demoId: demo.id,
        demoName: demo.name,
        sessionId: sessionId
      })
    }

    init()

    return () => {
      isMounted = false
    }
  }, [])

  if (creds === undefined) {
    return null
  }

  return (
    <CommandCredsContext.Provider value={creds}>
      { children }
    </CommandCredsContext.Provider>
  )
}

type Props = ProviderProps & {
  dbName: string
}

export const CommandCreds = ({ children, dbName, demoName }: Props) => (
  <SessionProvider>
    <ElectricProvider dbName={dbName}>
      <CommandCredsProvider demoName={demoName}>
        {children}
      </CommandCredsProvider>
    </ElectricProvider>
  </SessionProvider>
)
