export function withLeadingSlash(path: string): string {
  return path.startsWith(`/`) ? path : `/${path}`
}
