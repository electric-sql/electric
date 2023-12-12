import {
  Badge, Button, Container, Grid,
  IconButton, Popover, Slide, SlideProps, Snackbar
} from "@mui/material"
import { NavigationBar } from "../components/NavigationBar"
import { Close, Notifications } from "@mui/icons-material"
import { memo, useEffect, useState } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { useLiveQuery } from "electric-sql/react"
import { genUUID } from "electric-sql/util"
import { Activity_events } from "../generated/client"

export const ActivityEventsExample = () => {
  const [ visitTime ] = useState(Date.now())
  const { db } = useElectric()!
  // const { results: allActivities } = useLiveQuery(
  //   db.activity_events.liveMany({
  //     orderBy: {
  //       timestamp: 'desc'
  //     },
  //     take: 5, 
  //   })
  // )

  // const { results: numUnreadActivities } = useLiveQuery(
  //   db.liveRaw({
  //     sql: 'SELECT COUNT(id) as count FROM activity_events WHERE read_at = NULL'
  //   })
  // )

  const { results: mostRecentLiveActivity } = useLiveQuery(
    db.activity_events.liveFirst({
      orderBy: {
        timestamp: 'desc'
      },
      where: {
        timestamp: {
          gte: visitTime
        }
      }
    })
  )

  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.activity_events.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generateActivity = () => {
    db.activity_events.create({
      data: {
        id: genUUID(),
        source: 'Alice',
        activity_type: 'like',
        timestamp: Date.now(),
        message: Math.random() > 0.5 ? 'Alice liked your comment' : 'Bob commented on your post',
      }
    })
  }


  return (
    <div>
      <NavigationBar title="Activity Events" items={
        [
          <NotificationPopover key="notifications" />
        ]
      }/>
      <Container maxWidth="sm">
        <Grid container justifyContent="center" alignItems="center">
          <Grid item>
            <Button variant="outlined" onClick={generateActivity}>
              Primary
            </Button>
          </Grid>
        </Grid>

        <ActivityToast key="shi" activity={mostRecentLiveActivity} />
      </Container>
    </div>
  )

}

const NotificationPopover = () => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchorEl(e.currentTarget)}>
        <Badge
          color="secondary"
          variant="dot"
          invisible={false}
        >
          <Notifications />
        </Badge>
      </IconButton>
      <Popover
        open={anchorEl !== null}
        onClose={() => setAnchorEl(null)}
        anchorEl={anchorEl}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        >
      </Popover>
    </>
  )
}

const ActivityToast = memo(function ActivityToastRaw({
  activity,
  onAck
} : {
  activity?: Activity_events,
  onAck?: () => void
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (activity?.id !== undefined) {
      setOpen(true);
    }
  }, [activity?.id])

  const handleClose = (_event: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setOpen(false);
  };

  const handleAck = () => {
    onAck?.();
    setOpen(false);
  }


  return (
    <Snackbar
        key={activity?.id}
        open={open}
        autoHideDuration={6000}
        onClose={handleClose}
        TransitionComponent={TransitionUp}
        TransitionProps= {{ onExited: () => setOpen(false) }}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center'
        }}
        message={activity?.message}
        action={
          <>
            <Button color="secondary" size="small" onClick={handleAck}>
              Mark as read
            </Button>
            <IconButton
              aria-label="close"
              color="inherit"
              sx={{ p: 0.5 }}
              onClick={handleClose}
            >
              <Close />
            </IconButton>
          </>
        }
      />
  )
}, (prevProps, newProps) => prevProps.activity?.id == newProps.activity?.id);

function TransitionUp(props: SlideProps) {
  return <Slide {...props} direction="up" />;
}