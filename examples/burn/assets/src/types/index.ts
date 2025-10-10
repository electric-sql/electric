import type { Event, Fact, User } from '../db/schema'

export type EventResult = Pick<
  Event,
  | 'id'
  | 'type'
  | 'data'
  | 'thread_id'
  | 'inserted_at'
> & {
  user_id: User['id']
  user_avatar: User['avatar_url']
  user_name: User['name']
  user_type: User['type']
}

export type FactResult = Pick<
  Fact,
  | 'id'
  | 'predicate'
  | 'object'
  | 'category'
  | 'confidence'
  | 'disputed'
  | 'inserted_at'
> & {
  subject: User['name']
}

export type EventTypeColor = 'green' | 'orange' | 'yellow'
export type UserBadgeColor = 'blue' | 'purple'
