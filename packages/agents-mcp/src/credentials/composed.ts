import type { CredentialStore } from './types'

type ReadKey =
  | `getApiKey`
  | `getClientCredentials`
  | `getOAuthTokens`
  | `getOAuthClientInfo`
type WriteKey = `saveOAuthTokens` | `saveOAuthClientInfo`

async function readFirst<R>(
  stores: CredentialStore[],
  method: ReadKey,
  arg: string
): Promise<R | undefined> {
  for (const s of stores) {
    const fn = s[method]
    if (!fn) continue
    const v = await (fn as (a: string) => Promise<unknown>).call(s, arg)
    if (v !== undefined) return v as R
  }
  return undefined
}

async function writeFirst<A>(
  stores: CredentialStore[],
  method: WriteKey,
  server: string,
  value: A
): Promise<void> {
  for (const s of stores) {
    const fn = s[method]
    if (!fn) continue
    await (fn as (s: string, v: A) => Promise<void>).call(s, server, value)
    return
  }
  throw new Error(
    `composedCredentialStore: no writable store implements ${method}`
  )
}

export function composedCredentialStore(
  ...stores: CredentialStore[]
): CredentialStore {
  return {
    getApiKey: (s) => readFirst(stores, `getApiKey`, s),
    getClientCredentials: (s) => readFirst(stores, `getClientCredentials`, s),
    getOAuthTokens: (s) => readFirst(stores, `getOAuthTokens`, s),
    getOAuthClientInfo: (s) => readFirst(stores, `getOAuthClientInfo`, s),
    saveOAuthTokens: (s, t) => writeFirst(stores, `saveOAuthTokens`, s, t),
    saveOAuthClientInfo: (s, c) =>
      writeFirst(stores, `saveOAuthClientInfo`, s, c),
  }
}
