import type { CredentialStore } from './types'

function envKey(server: string, suffix: string): string {
  return `MCP_${server.toUpperCase().replace(/-/g, `_`)}_${suffix}`
}

export function envCredentialStore(
  env: NodeJS.ProcessEnv = process.env
): CredentialStore {
  return {
    getApiKey: (server) => env[envKey(server, `API_KEY`)],
    getClientCredentials: (server) => {
      const clientId = env[envKey(server, `CLIENT_ID`)]
      const clientSecret = env[envKey(server, `CLIENT_SECRET`)]
      if (!clientId || !clientSecret) return undefined
      return { clientId, clientSecret }
    },
  }
}
