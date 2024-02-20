import { useState } from 'react'
import { RequestAuditLogView } from './RequestAuditLogView'
import { useElectricQueryLog, PaginationState } from './use_electric_query_log'

export const RequestAuditLog = () => {
  // Keep pagination state to only load necessary data
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 5,
  })

  const { requestLogs, totalNumberOfRequests } = useElectricQueryLog({
    pagination,
    startDate: new Date('2024-02-20 11:00:00.000Z'),
    endDate: new Date('2024-02-21 04:05:00.000Z'),
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
