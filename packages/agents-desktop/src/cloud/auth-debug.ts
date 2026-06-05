export function logPostInjectionHeaders(input: {
  transport: string
  method: string | undefined
  url: string
  headers: Record<string, unknown>
}): void {
  if (!isEntityGrantsUrl(input.url)) return
  console.info(
    `[agents-desktop] post-injection auth headers`,
    JSON.stringify(
      {
        transport: input.transport,
        method: input.method ?? `GET`,
        url: input.url,
        headers: input.headers,
      },
      null,
      2
    )
  )
}

function isEntityGrantsUrl(url: string): boolean {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }
  return (
    pathname.includes(`/_electric/entities/`) && pathname.includes(`/grants`)
  )
}
