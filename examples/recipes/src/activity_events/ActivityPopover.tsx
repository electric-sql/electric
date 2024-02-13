import { ActivityPopoverView } from './ActivityPopoverView'
import { useActivityEvents } from './use_activity_events'

export const ActivityPopover = () => {
  const {
    recentActivities,
    numberOfUnreadActivities,
    markActivityAsRead,
    markAllActivitiesAsRead,
  } = useActivityEvents({ maxNumActivities: 5 })

  return (
    <ActivityPopoverView
      recentActivities={recentActivities}
      numUnreadActivities={numberOfUnreadActivities}
      onActivityRead={markActivityAsRead}
      onAllActivitiesRead={markAllActivitiesAsRead}
    />
  )
}
