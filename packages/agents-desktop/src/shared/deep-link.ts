// The app deep-link format (scheme/host match, parse, argv extraction) is
// shared across the desktop, mobile and web apps via
// `@electric-ax/agents-runtime/session-links` so the wire format can never
// drift. Re-exported here so existing imports from `./deep-link` keep working.
export {
  isSessionDeepLink,
  parseSessionDeepLink,
  extractSessionDeepLinkFromArgv,
} from '@electric-ax/agents-runtime/session-links'
