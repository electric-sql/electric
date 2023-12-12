import {
  Avatar, IconButton,
  Badge, Box, Button, Collapse, Container, Fade, Grid,
  List, ListItemButton, ListItemIcon, ListItemText,
  Popover, Slide, SlideProps, Snackbar
} from "@mui/material"
import { Close, FiberManualRecord, Notifications } from "@mui/icons-material"
import { NavigationBar } from "../components/NavigationBar"
import { memo, useEffect, useState } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { useLiveQuery } from "electric-sql/react"
import { genUUID } from "electric-sql/util"
import { Activity_events } from "../generated/client"

export const ActivityEventsExample = () => {
  const [ visitTime ] = useState(Date.now())
  const { db } = useElectric()!
  

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
          <ActivityPopover key="notifications" />
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

const ActivityPopover = () => {
  const { db } = useElectric()!
  const { results: mostRecentActivities = [] } = useLiveQuery(
    db.activity_events.liveMany({
      orderBy: {
        timestamp: 'desc'
      },
      take: 5, 
    })
  )

  const numUnreadActivities = useLiveQuery(
    db.liveRaw({
      sql: 'SELECT COUNT(*) FROM activity_events WHERE read_at IS NULL'
    })
  ).results?.[0]?.['COUNT(*)'] ?? 0
  const hasUnreadActivities = numUnreadActivities > 0;

  
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);


  const markActivityAsRead = (activityId: string) => {
    db.activity_events.update({
      data: {
        read_at: Date.now()
      },
      where: {
        id: activityId,
      }
    })
  }
  
  const markAllAsRead = () => {
    db.activity_events.updateMany({
      data: {
        read_at: Date.now()
      },
      where: {
        read_at: null
      }
    })
  }

  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchorEl(e.currentTarget)}>
        <Badge
          color="secondary"
          variant="dot"
          invisible={!hasUnreadActivities}
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
        <Box pb={1}>
          <List>
            {mostRecentActivities.map((activity) => (
              <ListItemButton
                key={activity.id}
                onPointerEnter={
                  () =>
                    activity.read_at ?
                    null :
                    markActivityAsRead(activity.id)
                }
              >
                <ListItemIcon>
                  <Avatar>{activity.source.slice(0,1)}</Avatar>
                </ListItemIcon>
                <ListItemText
                  primary={activity.message}
                  secondary={formatDate(activity.timestamp)}
                />
                <Fade in={activity.read_at == null}>
                  <FiberManualRecord style={{color: 'red', width: 8, marginLeft: 16}}/>
                </Fade>
              </ListItemButton>
            ))}
          </List>

          <Button fullWidth>
            {
            'See all activities' +
            (hasUnreadActivities ? ` (${numUnreadActivities} unread)` : '')
            }
          </Button>

          <Collapse in={hasUnreadActivities} collapsedSize={0}>
            <Button fullWidth
              disabled={!hasUnreadActivities}
              onClick={markAllAsRead}>
              Mark all as read
            </Button>
          </Collapse>
        </Box>
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

function formatDate(unixTime: number): string {
  const options: Intl.DateTimeFormatOptions = { 
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }
  const formattedDate = new Date(unixTime).toLocaleDateString(
    navigator.language,
    options
  );
  return formattedDate;
}