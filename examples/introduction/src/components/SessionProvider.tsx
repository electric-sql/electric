import React, { ReactNode, useEffect, useState } from 'react'
import { globalRegistry } from 'electric-sql/satellite'
import { ensureSessionId, timeTilSessionExpiry } from '../session'

type Props = {
  children: ReactNode
}

const SessionProvider = ({ children }: Props) => {
  const [ ready, setReady ] = useState(false)
  const [ hasExpired, setHasExpired ] = useState(false)

  useEffect(() => {
    ensureSessionId()
    setReady(true)

    const ttl = timeTilSessionExpiry()
    if (ttl < 0) {
      setHasExpired(true)

      return
    }

    const expire = () => {
      setHasExpired(true)

      // XXX cleanup the satellite processes
      // globalRegistry.stopAll()
    }

    let timer = window.setTimeout(expire, ttl)

    return () => window.clearTimeout(timer)
  }, [])

  if (!ready) {
    return null
  }

  if (hasExpired) {
    return (
      <div className="p-6 h-48 flex text-center content-center">
        <h4>
          Demo session expired
        </h4>
        <p>
          <a className="button button--secondary button--outline button--large"
              onClick={() => window.location.reload()}>
            Reload ↺
          </a>
        </p>
      </div>
    )
  }

  return (
    <>
      {children}
    </>
  )
}

export default SessionProvider
