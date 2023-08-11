import React, { ReactNode, useEffect, useState } from 'react'
import { useElectric } from '../electric'
import {
  DemoContext,
  DemoContextData,
  getCachedSessionId,
  getOrCreateDemo
} from '../session'

type Props = {
  bootstrapItems: number,
  bootstrapServerItems: number,
  children: ReactNode,
  demoName: string
}

const DemoProvider = ({ bootstrapItems, bootstrapServerItems, children, demoName }: Props) => {
  const { db } = useElectric()!
  const [ demoContext, setDemoContext ] = useState<DemoContextData>()

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const shape = await db.demos.sync({
        include: {
          items: true,
          sliders: true,
          players: true,
          tournaments: true
        }
      })
      await shape.synced

      if (!isMounted) {
        return
      }

      const sessionId = getCachedSessionId()
      const demo = await getOrCreateDemo(db, sessionId, demoName, bootstrapItems)

      if (!isMounted) {
        return
      }

      setDemoContext({demo: demo, sessionId: sessionId})
    }

    init()

    return () => {
      isMounted = false
    }
  }, [])

  if (demoContext === undefined) {
    return null
  }

  return (
    <DemoContext.Provider value={demoContext}>
      { children }
    </DemoContext.Provider>
  )
}

export default DemoProvider
