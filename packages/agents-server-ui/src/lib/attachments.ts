import { entityApiUrl } from './entity-api'
import { serverFetch } from './auth-fetch'
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

export async function downloadAttachment({
  url,
  filename,
}: {
  url: string
  filename: string
}): Promise<void> {
  const response = await serverFetch(url)
  if (!response.ok) {
    throw new Error(
      `Attachment download failed (${response.status} ${response.statusText})`
    )
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement(`a`)
  link.href = objectUrl
  link.download = filename || `attachment`
  link.style.display = `none`

  try {
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  }
}
