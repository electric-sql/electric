import { useEffect, useState } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { genUUID } from 'electric-sql/util'
import { JsonValueType, Requests, Responses } from '../generated/client'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export const useElectricQuery = ({
  path,
  method = 'GET',
  payload,
}: {
  path: string
  method?: HttpMethod
  payload?: JsonValueType
}) => {
  const { db } = useElectric()!

  // Keep track of the active request ID to match to response
  const [requestId, setRequestId] = useState('')

  // Arbitrary counter to allow re-submitting the same request
  const [refreshCounter, setRefreshCounter] = useState(0)

  useEffect(() => {
    const newRequestId = genUUID()
    setRequestId(newRequestId)
    db.requests.create({
      data: {
        id: newRequestId,
        timestamp: new Date(),
        path: path,
        method: method,
        data: payload,
        processing: false,
        cancelled: false,
      },
    })
  }, [db.requests, path, method, payload, refreshCounter])

  // Reactive query for the active request/response pair
  const request = useLiveQuery(
    db.requests.liveUnique({
      include: { responses: true },
      where: { id: requestId },
    }),
  ).results as undefined | (Requests & { responses: Responses[] })

  const response = request?.responses?.[0]

  return {
    data: response && response.status_code < 400 ? response.data : undefined,
    error: response && response.status_code >= 400 ? response.data : undefined,
    lastUpdatedAt: response?.timestamp,
    isPending: !response && request?.processing == false,
    isFetching: request?.processing == true,
    refresh: () => setRefreshCounter((c) => (c + 1) % 2),
  }
}
