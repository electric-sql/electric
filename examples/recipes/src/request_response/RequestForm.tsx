import { useState } from 'react'
import { RequestFormView } from './RequestFormView'
import { RequestResultView } from './RequestResultView'
import { useElectricQuery, HttpMethod } from './use_electric_query'

const paths = ['/health', '/user/activities', '/payments', '/contacts/new']

export const RequestForm = () => {
  const [requestParams, setRequestParams] = useState<{
    path: string
    method?: HttpMethod
    payload?: string | null
  }>({ path: paths[0] })

  const { data, error, isFetching, isPending, refresh } = useElectricQuery(requestParams)

  return (
    <div>
      <RequestFormView
        paths={paths}
        onSend={(method, path, payload) => {
          setRequestParams({ method, path, payload })
          // refreshing to allow multiple submissions - otherwise
          // request will only be sent once per unique specification
          refresh()
        }}
      />
      <RequestResultView data={data} error={error} isPending={isPending} isFetching={isFetching} />
    </div>
  )
}
