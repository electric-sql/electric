/* eslint-disable react-hooks/exhaustive-deps */
import {
  Avatar, IconButton,
  Badge, Box, Button, Collapse, Container,
  List, ListItemButton, ListItemIcon, ListItemText,
  Popover, Slide, SlideProps, Snackbar
} from "@mui/material"
import { Close, Notifications } from "@mui/icons-material"
import { NavigationBar } from "../components/NavigationBar"
import { useCallback, useEffect, useState } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { useLiveQuery } from "electric-sql/react"
import { genUUID } from "electric-sql/util"
import { formatDateTime } from "./utilities"

export const ActivityEventsExample = () => {
  const { db } = useElectric()!
  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.activity_events.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <NavigationBar title="Activity Events" items={
        [
          <ActivityPopover key="notifications" />
        ]
      }/>
      <Container maxWidth="sm" sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%'
      }}>
          <Button variant="contained" size="large" onClick={generateActivity}>
            Generate activity
          </Button>
        <ActivityToast />
      </Container>
    </Box>
  )

}

const ActivityPopover = () => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

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

  


  const markActivityAsRead = (activityId: string) =>
    db.activity_events.update({
      data: {
        read_at: Date.now()
      },
      where: {
        id: activityId,
      }
    })
  
  
  const markAllAsRead = () => 
    db.activity_events.updateMany({
      data: {
        read_at: Date.now()
      },
      where: {
        read_at: null
      }
    })

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
                  secondary={formatDateTime(activity.timestamp)}
                />
                <Badge
                  color="secondary"
                  variant="dot"
                  invisible={activity.read_at !== null}
                  sx={{ width: 24 }}
                />
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

const ActivityToast = () => {
  const [ visitTime ] = useState(Date.now())
  const [open, setOpen] = useState(false);

  const { db } = useElectric()!
  const { results: liveActivity } = useLiveQuery(
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
    if (liveActivity?.id !== undefined) {
      setOpen(true);
    }
  }, [liveActivity?.id])

  const handleClose = (_event: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setOpen(false);
  };

  const handleAck = useCallback(() => {
    if (liveActivity && liveActivity.read_at === null) {
      db.activity_events.update({
        data: {
          read_at: Date.now()
        },
        where: {
          id: liveActivity.id
        }
      })
    }
    setOpen(false);
  }, [liveActivity]);


  return (
    <Snackbar
        key={liveActivity?.id}
        open={open}
        autoHideDuration={6000}
        onClose={handleClose}
        TransitionComponent={TransitionUp}
        TransitionProps= {{ onExited: () => setOpen(false) }}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center'
        }}
        message={liveActivity?.message}
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
}

function TransitionUp(props: SlideProps) {
  return <Slide {...props} direction="up" />;
}