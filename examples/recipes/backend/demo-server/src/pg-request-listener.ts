import { type Notification, type Pool } from 'pg'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'

/**
 * Starts listening to request notifications from Postgres, redirecting
 * them to the appropriate API
 */
export async function startListeningToPgRequests (pgPool: Pool, apiPort: number): Promise<void> {
  const pgClient = await pgPool.connect()

  // Listen for PostgreSQL notifications
  await pgClient.query('LISTEN api_trigger')

  // Handle notifications
  pgClient.on('notification', (notification: Notification) => {
    const payload = JSON.parse(notification.payload ?? '{}') as {
      id?: string
      path?: string
      method?: string
      data?: string
    }
    console.log(`Received request: ${payload.path} - ${payload.method} - ${payload.data}`)

    const handleRequest = async (): Promise<void> => {
      let response
      try {
        // Make an API request using the information from the notification payload
        response = await axios({
          method: 'GET',
          url: `http://localhost:${apiPort}/random-result`,
        })
      } catch (err: any) {
        response = {
          status: err?.response?.status ?? 500,
          data: { message: err?.message ?? 'Failed to process' }
        }
      }

      console.log(`Received response: ${response.status} - ${JSON.stringify(response.data)}`)

      // Insert the API response into the 'responses' table
      const query = 'INSERT INTO responses (id, timestamp, request_id, status_code, data) VALUES ($1, $2, $3, $4, $5)'
      const values = [
        uuidv4(),
        (new Date()).toISOString(),
        payload.id,
        response.status,
        JSON.stringify(response.data)
      ]
      await pgClient.query(query, values)
    }
    handleRequest().catch((err: any) => {
      console.error('Failed to process PG notification with error:', err)
    })
  })
}
