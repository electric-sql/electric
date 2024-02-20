import { useState } from 'react'
import { RequestAuditLogView } from './components/RequestAuditLogView'
import { useElectricQueryLog, PaginationState } from './use_electric_query_log'

export const RequestAuditLog = () => {
  // Keep pagination state to only load necessary data
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 5,
  })

  const { requestLogs, totalNumberOfRequests } = useElectricQueryLog({
    pagination,
    // can also specify datetime range
  })

  return (
    <RequestAuditLogView
      rows={requestLogs}
      totalNumberOfRows={totalNumberOfRequests}
      pagination={pagination}
      onPaginationChange={setPagination}
    />
  )
}
