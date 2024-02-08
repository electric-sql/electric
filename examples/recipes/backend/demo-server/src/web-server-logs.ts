import { type Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { startGeneratingData } from './pg-utils'
import { faker } from '@faker-js/faker'

/**
 * Generates randomized web server log
 */
function generateWebServerLog(): string {
  const ipAddress = faker.internet.ipv4()
  const httpMethod = faker.internet.httpMethod()
  const url = faker.internet.url()
  const statusCode = faker.internet.httpStatusCode({
    types: ['success', 'clientError', 'serverError'],
  })
  return `${ipAddress} - ${httpMethod} ${url} - ${statusCode}`
}

/**
 * Starts generating web server logs with variant frequency, also
 * regularly cleans up old logs
 */
export async function startGeneratingWebServerLogs(pgPool: Pool): Promise<void> {
  await startGeneratingData({
    pgPool: pgPool,
    tableName: 'logs',
    rowGenerationQuery: 'INSERT INTO logs(id, timestamp, content) VALUES($1, $2, $3)',
    valueGenerator: () => [uuidv4(), new Date().toISOString(), generateWebServerLog()],
    rowGenerationFrequencyMs: 250,
    rowGenerationFrequencyVariationMs: 200,
  })
}
