import { Pool } from 'pg'
import { startGeneratingWebServerLogs } from './web-server-logs'
import { startListeningToPgRequests } from './pg-request-listener'
import { setupApi } from './api-setup'
import { waitForPostgresConnection } from './pg-utils'
import { startGeneratingMonitoringMetrics } from './monitoring-metrics'
import { startProcessingBackgroundJobs } from './background-job-service'
import { startGeneratingChatLogBotMessages } from './chat-room-bot'
import { batchInsertOrders } from './commerce-orders-generation'

const API_PORT = parseInt(process.env.DEMO_APP_PORT ?? '3123')
const pgPool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: parseInt(process.env.PG_PORT ?? '')
})

async function main (): Promise<void> {
  setupApi(API_PORT)

  await waitForPostgresConnection(pgPool)
  void startListeningToPgRequests(pgPool, API_PORT)
  void startGeneratingWebServerLogs(pgPool)
  void startGeneratingMonitoringMetrics(pgPool)
  void startProcessingBackgroundJobs(pgPool)
  void startGeneratingChatLogBotMessages(pgPool)
  void batchInsertOrders(pgPool)
}

void main()
