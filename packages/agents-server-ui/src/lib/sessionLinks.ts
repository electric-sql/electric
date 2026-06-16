// The app deep-link format is shared across the desktop, mobile and web apps
// (see `@electric-ax/agents-runtime/session-links`) so the wire format can
// never drift between the side that builds a link and the side that parses it.
// Re-exported here so existing imports from `./sessionLinks` keep working.
export { sessionAppUrl } from '@electric-ax/agents-runtime/session-links'
