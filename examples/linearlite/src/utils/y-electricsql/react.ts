import { useState, useEffect, useRef } from 'react'
import * as Y from 'yjs'
import {
  WebrtcProvider,
  type ProviderOptions as WebrtcProviderOptions,
} from 'y-webrtc'
import { DbSchema, ElectricClient } from 'electric-sql/client/model'
import {
  ElectricSQLPersistance,
  type ElectricSQLPersistanceOptions,
} from './index'

export * from './index'

export interface UseElectricYDocOptions extends ElectricSQLPersistanceOptions {
  roomName?: string // Used for webrtc, defaults to ydocId
  webrtc?: boolean | WebrtcProviderOptions
}

export function useElectricYDoc(
  electricClient: ElectricClient<DbSchema<any>>,
  ydocId?: string | null,
  options?: UseElectricYDocOptions
) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const persistance = useRef<ElectricSQLPersistance | null>(null)
  const webrtcProvider = useRef<WebrtcProvider | null>(null)

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

      if (options?.webrtc) {
        webrtcProvider.current = new WebrtcProvider(
          options?.roomName || ydocId,
          persistance.current!.ydoc,
          options?.webrtc === true
            ? {
                password: persistance.current!.webrtcSecret,
              }
            : options?.webrtc
        )
      }
    }

    const onError = (err: Error) => {
      if (ignore) return
      setError(err)
    }

    persistance.current.on('loaded', onLoaded)
    persistance.current.on('error', onError)

    return () => {
      ignore = true

      // There may be pending updates that need to be stored
      persistance.current?.storePendingUpdates()

      // Reset state
      setLoaded(false)
      setError(null)

      // Cleanup
      if (webrtcProvider.current) {
        webrtcProvider.current?.disconnect()
        webrtcProvider.current?.destroy()
      }
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
    webrtcProvider: webrtcProvider.current,
  }
}
