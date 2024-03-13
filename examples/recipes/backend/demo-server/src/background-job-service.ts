import { type Notification, type Pool } from 'pg'
import { wait } from './timing-utils'

/**
 * Starts listening to job submissions to process them
 */
export async function startProcessingBackgroundJobs(pgPool: Pool): Promise<void> {
  const pgClient = await pgPool.connect()

  // Listen for PostgreSQL notifications
  await pgClient.query('LISTEN process_background_job')

  // Handle notifications
  pgClient.on('notification', (notification: Notification) => {
    const payload = JSON.parse(notification.payload ?? '{}') as { id?: string }
    console.log(`Received job to process with ID: ${payload.id}`)

    const processJob = async (jobId: string): Promise<void> => {
      // wait some time between 500ms and 2000ms to
      // emulate some arbitrary processing workflow
      await wait(Math.max(500, Math.random() * 2000))

      // retrieve job data
      const jobInfo = (
        await pgClient.query(`SELECT cancelled, progress FROM background_jobs WHERE id = $1`, [
          jobId,
        ])
      ).rows[0]

      // if job was cancelled, stop processing
      if (jobInfo.cancelled ?? false) return

      // calculate arbitrary new progress and update it if not complete
      const newProgress = Math.min(1, (jobInfo.progress ?? 0) + Math.random() * 0.2)
      if (newProgress < 1) {
        await pgClient.query('UPDATE background_jobs SET progress = $1 WHERE id = $2', [
          newProgress,
          jobId,
        ])
        return processJob(jobId)
      }

      // if job is complete, set completion flag and result
      await pgClient.query(
        'UPDATE background_jobs SET progress = $1, completed = TRUE, result = $2 WHERE id = $3',
        [1.0, JSON.stringify({ message: 'success' }), jobId],
      )
    }

    processJob(payload.id!).catch(console.error)
  })
}
