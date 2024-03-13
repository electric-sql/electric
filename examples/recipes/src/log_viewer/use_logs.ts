import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'

export const useLogs = ({
  maxNumberOfLogs = 10,
  searchFilter = '',
  sourceId,
}: {
  maxNumberOfLogs: number
  searchFilter: string
  sourceId?: string
}) => {
  const { db } = useElectric()!

  // Retrieve specified number of logs matching filter in descending
  // chronological order
  const { results: logs = [] } = useLiveQuery(
    db.logs.liveMany({
      where: {
        content: { contains: searchFilter },
        ...(sourceId && { source_id: sourceId }),
      },
      orderBy: { timestamp: 'desc' },
      take: maxNumberOfLogs,
    }),
  )

  // Use raw SQL to count all logs matching filter
  const totalNumberOfLogs =
    useLiveQuery(
      db.liveRawQuery({
        sql: `
        SELECT COUNT(*) AS count FROM logs WHERE
        content LIKE ?
        ${sourceId ? `AND source_id = ?` : ''}
      `,
        args: [`%${searchFilter}%`, ...(sourceId ? [sourceId] : [])],
      }),
    ).results?.[0]?.count ?? 0

  return {
    logs,
    totalNumberOfLogs,
  }
}
