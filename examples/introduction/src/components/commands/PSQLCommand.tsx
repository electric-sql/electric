import React, { useEffect, useState } from 'react'
import api from '../../api'
import { SANITISED_DATABASE_URL } from '../../config'
import { useCommandCreds } from './CommandCreds'

type UserCreds = {
  userId: string,
  password: string
}

const PSQLCommand = () => {
  const { demoName, sessionId } = useCommandCreds()!
  const [ hasErrored, setHasErrored ] = useState<boolean>(false)
  const [ retryCount, setRetryCount ] = useState<number>(0)
  const [ userCreds, setUserCreds ] = useState<UserCreds>()

  const retry = async () => {
    setHasErrored(false)
    setRetryCount((x) => x + 1)
  }

  useEffect(() => {
    let isMounted = true

    const fetchUserCreds = async () => {
      const creds = await api.getUserCreds(sessionId)

      if (!isMounted) {
        return
      }

      if (creds === undefined) {
        setHasErrored(true)
      }
      else {
        setUserCreds(creds)
      }
    }

    fetchUserCreds()

    return () => {
      isMounted = false
    }
  }, [demoName, retryCount, sessionId])

  if (hasErrored) {
    return (
      <div className="tile flex-col mb-6">
        <span className="mr-3">
          Failed to fetch user credentials. Are you online?
        </span>
        <a className="button button--secondary button--outline" onClick={retry}>
          Retry ↺
        </a>
      </div>
    )
  }

  if (userCreds === undefined) {
    return (
      <pre><code>Fetching user credentials ...</code></pre>
    )
  }

  const [ protocol, remainder ] = SANITISED_DATABASE_URL.split('://')
  const { userId, password } = userCreds

  const parts = [
    protocol,
    '://',
    userId,
    ':',
    password,
    '@',
    remainder
  ]

  return (
    <pre><code>{`psql "${parts.join('')}"`}</code></pre>
  )
}

export default PSQLCommand
