import {
  Paper,
  Button,
  CircularProgress,
  Collapse,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
} from '@mui/material'
import { Cancel, Check, HorizontalRule } from '@mui/icons-material'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { useCallback } from 'react'
import { genUUID } from 'electric-sql/util'

export const BackgroundJobs = ({ numJobsToShow = 10 }: { numJobsToShow?: number }) => {
  const { db } = useElectric()!

  // Select [numJobsToShow] most recently submitted jobs to show - which
  // will contain progress info, completion status, and any results as well
  const { results: jobs = [] } = useLiveQuery(
    db.background_jobs.liveMany({
      orderBy: {
        timestamp: 'desc',
      },
      take: numJobsToShow,
    }),
  )

  const onSubmitJob = useCallback(
    () =>
      db.background_jobs.create({
        data: {
          id: genUUID(),
          timestamp: new Date(),
          cancelled: false,
          completed: false,
          progress: 0,
        },
      }),
    [db.background_jobs],
  )

  const onCancelJob = useCallback(
    (jobId: string) =>
      db.background_jobs.update({
        data: { cancelled: true },
        where: { id: jobId },
      }),
    [db.background_jobs],
  )

  return (
    <Paper
      sx={{
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
      <Button variant="contained" sx={{ my: 2 }} onClick={onSubmitJob}>
        Submit new job
      </Button>
      <BackgroundJobsTableView jobs={jobs} onCancelJob={onCancelJob} />
    </Paper>
  )
}

// *********
// View
// *********

interface Job {
  id: string
  timestamp: Date
  progress: number
  result?: unknown
  completed: boolean
  cancelled: boolean
}

const BackgroundJobsTableView = ({
  jobs,
  onCancelJob,
}: {
  jobs: Job[]
  onCancelJob: (jobId: string) => void
}) => {
  return (
    <TableContainer>
      <Table align="center">
        <TableHead>
          <TableRow>
            <TableCell align="left">Job ID</TableCell>
            <TableCell align="left">Submitted At</TableCell>
            <TableCell align="right">Progress</TableCell>
            <TableCell align="right">Result</TableCell>
            <TableCell align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell align="left">{job.id.slice(0, 6)}</TableCell>
              <TableCell align="left">{job.timestamp.toLocaleString()}</TableCell>
              <TableCell align="right">
                <Collapse in={!job.completed && !job.cancelled}>
                  {(job.progress * 100).toLocaleString(undefined, {
                    maximumSignificantDigits: 2,
                  }) + '%'}
                  <CircularProgress
                    variant="determinate"
                    size="1rem"
                    sx={{ ml: 1 }}
                    value={job.progress * 100}
                  />
                </Collapse>
                <Collapse in={job.completed || job.cancelled}>
                  {job.completed ? (
                    <Check color="primary" sx={{ height: '1rem' }} />
                  ) : (
                    <HorizontalRule sx={{ height: '1rem' }} />
                  )}
                </Collapse>
              </TableCell>
              <TableCell align="right">
                <Collapse in={job.completed || job.cancelled}>
                  {job.completed ? JSON.stringify(job.result) : 'cancelled'}
                </Collapse>
              </TableCell>

              <TableCell align="right">
                <Button
                  color="secondary"
                  disabled={job.cancelled || job.completed}
                  onClick={() => onCancelJob(job.id)}>
                  <Cancel sx={{ height: '1rem' }} />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
