/**
 * HTTP routes for Electric Agents entity management.
 */

import { Type, type Static } from '@sinclair/typebox'
import {
  buildEventSourceManifestEntry,
  resolveEventSourceSubscription,
} from '@electric-ax/agents-runtime'
import { Router, json, status } from 'itty-router'
import { apiError } from '../electric-agents-http.js'
import { parsePrincipalKey, principalUrl } from '../principal.js'
import { dispatchPolicySchema } from '../dispatch-policy-schema.js'
import { sandboxChoiceSchema } from '../sandbox-choice-schema.js'
import {
  ErrCodeNotFound,
  ErrCodeUnknownEntityType,
  ErrCodeInvalidRequest,
  ErrCodeUnauthorized,
  toPublicEntity,
} from '../electric-agents-types.js'
import {
  assertDispatchPolicyAllowed,
  backfillEntityDispatchPolicy,
  linkEntityDispatchSubscription,
  resolveEffectiveDispatchPolicyForSpawn,
  shouldLinkDispatchBeforeInitialMessage,
  unlinkEntityDispatchSubscription,
} from './dispatch-policy.js'
import { ElectricAgentsError } from '../entity-manager.js'
import {
  canAccessEntity,
  canAccessEntityType,
  isPermissionBypassPrincipal,
  principalSubject,
} from '../permissions.js'
import { routeBody, withSchema } from './schema.js'
import type {
  ElectricAgentsEntity,
  ElectricAgentsEntityType,
  EntityPermission,
  SendRequest,
} from '../electric-agents-types.js'
import type { JsonRouteRequest } from './schema.js'
import type { RouterType } from 'itty-router'
import type { TenantContext } from './context.js'
import type { EventSourceSubscriptionInput } from '@electric-ax/agents-runtime'

interface AgentsRouteRequest extends JsonRouteRequest {
  entityRoute?: ExistingEntityRoute
  spawnRoute?: SpawnableEntityRoute
}

type ExistingEntityRoute = { entityUrl: string; entity: ElectricAgentsEntity }
type SpawnableEntityRoute = { entityType: ElectricAgentsEntityType }
type AgentsRouteArgs = [TenantContext]
type AgentsRouteResult = Response | undefined

export type EntitiesRoutes = RouterType<
  AgentsRouteRequest,
  AgentsRouteArgs,
  AgentsRouteResult
>

const stringRecordSchema = Type.Record(Type.String(), Type.String())

function writeTokenFromRequest(request: AgentsRouteRequest): string {
  const electricClaimToken = request.headers.get(`electric-claim-token`)?.trim()
  if (electricClaimToken) return electricClaimToken
  return (
    request.headers
      .get(`authorization`)
      ?.replace(/^Bearer\s+/i, ``)
      .trim() ?? ``
  )
}

const wakeConditionSchema = Type.Union([
  Type.Literal(`runFinished`),
  Type.Object({
    on: Type.Literal(`change`),
    collections: Type.Optional(Type.Array(Type.String())),
    ops: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal(`insert`),
          Type.Literal(`update`),
          Type.Literal(`delete`),
        ])
      )
    ),
  }),
])

const permissionSubjectSchema = Type.Object(
  {
    subject_kind: Type.Union([
      Type.Literal(`principal`),
      Type.Literal(`principal_kind`),
    ]),
    subject_value: Type.String(),
  },
  { additionalProperties: false }
)

const entityPermissionSchema = Type.Union([
  Type.Literal(`read`),
  Type.Literal(`write`),
  Type.Literal(`delete`),
  Type.Literal(`signal`),
  Type.Literal(`fork`),
  Type.Literal(`schedule`),
  Type.Literal(`spawn`),
  Type.Literal(`manage`),
])

