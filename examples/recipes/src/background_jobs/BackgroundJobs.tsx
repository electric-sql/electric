import { BackgroundJobsView } from './BackgroundJobsView'
import { useBackgroundJobs } from './use_background_jobs'

export const BackgroundJobs = ({ numJobsToShow = 10 }: { numJobsToShow?: number }) => {
  const { jobs, onSubmitJob, onCancelJob } = useBackgroundJobs({ maxNumJobs: numJobsToShow })
  return <BackgroundJobsView jobs={jobs} onSubmitJob={onSubmitJob} onCancelJob={onCancelJob} />
}
