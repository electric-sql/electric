import { Button, IconButton, Slide, SlideProps, Snackbar } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { Close } from '@mui/icons-material'
import { Activity_events } from '../generated/client'

export const ActivityToast = () => {
  const [visitTime] = useState(new Date())
  const [show, setShow] = useState(false)

  const { db } = useElectric()!

  // Query for most recent activity that has occurred
  // since rendering this component
  const { results: liveActivity } = useLiveQuery(
    db.activity_events.liveFirst({
      orderBy: {
        timestamp: 'desc',
      },
      where: {
        timestamp: {
          gte: visitTime,
        },
      },
    }),
  )

  // Acknowledge activity by marking it as read
  const onAck = useCallback(() => {
    if (liveActivity && liveActivity.read_at === null) {
      db.activity_events.update({
        data: {
          read_at: new Date(),
        },
        where: {
          id: liveActivity.id,
        },
      })
    }
  }, [db.activity_events, liveActivity])

  useEffect(() => {
    if (liveActivity?.id !== undefined) {
      setShow(true)
    }
  }, [liveActivity?.id])

  return <ActivityToastView activity={liveActivity} show={show} onChange={setShow} onAck={onAck} />
}

// *********
// View
// *********

const ActivityToastView = ({
  activity,
  show,
  onChange,
  onAck,
}: {
  activity?: Activity_events | null
  show: boolean
  onChange: (show: boolean) => void
  onAck: (activityId: string) => void
}) => {
  const [open, setOpen] = useState(show)

  const handleAck = () => {
    if (!activity) return
    onAck?.(activity.id)
    setOpen(false)
  }

  const handleClose = (_event: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return
    }
    setOpen(false)
  }

  useEffect(() => setOpen(show), [show])
  useEffect(() => onChange(open), [open])

  return (
    <Snackbar
      key={activity?.id}
      open={open}
      autoHideDuration={3000}
      onClose={handleClose}
      TransitionComponent={TransitionUp}
      TransitionProps={{ onExited: () => setOpen(false) }}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'center',
      }}
      message={activity?.message}
      action={
        <>
          {activity?.action && (
            <Button variant="text" color="inherit" size="small">
              {activity.action}
            </Button>
          )}
          <Button variant="text" color="inherit" size="small" onClick={handleAck}>
            Mark as read
          </Button>
          <IconButton aria-label="close" color="inherit" sx={{ p: 0.5 }} onClick={handleClose}>
            <Close />
          </IconButton>
        </>
      }
    />
  )
}

function TransitionUp(props: SlideProps) {
  return <Slide {...props} direction="up" />
}
