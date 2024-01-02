import {
  Button,
  CircularProgress,
  List, ListItem,
  Paper,
  Typography,
  Collapse,
  Box,
} from "@mui/material"
import { useElectric } from "../electric/ElectricWrapper"
import { useLiveQuery } from "electric-sql/react"
import { useCallback } from "react";
import { genUUID } from "electric-sql/util";

export const BackgroundJobs = () => {
  const { db } = useElectric()!

  const { results: jobs = [] } = useLiveQuery(db.background_jobs.liveMany({
    orderBy: {
      timestamp: 'desc',
    },
    take: 10,
  }))

  const onSubmitJob = useCallback(() => {
    db.background_jobs.create({
      data: {
        id: genUUID(),
        timestamp: new Date(),
        cancelled: false,
        completed: false,
        progress: 0
      }
    })
  }, [db.background_jobs])
  

  return (
    <Paper sx={{ p: 2 }}>
      <Button onClick={onSubmitJob}>
        Submit new job
      </Button>
      <List>
        {
          jobs.map((job) => (
            <ListItem key={job.id} sx={{ display: 'flex', justifyContent: 'space-between'}}>
              <Typography>
                {job.id.slice(0,6)}
              </Typography>
              <Box>
                <Collapse in={!job.completed}>
                  {(job.progress * 100).toLocaleString(undefined, { maximumSignificantDigits: 2 }) + '%'}
                  <CircularProgress
                    variant="determinate"
                    size="1rem"
                    sx={{ ml: 1 }}
                    value={job.progress * 100} />
                  
                </Collapse>
                <Collapse in={job.completed}>
                  {JSON.stringify(job.result)}
                </Collapse>
              </Box>
            </ListItem>
          ))
        }
      </List>
    </Paper>
  )
};