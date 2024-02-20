import { useState } from 'react'
import { RequestFormView } from './components/RequestFormView'
import { RequestResultView } from './components/RequestResultView'
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
          // refreshing here to allow re-submissions - otherwise
          // request will only be executed once per unique
          // method-path-payload combination
          refresh()
        }}
      />
      <RequestResultView data={data} error={error} isPending={isPending} isFetching={isFetching} />
    </div>
  )
}
