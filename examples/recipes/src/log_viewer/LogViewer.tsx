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
import React, { Fragment, useCallback, useEffect, useState } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'

export const LogViewer = ({
  defaultNumLogsToShow = 10,
  additionalLogsToShow = 10,
}: {
  defaultNumLogsToShow?: number
  additionalLogsToShow?: number
}) => {
  const [numLogsToShow, setNumLogsToShow] = useState(defaultNumLogsToShow)
  const [searchFilter, setSearchFilter] = useState('')

  const { db } = useElectric()!

  // Retrieve specified number of logs matching filter in descending
  // chronological order
  const { results: logs = [] } = useLiveQuery(
    db.logs.liveMany({
      orderBy: {
        timestamp: 'desc',
      },
      where: {
        content: {
          contains: searchFilter,
        },
      },
      take: numLogsToShow,
    }),
  )

  // Use raw SQL to count all logs matching filter
  const totalNumberOfLogs =
    useLiveQuery(
      db.liveRaw({
        sql: `SELECT COUNT(*) FROM logs WHERE content LIKE '%${searchFilter}%';`,
      }),
    ).results?.[0]?.['COUNT(*)'] ?? 0

  // Reset number of logs shown when updating search filter
  useEffect(() => {
    if (searchFilter.length > 0) {
      setNumLogsToShow(defaultNumLogsToShow)
    }
  }, [searchFilter, defaultNumLogsToShow])

  // Increase number of logs to "take" from db
  const handleShowMore = useCallback(
    () => setNumLogsToShow((currentNum) => currentNum + additionalLogsToShow),
    [additionalLogsToShow],
  )

  return (
    <LogViewerView
      logs={logs}
      numHiddenLogs={totalNumberOfLogs - numLogsToShow}
      onSearchFilterChange={setSearchFilter}
      onShowMoreLogs={handleShowMore}
    />
  )
}

// *********
// View
// *********
interface Log {
  id: string
  timestamp: Date
  content: string
}

const LogViewerView = ({
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
