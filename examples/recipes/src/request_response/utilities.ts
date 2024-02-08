import { genUUID } from 'electric-sql/util'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { useCallback, useEffect, useState } from 'react'

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
}

interface ElectricFetchParams {
  path: string
  method: HttpMethod
  data?: string
}

interface ElectricFetchResponse<R> {
  response?: {
    statusCode: number
    data?: R
  }
  requestProcessing: boolean
  cancelRequest?: () => void
}

export function useElectricFetch<ResultType>({
  path,
  method,
  data,
}: ElectricFetchParams): ElectricFetchResponse<ResultType> {
  const { db } = useElectric()!
  const [requestId, setRequestId] = useState('')

  // If a response is not present, mark request as
  // cancelled to prevent further processing on the backend
  const cancelRequest = useCallback(
    async (requestIdToCancel: string) => {
      setRequestId('')
      const response = await db.responses.findFirst({
        where: { request_id: requestIdToCancel },
      })
      if (response !== null) return
      db.requests.update({
        data: { cancelled: true },
        where: { id: requestIdToCancel },
      })
    },
    [db.requests, db.responses],
  )

  // Add an entry to the requests table, to be handled
  // by the backend and marked as being processed when synced
  useEffect(() => {
    const newRequestId = genUUID()
    db.requests.create({
      data: {
        id: newRequestId,
        timestamp: new Date(),
        path: path,
        method: method,
        data: data,
        processing: false,
        cancelled: false,
      },
    })
    setRequestId(newRequestId)
    return () => {
      cancelRequest(newRequestId)
    }
  }, [db.requests, cancelRequest, path, method, data])

  // Keep track of whether the backend has started processing
  // the request
  const requestProcessing =
    useLiveQuery(
      db.requests.liveFirst({
        select: { processing: true },
        where: { id: requestId },
      }),
    ).results?.processing ?? false

  // Listen for response to the given request in the
  // responses table, using the request ID to match it
  const response = useLiveQuery(
    db.responses.liveFirst({
      where: { request_id: requestId },
    }),
  ).results

  return {
    response:
      response != null
        ? {
            statusCode: response.status_code,
            data: response.data as ResultType,
          }
        : undefined,
    requestProcessing,
    cancelRequest: requestId !== '' ? () => cancelRequest(requestId) : undefined,
  }
}
