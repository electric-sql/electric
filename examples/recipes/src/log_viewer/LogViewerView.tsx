import {
  Button,
  Collapse,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import React, { Fragment, useCallback } from 'react'

interface Log {
  id: string
  timestamp: Date
  content: string
}

export const LogViewerView = ({
  logs,
  numHiddenLogs,
  onSearchFilterChange,
  onShowMoreLogs,
}: {
  logs: Log[]
  numHiddenLogs: number
  onSearchFilterChange: (filter: string) => void
  onShowMoreLogs: () => void
}) => {
  const handleSearchInputChange = useCallback<React.ChangeEventHandler<HTMLInputElement>>(
    (e) => onSearchFilterChange(e.target.value),
    [onSearchFilterChange],
  )
  const hasMoreLogsToShow = numHiddenLogs > 0
  return (
    <Paper>
      <List disablePadding dense>
        <ListSubheader
          key="log-header"
          sx={{
            py: 1,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
          <Typography variant="h5">Logs</Typography>
          <TextField
            variant="outlined"
            size="small"
            label="Search filter"
            onChange={handleSearchInputChange}
          />
        </ListSubheader>
        {logs.map((log, index) => (
          <Fragment key={log.id}>
            <ListItem>
              <ListItemText
                primary={`${log.timestamp.toISOString()}: ${JSON.stringify(log.content, null, 2)}`}
              />
            </ListItem>
            {index < logs.length - 1 && <Divider />}
          </Fragment>
        ))}

        <Collapse key="show-more-logs" in={hasMoreLogsToShow}>
          <Button fullWidth onClick={onShowMoreLogs}>
            {hasMoreLogsToShow ? `Show more logs (${numHiddenLogs} more)` : 'Show more logs'}
          </Button>
        </Collapse>
      </List>
    </Paper>
  )
}
