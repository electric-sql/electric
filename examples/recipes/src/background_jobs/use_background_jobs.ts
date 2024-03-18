import { useCallback } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { genUUID } from 'electric-sql/util'

export const useBackgroundJobs = ({ maxNumJobs }: { maxNumJobs?: number }) => {
  const { db } = useElectric()!

  const { results: jobs = [] } = useLiveQuery(
    db.background_jobs.liveMany({
      orderBy: { timestamp: 'desc' },
      take: maxNumJobs,
    }),
  )

  const onSubmitJob = useCallback(
    (payload: object = {}) =>
      db.background_jobs.create({
        data: {
          id: genUUID(),
          payload: payload,
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
        where: { id: jobId, completed: false },
      }),
    [db.background_jobs],
  )

  return {
    jobs,
    onSubmitJob,
    onCancelJob,
  }
}
