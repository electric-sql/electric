export function applyElectricUrlQueryParams(
  target: URL,
  electricUrl: string
): void {
  const configured = new URL(electricUrl)
  configured.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value)
  })
}

export function electricUrlWithPath(electricUrl: string, path: string): URL {
  const target = new URL(path, electricUrl)
  applyElectricUrlQueryParams(target, electricUrl)
  return target
}
