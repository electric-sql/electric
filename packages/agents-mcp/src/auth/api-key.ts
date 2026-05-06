import type { KeyVault } from '../vault/types'

export interface ApiKeyAuth {
  headerName: string
  getToken(): Promise<string | null>
}

export function createApiKeyAuth(
  cfg: { mode: `apiKey`; headerName: string; valueRef: string },
  vault: KeyVault
): ApiKeyAuth {
  return {
    headerName: cfg.headerName,
    getToken: () => vault.get(cfg.valueRef),
  }
}
