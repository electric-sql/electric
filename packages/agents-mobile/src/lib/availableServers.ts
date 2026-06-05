import { getCloudServiceIdFromServerUrl } from './cloudAgentUrls'
import type { CloudAgentServer } from './cloudAgentServers'
import type { SavedServer } from './savedServers'

/**
 * Pure merge logic for the unified server picker, kept free of React /
 * React Native imports so it can be unit-tested in isolation. The hook
 * that wires it to live state lives in `useAvailableServers.ts`.
 */

export type AvailableServerKind = `self-hosted` | `cloud`

export type AvailableServer = {
  key: string
  kind: AvailableServerKind
  name: string
  /** Connection URL to register as the active server. */
  url: string
  /** Cloud only: `workspace · project · environment`. */
  breadcrumb?: string
  /** Matches the currently-active server URL. */
  isActive: boolean
  /** Already in the persisted list (vs a live-only Cloud server). */
  saved: boolean
}

function breadcrumbFor(server: CloudAgentServer): string | undefined {
  const parts = [
    server.workspaceName,
    server.projectName,
    server.environmentName,
  ].filter((p): p is string => Boolean(p))
  return parts.length > 0 ? parts.join(` · `) : undefined
}

/**
 * Merge the persisted server list with the live Cloud agent servers into
 * one deduped list. Dedup is by Cloud service id: a Cloud server already
 * saved (because the user connected to it) is shown once, enriched with
 * the live breadcrumb. `resolveCloudUrl` turns a Cloud service id into its
 * tenant-scoped agents URL (injected so this stays free of network state).
 */
export function mergeAvailableServers(
  saved: ReadonlyArray<SavedServer>,
  cloudServers: ReadonlyArray<CloudAgentServer>,
  activeUrl: string | null,
  resolveCloudUrl: (serviceId: string) => string
): ReadonlyArray<AvailableServer> {
  const cloudById = new Map(cloudServers.map((s) => [s.id, s]))
  const savedCloudServiceIds = new Set<string>()

  const fromSaved = saved.map((s): AvailableServer => {
    const isCloud = s.source === `electric-cloud`
    const serviceId = isCloud
      ? (getCloudServiceIdFromServerUrl(s.url) ?? s.id)
      : null
    if (serviceId) savedCloudServiceIds.add(serviceId)
    const live = serviceId ? cloudById.get(serviceId) : undefined
    return {
      key: `saved:${s.id}`,
      kind: isCloud ? `cloud` : `self-hosted`,
      name: s.name,
      url: s.url,
      breadcrumb: live ? breadcrumbFor(live) : undefined,
      isActive: s.url === activeUrl,
      saved: true,
    }
  })

  const fromCloud = cloudServers
    .filter((s) => !savedCloudServiceIds.has(s.id))
    .map((s): AvailableServer => {
      const url = resolveCloudUrl(s.id)
      return {
        key: `cloud:${s.id}`,
        kind: `cloud`,
        name: s.name,
        url,
        breadcrumb: breadcrumbFor(s),
        isActive: url === activeUrl,
        saved: false,
      }
    })

  return [...fromSaved, ...fromCloud]
}

/**
 * Decide what the active server should become after Cloud sign-out (once
 * the Cloud servers have been purged from `savedAfterPurge`). If the
 * active server was a Cloud server it's now unreachable, so fall back to a
 * remaining self-hosted server, or clear it (`null`). A non-Cloud active
 * server is left untouched (`changed: false`).
 */
export function resolveActiveAfterCloudSignOut(
  activeUrl: string | null,
  savedAfterPurge: ReadonlyArray<SavedServer>
): { changed: boolean; url: string | null } {
  if (!activeUrl || getCloudServiceIdFromServerUrl(activeUrl) === null) {
    return { changed: false, url: activeUrl }
  }
  const fallback = savedAfterPurge.find((s) => s.source === `manual`)
  return { changed: true, url: fallback?.url ?? null }
}