const entityPermissionGrantInputSchema = Type.Object(
  {
    ...permissionSubjectSchema.properties,
    permission: entityPermissionSchema,
    propagation: Type.Optional(
      Type.Union([Type.Literal(`self`), Type.Literal(`descendants`)])
    ),
    copy_to_children: Type.Optional(Type.Boolean()),
    expires_at: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
)

const spawnBodySchema = Type.Object({
  args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  tags: Type.Optional(stringRecordSchema),
  parent: Type.Optional(Type.String()),
  dispatch_policy: Type.Optional(dispatchPolicySchema),
  sandbox: Type.Optional(sandboxChoiceSchema),
  initialMessage: Type.Optional(Type.Unknown()),
  grants: Type.Optional(Type.Array(entityPermissionGrantInputSchema)),
  initialMessageType: Type.Optional(Type.String()),
  wake: Type.Optional(
    Type.Object({
      subscriberUrl: Type.String(),
      condition: wakeConditionSchema,
      debounceMs: Type.Optional(Type.Number()),
      timeoutMs: Type.Optional(Type.Number()),
      includeResponse: Type.Optional(Type.Boolean()),
      manifestKey: Type.Optional(Type.String()),
    })
  ),
})

const sendBodySchema = Type.Object({
  payload: Type.Optional(Type.Unknown()),
  key: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  mode: Type.Optional(
    Type.Union([
      Type.Literal(`immediate`),
      Type.Literal(`queued`),
      Type.Literal(`paused`),
      Type.Literal(`steer`),
    ])
  ),
  position: Type.Optional(Type.String()),
  afterMs: Type.Optional(Type.Number()),
  from: Type.Optional(Type.String()),
  from_principal: Type.Optional(Type.String()),
  from_agent: Type.Optional(Type.String()),
})

function agentUrlForPrincipal(principal: {
  kind: string
  id: string
  key: string
}): string | null {
  if (principal.kind === `agent`) return `/${principal.id}`
  if (principal.key.startsWith(`entity:`)) {
    return `/${principal.key.slice(`entity:`.length)}`
  }
  return null
}

function agentUrlPath(value: string): string {
  try {
    return new URL(value).pathname
  } catch {
    return value
  }
}

const inboxMessageBodySchema = Type.Object({
  payload: Type.Optional(Type.Unknown()),
  position: Type.Optional(Type.String()),
  mode: Type.Optional(
    Type.Union([
      Type.Literal(`immediate`),
      Type.Literal(`queued`),
      Type.Literal(`paused`),
      Type.Literal(`steer`),
    ])
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal(`pending`),
      Type.Literal(`processed`),
      Type.Literal(`cancelled`),
    ])
  ),
})

const forkBodySchema = Type.Object({
  instance_id: Type.Optional(Type.String()),
  waitTimeoutMs: Type.Optional(Type.Number()),
  // Optional anchor pointing at an event on the source root's `main`
  // stream. Wire shape is snake_case; the route handler translates to
  // camelCase before forwarding to entity-manager.
  fork_pointer: Type.Optional(
    Type.Object({
      offset: Type.Union([Type.String(), Type.Null()]),
      sub_offset: Type.Number(),
    })
  ),
})

const setTagBodySchema = Type.Object({
  value: Type.String(),
})

const entitySignalSchema = Type.Union([
  Type.Literal(`SIGINT`),
  Type.Literal(`SIGHUP`),
  Type.Literal(`SIGTERM`),
  Type.Literal(`SIGKILL`),
  Type.Literal(`SIGSTOP`),
  Type.Literal(`SIGCONT`),
  Type.Literal(`SIGUSR`),
])

const signalBodySchema = Type.Object({
  signal: entitySignalSchema,
  reason: Type.Optional(Type.String()),
  payload: Type.Optional(Type.Unknown()),
})

const scheduleBodySchema = Type.Union([
  Type.Object({
    scheduleType: Type.Literal(`cron`),
    expression: Type.String(),
    timezone: Type.Optional(Type.String()),
    payload: Type.Unknown(),
    debounceMs: Type.Optional(Type.Number()),
    timeoutMs: Type.Optional(Type.Number()),
  }),
  Type.Object({
    scheduleType: Type.Literal(`future_send`),
    payload: Type.Unknown(),
    targetUrl: Type.Optional(Type.String()),
    fireAt: Type.String(),
    messageType: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
  }),
])

const subscriptionLifetimeSchema = Type.Union([
  Type.Object({ kind: Type.Literal(`until_entity_stopped`) }),
  Type.Object({
    kind: Type.Literal(`expires_at`),
    at: Type.String(),
  }),
  Type.Object({ kind: Type.Literal(`manual`) }),
])

const eventSourceSubscriptionBodySchema = Type.Object({
  sourceKey: Type.String(),
  bucketKey: Type.Optional(Type.String()),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  filterKey: Type.Optional(Type.String()),
  lifetime: Type.Optional(subscriptionLifetimeSchema),
  reason: Type.Optional(Type.String()),
})

type SpawnBody = Static<typeof spawnBodySchema>
type SendBody = Static<typeof sendBodySchema>
type InboxMessageBody = Static<typeof inboxMessageBodySchema>
type ForkBody = Static<typeof forkBodySchema>
type SetTagBody = Static<typeof setTagBodySchema>
type SignalBody = Static<typeof signalBodySchema>
type ScheduleBody = Static<typeof scheduleBodySchema>
type EventSourceSubscriptionBody = Static<
  typeof eventSourceSubscriptionBodySchema
>
type EntityPermissionGrantInput = Static<
  typeof entityPermissionGrantInputSchema
>
type AttachmentSubjectType = `inbox` | `run` | `text` | `tool_call` | `context`
type AttachmentRole = `input` | `output`
type ParsedAttachmentForm = {
  id?: string
  bytes: Uint8Array
  mimeType: string
  filename?: string
  subject: { type: AttachmentSubjectType; key: string }
  role?: AttachmentRole
  meta?: Record<string, unknown>
}

