/**
 * App deep link that opens a session in the Electric Agents desktop/mobile app.
 * Mirrors `agents-mobile`'s `sessionAppUrl`. Carries the full server base URL
 * (incl. any Cloud tenant prefix) and the server-scoped entity url, URL-encoded.
 */
export function sessionAppUrl(serverUrl: string, entityUrl: string): string {
  const server = encodeURIComponent(serverUrl.replace(/\/+$/, ``))
  const entity = encodeURIComponent(entityUrl.replace(/^\/+/, ``))
  return `electric-agents://open-session?server=${server}&entity=${entity}`
}
