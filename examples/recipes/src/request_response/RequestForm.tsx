import { useState } from 'react'
import { RequestFormView } from './RequestFormView'
import { useElectricQuery, HttpMethod } from './use_electric_query'
import { RequestResultView } from './RequestResultView'
const paths = ['/health', '/user/activities', '/payments', '/contacts/new']

export const RequestForm = () => {
  const [requestParams, setRequestParams] = useState<{
    path: string
    method?: HttpMethod
    payload?: string | null
  }>({ path: paths[0] })

  const { data, error, isFetching, isPending } = useElectricQuery(requestParams)

  return (
    <div>
      <RequestFormView
        paths={paths}
        onSend={(method, path, payload) => setRequestParams({ method, path, payload })}
      />
      <RequestResultView data={data} error={error} isPending={isPending} isFetching={isFetching} />
    </div>
  )
}