const attachmentSubjectTypes = new Set<AttachmentSubjectType>([
  `inbox`,
  `run`,
  `text`,
  `tool_call`,
  `context`,
])

export const entitiesRouter: EntitiesRoutes = Router<
  AgentsRouteRequest,
  AgentsRouteArgs,
  AgentsRouteResult
>({
  base: `/_electric/entities`,
})

entitiesRouter.get(`/`, listEntities)
entitiesRouter.put(
  `/:type/:instanceId`,
  withSpawnableEntityType,
  withSchema(spawnBodySchema),
  withSpawnPermission,
  spawnEntity
)
entitiesRouter.get(
  `/:type/:instanceId`,
  withExistingEntity,
  withEntityPermission(`read`),
  getEntity
)
entitiesRouter.head(
  `/:type/:instanceId`,
  withExistingEntity,
  withEntityPermission(`read`),
  headEntity
)
entitiesRouter.delete(
  `/:type/:instanceId`,
  withExistingEntity,
  withEntityPermission(`delete`),
  killEntity
)
entitiesRouter.post(
  `/:type/:instanceId/signal`,
  withExistingEntity,
  withSchema(signalBodySchema),
  withEntityPermission(`signal`),
  signalEntity
)
entitiesRouter.post(
  `/:type/:instanceId/send`,
  withExistingEntity,
  withSchema(sendBodySchema),
  withEntityPermission(`write`),
  sendEntity
)
entitiesRouter.post(
  `/:type/:instanceId/attachments`,
  withExistingEntity,
  withEntityPermission(`write`),
  createAttachment
)
entitiesRouter.get(
  `/:type/:instanceId/attachments/:attachmentId`,
  withExistingEntity,
  withEntityPermission(`read`),
  readAttachment
)
entitiesRouter.delete(
  `/:type/:instanceId/attachments/:attachmentId`,
  withExistingEntity,
  withEntityPermission(`write`),
  deleteAttachment
)
entitiesRouter.patch(
  `/:type/:instanceId/inbox/:messageKey`,
  withExistingEntity,
  withSchema(inboxMessageBodySchema),
  withEntityPermission(`write`),
  updateInboxMessage
)
entitiesRouter.delete(
  `/:type/:instanceId/inbox/:messageKey`,
  withExistingEntity,
  withEntityPermission(`write`),
  deleteInboxMessage
)
entitiesRouter.post(
  `/:type/:instanceId/fork`,
  withExistingEntity,
  withSchema(forkBodySchema),
  withEntityPermission(`fork`),
  forkEntity
)
entitiesRouter.post(
  `/:type/:instanceId/tags/:tagKey`,
  withExistingEntity,
  withSchema(setTagBodySchema),
  withEntityPermission(`write`),
  setTag
)
entitiesRouter.delete(
  `/:type/:instanceId/tags/:tagKey`,
  withExistingEntity,
  withEntityPermission(`write`),
  deleteTag
)
entitiesRouter.put(
  `/:type/:instanceId/schedules/:scheduleId`,
  withExistingEntity,
  withSchema(scheduleBodySchema),
  withEntityPermission(`schedule`),
  upsertSchedule
)
entitiesRouter.delete(
  `/:type/:instanceId/schedules/:scheduleId`,
  withExistingEntity,
  withEntityPermission(`schedule`),
  deleteSchedule
)
entitiesRouter.put(
  `/:type/:instanceId/event-source-subscriptions/:subscriptionId`,
  withExistingEntity,
  withSchema(eventSourceSubscriptionBodySchema),
  withEntityPermission(`write`),
  upsertEventSourceSubscription
)
entitiesRouter.delete(
  `/:type/:instanceId/event-source-subscriptions/:subscriptionId`,
  withExistingEntity,
  withEntityPermission(`write`),
  deleteEventSourceSubscription
)
entitiesRouter.get(
  `/:type/:instanceId/grants`,
  withExistingEntity,
  withEntityPermission(`manage`),
  listEntityPermissionGrants
)
entitiesRouter.post(
  `/:type/:instanceId/grants`,
  withExistingEntity,
  withSchema(entityPermissionGrantInputSchema),
  withEntityPermission(`manage`),
  createEntityPermissionGrant
)
entitiesRouter.delete(
  `/:type/:instanceId/grants/:grantId`,
  withExistingEntity,
  withEntityPermission(`manage`),
  deleteEntityPermissionGrant
)

function entityUrlFromSegments(
  type: string,
  instanceId: string
): string | null {
  if (!type || !instanceId) return null
  if (type.startsWith(`_`) || type.includes(`*`) || instanceId.includes(`*`)) {
    return null
  }
  if (type === `principal`) {
    try {
      return principalUrl(decodeURIComponent(instanceId))
    } catch {
      return null
    }
  }
  return `/${type}/${instanceId}`
}

