import { hostOf } from './serverHost'

/**
 * Pure state machine behind the `open-session` landing route — extracted from
 * the React component so the branching (which is the part most likely to
 * regress) is unit-testable without a renderer. Given the parsed link and the
 * current app state it decides what the route should do:
 *
 * - `abandon` — nothing usable, or a Cloud server we can't silently switch to
 *   (Cloud needs an interactive sign-in).
 * - `route`  — the link's server is already active; go straight to the session.
 * - `switch` — a self-hosted server the user has *already added*; make it the
 *   active server, after which a re-evaluation yields `route`.
 * - `refuse` — a self-hosted server the user hasn't added. Mirrors the desktop:
 *   we never silently point the app at an unknown (possibly attacker-supplied)
 *   server, so the route shows a "you haven't added this server" message.
 */
export type OpenSessionDecision =
  | { kind: `abandon` }
  | { kind: `route`; entityUrl: string }
  | { kind: `switch`; serverUrl: string }
  | { kind: `refuse`; host: string }

export type OpenSessionInput = {
  target: { serverUrl: string; entityUrl: string } | null
  activeServerUrl: string | null
  isCloudServer: (serverUrl: string) => boolean
  isSavedServer: (serverUrl: string) => boolean
}

function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, ``)
}

export function decideOpenSession(
  input: OpenSessionInput
): OpenSessionDecision {
  const { target, activeServerUrl, isCloudServer, isSavedServer } = input
  if (!target) return { kind: `abandon` }

  const targetServer = normalizeServerUrl(target.serverUrl)
  const activeServer =
    activeServerUrl !== null ? normalizeServerUrl(activeServerUrl) : null
  const activeMatches = targetServer === activeServer

  if (activeMatches) return { kind: `route`, entityUrl: target.entityUrl }
  // A Cloud server we're not already signed into can't be switched to silently.
  if (isCloudServer(targetServer)) return { kind: `abandon` }
  if (isSavedServer(targetServer)) {
    return { kind: `switch`, serverUrl: targetServer }
  }
  return { kind: `refuse`, host: hostOf(targetServer) }
}
