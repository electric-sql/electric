import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import {
  createCollection,
  localStorageCollectionOptions,
} from '@tanstack/react-db'
import { ingestMutations } from './mutations'
import {
  authSchema,
  eventSchema,
  factSchema,
  membershipSchema,
  threadSchema,
  userSchema,
} from './schema'

import type { Value } from '@electric-sql/client'
import type { ElectricCollectionUtils } from '@tanstack/electric-db-collection'
import type {
  InsertMutationFn,
  UpdateMutationFn,
  DeleteMutationFn,
} from '@tanstack/react-db'
import type { Auth, Event, Fact, Membership, Thread, User } from './schema'

type CollectionKey = string | number

export const authCollection = createCollection<Auth>(
  localStorageCollectionOptions({
    storageKey: 'auth',
    getKey: (item: Auth) => item.key,
    onInsert: async () => true,
    onUpdate: async () => true,
    onDelete: async () => true,
    schema: authSchema,
  })
)

const headers = {
  Authorization: async () => {
    const auth = authCollection.get('current')

    return auth ? `Bearer ${auth.user_id}` : 'Unauthenticated'
  },
}

async function onError(error: Error) {
  const status =
    'status' in error && Number.isInteger(error.status)
    ? error.status as number
    : undefined

  if (status === 403 && authCollection.has('current')) {
    await authCollection.delete('current')

    return { headers }
  }

  if (status === 401) {
    await new Promise((resolve) => authCollection.subscribeChanges(resolve))

    return { headers }
  }

  throw error
}

const parser = {
  timestamp: (dateStr: string) => {
    // Timestamps sync in as naive datetime strings with no
    // timezone info because they're all implicitly UTC.
    const utcDateStr = dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`
    const date: Date = new Date(utcDateStr)

    // Cast to `Value`` because we haven't fixed the typing yet
    // https://github.com/TanStack/db/pull/201
    return date as unknown as Value
  },
}

const baseShapeOptions = {
  headers,
  onError,
  parser,
}

function operationHandlers<Type extends object>() {
  return {
    onInsert: ingestMutations as InsertMutationFn<Type>,
    onUpdate: ingestMutations as UpdateMutationFn<Type>,
    onDelete: ingestMutations as DeleteMutationFn<Type>,
  }
}

function relativeUrl(path: string) {
  return `${window.location.origin}${path}`
}

export const eventCollection = createCollection<
  Event,
  CollectionKey,
  ElectricCollectionUtils
>(
  electricCollectionOptions({
    id: `events`,
    shapeOptions: {
      url: relativeUrl('/sync/events'),
      ...baseShapeOptions,
    },
    getKey: (item: Event) => item.id as string,
    schema: eventSchema,
    ...operationHandlers<Event>(),
  })
)

export const factCollection = createCollection<
  Fact,
  CollectionKey,
  ElectricCollectionUtils
>(
  electricCollectionOptions({
    id: `facts`,
    shapeOptions: {
      url: relativeUrl('/sync/facts'),
      ...baseShapeOptions,
    },
    getKey: (item: Fact) => item.id as string,
    schema: factSchema,
    ...operationHandlers<Fact>(),
  })
)

export const membershipCollection = createCollection<
  Membership,
  CollectionKey,
  ElectricCollectionUtils
>(
  electricCollectionOptions({
    id: `memberships`,
    shapeOptions: {
      url: relativeUrl('/sync/memberships'),
      ...baseShapeOptions,
    },
    getKey: (item: Membership) => item.id as string,
    schema: membershipSchema,
    ...operationHandlers<Membership>(),
  })
)

export const threadCollection = createCollection<
  Thread,
  CollectionKey,
  ElectricCollectionUtils
>(
  electricCollectionOptions({
    id: `threads`,
    shapeOptions: {
      url: relativeUrl('/sync/threads'),
      ...baseShapeOptions,
    },
    getKey: (item: Thread) => item.id as string,
    schema: threadSchema,
    ...operationHandlers<Thread>(),
  })
)

export const userCollection = createCollection<
  User,
  CollectionKey,
  ElectricCollectionUtils
>(
  electricCollectionOptions({
    id: `users`,
    shapeOptions: {
      url: relativeUrl('/sync/users'),
      ...baseShapeOptions,
    },
    getKey: (item: User) => item.id as string,
    schema: userSchema,
    ...operationHandlers<User>(),
  })
)

// @ts-ignore
window.authCollection = authCollection
// @ts-ignore
window.eventCollection = eventCollection
// @ts-ignore
window.factCollection = factCollection
// @ts-ignore
window.membershipCollection = membershipCollection
// @ts-ignore
window.threadCollection = threadCollection
// @ts-ignore
window.userCollection = userCollection
