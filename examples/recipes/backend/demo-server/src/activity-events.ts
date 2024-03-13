import { type Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { startGeneratingData } from './pg-utils'
import { faker } from '@faker-js/faker'

enum ActivityType {
  like = 'like',
  comment = 'comment',
  react = 'react',
  invite = 'invite',
  join = 'join',
  message = 'message',
}

function getActivityText(user: string, activity: ActivityType): string {
  switch (activity) {
    case ActivityType.like:
      return `${user} liked your photo.`
    case ActivityType.comment:
      return `${user} commented on your post.`
    case ActivityType.react:
      return `${user} reacted to your post.`
    case ActivityType.invite:
      return `${user} invited you to an event.`
    case ActivityType.join:
      return `${user} joined your group.`
    case ActivityType.message:
      return `${user} sent you a message.`
    default:
      return `${user} performed an unknown activity.`
  }
}

function getActivityAction(activity: ActivityType): string | null {
  switch (activity) {
    case ActivityType.comment:
    case ActivityType.message:
      return 'Reply'
    case ActivityType.invite:
      return 'Accept'
  }
  return null
}

/**
 * Generates a randomized social-media-like activity event for
 * demo-ing purposes
 */
export function generateActivity() {
  const activityType = faker.helpers.arrayElement(Object.values(ActivityType))
  return [
    uuidv4(),
    uuidv4(),
    uuidv4(),
    activityType,
    new Date().toISOString(),
    getActivityText(faker.person.firstName(), activityType),
    getActivityAction(activityType),
    null,
  ]
}

/**
 * Starts generating fake activity events
 */
export async function startGeneratingActivityEvents(pgPool: Pool): Promise<void> {
  await startGeneratingData({
    pgPool: pgPool,
    tableName: 'activity_events',
    rowGenerationQuery: `
      INSERT INTO activity_events(
        id, source_user_id, target_user_id, activity_type,
        timestamp, message, action, read_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    valueGenerator: generateActivity,
    rowGenerationFrequencyMs: 5 * 1000,
    rowGenerationFrequencyVariationMs: 2 * 1000,
    minutesToRetain: 24 * 60,
  })
}
