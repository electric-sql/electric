import { authCollection } from './collections'
import type { Auth } from './schema'

type CurrentAuth = Auth | undefined
type AuthResult = {
  currentUserId: string | null
  isAuthenticated: boolean
}

export async function signIn(user_id: string): Promise<void> {
  await authCollection.insert({
    key: 'current',
    user_id: user_id,
  })
}

export async function signOut(): Promise<void> {
  await authCollection.delete('current')
}

export function useAuth(): AuthResult {
  const auth: CurrentAuth = authCollection.get('current')

  const currentUserId = auth !== undefined ? auth.user_id : null
  const isAuthenticated = currentUserId !== null

  return { currentUserId, isAuthenticated }
}