function firstQueryValue(
  value: string | Array<string> | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function requireExistingEntityRoute(
  request: AgentsRouteRequest
): ExistingEntityRoute {
  if (!request.entityRoute) {
    throw new Error(`existing entity middleware did not run`)
  }
  return request.entityRoute
}

function invalidAttachmentRequest(message: string): never {
  throw new ElectricAgentsError(ErrCodeInvalidRequest, message, 400)
}

function formString(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  if (typeof value !== `string`) return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function parseJsonFormField<T>(form: FormData, key: string): T | undefined {
  const raw = formString(form, key)
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    invalidAttachmentRequest(`Invalid JSON field: ${key}`)
  }
}

function parseAttachmentSubject(
  form: FormData
): ParsedAttachmentForm[`subject`] {
  const explicit = parseJsonFormField<unknown>(form, `subject`)
  if (explicit !== undefined) {
    if (!explicit || typeof explicit !== `object` || Array.isArray(explicit)) {
      invalidAttachmentRequest(`attachment subject must be an object`)
    }
    const subject = explicit as Record<string, unknown>
    const type = subject.type
    const key = subject.key
    if (typeof type !== `string` || typeof key !== `string`) {
      invalidAttachmentRequest(`attachment subject requires type and key`)
    }
    if (!attachmentSubjectTypes.has(type as AttachmentSubjectType)) {
      invalidAttachmentRequest(`invalid attachment subject type`)
    }
    return { type: type as AttachmentSubjectType, key }
  }

  const type = formString(form, `subjectType`)
  const key = formString(form, `subjectKey`)
  if (!type || !key) {
    invalidAttachmentRequest(`attachment subject is required`)
  }
  if (!attachmentSubjectTypes.has(type as AttachmentSubjectType)) {
    invalidAttachmentRequest(`invalid attachment subject type`)
  }
  return { type: type as AttachmentSubjectType, key }
}

type UploadedFormFile = {
  arrayBuffer: () => Promise<ArrayBuffer>
  type?: string
  name?: string
}

function getUploadedFormFile(
  value: FormDataEntryValue | null
): UploadedFormFile | null {
  if (
    value !== null &&
    typeof value === `object` &&
    `arrayBuffer` in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === `function`
  ) {
    return value as unknown as UploadedFormFile
  }
  return null
}

async function parseAttachmentForm(
  request: AgentsRouteRequest
): Promise<ParsedAttachmentForm> {
  const contentType = request.headers.get(`content-type`)?.toLowerCase() ?? ``
  if (!contentType.includes(`multipart/form-data`)) {
    invalidAttachmentRequest(`Attachment uploads must use multipart/form-data`)
  }

  let form: FormData
  try {
    form = await (request as unknown as Request).formData()
  } catch {
    invalidAttachmentRequest(`Invalid multipart form data`)
  }

  const file = getUploadedFormFile(form.get(`file`))
  if (!file) {
    invalidAttachmentRequest(`Missing file field`)
  }

  const role = formString(form, `role`)
  if (role !== undefined && role !== `input` && role !== `output`) {
    invalidAttachmentRequest(`invalid attachment role`)
  }

  const fileName =
    formString(form, `filename`) ??
    (typeof file.name === `string` ? file.name : undefined)
  const mimeType =
    formString(form, `mimeType`) ||
    (typeof file.type === `string` ? file.type : undefined) ||
    `application/octet-stream`
  const meta = parseJsonFormField<Record<string, unknown>>(form, `meta`)
  if (meta !== undefined && (typeof meta !== `object` || Array.isArray(meta))) {
    invalidAttachmentRequest(`attachment meta must be an object`)
  }

  return {
    id: formString(form, `id`),
    bytes: new Uint8Array(await file.arrayBuffer()),
    mimeType,
    filename: fileName,
    subject: parseAttachmentSubject(form),
    role,
    meta,
  }
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/["\\\r\n]/g, `_`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

function rejectPrincipalEntityMutation(
  request: AgentsRouteRequest,
  action: string
): Response | undefined {
  const { entity } = requireExistingEntityRoute(request)
  if (entity.type !== `principal`) return undefined

  return apiError(
    400,
    ErrCodeInvalidRequest,
    `Principal entities are built in and cannot be ${action}`
  )
}

function parseExpiresAt(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined
  const expiresAt = new Date(value)
  if (Number.isNaN(expiresAt.getTime())) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `Invalid expires_at timestamp`,
      400
    )
  }
  return expiresAt
}

function parseGrantId(request: AgentsRouteRequest): number {
  const grantId = Number.parseInt(String(request.params.grantId), 10)
  if (!Number.isSafeInteger(grantId) || grantId <= 0) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `Invalid grant id`,
      400
    )
  }
  return grantId
}

