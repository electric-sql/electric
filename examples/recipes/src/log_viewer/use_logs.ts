import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'

export const useLogs = ({
  maxNumberOfLogs = 10,
  searchFilter = '',
}: {
  maxNumberOfLogs: number
  searchFilter: string
}) => {
  const { db } = useElectric()!

  // Retrieve specified number of logs matching filter in descending
  // chronological order
  const { results: logs = [] } = useLiveQuery(
    db.logs.liveMany({
      orderBy: { timestamp: 'desc' },
      where: { content: { contains: searchFilter } },
      take: maxNumberOfLogs,
    }),
  )

  // Use raw SQL to count all logs matching filter
  const totalNumberOfLogs =
    useLiveQuery(
      db.liveRawQuery({
        sql: `SELECT COUNT(*) FROM logs WHERE content LIKE '%?%';`,
        args: [searchFilter],
      }),
    ).results?.[0]?.['COUNT(*)'] ?? 0

  return {
    logs,
    totalNumberOfLogs,
  }
}
