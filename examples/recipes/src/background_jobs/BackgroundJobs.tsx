import {
  Button,
  List, ListItem,
  Paper,
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
    take: 5,
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
    <Paper>
      <Button onClick={onSubmitJob}>
        Submit new job
      </Button>
      <List>
        {
          jobs.map((job) => (
            <ListItem key={job.id}>
              {[job.id, job.progress, job.completed, job.result].join(' - ')}
            </ListItem>
          ))
        }
      </List>
    </Paper>
  )
};