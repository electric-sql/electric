import { useCallback } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'

export const useActivityEvents = ({
  maxNumActivities,
  startingFrom,
}: {
  maxNumActivities?: number
  startingFrom?: Date
}) => {
  const { db } = useElectric()!

  // Query for [maxNumActivities] most recent activities
  const { results: recentActivities = [] } = useLiveQuery(
    db.activity_events.liveMany({
      ...(startingFrom !== undefined && { where: { timestamp: { gte: startingFrom } } }),
      orderBy: { timestamp: 'desc' },
      take: maxNumActivities,
    }),
  )

  // Use raw SQL to count all unread activities
  const numberOfUnreadActivities =
    useLiveQuery(
      db.liveRawQuery({
        sql: 'SELECT COUNT(*) AS count FROM activity_events WHERE read_at IS NULL',
      }),
    ).results?.[0]?.count ?? 0
  // Update individual activity's read status through its ID
  const markActivityAsRead = useCallback(
    (activityId: string) =>
      db.activity_events.update({
        data: { read_at: new Date() },
        where: { id: activityId },
      }),
    [db.activity_events],
  )

  // Mark all unread activities as read
  const markAllActivitiesAsRead = useCallback(
    () =>
      db.activity_events.updateMany({
        data: { read_at: new Date() },
        where: { read_at: null },
      }),
    [db.activity_events],
  )

  return {
    recentActivities,
    numberOfUnreadActivities,
    markActivityAsRead,
    markAllActivitiesAsRead,
  }
}