async function withExistingEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<AgentsRouteResult> {
  const entityUrl = entityUrlFromSegments(
    request.params.type,
    request.params.instanceId
  )
  if (!entityUrl) return undefined

  const entity = await ctx.entityManager.registry.getEntity(entityUrl)
  if (!entity) {
    const entityType = await ctx.entityManager.registry.getEntityType(
      request.params.type
    )
    if (request.params.type === `principal`) {
      try {
        const materialized = await ctx.entityManager.ensurePrincipal(
          parsePrincipalKey(decodeURIComponent(request.params.instanceId))
        )
        request.entityRoute = { entityUrl, entity: materialized }
        return undefined
      } catch (error) {
        return apiError(
          400,
          ErrCodeInvalidRequest,
          error instanceof Error ? error.message : `Invalid principal`
        )
      }
    }
    if (entityType) {
      return apiError(404, ErrCodeNotFound, `Entity not found at ${entityUrl}`)
    }
    return apiError(
      404,
      ErrCodeUnknownEntityType,
      `Entity type "${request.params.type}" not found`
    )
  }

  request.entityRoute = { entityUrl, entity }
  return undefined
}

async function withSpawnableEntityType(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<AgentsRouteResult> {
  if (!entityUrlFromSegments(request.params.type, request.params.instanceId)) {
    return undefined
  }

  if (request.params.type === `principal`) {
    return apiError(
      400,
      ErrCodeInvalidRequest,
      `Principal entities are built in and cannot be spawned directly`
    )
  }

  const entityType = await ctx.entityManager.registry.getEntityType(
    request.params.type
  )
  if (!entityType) {
    return apiError(
      404,
      ErrCodeUnknownEntityType,
      `Entity type "${request.params.type}" not found`
    )
  }

  request.spawnRoute = { entityType }
  return undefined
}

function withEntityPermission(permission: EntityPermission) {
  return async (
    request: AgentsRouteRequest,
    ctx: TenantContext
  ): Promise<AgentsRouteResult> => {
    const { entity } = requireExistingEntityRoute(request)
    if (await canAccessEntity(ctx, entity, permission, request as Request)) {
      return undefined
    }
    return apiError(
      401,
      ErrCodeUnauthorized,
      `Principal is not allowed to ${permission} ${entity.url}`
    )
  }
}

async function withSpawnPermission(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<AgentsRouteResult> {
  const parsed = routeBody<SpawnBody>(request)
  const entityType = request.spawnRoute?.entityType
  if (!entityType) {
    throw new Error(`spawnable entity type middleware did not run`)
  }

  if (
    !(await canAccessEntityType(ctx, entityType, `spawn`, request as Request))
  ) {
    return apiError(
      401,
      ErrCodeUnauthorized,
      `Principal is not allowed to spawn ${entityType.name}`
    )
  }

  if (!parsed.parent) return undefined

  const parent = await ctx.entityManager.registry.getEntity(parsed.parent)
  if (!parent) {
    return apiError(404, ErrCodeNotFound, `Parent entity not found`)
  }
  if (await canAccessEntity(ctx, parent, `spawn`, request as Request)) {
    return await validateParentedSpawnGrants(request, ctx, parent, parsed)
  }
  return apiError(
    401,
    ErrCodeUnauthorized,
    `Principal is not allowed to spawn children from ${parent.url}`
  )
}

async function validateParentedSpawnGrants(
  request: AgentsRouteRequest,
  ctx: TenantContext,
  parent: ElectricAgentsEntity,
  parsed: SpawnBody
): Promise<AgentsRouteResult> {
  const needsParentManage = (parsed.grants ?? []).some(
    requiresParentManageForInitialGrant
  )
  if (!needsParentManage) return undefined

  if (await canAccessEntity(ctx, parent, `manage`, request as Request)) {
    return undefined
  }

  return apiError(
    401,
    ErrCodeUnauthorized,
    `Principal is not allowed to delegate broad grants from ${parent.url}`
  )
}

function requiresParentManageForInitialGrant(
  grant: EntityPermissionGrantInput
): boolean {
  return (
    grant.permission === `manage` ||
    grant.subject_kind === `principal_kind` ||
    grant.propagation === `descendants` ||
    grant.copy_to_children === true
  )
}

async function listEntities(
  { query }: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entities } = await ctx.entityManager.registry.listEntities({
    type: firstQueryValue(query.type),
    status: firstQueryValue(query.status),
    parent: firstQueryValue(query.parent),
    created_by: firstQueryValue(query.created_by),
    readableBy: {
      ...principalSubject(ctx.principal),
      bypass: isPermissionBypassPrincipal(ctx),
    },
  })
  return json(entities.map((entity) => toPublicEntity(entity)))
}

async function listEntityPermissionGrants(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entityUrl } = requireExistingEntityRoute(request)
  const grants =
    await ctx.entityManager.registry.listEntityPermissionGrants(entityUrl)
  return json({ grants })
}

