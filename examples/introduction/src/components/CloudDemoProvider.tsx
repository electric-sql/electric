import React, { ReactNode, useEffect, useState } from 'react'
import api from '../api'
import { DemoContext, DemoContextData, getCachedSessionId } from '../session'

type Props = {
  bootstrapItems: number,
  children: ReactNode,
  demoName: string
}

const CloudDemoProvider = ({ bootstrapItems, children, demoName }: Props) => {
  const [ demoContext, setDemoContext ] = useState<DemoContextData>()

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const sessionId = getCachedSessionId()
      const demo = await api.bootstrapDemo(sessionId, demoName, bootstrapItems)

      if (!isMounted || demo === undefined) {
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

export default CloudDemoProvider
