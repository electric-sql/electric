import {
  Avatar,
  IconButton,
  Badge,
  Box,
  Button,
  Collapse,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
} from '@mui/material'
import { Notifications } from '@mui/icons-material'
import { ReactElement, useState } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { CURRENT_USER, formatDateTime } from './utilities'
import { Activity_events } from '../generated/client'

export const ActivityPopover = () => {
  const { db } = useElectric()!

  // Query for 5 most recent activities
  const { results: mostRecentActivities = [] } = useLiveQuery(
    db.activity_events.liveMany({
      where: {
        target: CURRENT_USER,
      },
      orderBy: {
        timestamp: 'desc',
      },
      take: 5,
    }),
  )

  // Use raw SQL to count all unread activities
  const numUnreadActivities =
    useLiveQuery(
      db.liveRawQuery({
        sql: `
      SELECT COUNT(*) FROM activity_events
      WHERE target = '${CURRENT_USER}' AND read_at IS NULL`,
      }),
    ).results?.[0]?.['COUNT(*)'] ?? 0

  // Update individual activity's read status through its ID
  const markActivityAsRead = (activityId: string) =>
    db.activity_events.update({
      data: {
        read_at: new Date(),
      },
      where: {
        id: activityId,
      },
    })

  // Update all unread activities using a WHERE clause
  const markAllAsRead = () =>
    db.activity_events.updateMany({
      data: {
        read_at: new Date(),
      },
      where: {
        read_at: null,
      },
    })

  return (
    <ActivityPopoverView
      recentActivities={mostRecentActivities}
      numUnreadActivities={numUnreadActivities}
      onActivityRead={markActivityAsRead}
      onAllActivitiesRead={markAllAsRead}
    />
  )
}

// *********
// View
// *********

const ActivityPopoverView = ({
  recentActivities,
  numUnreadActivities,
  onActivityRead,
  onAllActivitiesRead,
}: {
  recentActivities: Activity_events[]
  numUnreadActivities: number
  onActivityRead: (activityId: string) => void
  onAllActivitiesRead: () => void
}) => {
  const hasUnreadActivities = numUnreadActivities > 0
  return (
    <NotificationPopover showBadge={hasUnreadActivities}>
      <Box pb={1}>
        <List>
          {recentActivities.map((activity) => (
            <ListItemButton
              key={activity.id}
              onPointerEnter={() => (activity.read_at ? null : onActivityRead(activity.id))}>
              <ListItemIcon>
                <Avatar>{activity.source.slice(0, 1)}</Avatar>
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
          {'See all activities' + (hasUnreadActivities ? ` (${numUnreadActivities} unread)` : '')}
        </Button>

        <Collapse in={hasUnreadActivities} collapsedSize={0}>
          <Button fullWidth disabled={!hasUnreadActivities} onClick={onAllActivitiesRead}>
            Mark all as read
          </Button>
        </Collapse>
      </Box>
    </NotificationPopover>
  )
}

const NotificationPopover = ({
  children,
  showBadge = false,
}: {
  children: ReactElement[] | ReactElement
  showBadge: boolean
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchorEl(e.currentTarget)}>
        <Badge color="secondary" variant="dot" invisible={!showBadge}>
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
        }}>
        {children}
      </Popover>
    </>
  )
}
