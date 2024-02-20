import { useMemo } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { HttpMethod } from './use_electric_query'

export interface PaginationState {
  pageSize: number
  pageIndex: number
}

export const useElectricQueryLog = ({
  pagination = { pageIndex: 0, pageSize: 5 },
  startDate,
  endDate,
}: {
  pagination: PaginationState
  startDate?: Date
  endDate?: Date
}) => {
  const { db } = useElectric()!

  // filter for both request and response times between the given dates
  const whereClause = useMemo(() => {
    const safeStartTime = Math.round((startDate?.getTime() ?? 0) / 1000)
    const safeEndTime = Math.round((endDate ?? new Date()).getTime() / 1000)
    return `
      WHERE (strftime('%s', requestTime)
        BETWEEN '${safeStartTime}' AND '${safeEndTime}')
      OR (strftime('%s', responseTime)
        BETWEEN '${safeStartTime}' AND '${safeEndTime}')
    `
  }, [startDate, endDate])

  // Retrieve specified request logs
  const { results: requestLogs } = useLiveQuery<
    {
      requestTime: Date
      path: string
      method: HttpMethod
      payload?: string
      processing: boolean
      cancelled: boolean
      responseTime?: Date
      responseStatus?: number
      responseData?: string
    }[]
  >(
    db.liveRawQuery({
      sql: `
    SELECT
        r.timestamp AS requestTime,
        r.path AS path,
        r.method AS method,
        r.data AS payload,
        r.processing AS processing,
        r.cancelled AS cancelled,
        rs.timestamp AS responseTime,
        rs.status_code AS responseStatus,
        rs.data AS responseData
    FROM requests r
    LEFT JOIN responses rs ON r.id = rs.request_id
    ${whereClause}
    ORDER BY r.timestamp DESC
    LIMIT ${pagination.pageSize}
    OFFSET ${pagination.pageIndex * pagination.pageSize};
    `,
    }),
  )

  // Also get a count for the total data matching the filters
  // such that pagination can be handled correctly
  const totalNumberOfRequests =
    useLiveQuery(
      db.liveRawQuery({
        sql: `
        SELECT
          COUNT(*) AS count,
          r.timestamp AS requestTime,
          rs.timestamp AS responseTime
        FROM requests r
        LEFT JOIN responses rs ON r.id = rs.request_id
        ${whereClause}`,
      }),
    ).results?.[0]?.count ?? 0

  return { requestLogs, totalNumberOfRequests }
}