async function createEntityPermissionGrant(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entityUrl } = requireExistingEntityRoute(request)
  const parsed = routeBody<EntityPermissionGrantInput>(request)
  const grant = await ctx.entityManager.registry.createEntityPermissionGrant({
    entityUrl,
    permission: parsed.permission,
    subjectKind: parsed.subject_kind,
    subjectValue: parsed.subject_value,
    propagation: parsed.propagation,
    copyToChildren: parsed.copy_to_children,
    expiresAt: parseExpiresAt(parsed.expires_at),
    createdBy: ctx.principal.url,
  })
  await ctx.entityBridgeManager.onEntityChanged(entityUrl)
  return json(grant, { status: 201 })
}

async function deleteEntityPermissionGrant(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entityUrl } = requireExistingEntityRoute(request)
  const deleted = await ctx.entityManager.registry.deleteEntityPermissionGrant(
    entityUrl,
    parseGrantId(request)
  )
  if (deleted) {
    await ctx.entityBridgeManager.onEntityChanged(entityUrl)
  }
  return deleted
    ? status(204)
    : apiError(404, ErrCodeNotFound, `Grant not found`)
}

async function upsertSchedule(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `scheduled`
  )
  if (principalMutationError) return principalMutationError

  const parsed = routeBody<ScheduleBody>(request)
  const { entityUrl } = requireExistingEntityRoute(request)
  const scheduleId = decodeURIComponent(request.params.scheduleId)

  if (parsed.scheduleType === `cron`) {
    const result = await ctx.entityManager.upsertCronSchedule(entityUrl, {
      id: scheduleId,
      expression: parsed.expression,
      timezone: parsed.timezone,
      payload: parsed.payload,
      debounceMs: parsed.debounceMs,
      timeoutMs: parsed.timeoutMs,
    })
    return json(result)
  }

  if (parsed.scheduleType === `future_send`) {
    if (parsed.from !== undefined && parsed.from !== ctx.principal.url) {
      return apiError(
        400,
        ErrCodeInvalidRequest,
        `Request from must match Electric-Principal`
      )
    }
    const result = await ctx.entityManager.upsertFutureSendSchedule(entityUrl, {
      id: scheduleId,
      payload: parsed.payload,
      targetUrl: parsed.targetUrl,
      fireAt: parsed.fireAt,
      senderUrl: ctx.principal.url,
      messageType: parsed.messageType,
    })
    return json(result)
  }

  throw new Error(`schedule schema accepted an unknown scheduleType`)
}

async function deleteSchedule(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `unscheduled`
  )
  if (principalMutationError) return principalMutationError

  const { entityUrl } = requireExistingEntityRoute(request)
  const result = await ctx.entityManager.deleteSchedule(entityUrl, {
    id: decodeURIComponent(request.params.scheduleId),
  })
  return json(result)
}

async function upsertEventSourceSubscription(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `subscribed to event sources`
  )
  if (principalMutationError) return principalMutationError

  const catalog = ctx.eventSources
  if (!catalog) {
    return apiError(
      404,
      ErrCodeNotFound,
      `No event source catalog is configured`
    )
  }

  const { entityUrl } = requireExistingEntityRoute(request)
  const parsed = routeBody<EventSourceSubscriptionBody>(request)
  const source = await catalog.getEventSource(parsed.sourceKey)
  if (!source) {
    return apiError(
      404,
      ErrCodeNotFound,
      `Event source "${parsed.sourceKey}" not found`
    )
  }

  if (parsed.lifetime?.kind === `expires_at`) {
    const expiresAt = new Date(parsed.lifetime.at)
    if (Number.isNaN(expiresAt.getTime())) {
      return apiError(
        400,
        ErrCodeInvalidRequest,
        `Invalid expires_at lifetime timestamp`
      )
    }
  }

  let resolved: ReturnType<typeof resolveEventSourceSubscription>
  try {
    resolved = resolveEventSourceSubscription({
      contract: source,
      entityUrl,
      request: {
        ...(parsed as EventSourceSubscriptionInput),
        id: decodeURIComponent(request.params.subscriptionId),
      },
      createdBy: `tool`,
    })
  } catch (error) {
    return apiError(
      400,
      ErrCodeInvalidRequest,
      error instanceof Error ? error.message : String(error)
    )
  }

  await ctx.ensureEventSourceWakeSource?.(resolved.subscription.sourceUrl)

  const result = await ctx.entityManager.upsertEventSourceSubscription(
    entityUrl,
    {
      subscription: resolved.subscription,
      manifest: buildEventSourceManifestEntry(resolved),
    }
  )
  return json(result)
}

