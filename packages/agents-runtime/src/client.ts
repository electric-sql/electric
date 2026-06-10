export { createEntityStreamDB } from './entity-stream-db'
export { createAgentsClient } from './agents-client'
export {
  compareTimelineOrders,
  buildEntityTimelineData,
  createPendingTimelineOrder,
  createEntityErrorsQuery,
  createEntityIncludesQuery,
  createEntityTimelineQuery,
  getEntityState,
  normalizeEntityTimelineData,
  normalizeTimelineEntities,
  TIMELINE_ORDER_FALLBACK,
} from './entity-timeline'
export {
  canonicalPgSyncOptions,
  db,
  entities,
  entity,
  getPgSyncStreamPath,
  pgSync,
  pgSyncObservationCollections,
  sourceRefForPgSync,
  webhook,
  getWebhookStreamPath,
  webhookObservationCollections,
  webhookEventRowSchema,
} from './observation-sources'
export { appendPathToUrl } from './url'
export {
  getEntityAttachmentStreamPath,
  manifestAttachmentKey,
} from './manifest-helpers'
export { buildSections, buildTimelineEntries } from './use-chat'
export {
  COMPOSER_INPUT_MESSAGE_TYPE,
  serializeComposerInput,
  normalizeCommandName,
  formatSlashCommandArgumentHint,
  detectSlashCommandTrigger,
  createSlashCommandTokenRegex,
  SLASH_COMMAND_TRIGGER_REGEX,
} from './composer-input'
// The /goal text grammar — pure parsing, shared with the UI so composer
// behavior (e.g. which subcommands interrupt a running agent) can't
// drift from the runtime dispatcher.
export { isGoalCommandText, parseGoalCommand } from './goal-command'
export { formatTokenCount } from './token-budget'
export type { GoalCommand } from './goal-command'

export type {
  EntityStreamDB,
  EntityStreamDBWithActions,
} from './entity-stream-db'
export type { ObservationStreamDB } from './types'
export type {
  ComposerInputPayload,
  ComposerNode,
  SlashCommandRow,
  SlashCommandTrigger,
} from './composer-input'
export type { AgentsClient, AgentsClientConfig } from './agents-client'
export type {
  AttachmentRole,
  AttachmentStatus,
  AttachmentSubject,
  AttachmentSubjectType,
  GoalStatus,
  Manifest,
  ManifestAttachmentEntry,
  ManifestGoalEntry,
} from './entity-schema'
export type {
  AttachmentCreateInput,
  AttachmentsApi,
  LLMContentBlock,
  LLMMessageContent,
} from './types'
export type {
  DbObservationSource,
  EntitiesObservationSource,
  EntityObservationSource,
  WebhookObservationSource,
  WebhookEventRow,
  EntitiesQuery,
  CanonicalPgSyncConfig,
  PgSyncObservationSource,
  PgSyncOptions,
  PgSyncRequestMetadata,
} from './observation-sources'
export type {
  EntityTimelineCommentRow,
  EntityTimelineContentItem,
  EntityTimelineData,
  EntityTimelineInboxMode,
  EntityTimelineQueryOptions,
  EntityTimelineQueryRow,
  EntityTimelineRunRow,
  EntityTimelineRunItem,
  EntityTimelineSection,
  EntityTimelineState,
  EntityTimelineTextChunk,
  EntityTimelineTextItem,
  EntityTimelineToolCallItem,
  IncludesEntity,
  IncludesInboxMessage,
  IncludesRun,
} from './entity-timeline'
export { commentsCollection } from './comments-collection'
export type {
  CommentSnapshotValue as CommentSnapshot,
  CommentTargetValue as CommentTarget,
} from './comments-collection'
export type { EntityTimelineEntry } from './use-chat'
