import { z } from 'zod'
import { demoAvatarColorSchema, type DemoAvatarColor } from './space'

export const demoSessionStorageKey = `living-wiki.demo-session.v1`

export type DemoSessionIdentity = {
  actorId?: string
  displayName?: string
  avatarColor?: DemoAvatarColor
}

const demoSessionIdentitySchema = z.object({
  actorId: z.string().optional(),
  displayName: z.string().optional(),
  avatarColor: demoAvatarColorSchema.optional(),
})

export function readDemoSessionIdentity(
  storage: Pick<Storage, `getItem`>
): DemoSessionIdentity {
  const rawValue = storage.getItem(demoSessionStorageKey)

  if (rawValue === null) {
    return {}
  }

  try {
    const parsedValue: unknown = JSON.parse(rawValue)
    const result = demoSessionIdentitySchema.safeParse(parsedValue)

    return result.success ? result.data : {}
  } catch {
    return {}
  }
}

export function writeDemoSessionIdentity(
  storage: Pick<Storage, `setItem`>,
  identity: DemoSessionIdentity
): void {
  storage.setItem(demoSessionStorageKey, JSON.stringify(identity))
}

export function clearDemoSessionIdentity(
  storage: Pick<Storage, `removeItem`>
): void {
  storage.removeItem(demoSessionStorageKey)
}