async function deleteEventSourceSubscription(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `unsubscribed from event sources`
  )
  if (principalMutationError) return principalMutationError

  const { entityUrl } = requireExistingEntityRoute(request)
  const result = await ctx.entityManager.deleteEventSourceSubscription(
    entityUrl,
    {
      id: decodeURIComponent(request.params.subscriptionId),
    }
  )
  return json(result)
}

async function setTag(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `tag updated`
  )
  if (principalMutationError) return principalMutationError

  const parsed = routeBody<SetTagBody>(request)
  const { entityUrl } = requireExistingEntityRoute(request)
  const token = writeTokenFromRequest(request)
  const updated = await ctx.entityManager.setTag(
    entityUrl,
    decodeURIComponent(request.params.tagKey),
    { value: parsed.value },
    token
  )
  return json(toPublicEntity(updated))
}

async function deleteTag(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `tag deleted`
  )
  if (principalMutationError) return principalMutationError

  const { entityUrl } = requireExistingEntityRoute(request)
  const token = writeTokenFromRequest(request)
  const updated = await ctx.entityManager.deleteTag(
    entityUrl,
    decodeURIComponent(request.params.tagKey),
    token
  )
  return json(toPublicEntity(updated))
}

async function forkEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `forked`
  )
  if (principalMutationError) return principalMutationError

  const parsed = routeBody<ForkBody>(request)
  const { entityUrl, entity } = requireExistingEntityRoute(request)
  await assertDispatchPolicyAllowed(ctx, entity.dispatch_policy)
  const result = await ctx.entityManager.forkSubtree(entityUrl, {
    rootInstanceId: parsed.instance_id,
    waitTimeoutMs: parsed.waitTimeoutMs,
    createdBy: ctx.principal.url,
    ...(parsed.fork_pointer && {
      forkPointer: {
        offset: parsed.fork_pointer.offset,
        subOffset: parsed.fork_pointer.sub_offset,
      },
    }),
  })
  for (const forkedEntity of result.entities) {
    await linkEntityDispatchSubscription(ctx, forkedEntity)
  }
  return json(
    {
      root: toPublicEntity(result.root),
      entities: result.entities.map((entity) => toPublicEntity(entity)),
    },
    { status: 201 }
  )
}

async function sendEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<SendBody>(request)
  const principal = ctx.principal
  if (parsed.from !== undefined && parsed.from !== principal.url) {
    return apiError(
      400,
      ErrCodeInvalidRequest,
      `Request from must match Electric-Principal`
    )
  }
  if (
    parsed.from_principal !== undefined &&
    parsed.from_principal !== principal.url
  ) {
    return apiError(
      400,
      ErrCodeInvalidRequest,
      `Request from_principal must match Electric-Principal`
    )
  }
  if (parsed.from_agent !== undefined) {
    const principalAgentUrl = agentUrlForPrincipal(principal)
    if (agentUrlPath(parsed.from_agent) !== principalAgentUrl) {
      return apiError(
        400,
        ErrCodeInvalidRequest,
        `Request from_agent must match authenticated agent principal`
      )
    }
  }
  await ctx.entityManager.ensurePrincipal(principal)
  const { entityUrl, entity } = requireExistingEntityRoute(request)

  const dispatchEntity = entity.dispatch_policy
    ? entity
    : await backfillEntityDispatchPolicy(ctx, entity)
  await linkEntityDispatchSubscription(ctx, dispatchEntity)

  const sendReq: SendRequest = {
    from: principal.url,
    from_principal: principal.url,
    from_agent: parsed.from_agent,
    payload: parsed.payload,
    key: parsed.key,
    type: parsed.type,
    mode: parsed.mode,
    position: parsed.position,
  }

  if (parsed.afterMs && parsed.afterMs > 0) {
    await ctx.entityManager.enqueueDelayedSend(
      entityUrl,
      sendReq,
      new Date(Date.now() + parsed.afterMs)
    )
  } else {
    await ctx.entityManager.send(entityUrl, sendReq)
  }

  return status(204)
}

async function createAttachment(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `given attachments`
  )
  if (principalMutationError) return principalMutationError

  const { entityUrl } = requireExistingEntityRoute(request)
  const form = await parseAttachmentForm(request)
  const result = await ctx.entityManager.createAttachment(entityUrl, {
    id: form.id,
    bytes: form.bytes,
    mimeType: form.mimeType,
    filename: form.filename,
    subject: form.subject,
    role: form.role,
    createdBy: ctx.principal.url,
    meta: form.meta,
  })
  return json(result, { status: 201 })
}

