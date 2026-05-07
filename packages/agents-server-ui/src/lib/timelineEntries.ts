import type {
  EntityTimelineEntry,
  Manifest,
} from '@electric-ax/agents-runtime/client'

export type ManifestTimelineEntry = {
  key: string
  order: string | number
  responseTimestamp: null
  section: {
    kind: `manifest`
    manifest: Manifest
  }
}

export type TimelineEntry = EntityTimelineEntry | ManifestTimelineEntry

export function isManifestTimelineEntry(
  entry: TimelineEntry
): entry is ManifestTimelineEntry {
  return entry.section.kind === `manifest`
}
