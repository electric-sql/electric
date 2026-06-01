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

export function getEntityAttachmentStreamPath(
  entityUrl: string,
  attachmentId: string
): string {
  return `${entityUrl.replace(/\/+$/, ``)}/attachments/${attachmentId}`
}