async function readAttachment(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entityUrl } = requireExistingEntityRoute(request)
  const result = await ctx.entityManager.readAttachment(
    entityUrl,
    decodeURIComponent(request.params.attachmentId)
  )
  const headers = new Headers({
    'content-type': result.attachment.mimeType,
    'content-length': String(result.bytes.length),
    'cache-control': `private, max-age=31536000, immutable`,
  })
  if (result.attachment.filename) {
    headers.set(
      `content-disposition`,
      contentDisposition(result.attachment.filename)
    )
  }
  return new Response(result.bytes, { status: 200, headers })
}

async function deleteAttachment(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `stripped of attachments`
  )
  if (principalMutationError) return principalMutationError

  const { entityUrl } = requireExistingEntityRoute(request)
  const result = await ctx.entityManager.deleteAttachment(
    entityUrl,
    decodeURIComponent(request.params.attachmentId)
  )
  return json(result)
}

async function updateInboxMessage(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<InboxMessageBody>(request)
  const { entityUrl } = requireExistingEntityRoute(request)
  await ctx.entityManager.updateInboxMessage(
    entityUrl,
    decodeURIComponent(request.params.messageKey),
    parsed
  )
  return status(204)
}

async function deleteInboxMessage(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entityUrl } = requireExistingEntityRoute(request)
  await ctx.entityManager.deleteInboxMessage(
    entityUrl,
    decodeURIComponent(request.params.messageKey)
  )
  return status(204)
}

async function spawnEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<SpawnBody>(request)
  const principal = ctx.principal
  await ctx.entityManager.ensurePrincipal(principal)
  const dispatchPolicy = await resolveEffectiveDispatchPolicyForSpawn(
    ctx,
    request.params.type,
    {
      dispatchPolicy: parsed.dispatch_policy,
      parent: parsed.parent,
    }
  )
  await assertDispatchPolicyAllowed(ctx, dispatchPolicy)
  const entity = await ctx.entityManager.spawn(request.params.type, {
    instance_id: request.params.instanceId,
    args: parsed.args,
    tags: parsed.tags,
    parent: parsed.parent,
    dispatch_policy: dispatchPolicy,
    sandbox: parsed.sandbox,
    initialMessage: undefined,
    initialMessageType: undefined,
    wake: parsed.wake,
    created_by: principal.url,
  })
  if (parsed.parent) {
    await ctx.entityManager.registry.copyEntityPermissionGrantsForSpawn(
      parsed.parent,
      entity.url,
      principal.url
    )
  }
  for (const grant of parsed.grants ?? []) {
    await ctx.entityManager.registry.createEntityPermissionGrant({
      entityUrl: entity.url,
      permission: grant.permission,
      subjectKind: grant.subject_kind,
      subjectValue: grant.subject_value,
      propagation: grant.propagation,
      copyToChildren: grant.copy_to_children,
      expiresAt: parseExpiresAt(grant.expires_at),
      createdBy: principal.url,
    })
  }
  const linkBeforeInitialMessage =
    parsed.initialMessage !== undefined &&
    shouldLinkDispatchBeforeInitialMessage(dispatchPolicy)
  if (linkBeforeInitialMessage) {
    await linkEntityDispatchSubscription(ctx, entity)
  }
  if (parsed.initialMessage !== undefined) {
    await ctx.entityManager.send(entity.url, {
      from: principal.url,
      payload: parsed.initialMessage,
      type: parsed.initialMessageType,
    })
  }
  if (!linkBeforeInitialMessage) {
    await linkEntityDispatchSubscription(ctx, entity)
  }

  return json(
    { ...toPublicEntity(entity), txid: entity.txid },
    {
      status: 201,
      headers: { 'x-write-token': entity.write_token },
    }
  )
}

function getEntity(request: AgentsRouteRequest): Response {
  return json(toPublicEntity(requireExistingEntityRoute(request).entity))
}

function headEntity(): Response {
  return status(200)
}

async function killEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `killed`
  )
  if (principalMutationError) return principalMutationError

  const { entityUrl, entity } = requireExistingEntityRoute(request)
  await unlinkEntityDispatchSubscription(ctx, entity)
  const result = await ctx.entityManager.kill(entityUrl)
  ctx.runtime.claimWriteTokens.clearStream(ctx.service, entity.streams.main)
  return json(result)
}

async function signalEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `signaled`
  )
  if (principalMutationError) return principalMutationError

  const parsed = routeBody<SignalBody>(request)
  const { entityUrl, entity } = requireExistingEntityRoute(request)
  const result = await ctx.entityManager.signal(entityUrl, {
    signal: parsed.signal,
    reason: parsed.reason,
    payload: parsed.payload,
  })
  if (result.new_state === `stopped` || result.new_state === `killed`) {
    await unlinkEntityDispatchSubscription(ctx, entity)
    ctx.runtime.claimWriteTokens.clearStream(ctx.service, entity.streams.main)
  }
  return json(result)
}
