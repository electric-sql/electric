export function manifestChildKey(entityType: string, id: string): string {
  return `child:${entityType}:${id}`
}

export { manifestSourceKey } from './observation-sources'

export function manifestSharedStateKey(id: string): string {
  return `shared-state:${id}`
}

export function manifestEffectKey(functionRef: string, id: string): string {
  return `effect:${functionRef}:${id}`
}

export function manifestAttachmentKey(id: string): string {
  return `attachment:${id}`
}

export function manifestMarkdownDocumentKey(id: string): string {
  return `document:${id}`
}

export function getEntityAttachmentStreamPath(
  entityUrl: string,
  attachmentId: string
): string {
  return `${entityUrl.replace(/\/+$/, ``)}/attachments/${attachmentId}`
}

export function getEntityMarkdownDocumentPath(
  entityUrl: string,
  documentId: string
): string {
  const segments = entityUrl.replace(/^\/+|\/+$/g, ``).split(`/`)
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new Error(
      `Invalid entity URL for markdown document path: ${entityUrl}`
    )
  }
  return `agents/${segments[0]}/${segments[1]}/documents/${documentId}`
}

export function getEntityMarkdownDocumentUrlPath(
  service: string,
  entityUrl: string,
  documentId: string
): string {
  return `/v1/yjs/${encodeURIComponent(service)}/docs/${getEntityMarkdownDocumentPath(
    entityUrl,
    documentId
  )}`
}
