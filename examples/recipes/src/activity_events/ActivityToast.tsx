import { useEffect, useState } from 'react'
import { ActivityToastView } from './ActivityToastView'
import { useActivityEvents } from './use_activity_events'

export const ActivityToast = () => {
  const [visitTime] = useState(new Date())
  const [show, setShow] = useState(false)

  // Get most recent activity since mounting this component
  const {
    recentActivities: [liveActivity],
    markActivityAsRead,
  } = useActivityEvents({ maxNumActivities: 1, startingFrom: visitTime })

  // Show the toast whenever a new activity is detected
  useEffect(() => {
    if (liveActivity?.id !== undefined) setShow(true)
  }, [liveActivity?.id])

  return (
    <ActivityToastView
      activity={liveActivity}
      show={show}
      onChange={setShow}
      onAck={() => markActivityAsRead(liveActivity.id)}
    />
  )
}
