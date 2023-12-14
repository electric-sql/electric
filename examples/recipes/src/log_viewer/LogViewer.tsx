import {
  Button, Collapse, Divider,
  List, ListItem, ListItemText, ListSubheader,
  Paper, TextField, Typography
} from "@mui/material"
import {  useEffect, useState } from "react"
import { useElectric } from "../electric/ElectricWrapper"
import { useLiveQuery } from "electric-sql/react"

export const LogViewer = ({ defaultNumLogs = 10} : { defaultNumLogs?: number }) => {
  const [numLogsToShow, setNumLogsToShow] = useState(defaultNumLogs)
  const [searchFilter, setSearchFilter] = useState('')

  const { db } = useElectric()!

  // Retrieve specified number of logs matching filter in descending
  // chronological order
  const { results: logs = [] } = useLiveQuery(db.logs.liveMany({
    orderBy: {
      timestamp: 'desc',
    },
    where: {
      content: {
        contains: searchFilter
      }
    },
    take: numLogsToShow,
  }))

  // Use raw SQL to count all logs matching filter
  const totalNumberOfLogs = useLiveQuery(
    db.liveRaw({
      sql: `SELECT COUNT(*) FROM logs WHERE content LIKE '%${searchFilter}%';`
    })
  ).results?.[0]?.['COUNT(*)'] ?? 0;
  
  // Reset number of logs shown when updating search filter
  useEffect(() => {
    if (searchFilter.length > 0) {
      setNumLogsToShow(defaultNumLogs)
    }
  }, [searchFilter, defaultNumLogs])

  return (
    <div>
      <Paper>
        <List disablePadding dense>
          <ListSubheader sx={{
            py: 1, 
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <Typography variant="h5">
              Logs
            </Typography>
            <TextField
              variant="outlined"
              size="small"
              label="Search filter"
              onChange={(e) => setSearchFilter(e.target.value)}
              />
          </ListSubheader>            
          {logs.map((log, index) => (
            <>
              <ListItem key={index}>
                <ListItemText
                  primary={`${log.timestamp.toISOString()}: ${JSON.stringify(log.content, null, 2)}`}
                />
              </ListItem>
              {index < logs.length - 1 && <Divider />}
            </>
          ))}

          <Collapse in={totalNumberOfLogs > numLogsToShow}>
            <Button
              fullWidth
              onClick={() => setNumLogsToShow((num) => num + defaultNumLogs)}
            >
              {`Show more logs (${totalNumberOfLogs - numLogsToShow} more)`}
            </Button>
          </Collapse>
        </List>
      </Paper>
    </div>
  );
};
