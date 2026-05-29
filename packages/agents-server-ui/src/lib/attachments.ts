import { entityApiUrl } from './entity-api'
import type {
  Manifest,
  ManifestAttachmentEntry,
} from '@electric-ax/agents-runtime/client'

export function isAttachmentManifest(
  manifest: Manifest | undefined
): manifest is ManifestAttachmentEntry {
  return manifest?.kind === `attachment`
}

export function attachmentDownloadUrl(
  baseUrl: string,
  entityUrl: string,
  id: string
): string {
  return entityApiUrl(
    baseUrl,
    entityUrl,
    `/attachments/${encodeURIComponent(id)}`
  )
}

export function attachmentDisplayName(
  attachment: Pick<ManifestAttachmentEntry, `filename` | `id`>
): string {
  return attachment.filename?.trim() || attachment.id
}

export function formatAttachmentSize(bytes: number | undefined): string {
  if (bytes === undefined) return `unknown size`
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KB`
  const mib = kib / 1024
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`
}
