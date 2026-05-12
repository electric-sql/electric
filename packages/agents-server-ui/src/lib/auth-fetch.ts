export type AssertedAuthHeaders = Record<string, string>

export async function getDesktopAssertedAuthHeaders(): Promise<AssertedAuthHeaders> {
  if (typeof window === `undefined`) return {}
  return (await window.electronAPI?.getAssertedAuthHeaders?.()) ?? {}
}

export async function serverFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const assertedHeaders = await getDesktopAssertedAuthHeaders()
  const headers = new Headers(init.headers)
  for (const [key, value] of Object.entries(assertedHeaders)) {
    if (!headers.has(key)) headers.set(key, value)
  }
  return fetch(input, { ...init, headers })
}
