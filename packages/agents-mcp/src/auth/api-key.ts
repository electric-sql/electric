export interface ApiKeyAuthOpts {
  headerName?: string /* default: Authorization */
  valuePrefix?: string /* e.g. 'Bearer ' */
}

export function buildApiKeyHeader(
  apiKey: string,
  opts: ApiKeyAuthOpts = {}
): { name: string; value: string } {
  return {
    name: opts.headerName ?? `Authorization`,
    value: (opts.valuePrefix ?? ``) + apiKey,
  }
}
