import { Button, IconButton, Slide, SlideProps, Snackbar } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { Close } from '@mui/icons-material'

export const ActivityToast = () => {
  const [visitTime] = useState(new Date())
  const [open, setOpen] = useState(false)

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

  const handleClose = (_event: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return
    }
    setOpen(false)
  }

  // Acknowledge activity by marking it as read
  const handleAck = useCallback(() => {
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
    setOpen(false)
  }, [db.activity_events, liveActivity])

  useEffect(() => {
    if (liveActivity?.id !== undefined) {
      setOpen(true)
    }
  }, [liveActivity?.id])

  return (
    <Snackbar
      key={liveActivity?.id}
      open={open}
      autoHideDuration={3000}
      onClose={handleClose}
      TransitionComponent={TransitionUp}
      TransitionProps={{ onExited: () => setOpen(false) }}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'center',
      }}
      message={liveActivity?.message}
      action={
        <>
          {liveActivity?.action && (
            <Button variant="text" color="inherit" size="small">
              {liveActivity.action}
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
