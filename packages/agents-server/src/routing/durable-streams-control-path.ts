export function durableStreamsControlPath(pathname: string): string | null {
  const segments = pathname.split(`/`).filter(Boolean)
  if (segments[0] !== `__ds`) return null
  return `/${segments.join(`/`)}`
}
