export function appendPathToUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl)
  const pathUrl = new URL(path, `http://electric-agents.local`)
  const basePath =
    base.pathname === `/` ? `` : base.pathname.replace(/\/+$/, ``)
  const pathName = pathUrl.pathname.startsWith(`/`)
    ? pathUrl.pathname
    : `/${pathUrl.pathname}`
  const target = new URL(base)

  target.pathname = `${basePath}${pathName}`
  target.search = ``
  target.hash = pathUrl.hash

  base.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })
  pathUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })

  return target.toString()
}
