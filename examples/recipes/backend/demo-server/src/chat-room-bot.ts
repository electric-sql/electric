import { type Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { startGeneratingData } from './pg-utils'
import { faker } from '@faker-js/faker'

/**
 * Starts generating chat room bot messages
 */
export async function startGeneratingChatLogBotMessages(pgPool: Pool): Promise<void> {
  await startGeneratingData({
    pgPool: pgPool,
    tableName: 'chat_room',
    rowGenerationQuery:
      'INSERT INTO chat_room(id, timestamp, username, message) VALUES($1, $2, $3, $4)',
    valueGenerator: () => [
      uuidv4(),
      new Date().toISOString(),
      `${faker.person.firstName()} [BOT]`,
      faker.lorem.sentence(),
    ],
    rowGenerationFrequencyMs: 20 * 1000,
    rowGenerationFrequencyVariationMs: 10 * 1000,
    minutesToRetain: 24 * 60,
  })
}
