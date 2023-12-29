import { useState, useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { DbSchema, ElectricClient } from 'electric-sql/client/model'
import {
  ElectricSQLPersistance,
  type ElectricSQLPersistanceOptions,
} from './index'

export * from './index'

export function useElectricYDoc(
  electricClient: ElectricClient<DbSchema<any>>,
  ydocId?: string | null,
  options?: ElectricSQLPersistanceOptions
) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const persistance = useRef<ElectricSQLPersistance | null>(null)

  useEffect(() => {
    if (!ydocId) return
    persistance.current = new ElectricSQLPersistance(
      electricClient,
      ydocId,
      options
    )
    let ignore = false

    const onLoaded = () => {
      if (ignore) return
      setLoaded(true)
      setYdoc(persistance.current?.ydoc!)
    }

    const onError = (err: Error) => {
      if (ignore) return
      setError(err)
    }

    persistance.current.on('loaded', onLoaded)
    persistance.current.on('error', onError)

    return () => {
      ignore = true
      setLoaded(false)
      setError(null)
      persistance.current?.off('loaded', onLoaded)
      persistance.current?.off('error', onError)
      persistance.current?.destroy()
      ydoc?.destroy()
    }
  }, [electricClient, ydocId, options])

  return {
    ydoc,
    persistance: persistance.current,
    loaded,
    error,
  }
}
