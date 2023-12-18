import { genUUID } from "electric-sql/util";
import { useElectric } from "../electric/ElectricWrapper";
import { useLiveQuery } from "electric-sql/react";
import { useCallback, useEffect, useState } from "react";

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

interface ElectricFetchParams {
  path: string,
  method: HttpMethod,
  data?: string
}

interface ElectricFetchResponse<R> {
  response?: {
    statusCode: number,
    data?: R
  },
  requestProcessing: boolean,
  cancelRequest: () => void
}

export function useElectricFetch<ResultType>({
  path,
  method,
  data
} : ElectricFetchParams) : ElectricFetchResponse<ResultType> {
  const { db } = useElectric()!;
  const [requestId, setRequestId] = useState('')

  const cancelRequest = useCallback(
    (requestIdToCancel: string) => db.requests.update({
      data: { cancelled: true },
      where: { id: requestIdToCancel }
    }),
    [db.requests]
  )

  useEffect(() => {
    const newRequestId = genUUID()
    db.requests.create({
      data: {
        id: newRequestId,
        path: path,
        method: method,
        data: data,
        processing: false,
        cancelled: false,
      }
    })
    setRequestId(newRequestId);
    return () => {
      cancelRequest(newRequestId)
    }
  }, [db.requests, cancelRequest, path, method, data])


  const requestProcessing = useLiveQuery(db.requests.liveFirst({
    select: { processing: true },
    where: { id: requestId }
  })).results?.processing ?? false

  const response = useLiveQuery(db.responses.liveFirst({
    where: { request_id: requestId }
  })).results

  return {
    response: response != null ?
      {
        statusCode: response.status_code,
        data: response.data as ResultType
      } :
      undefined,
    requestProcessing,
    cancelRequest: () => cancelRequest(requestId),
  }
}