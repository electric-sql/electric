#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { DurableStreamTestServer } from "@durable-streams/server";
import { createServer } from "node:http";
import { createServerAdapter } from "@whatwg-node/server";
import { Agent } from "undici";
import { appendPathToUrl, assertTags, buildTagsIndex, createEntityRegistry, createRuntimeHandler, entityStateSchema, getCronStreamPath, getCronStreamPathFromSpec, getEntitiesStreamPath, getNextCronFireAt, getSharedStateStreamPath, manifestChildKey, manifestSharedStateKey, manifestSourceKey, normalizeTags, parseCronStreamPath, resolveCronScheduleSpec, sourceRefForTags } from "@electric-ax/agents-runtime";
import fs, { existsSync } from "node:fs";
import path, { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { and, desc, eq, lt, ne, sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { AutoRouter, Router, json, status, withParams } from "itty-router";
import { access, readFile } from "node:fs/promises";
import { DurableStream, DurableStreamError, FetchError, IdempotentProducer } from "@durable-streams/client";
import { SpanKind, SpanStatusCode, context, propagation, trace } from "@opentelemetry/api";
import { Type } from "@sinclair/typebox";
import pino from "pino";
import Ajv from "ajv";
import { createHash, randomUUID } from "node:crypto";
import fastq from "fastq";
import { ShapeStream, isChangeMessage, isControlMessage } from "@electric-sql/client";

//#region rolldown:runtime
var __defProp = Object.defineProperty;
var __export = (target, all) => {
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
};

//#endregion
//#region src/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
	consumerCallbacks: () => consumerCallbacks,
	consumerClaims: () => consumerClaims,
	entities: () => entities,
	entityBridges: () => entityBridges,
	entityDispatchState: () => entityDispatchState,
	entityManifestSources: () => entityManifestSources,
	entityTypes: () => entityTypes,
	runners: () => runners,
	scheduledTasks: () => scheduledTasks,
	subscriptionWebhooks: () => subscriptionWebhooks,
	tagStreamOutbox: () => tagStreamOutbox,
	users: () => users,
	wakeNotifications: () => wakeNotifications,
	wakeRegistrations: () => wakeRegistrations
});
const entityTypes = pgTable(`entity_types`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	name: text(`name`).notNull(),
	description: text(`description`).notNull(),
	creationSchema: jsonb(`creation_schema`),
	inboxSchemas: jsonb(`inbox_schemas`),
	stateSchemas: jsonb(`state_schemas`),
	serveEndpoint: text(`serve_endpoint`),
	defaultDispatchPolicy: jsonb(`default_dispatch_policy`),
	revision: integer(`revision`).notNull().default(1),
	createdAt: text(`created_at`).notNull(),
	updatedAt: text(`updated_at`).notNull()
}, (table) => [primaryKey({ columns: [table.tenantId, table.name] })]);
const entities = pgTable(`entities`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	url: text(`url`).notNull(),
	type: text(`type`).notNull(),
	status: text(`status`).notNull().default(`idle`),
	subscriptionId: text(`subscription_id`).notNull(),
	dispatchPolicy: jsonb(`dispatch_policy`),
	writeToken: text(`write_token`).notNull(),
	tags: jsonb(`tags`).notNull().default({}),
	tagsIndex: text(`tags_index`).array().notNull().default(sql`'{}'::text[]`),
	spawnArgs: jsonb(`spawn_args`).default({}),
	parent: text(`parent`),
	createdBy: text(`created_by`),
	typeRevision: integer(`type_revision`),
	inboxSchemas: jsonb(`inbox_schemas`),
	stateSchemas: jsonb(`state_schemas`),
	createdAt: bigint(`created_at`, { mode: `number` }).notNull(),
	updatedAt: bigint(`updated_at`, { mode: `number` }).notNull()
}, (table) => [
	primaryKey({ columns: [table.tenantId, table.url] }),
	index(`idx_entities_type`).on(table.tenantId, table.type),
	index(`idx_entities_status`).on(table.tenantId, table.status),
	index(`idx_entities_parent`).on(table.tenantId, table.parent),
	index(`idx_entities_created_by`).on(table.tenantId, table.createdBy),
	index(`entities_tags_index_gin`).using(`gin`, table.tagsIndex),
	check(`chk_entities_status`, sql`${table.status} IN ('spawning', 'running', 'idle', 'stopped')`)
]);
const users = pgTable(`users`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	id: text(`id`).notNull(),
	displayName: text(`display_name`),
	email: text(`email`),
	avatarUrl: text(`avatar_url`),
	authProvider: text(`auth_provider`),
	authSubject: text(`auth_subject`),
	profile: jsonb(`profile`).notNull().default({}),
	metadata: jsonb(`metadata`).notNull().default({}),
	createdAt: timestamp(`created_at`, { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp(`updated_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	primaryKey({ columns: [table.tenantId, table.id] }),
	index(`idx_users_email`).on(table.tenantId, table.email),
	index(`idx_users_auth_identity`).on(table.tenantId, table.authProvider, table.authSubject)
]);
const runners = pgTable(`runners`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	id: text(`id`).notNull(),
	ownerUserId: text(`owner_user_id`).notNull(),
	label: text(`label`).notNull(),
	kind: text(`kind`).notNull().default(`local`),
	adminStatus: text(`admin_status`).notNull().default(`enabled`),
	wakeStream: text(`wake_stream`).notNull(),
	wakeStreamOffset: text(`wake_stream_offset`),
	lastSeenAt: timestamp(`last_seen_at`, { withTimezone: true }),
	livenessLeaseExpiresAt: timestamp(`liveness_lease_expires_at`, { withTimezone: true }),
	createdAt: timestamp(`created_at`, { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp(`updated_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	primaryKey({ columns: [table.tenantId, table.id] }),
	unique(`uq_runners_wake_stream`).on(table.tenantId, table.wakeStream),
	index(`idx_runners_owner_user_id`).on(table.tenantId, table.ownerUserId),
	index(`idx_runners_admin_status`).on(table.tenantId, table.adminStatus),
	index(`idx_runners_liveness_lease_expires_at`).on(table.tenantId, table.livenessLeaseExpiresAt),
	check(`chk_runners_kind`, sql`${table.kind} IN ('local', 'cloud-worker', 'sandbox', 'ci', 'server')`),
	check(`chk_runners_admin_status`, sql`${table.adminStatus} IN ('enabled', 'disabled')`)
]);
const entityDispatchState = pgTable(`entity_dispatch_state`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	entityUrl: text(`entity_url`).notNull(),
	pendingSourceStreams: jsonb(`pending_source_streams`).notNull().default([]),
	pendingReason: text(`pending_reason`),
	pendingSince: timestamp(`pending_since`, { withTimezone: true }),
	outstandingWakeId: text(`outstanding_wake_id`),
	outstandingWakeTarget: jsonb(`outstanding_wake_target`),
	outstandingWakeCreatedAt: timestamp(`outstanding_wake_created_at`, { withTimezone: true }),
	activeConsumerId: text(`active_consumer_id`),
	activeRunnerId: text(`active_runner_id`),
	activeEpoch: integer(`active_epoch`),
	activeClaimedAt: timestamp(`active_claimed_at`, { withTimezone: true }),
	activeLeaseExpiresAt: timestamp(`active_lease_expires_at`, { withTimezone: true }),
	lastWakeId: text(`last_wake_id`),
	lastClaimedAt: timestamp(`last_claimed_at`, { withTimezone: true }),
	lastReleasedAt: timestamp(`last_released_at`, { withTimezone: true }),
	lastCompletedAt: timestamp(`last_completed_at`, { withTimezone: true }),
	lastError: text(`last_error`),
	updatedAt: timestamp(`updated_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	primaryKey({ columns: [table.tenantId, table.entityUrl] }),
	index(`idx_entity_dispatch_state_active_runner`).on(table.tenantId, table.activeRunnerId),
	index(`idx_entity_dispatch_state_outstanding_wake`).on(table.tenantId, table.outstandingWakeId),
	index(`idx_entity_dispatch_state_active_lease`).on(table.tenantId, table.activeLeaseExpiresAt)
]);
const wakeNotifications = pgTable(`wake_notifications`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	wakeId: text(`wake_id`).notNull(),
	entityUrl: text(`entity_url`).notNull(),
	targetType: text(`target_type`).notNull(),
	targetRunnerId: text(`target_runner_id`),
	targetWebhookUrl: text(`target_webhook_url`),
	targetWorkerPoolId: text(`target_worker_pool_id`),
	runnerWakeStream: text(`runner_wake_stream`),
	runnerWakeStreamOffset: text(`runner_wake_stream_offset`),
	notificationPublic: jsonb(`notification_public`).notNull(),
	deliveryStatus: text(`delivery_status`).notNull().default(`queued`),
	claimStatus: text(`claim_status`).notNull().default(`unclaimed`),
	createdAt: timestamp(`created_at`, { withTimezone: true }).notNull().defaultNow(),
	deliveredAt: timestamp(`delivered_at`, { withTimezone: true }),
	claimedAt: timestamp(`claimed_at`, { withTimezone: true }),
	resolvedAt: timestamp(`resolved_at`, { withTimezone: true })
}, (table) => [
	primaryKey({ columns: [table.tenantId, table.wakeId] }),
	index(`idx_wake_notifications_entity_url`).on(table.tenantId, table.entityUrl),
	index(`idx_wake_notifications_target_runner`).on(table.tenantId, table.targetRunnerId),
	index(`idx_wake_notifications_delivery_status`).on(table.tenantId, table.deliveryStatus),
	index(`idx_wake_notifications_claim_status`).on(table.tenantId, table.claimStatus),
	index(`idx_wake_notifications_created_at`).on(table.tenantId, table.createdAt),
	check(`chk_wake_notifications_target_type`, sql`${table.targetType} IN ('webhook', 'runner', 'worker-pool')`),
	check(`chk_wake_notifications_delivery_status`, sql`${table.deliveryStatus} IN ('queued', 'delivered', 'failed', 'superseded')`),
	check(`chk_wake_notifications_claim_status`, sql`${table.claimStatus} IN ('unclaimed', 'claimed', 'completed', 'expired')`)
]);
const consumerClaims = pgTable(`consumer_claims`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	consumerId: text(`consumer_id`).notNull(),
	epoch: integer(`epoch`).notNull(),
	wakeId: text(`wake_id`),
	entityUrl: text(`entity_url`).notNull(),
	streamPath: text(`stream_path`).notNull(),
	runnerId: text(`runner_id`),
	status: text(`status`).notNull().default(`active`),
	claimedAt: timestamp(`claimed_at`, { withTimezone: true }).notNull().defaultNow(),
	lastHeartbeatAt: timestamp(`last_heartbeat_at`, { withTimezone: true }),
	leaseExpiresAt: timestamp(`lease_expires_at`, { withTimezone: true }),
	releasedAt: timestamp(`released_at`, { withTimezone: true }),
	ackedStreams: jsonb(`acked_streams`),
	updatedAt: timestamp(`updated_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	primaryKey({ columns: [
		table.tenantId,
		table.consumerId,
		table.epoch
	] }),
	index(`idx_consumer_claims_entity_status`).on(table.tenantId, table.entityUrl, table.status),
	index(`idx_consumer_claims_runner`).on(table.tenantId, table.runnerId),
	index(`idx_consumer_claims_wake_id`).on(table.tenantId, table.wakeId),
	index(`idx_consumer_claims_lease_expires_at`).on(table.tenantId, table.leaseExpiresAt),
	check(`chk_consumer_claims_status`, sql`${table.status} IN ('active', 'released', 'expired', 'failed')`)
]);
const wakeRegistrations = pgTable(`wake_registrations`, {
	id: serial(`id`).primaryKey(),
	tenantId: text(`tenant_id`).notNull().default(`default`),
	subscriberUrl: text(`subscriber_url`).notNull(),
	sourceUrl: text(`source_url`).notNull(),
	condition: jsonb(`condition`).notNull(),
	debounceMs: integer(`debounce_ms`).notNull().default(0),
	timeoutMs: integer(`timeout_ms`).notNull().default(0),
	oneShot: boolean(`one_shot`).notNull().default(false),
	timeoutConsumed: boolean(`timeout_consumed`).notNull().default(false),
	includeResponse: boolean(`include_response`).notNull().default(true),
	manifestKey: text(`manifest_key`),
	createdAt: timestamp(`created_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [index(`idx_wake_source_url`).on(table.tenantId, table.sourceUrl), unique(`uq_wake_registration`).on(table.tenantId, table.subscriberUrl, table.sourceUrl, table.oneShot, table.debounceMs, table.timeoutMs, table.condition, table.manifestKey)]);
const subscriptionWebhooks = pgTable(`subscription_webhooks`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	subscriptionId: text(`subscription_id`).notNull(),
	webhookUrl: text(`webhook_url`).notNull(),
	createdAt: timestamp(`created_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.tenantId, table.subscriptionId] })]);
const consumerCallbacks = pgTable(`consumer_callbacks`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	consumerId: text(`consumer_id`).notNull(),
	callbackUrl: text(`callback_url`).notNull(),
	primaryStream: text(`primary_stream`),
	createdAt: timestamp(`created_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.tenantId, table.consumerId] }), index(`idx_consumer_callbacks_primary_stream`).on(table.tenantId, table.primaryStream)]);
const scheduledTasks = pgTable(`scheduled_tasks`, {
	id: bigserial(`id`, { mode: `number` }).primaryKey(),
	tenantId: text(`tenant_id`).notNull().default(`default`),
	kind: text(`kind`).notNull(),
	payload: jsonb(`payload`).notNull(),
	fireAt: timestamp(`fire_at`, { withTimezone: true }).notNull(),
	cronExpression: text(`cron_expression`),
	cronTimezone: text(`cron_timezone`),
	cronTickNumber: integer(`cron_tick_number`),
	ownerEntityUrl: text(`owner_entity_url`),
	manifestKey: text(`manifest_key`),
	claimedBy: text(`claimed_by`),
	claimedAt: timestamp(`claimed_at`, { withTimezone: true }),
	completedAt: timestamp(`completed_at`, { withTimezone: true }),
	lastError: text(`last_error`),
	createdAt: timestamp(`created_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [
	check(`chk_scheduled_tasks_kind`, sql`${table.kind} IN ('delayed_send', 'cron_tick')`),
	index(`idx_scheduled_tasks_fire_ready`).on(table.tenantId, table.fireAt).where(sql`${table.completedAt} IS NULL AND ${table.claimedAt} IS NULL`),
	unique(`uq_cron_tick`).on(table.tenantId, table.cronExpression, table.cronTimezone, table.cronTickNumber),
	index(`idx_scheduled_tasks_manifest_pending`).on(table.tenantId, table.ownerEntityUrl, table.manifestKey).where(sql`${table.kind} = 'delayed_send' AND ${table.completedAt} IS NULL AND ${table.manifestKey} IS NOT NULL`),
	index(`idx_scheduled_tasks_stale_claims`).on(table.tenantId, table.claimedAt).where(sql`${table.completedAt} IS NULL AND ${table.claimedAt} IS NOT NULL`)
]);
const entityBridges = pgTable(`entity_bridges`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	sourceRef: text(`source_ref`).notNull(),
	tags: jsonb(`tags`).notNull(),
	streamUrl: text(`stream_url`).notNull(),
	shapeHandle: text(`shape_handle`),
	shapeOffset: text(`shape_offset`),
	lastObserverActivityAt: timestamp(`last_observer_activity_at`, { withTimezone: true }).notNull().defaultNow(),
	createdAt: timestamp(`created_at`, { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp(`updated_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [primaryKey({ columns: [table.tenantId, table.sourceRef] }), unique(`uq_entity_bridges_stream_url`).on(table.tenantId, table.streamUrl)]);
const entityManifestSources = pgTable(`entity_manifest_sources`, {
	tenantId: text(`tenant_id`).notNull().default(`default`),
	ownerEntityUrl: text(`owner_entity_url`).notNull(),
	manifestKey: text(`manifest_key`).notNull(),
	sourceRef: text(`source_ref`).notNull(),
	createdAt: timestamp(`created_at`, { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp(`updated_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [unique(`uq_entity_manifest_source`).on(table.tenantId, table.ownerEntityUrl, table.manifestKey), index(`idx_entity_manifest_sources_source_ref`).on(table.tenantId, table.sourceRef)]);
const tagStreamOutbox = pgTable(`tag_stream_outbox`, {
	id: bigserial(`id`, { mode: `number` }).primaryKey(),
	tenantId: text(`tenant_id`).notNull().default(`default`),
	entityUrl: text(`entity_url`).notNull(),
	collection: text(`collection`).notNull(),
	op: text(`op`).notNull(),
	key: text(`key`).notNull(),
	rowData: jsonb(`row_data`),
	attemptCount: integer(`attempt_count`).notNull().default(0),
	lastError: text(`last_error`),
	claimedBy: text(`claimed_by`),
	claimedAt: timestamp(`claimed_at`, { withTimezone: true }),
	deadLetteredAt: timestamp(`dead_lettered_at`, { withTimezone: true }),
	createdAt: timestamp(`created_at`, { withTimezone: true }).notNull().defaultNow()
}, (table) => [index(`idx_tag_stream_outbox_unclaimed`).on(table.tenantId, table.createdAt).where(sql`${table.claimedAt} IS NULL AND ${table.deadLetteredAt} IS NULL`), index(`idx_tag_stream_outbox_stale_claims`).on(table.tenantId, table.claimedAt).where(sql`${table.claimedAt} IS NOT NULL AND ${table.deadLetteredAt} IS NULL`)]);

//#endregion
//#region src/db/index.ts
function createDb(postgresUrl) {
	const poolMax = Number(process.env.ELECTRIC_AGENTS_PG_POOL_MAX ?? `100`);
	const client = postgres(postgresUrl, {
		max: poolMax,
		fetch_types: false
	});
	const db = drizzle(client, { schema: schema_exports });
	return {
		db,
		client
	};
}
function resolveMigrationsFolder(fromUrl = import.meta.url) {
	const here = dirname(fileURLToPath(fromUrl));
	const candidates = [
		resolve(here, `../../drizzle`),
		resolve(here, `../drizzle`),
		resolve(process.cwd(), `packages/agents-server/drizzle`)
	];
	const folder = candidates.find((candidate) => existsSync(candidate));
	if (!folder) throw new Error(`Could not locate agent-server migrations directory from ${fromUrl}`);
	return folder;
}
async function runMigrations(postgresUrl) {
	const migrationClient = postgres(postgresUrl, {
		max: 1,
		onnotice: () => {}
	});
	const db = drizzle(migrationClient);
	await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
	await migrationClient.end();
}

//#endregion
//#region src/routing/tenant-stream-paths.ts
function withoutLeadingSlash(path$1) {
	return path$1.replace(/^\/+/, ``);
}
function withLeadingSlash(path$1) {
	return path$1.startsWith(`/`) ? path$1 : `/${path$1}`;
}
function prefixTenantStreamPath(path$1, tenantId) {
	const normalized = withoutLeadingSlash(path$1);
	if (!normalized || normalized === tenantId) return tenantId;
	if (normalized.startsWith(`${tenantId}/`)) return normalized;
	return `${tenantId}/${normalized}`;
}
function stripTenantStreamPrefix(path$1, tenantId) {
	const normalized = withoutLeadingSlash(path$1);
	if (normalized === tenantId) return ``;
	if (normalized.startsWith(`${tenantId}/`)) return normalized.slice(tenantId.length + 1);
	return normalized;
}

//#endregion
//#region src/routing/durable-streams-routing-adapter.ts
function appendSearch(target, source) {
	target.search = source.search;
	return target;
}
function removeServiceQuery(target) {
	target.searchParams.delete(`service`);
	return target;
}
function logicalStreamPathFromRequest(requestUrl, serviceId) {
	const incomingUrl = new URL(requestUrl, `http://localhost`);
	const segments = incomingUrl.pathname.split(`/`).filter(Boolean);
	if (segments[0] === `v1` && segments[1] === `stream`) return {
		incomingUrl,
		streamPath: segments.length > 2 ? `/${segments.slice(3).join(`/`)}` : `/`
	};
	return {
		incomingUrl,
		streamPath: incomingUrl.pathname || `/${serviceId}`
	};
}
function backendStreamUrl(input, backendStreamPath) {
	const path$1 = backendStreamPath.replace(/^\/+/, ``);
	const target = new URL(`/v1/stream/${path$1}`, input.durableStreamsUrl);
	return target;
}
function streamMetaUrlWithoutService(input) {
	const incomingUrl = new URL(input.requestUrl, `http://localhost`);
	return removeServiceQuery(appendSearch(new URL(incomingUrl.pathname, input.durableStreamsUrl), incomingUrl));
}
const pathPrefixedSingleTenantDurableStreamsRoutingAdapter = {
	streamUrl(input) {
		const { incomingUrl, streamPath } = logicalStreamPathFromRequest(input.requestUrl, input.serviceId);
		const target = backendStreamUrl(input, prefixTenantStreamPath(streamPath, input.serviceId));
		return removeServiceQuery(appendSearch(target, incomingUrl));
	},
	streamMetaUrl: streamMetaUrlWithoutService,
	toBackendStreamPath(serviceId, streamPath) {
		return prefixTenantStreamPath(streamPath, serviceId);
	},
	toRuntimeStreamPath(serviceId, streamPath) {
		return stripTenantStreamPrefix(streamPath, serviceId);
	}
};
function resolveDurableStreamsRoutingAdapter(adapter) {
	return adapter ?? pathPrefixedSingleTenantDurableStreamsRoutingAdapter;
}

//#endregion
//#region src/electric-agents-http.ts
function apiError(status$1, code, message, details) {
	return json({ error: {
		code,
		message,
		...details ? { details } : {}
	} }, { status: status$1 });
}
async function readRequestBody(request) {
	return new Uint8Array(await request.arrayBuffer());
}
function responseHeaders(response) {
	const headers = {};
	response.headers.forEach((value, key) => {
		if (key === `content-encoding` || key === `content-length` || key === `transfer-encoding` || key === `connection` || key.startsWith(`access-control-`)) return;
		headers[key] = value;
	});
	headers[`access-control-allow-origin`] = `*`;
	headers[`access-control-expose-headers`] = `*`;
	return headers;
}

//#endregion
//#region src/electric-agents-types.ts
const VALID_ENTITY_STATUSES = new Set([
	`spawning`,
	`running`,
	`idle`,
	`stopped`
]);
function assertEntityStatus(s) {
	if (!VALID_ENTITY_STATUSES.has(s)) throw new Error(`Invalid entity status: "${s}"`);
	return s;
}
const VALID_RUNNER_KINDS = new Set([
	`local`,
	`cloud-worker`,
	`sandbox`,
	`ci`,
	`server`
]);
const VALID_RUNNER_ADMIN_STATUSES = new Set([`enabled`, `disabled`]);
function assertRunnerKind(s) {
	if (!VALID_RUNNER_KINDS.has(s)) throw new Error(`Invalid runner kind: "${s}"`);
	return s;
}
function assertRunnerAdminStatus(s) {
	if (!VALID_RUNNER_ADMIN_STATUSES.has(s)) throw new Error(`Invalid runner admin status: "${s}"`);
	return s;
}
/** Strip internal fields (write_token, subscription_id) from an entity. */
function toPublicEntity(entity) {
	return {
		url: entity.url,
		type: entity.type,
		status: entity.status,
		streams: entity.streams,
		dispatch_policy: entity.dispatch_policy,
		tags: entity.tags,
		spawn_args: entity.spawn_args,
		parent: entity.parent,
		created_by: entity.created_by,
		created_at: entity.created_at,
		updated_at: entity.updated_at
	};
}
const ErrCodeDuplicateURL = `DUPLICATE_URL`;
const ErrCodeUnauthorized = `UNAUTHORIZED`;
const ErrCodeNotFound = `NOT_FOUND`;
const ErrCodeNotRunning = `NOT_RUNNING`;
const ErrCodeInvalidRequest = `INVALID_REQUEST`;
const ErrCodeUnknownEntityType = `UNKNOWN_ENTITY_TYPE`;
const ErrCodeSchemaValidationFailed = `SCHEMA_VALIDATION_FAILED`;
const ErrCodeUnknownMessageType = `UNKNOWN_MESSAGE_TYPE`;
const ErrCodeUnknownEventType = `UNKNOWN_EVENT_TYPE`;
const ErrCodeSchemaKeyExists = `SCHEMA_KEY_EXISTS`;
const ErrCodeServeEndpointUnreachable = `SERVE_ENDPOINT_UNREACHABLE`;
const ErrCodeServeEndpointNameMismatch = `SERVE_ENDPOINT_NAME_MISMATCH`;
const ErrCodeForkInProgress = `FORK_IN_PROGRESS`;
const ErrCodeForkWaitTimeout = `FORK_WAIT_TIMEOUT`;
const ErrCodeEntityPersistFailed = `ENTITY_PERSIST_FAILED`;
const ErrCodeAgentUiNotFound = `AGENT_UI_NOT_FOUND`;
const ErrCodeSubscriptionNotFound = `SUBSCRIPTION_NOT_FOUND`;
const ErrCodeCallbackNotFound = `CALLBACK_NOT_FOUND`;

//#endregion
//#region src/utils/electric-url.ts
function applyElectricUrlQueryParams(target, electricUrl) {
	const configured = new URL(electricUrl);
	configured.searchParams.forEach((value, key) => {
		target.searchParams.set(key, value);
	});
}
function electricUrlWithPath(electricUrl, path$1) {
	const target = new URL(path$1, electricUrl);
	applyElectricUrlQueryParams(target, electricUrl);
	return target;
}

//#endregion
//#region src/tracing.ts
const tracer = trace.getTracer(`agent-server`);
const ATTR = {
	ENTITY_URL: `electric_agents.entity.url`,
	ENTITY_TYPE: `electric_agents.entity.type`,
	PARENT_URL: `electric_agents.entity.parent`,
	WAKE_SOURCE: `electric_agents.wake.source`,
	WAKE_SUBSCRIBER: `electric_agents.wake.subscriber`,
	WAKE_KIND: `electric_agents.wake.kind`,
	STREAM_PATH: `electric_agents.stream.path`,
	STREAM_OP: `electric_agents.stream.op`,
	DB_OP: `electric_agents.db.op`,
	HTTP_METHOD: `http.method`,
	HTTP_ROUTE: `http.route`,
	HTTP_STATUS: `http.status_code`
};
/**
* Run `fn` inside an active span. Errors are recorded + status set to ERROR,
* then re-thrown. Span ends in a finally block.
*/
async function withSpan(name, fn, opts) {
	return await tracer.startActiveSpan(name, opts ?? {}, async (span) => {
		try {
			return await fn(span);
		} catch (err) {
			span.recordException(err);
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: err instanceof Error ? err.message : String(err)
			});
			throw err;
		} finally {
			span.end();
		}
	});
}
function injectTraceHeaders(headers, ctx = context.active()) {
	propagation.inject(ctx, headers);
}
function extractTraceContext(headers) {
	return propagation.extract(context.active(), headers);
}

//#endregion
//#region src/stream-client.ts
var DurableStreamsSubscriptionError = class extends Error {
	code;
	errorMessage;
	constructor(message, status$1, body) {
		super(`${message}: ${status$1} ${body}`);
		this.status = status$1;
		this.body = body;
		this.name = `DurableStreamsSubscriptionError`;
		try {
			const parsed = JSON.parse(body);
			if (typeof parsed.error?.code === `string`) this.code = parsed.error.code;
			if (typeof parsed.error?.message === `string`) this.errorMessage = parsed.error.message;
		} catch {}
	}
};
async function resolveDurableStreamsBearer(bearer) {
	if (!bearer) return void 0;
	const value = typeof bearer === `function` ? await bearer() : bearer;
	const trimmed = value.trim();
	if (!trimmed) return void 0;
	return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}
async function applyDurableStreamsBearer(headers, bearer, opts = {}) {
	if (!bearer) return;
	if (!opts.overwrite && headers.has(`authorization`)) return;
	const value = await resolveDurableStreamsBearer(bearer);
	if (value) headers.set(`authorization`, value);
}
function durableStreamsBearerHeaders(bearer) {
	if (!bearer) return void 0;
	return { authorization: async () => await resolveDurableStreamsBearer(bearer) ?? `` };
}
function durableStreamsServiceUrl(baseUrl, serviceId) {
	const url = new URL(baseUrl);
	if (/^\/v1\/stream\/[^/]+\/?$/.test(url.pathname)) return baseUrl.replace(/\/+$/, ``);
	const base = baseUrl.replace(/\/+$/, ``);
	return `${base}/v1/stream/${encodeURIComponent(serviceId)}`;
}
function isNotFoundError(err) {
	return err instanceof DurableStreamError && err.code === ErrCodeNotFound || err instanceof FetchError && err.status === 404;
}
function isAbortLikeError(err) {
	return err instanceof Error && (err.name === `AbortError` || err.message === `Stream request was aborted`);
}
function normalizeSubscriptionPattern(pattern) {
	return pattern.replace(/^\/+/, ``);
}
function normalizeSubscriptionStreamPath(path$1) {
	return path$1.replace(/^\/+/, ``);
}
function normalizeSubscriptionPath(path$1) {
	return path$1.replace(/^\/+/, ``).replace(/\/+$/, ``);
}
var StreamClient = class {
	constructor(baseUrl, options = {}) {
		this.baseUrl = baseUrl;
		this.options = options;
	}
	streamUrl(path$1) {
		return `${this.baseUrl}${path$1}`;
	}
	streamHeaders() {
		return durableStreamsBearerHeaders(this.options.bearer);
	}
	async requestHeaders(init, opts = {}) {
		const headers = new Headers(init);
		await applyDurableStreamsBearer(headers, this.options.bearer, { overwrite: opts.overwriteBearer });
		return headers;
	}
	subscriptionServiceId() {
		const url = new URL(this.baseUrl);
		const match = /^(.*)\/v1\/stream\/([^/]+)\/?$/.exec(url.pathname);
		return match ? decodeURIComponent(match[2]) : null;
	}
	backendSubscriptionPath(path$1) {
		const normalized = normalizeSubscriptionPath(path$1);
		const serviceId = this.subscriptionServiceId();
		if (!serviceId) return normalized;
		if (normalized === serviceId || normalized.startsWith(`${serviceId}/`)) return normalized;
		return `${serviceId}/${normalized}`;
	}
	runtimeSubscriptionPath(path$1) {
		const normalized = normalizeSubscriptionPath(path$1);
		const serviceId = this.subscriptionServiceId();
		if (!serviceId) return normalized;
		return normalized.startsWith(`${serviceId}/`) ? normalized.slice(serviceId.length + 1) : normalized;
	}
	subscriptionUrl(subscriptionId) {
		const url = new URL(this.baseUrl);
		const match = /^(.*)\/v1\/stream\/([^/]+)\/?$/.exec(url.pathname);
		if (match) {
			const [, prefix = ``, serviceId] = match;
			url.pathname = `${prefix}/v1/stream-meta/subscriptions/${encodeURIComponent(subscriptionId)}`;
			url.searchParams.set(`service`, decodeURIComponent(serviceId));
			return url.toString();
		}
		url.pathname = `${url.pathname.replace(/\/+$/, ``)}/v1/stream-meta/subscriptions/${encodeURIComponent(subscriptionId)}`;
		return url.toString();
	}
	subscriptionChildUrl(subscriptionId, ...segments) {
		const url = new URL(this.subscriptionUrl(subscriptionId));
		url.pathname = `${url.pathname.replace(/\/+$/, ``)}/${segments.map((segment) => encodeURIComponent(segment)).join(`/`)}`;
		return url.toString();
	}
	async create(path$1, opts) {
		return await withSpan(`stream.create`, async (span) => {
			span.setAttributes({
				[ATTR.STREAM_PATH]: path$1,
				[ATTR.STREAM_OP]: `create`
			});
			await DurableStream.create({
				url: this.streamUrl(path$1),
				headers: this.streamHeaders(),
				contentType: opts.contentType,
				body: opts.body
			});
		});
	}
	async fork(path$1, sourcePath) {
		return await withSpan(`stream.fork`, async (span) => {
			span.setAttributes({
				[ATTR.STREAM_PATH]: path$1,
				[ATTR.STREAM_OP]: `fork`
			});
			const headers = {
				"content-type": `application/json`,
				"Stream-Forked-From": sourcePath
			};
			injectTraceHeaders(headers);
			const response = await fetch(this.streamUrl(path$1), {
				method: `PUT`,
				headers: await this.requestHeaders(headers)
			});
			if (response.ok) return;
			throw new Error(`Stream fork failed: ${response.status} ${await response.text()}`);
		});
	}
	async append(path$1, data, opts) {
		return await withSpan(`stream.append`, async (span) => {
			span.setAttributes({
				[ATTR.STREAM_PATH]: path$1,
				[ATTR.STREAM_OP]: opts?.close ? `append+close` : `append`
			});
			const handle = new DurableStream({
				url: this.streamUrl(path$1),
				headers: this.streamHeaders(),
				contentType: `application/json`,
				batching: false
			});
			if (opts?.close) {
				const result = await handle.close({ body: data });
				return { offset: result.finalOffset };
			}
			await handle.append(data);
			const head = await handle.head();
			return { offset: head.exists && head.offset || `` };
		});
	}
	async appendIdempotent(path$1, data, opts) {
		return await withSpan(`stream.appendIdempotent`, async (span) => {
			span.setAttributes({
				[ATTR.STREAM_PATH]: path$1,
				[ATTR.STREAM_OP]: `appendIdempotent`
			});
			const stream = new DurableStream({
				url: this.streamUrl(path$1),
				headers: this.streamHeaders(),
				contentType: `application/json`
			});
			const producer = new IdempotentProducer(stream, opts.producerId, { epoch: opts.epoch ?? 0 });
			try {
				producer.append(data);
				await producer.flush();
			} finally {
				await producer.detach();
			}
		});
	}
	async appendWithProducerHeaders(path$1, data, opts) {
		return await withSpan(`stream.appendWithProducerHeaders`, async (span) => {
			span.setAttributes({
				[ATTR.STREAM_PATH]: path$1,
				[ATTR.STREAM_OP]: `appendWithProducerHeaders`
			});
			const headers = {
				"content-type": `application/json`,
				"Producer-Id": opts.producerId,
				"Producer-Epoch": String(opts.epoch),
				"Producer-Seq": String(opts.seq)
			};
			injectTraceHeaders(headers);
			const response = await fetch(this.streamUrl(path$1), {
				method: `POST`,
				headers: await this.requestHeaders(headers),
				body: typeof data === `string` ? data : Buffer.from(data)
			});
			if (response.ok || response.status === 204) return;
			throw new Error(`Stream append failed: ${response.status} ${await response.text()}`);
		});
	}
	async read(path$1, fromOffset) {
		return await withSpan(`stream.read`, async (span) => {
			span.setAttributes({
				[ATTR.STREAM_PATH]: path$1,
				[ATTR.STREAM_OP]: `read`
			});
			const handle = new DurableStream({
				url: this.streamUrl(path$1),
				headers: this.streamHeaders()
			});
			const response = await handle.stream({
				offset: fromOffset ?? `-1`,
				live: false
			});
			const messages = [];
			return await new Promise((resolve$1, reject) => {
				let settled = false;
				let unsub = () => {};
				const finish = (r) => {
					if (settled) return;
					settled = true;
					unsub();
					resolve$1(r);
				};
				unsub = response.subscribeBytes((chunk) => {
					messages.push({
						data: chunk.data,
						offset: chunk.offset
					});
					if (chunk.upToDate || chunk.streamClosed) finish({ messages });
				});
				response.closed.then(() => finish({ messages })).catch((err) => {
					if (settled) return;
					settled = true;
					unsub();
					reject(err);
				});
			});
		});
	}
	async readJson(path$1, fromOffset) {
		return await withSpan(`stream.readJson`, async (span) => {
			span.setAttributes({
				[ATTR.STREAM_PATH]: path$1,
				[ATTR.STREAM_OP]: `readJson`
			});
			const handle = new DurableStream({
				url: this.streamUrl(path$1),
				headers: this.streamHeaders()
			});
			const response = await handle.stream({
				offset: fromOffset ?? `-1`,
				live: false
			});
			return await response.json();
		});
	}
	async waitForMessages(path$1, fromOffset, timeoutMs) {
		return await withSpan(`stream.waitForMessages`, async (span) => {
			span.setAttributes({
				[ATTR.STREAM_PATH]: path$1,
				[ATTR.STREAM_OP]: `waitForMessages`
			});
			const handle = new DurableStream({
				url: this.streamUrl(path$1),
				headers: this.streamHeaders()
			});
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await handle.stream({
					offset: fromOffset,
					live: `long-poll`,
					signal: controller.signal
				});
				const messages = [];
				return await new Promise((resolve$1, reject) => {
					let settled = false;
					let unsub = () => {};
					const finish = (result) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						unsub();
						resolve$1(result);
					};
					unsub = response.subscribeBytes((chunk) => {
						messages.push({
							data: chunk.data,
							offset: chunk.offset
						});
						if (chunk.upToDate) finish({
							messages,
							timedOut: false
						});
					});
					response.closed.then(() => finish({
						messages,
						timedOut: false
					})).catch((err) => {
						if (settled) return;
						clearTimeout(timer);
						if (isAbortLikeError(err)) {
							settled = true;
							unsub();
							resolve$1({
								messages: [],
								timedOut: true
							});
							return;
						}
						settled = true;
						unsub();
						reject(err);
					});
				});
			} catch (err) {
				clearTimeout(timer);
				if (isAbortLikeError(err)) return {
					messages: [],
					timedOut: true
				};
				throw err;
			}
		});
	}
	async delete(path$1) {
		await DurableStream.delete({
			url: this.streamUrl(path$1),
			headers: this.streamHeaders()
		});
	}
	async ensure(path$1, opts) {
		if (await this.exists(path$1)) return;
		try {
			await this.create(path$1, opts);
		} catch (err) {
			if (err && typeof err === `object` && `status` in err && err.status === 409) return;
			throw err;
		}
	}
	async exists(path$1) {
		try {
			const result = await DurableStream.head({
				url: this.streamUrl(path$1),
				headers: this.streamHeaders()
			});
			return result.exists;
		} catch (err) {
			if (isNotFoundError(err)) return false;
			throw err;
		}
	}
	async createSubscription(pattern, subscriptionId, webhookUrl, description) {
		const res = await this.putSubscription(subscriptionId, {
			type: `webhook`,
			pattern: normalizeSubscriptionPattern(pattern),
			webhook: { url: webhookUrl },
			...description ? { description } : {}
		});
		return res;
	}
	async putSubscription(subscriptionId, input) {
		const res = await fetch(this.subscriptionUrl(subscriptionId), {
			method: `PUT`,
			headers: await this.requestHeaders({ "content-type": `application/json` }),
			body: JSON.stringify({
				...input,
				pattern: typeof input.pattern === `string` ? this.backendSubscriptionPath(normalizeSubscriptionPattern(input.pattern)) : void 0,
				streams: input.streams?.map((stream) => this.backendSubscriptionPath(normalizeSubscriptionStreamPath(stream))),
				wake_stream: typeof input.wake_stream === `string` ? this.backendSubscriptionPath(normalizeSubscriptionStreamPath(input.wake_stream)) : void 0
			})
		});
		return await this.subscriptionJson(res, `Subscription creation failed`);
	}
	async getSubscription(subscriptionId) {
		const res = await fetch(this.subscriptionUrl(subscriptionId), {
			method: `GET`,
			headers: await this.requestHeaders()
		});
		if (res.status === 404) return null;
		return await this.subscriptionJson(res, `Subscription query failed`);
	}
	async deleteSubscription(subscriptionId) {
		const res = await fetch(this.subscriptionUrl(subscriptionId), {
			method: `DELETE`,
			headers: await this.requestHeaders()
		});
		if (res.status === 404 || res.status === 204) return;
		if (!res.ok) throw new Error(`Subscription delete failed: ${res.status} ${await res.text()}`);
	}
	async addSubscriptionStreams(subscriptionId, streams$1) {
		const res = await fetch(this.subscriptionChildUrl(subscriptionId, `streams`), {
			method: `POST`,
			headers: await this.requestHeaders({ "content-type": `application/json` }),
			body: JSON.stringify({ streams: streams$1.map((stream) => this.backendSubscriptionPath(normalizeSubscriptionStreamPath(stream))) })
		});
		return await this.subscriptionJson(res, `Subscription stream add failed`);
	}
	async removeSubscriptionStream(subscriptionId, streamPath) {
		const res = await fetch(this.subscriptionChildUrl(subscriptionId, `streams`, this.backendSubscriptionPath(normalizeSubscriptionStreamPath(streamPath))), {
			method: `DELETE`,
			headers: await this.requestHeaders()
		});
		if (res.status === 404 || res.status === 204) return;
		if (!res.ok) throw new Error(`Subscription stream remove failed: ${res.status} ${await res.text()}`);
	}
	async claimSubscription(subscriptionId, worker) {
		const res = await fetch(this.subscriptionChildUrl(subscriptionId, `claim`), {
			method: `POST`,
			headers: await this.requestHeaders({ "content-type": `application/json` }),
			body: JSON.stringify({ worker })
		});
		if (res.status === 204 || res.status === 404) return null;
		return await this.subscriptionJson(res, `Subscription claim failed`);
	}
	async ackSubscription(subscriptionId, token, body) {
		const res = await fetch(this.subscriptionChildUrl(subscriptionId, `ack`), {
			method: `POST`,
			headers: await this.requestHeaders({
				"content-type": `application/json`,
				authorization: `Bearer ${token}`
			}),
			body: JSON.stringify(this.subscriptionRequestBody(body))
		});
		return await this.subscriptionJson(res, `Subscription ack failed`);
	}
	async releaseSubscription(subscriptionId, token, body) {
		const res = await fetch(this.subscriptionChildUrl(subscriptionId, `release`), {
			method: `POST`,
			headers: await this.requestHeaders({
				"content-type": `application/json`,
				authorization: `Bearer ${token}`
			}),
			body: JSON.stringify(this.subscriptionRequestBody(body))
		});
		return await this.subscriptionJson(res, `Subscription release failed`);
	}
	subscriptionRequestBody(body) {
		const next = { ...body };
		if (typeof next.stream === `string`) next.stream = this.backendSubscriptionPath(next.stream);
		if (typeof next.path === `string`) next.path = this.backendSubscriptionPath(next.path);
		if (Array.isArray(next.acks)) next.acks = next.acks.map((ack) => {
			if (!ack || typeof ack !== `object`) return ack;
			const mapped = { ...ack };
			if (typeof mapped.stream === `string`) mapped.stream = this.backendSubscriptionPath(mapped.stream);
			if (typeof mapped.path === `string`) mapped.path = this.backendSubscriptionPath(mapped.path);
			return mapped;
		});
		return next;
	}
	subscriptionResponseBody(body) {
		const next = { ...body };
		if (typeof next.pattern === `string`) next.pattern = this.runtimeSubscriptionPath(next.pattern);
		if (typeof next.wake_stream === `string`) next.wake_stream = this.runtimeSubscriptionPath(next.wake_stream);
		if (Array.isArray(next.streams)) next.streams = next.streams.map((stream) => {
			if (typeof stream === `string`) return this.runtimeSubscriptionPath(stream);
			return {
				...stream,
				path: this.runtimeSubscriptionPath(stream.path)
			};
		});
		if (Array.isArray(next.acks)) next.acks = next.acks.map((ack) => {
			if (!ack || typeof ack !== `object`) return ack;
			const mapped = { ...ack };
			if (typeof mapped.stream === `string`) mapped.stream = this.runtimeSubscriptionPath(mapped.stream);
			if (typeof mapped.path === `string`) mapped.path = this.runtimeSubscriptionPath(mapped.path);
			return mapped;
		});
		if (typeof next.stream === `string`) next.stream = this.runtimeSubscriptionPath(next.stream);
		return next;
	}
	async subscriptionJson(res, message) {
		if (!res.ok) throw new DurableStreamsSubscriptionError(message, res.status, await res.text());
		if (res.status === 204) return {};
		const text$1 = await res.text();
		if (!text$1.trim()) return {};
		return this.subscriptionResponseBody(JSON.parse(text$1));
	}
	async getConsumerState(consumerId) {
		const res = await fetch(`${this.baseUrl}/consumers/${encodeURIComponent(consumerId)}`, {
			method: `GET`,
			headers: await this.requestHeaders()
		});
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`Consumer query failed: ${res.status} ${await res.text()}`);
		return res.json();
	}
};

//#endregion
//#region src/utils/server-utils.ts
function contentTypeForStaticFile(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case `.html`: return `text/html; charset=utf-8`;
		case `.js`: return `text/javascript; charset=utf-8`;
		case `.css`: return `text/css; charset=utf-8`;
		case `.json`: return `application/json; charset=utf-8`;
		case `.svg`: return `image/svg+xml`;
		case `.png`: return `image/png`;
		case `.jpg`:
		case `.jpeg`: return `image/jpeg`;
		case `.ico`: return `image/x-icon`;
		case `.map`: return `application/json; charset=utf-8`;
		default: return `application/octet-stream`;
	}
}
function cacheControlForAgentUiFile(filePath) {
	return filePath.includes(`${path.sep}assets${path.sep}`) ? `public, max-age=31536000, immutable` : `no-cache`;
}
function resolveAgentUiPath(agentUiDistDir, relativePath) {
	const normalized = relativePath.replace(/^\/+/, ``);
	return path.resolve(agentUiDistDir, normalized);
}
async function pickAgentUiFile(agentUiDistDir, filePath, fallbackToIndex) {
	if (isAgentUiPath(agentUiDistDir, filePath) && await fileExists(filePath)) return filePath;
	if (!fallbackToIndex) return null;
	const indexPath = path.join(agentUiDistDir, `index.html`);
	if (!await fileExists(indexPath)) return null;
	return indexPath;
}
function isAgentUiPath(agentUiDistDir, filePath) {
	return filePath === agentUiDistDir || filePath.startsWith(`${agentUiDistDir}${path.sep}`);
}
async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}
function buildElectricProxyTarget(options) {
	const targetPath = options.incomingUrl.pathname.replace(`/_electric/electric`, ``);
	const target = electricUrlWithPath(options.electricUrl, targetPath);
	options.incomingUrl.searchParams.forEach((value, key) => {
		target.searchParams.append(key, value);
	});
	applyElectricUrlQueryParams(target, options.electricUrl);
	if (targetPath !== `/v1/shape`) return target;
	if (options.electricSecret) target.searchParams.set(`secret`, options.electricSecret);
	const table = options.incomingUrl.searchParams.get(`table`);
	if (table === `entities`) {
		target.searchParams.set(`columns`, `"tenant_id","url","type","status","dispatch_policy","tags","spawn_args","parent","type_revision","inbox_schemas","state_schemas","created_at","updated_at"`);
		applyTenantShapeWhere(target, options.tenantId);
	} else if (table === `entity_types`) {
		target.searchParams.set(`columns`, `"tenant_id","name","description","creation_schema","inbox_schemas","state_schemas","serve_endpoint","default_dispatch_policy","revision","created_at","updated_at"`);
		applyTenantShapeWhere(target, options.tenantId);
	} else if (table === `runners`) {
		target.searchParams.set(`columns`, `"tenant_id","id","owner_user_id","label","kind","admin_status","wake_stream","wake_stream_offset","last_seen_at","liveness_lease_expires_at","created_at","updated_at"`);
		applyTenantShapeWhere(target, options.tenantId);
	} else if (table === `entity_dispatch_state`) {
		target.searchParams.set(`columns`, `"tenant_id","entity_url","pending_source_streams","pending_reason","pending_since","outstanding_wake_id","outstanding_wake_target","outstanding_wake_created_at","active_consumer_id","active_runner_id","active_epoch","active_claimed_at","active_lease_expires_at","last_wake_id","last_claimed_at","last_released_at","last_completed_at","last_error","updated_at"`);
		applyTenantShapeWhere(target, options.tenantId);
	} else if (table === `wake_notifications`) {
		target.searchParams.set(`columns`, `"tenant_id","wake_id","entity_url","target_type","target_runner_id","target_webhook_url","target_worker_pool_id","runner_wake_stream","runner_wake_stream_offset","notification_public","delivery_status","claim_status","created_at","delivered_at","claimed_at","resolved_at"`);
		applyTenantShapeWhere(target, options.tenantId);
	} else if (table === `consumer_claims`) {
		target.searchParams.set(`columns`, `"tenant_id","consumer_id","epoch","wake_id","entity_url","stream_path","runner_id","status","claimed_at","last_heartbeat_at","lease_expires_at","released_at","acked_streams","updated_at"`);
		applyTenantShapeWhere(target, options.tenantId);
	}
	return target;
}
async function forwardFetchRequest(options) {
	const routingAdapter = resolveDurableStreamsRoutingAdapter(options.durableStreamsRouting);
	const routingInput = {
		durableStreamsUrl: options.durableStreamsUrl,
		serviceId: options.serviceId,
		requestUrl: options.request.url
	};
	const upstreamUrl = options.route === `stream-meta` ? routingAdapter.streamMetaUrl(routingInput) : routingAdapter.streamUrl(routingInput);
	const headers = new Headers(options.request.headers);
	if (options.durableStreamsBearerMode !== `none`) await applyDurableStreamsBearer(headers, options.durableStreamsBearer, { overwrite: options.durableStreamsBearerMode !== `if-missing` });
	const init = {
		method: options.request.method,
		headers
	};
	if (options.body !== void 0) {
		headers.delete(`content-length`);
		init.body = bodyFromBytes$2(options.body);
		init.duplex = `half`;
	}
	if (options.dispatcher) init.dispatcher = options.dispatcher;
	return await fetch(upstreamUrl, init);
}
function bodyFromBytes$2(body) {
	return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
}
function decodeJsonObject(body) {
	if (body.length === 0) return null;
	try {
		const parsed = JSON.parse(new TextDecoder().decode(body));
		if (parsed && typeof parsed === `object` && !Array.isArray(parsed)) return parsed;
	} catch {}
	return null;
}
function applyTenantShapeWhere(target, tenantId) {
	const tenantWhere = `tenant_id = ${sqlStringLiteral$2(tenantId)}`;
	const existingWhere = target.searchParams.get(`where`);
	target.searchParams.set(`where`, existingWhere ? `${tenantWhere} AND (${existingWhere})` : tenantWhere);
}
function sqlStringLiteral$2(value) {
	return `'${value.replace(/'/g, `''`)}'`;
}

//#endregion
//#region src/routing/agent-ui-router.ts
function resolveAgentUiDistDir(fromUrl = import.meta.url) {
	const moduleDir = path.dirname(fileURLToPath(fromUrl));
	const candidates = [
		path.resolve(moduleDir, `../../../agents-server-ui/dist`),
		path.resolve(moduleDir, `../../agents-server-ui/dist`),
		path.resolve(process.cwd(), `packages/agents-server-ui/dist`)
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
const AGENT_UI_DIST_DIR = resolveAgentUiDistDir();
const agentUiRouter = Router({ base: `/__agent_ui` });
agentUiRouter.get(`/*`, serveAgentUi);
agentUiRouter.head(`/*`, serveAgentUi);
agentUiRouter.all(`*`, () => status(404));
async function serveAgentUi(request) {
	const requestPath = new URL(request.url).pathname;
	const relativePath = decodeURIComponent(requestPath.slice(`/__agent_ui/`.length));
	const requestedFile = relativePath.length === 0 ? `index.html` : relativePath;
	const filePath = resolveAgentUiPath(AGENT_UI_DIST_DIR, requestedFile);
	const fallbackToIndex = path.extname(requestedFile) === `` || requestedFile.endsWith(`/`);
	const resolvedFile = await pickAgentUiFile(AGENT_UI_DIST_DIR, filePath, fallbackToIndex);
	if (!resolvedFile) return apiError(404, ErrCodeAgentUiNotFound, `Agent UI build artifacts are missing`);
	const body = request.method === `HEAD` ? null : await readFile(resolvedFile);
	return new Response(body, { headers: {
		"content-type": contentTypeForStaticFile(resolvedFile),
		"cache-control": cacheControlForAgentUiFile(resolvedFile)
	} });
}

//#endregion
//#region src/utils/log.ts
const LOG_LEVEL = process.env.ELECTRIC_AGENTS_LOG_LEVEL ?? `info`;
const IS_ELECTRON_MAIN = Boolean(process.versions.electron);
const USE_FILE_LOGS = process.env.ELECTRIC_AGENTS_LOG_FILE !== `false`;
const USE_PRETTY_LOGS = LOG_LEVEL !== `silent` && !process.env.VITEST && !IS_ELECTRON_MAIN;
const LOG_DIR = USE_FILE_LOGS ? process.env.ELECTRIC_AGENTS_LOG_DIR ?? path.resolve(process.cwd(), `logs`) : void 0;
const LOG_FILE = LOG_DIR ? path.join(LOG_DIR, `agent-server-${Date.now()}.jsonl`) : void 0;
if (LOG_DIR) fs.mkdirSync(LOG_DIR, { recursive: true });
const streams = [];
if (LOG_FILE) streams.push({ stream: pino.destination({
	dest: LOG_FILE,
	sync: IS_ELECTRON_MAIN
}) });
if (USE_PRETTY_LOGS) streams.push({ stream: pino.transport({
	target: `pino-pretty`,
	options: {
		colorize: true,
		ignore: `pid,hostname,name`,
		translateTime: `SYS:HH:MM:ss`
	}
}) });
const logger = streams.length > 0 ? pino({
	base: void 0,
	level: LOG_LEVEL
}, pino.multistream(streams)) : pino({
	base: void 0,
	enabled: false,
	level: LOG_LEVEL
});
function formatArgs(args) {
	const errors = [];
	const parts = [];
	for (const a of args) if (a instanceof Error) errors.push(a);
	else parts.push(typeof a === `string` ? a : JSON.stringify(a));
	return {
		err: errors[0],
		msg: parts.join(` `)
	};
}
const serverLog = {
	info(...args) {
		const { msg } = formatArgs(args);
		logger.info(msg);
	},
	warn(...args) {
		const { err, msg } = formatArgs(args);
		if (err) logger.warn({ err }, msg);
		else logger.warn(msg);
	},
	error(...args) {
		const { err, msg } = formatArgs(args);
		if (err) logger.error({ err }, msg);
		else logger.error(msg);
	},
	event(obj, msg) {
		logger.info(obj, msg);
	}
};

//#endregion
//#region src/routing/stream-append.ts
const electricAgentsStreamAppendRouter = Router();
electricAgentsStreamAppendRouter.post(`*`, handleStreamAppend);
function createStreamAppendRouteRequest(request) {
	return {
		method: request.method,
		url: request.url,
		headers: request.headers,
		readBody: () => readRequestBody(request)
	};
}
async function handleStreamAppend(request, runtime, forward) {
	const path$1 = new URL(request.url).pathname;
	const { manager } = runtime;
	const entity = await manager.registry.getEntityByStream(path$1);
	const isSharedState = path$1.startsWith(`/_electric/shared-state/`);
	if (!entity && !isSharedState) return void 0;
	const body = await request.readBody();
	const event = decodeStreamAppendEvent(body);
	if (entity) {
		const token = writeTokenFromHeaders(request.headers);
		if (!manager.isValidWriteToken(entity, token)) return apiError(401, ErrCodeUnauthorized, `Invalid write token`);
		if (manager.isForkWriteLockedEntity(entity.url)) return apiError(409, ErrCodeForkInProgress, `Entity subtree is being forked`);
		if (entity.status === `stopped`) return apiError(409, ErrCodeNotRunning, `Entity is stopped`);
		if (event) {
			const events = Array.isArray(event) ? event : [event];
			for (const eventItem of events) {
				const validationError = await manager.validateWriteEvent(entity, eventItem);
				if (validationError) return apiError(validationError.status, validationError.code, validationError.message);
			}
		}
	} else if (manager.isForkWriteLockedStream(path$1)) return apiError(409, ErrCodeForkInProgress, `Entity subtree is being forked`);
	const upstream = await forward(request, body);
	if (!upstream.ok || !event) return upstream;
	if (entity) {
		runtime.evaluateWakePayload(entity.url, event).catch((err) => serverLog.warn(`[agent-server] wake evaluation failed:`, err));
		runtime.checkRunFinished(entity.url, event);
		runtime.syncManifestWakes(entity.url, event).catch((err) => serverLog.warn(`[agent-server] manifest wake sync failed:`, err));
		runtime.syncManifestEntitySources(entity.url, event).catch((err) => serverLog.warn(`[agent-server] manifest source sync failed:`, err));
		runtime.syncManifestSchedules(entity.url, event).catch((err) => serverLog.warn(`[agent-server] manifest schedule sync failed:`, err));
	} else runtime.evaluateWakePayload(path$1, event).catch((err) => serverLog.warn(`[agent-server] wake evaluation failed:`, err));
	return upstream;
}
function decodeStreamAppendEvent(body) {
	try {
		return JSON.parse(new TextDecoder().decode(body));
	} catch {
		return null;
	}
}
function writeTokenFromHeaders(headers) {
	const electricClaimToken = headers.get(`electric-claim-token`)?.trim();
	if (electricClaimToken) return electricClaimToken;
	return headers.get(`authorization`)?.replace(/^Bearer\s+/i, ``).trim() ?? ``;
}

//#endregion
//#region src/schema-validation.ts
const jsonBodyAjv = new Ajv({ allErrors: true });
const schemaValidators = new WeakMap();
function schemaValidator(schema) {
	let validate = schemaValidators.get(schema);
	if (!validate) {
		validate = jsonBodyAjv.compile(schema);
		schemaValidators.set(schema, validate);
	}
	return validate;
}

//#endregion
//#region src/routing/schema.ts
function routeBody(request) {
	return request.content;
}
function withSchema(schema, options = {}) {
	return async (request) => {
		const contentType = request.headers.get(`content-type`)?.toLowerCase() ?? ``;
		const isJson = contentType.includes(`application/json`);
		if (options.lenient && !isJson) return void 0;
		const bodyStr = await request.text();
		let parsed;
		if (bodyStr.trim()) try {
			parsed = JSON.parse(bodyStr);
		} catch {
			return apiError(400, ErrCodeInvalidRequest, `Invalid JSON body`);
		}
		else parsed = {};
		const validate = schemaValidator(schema);
		if (!validate(parsed)) return apiError(400, ErrCodeInvalidRequest, `Request body does not match API schema`, (validate.errors ?? []).map((err) => ({
			path: err.instancePath || `/`,
			message: err.message ?? `validation error`
		})));
		request.content = parsed;
		return void 0;
	};
}
function validateBody(schema, body) {
	const parsed = parseJsonBodyBytes(body);
	if (!parsed.ok) return parsed;
	const validation = validateParsedBody(schema, parsed.value);
	if (!validation.ok) return validation;
	return {
		ok: true,
		value: parsed.value
	};
}
function validateOptionalJsonBody(schema, body, contentType) {
	const bodyText = new TextDecoder().decode(body);
	const trimmed = bodyText.trim();
	if (!trimmed) return {
		ok: true,
		value: void 0
	};
	let parsed;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		if (contentType?.toLowerCase().includes(`application/json`)) return {
			ok: false,
			response: apiError(400, ErrCodeInvalidRequest, `Invalid JSON body`)
		};
		return {
			ok: true,
			value: void 0
		};
	}
	const validation = validateParsedBody(schema, parsed);
	if (!validation.ok) return validation;
	return {
		ok: true,
		value: parsed
	};
}
function parseJsonBodyBytes(body) {
	if (body.length === 0) return {
		ok: true,
		value: {}
	};
	try {
		return {
			ok: true,
			value: JSON.parse(new TextDecoder().decode(body))
		};
	} catch {
		return {
			ok: false,
			response: apiError(400, ErrCodeInvalidRequest, `Invalid JSON body`)
		};
	}
}
function validateParsedBody(schema, parsed) {
	const validate = schemaValidator(schema);
	if (validate(parsed)) return { ok: true };
	return {
		ok: false,
		response: apiError(400, ErrCodeInvalidRequest, `Request body does not match API schema`, (validate.errors ?? []).map((err) => ({
			path: err.instancePath || `/`,
			message: err.message ?? `validation error`
		})))
	};
}

//#endregion
//#region src/utils/webhook-url.ts
function rewriteLoopbackWebhookUrl(value) {
	if (!value) return void 0;
	const rewriteTarget = process.env.ELECTRIC_AGENTS_REWRITE_LOOPBACK_WEBHOOKS_TO?.trim();
	if (!rewriteTarget) return value;
	const url = new URL(value);
	if (!isLoopbackHostname(url.hostname)) return value;
	if (rewriteTarget.includes(`://`)) {
		const target = new URL(rewriteTarget);
		url.protocol = target.protocol;
		url.username = target.username;
		url.password = target.password;
		url.hostname = target.hostname;
		url.port = target.port;
		return url.toString();
	}
	url.host = rewriteTarget;
	return url.toString();
}
function isLoopbackHostname(hostname) {
	return hostname === `localhost` || hostname === `127.0.0.1` || hostname === `::1`;
}

//#endregion
//#region src/routing/durable-streams-router.ts
const subscriptionProxyBodySchema = Type.Object({ webhook: Type.Optional(Type.Object({ url: Type.String() }, { additionalProperties: true })) }, { additionalProperties: true });
const durableStreamsRouter = Router();
durableStreamsRouter.all(`/v1/stream-meta/subscriptions/*`, subscriptionProxy);
durableStreamsRouter.post(`*`, streamAppend);
durableStreamsRouter.all(`*`, proxyPassThrough);
function bodyFromBytes$1(body) {
	return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
}
function responseFromUpstream$1(response, body) {
	return new Response(body ? bodyFromBytes$1(body) : response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: responseHeaders(response)
	});
}
async function forwardToDurableStreams(ctx, request, body, route = `stream`, urlOverride) {
	const headers = new Headers(request.headers);
	headers.delete(`host`);
	let requestBody = body;
	if (requestBody === void 0 && ![`GET`, `HEAD`].includes(request.method.toUpperCase())) requestBody = await readRequestBody(request);
	return await forwardFetchRequest({
		request: {
			method: request.method.toUpperCase(),
			url: urlOverride ?? request.url,
			headers
		},
		body: requestBody,
		durableStreamsUrl: ctx.durableStreamsUrl,
		durableStreamsBearer: ctx.durableStreamsBearer,
		durableStreamsBearerMode: usesSubscriptionScopedBearer(urlOverride ?? request.url) ? `if-missing` : `overwrite`,
		durableStreamsRouting: ctx.durableStreamsRouting,
		serviceId: ctx.service,
		dispatcher: ctx.durableStreamsDispatcher,
		route
	});
}
function subscriptionIdFromPath(pathname) {
	const match = /^\/v1\/stream-meta\/subscriptions\/([^/]+)(?:\/.*)?$/.exec(pathname);
	return match ? decodeURIComponent(match[1]) : null;
}
function isSubscriptionBasePath(pathname) {
	return /^\/v1\/stream-meta\/subscriptions\/[^/]+\/?$/.test(pathname);
}
function usesSubscriptionScopedBearer(requestUrl) {
	const pathname = new URL(requestUrl, `http://localhost`).pathname;
	return /^\/v1\/stream-meta\/subscriptions\/[^/]+\/(?:ack|release|callback)\/?$/.test(pathname);
}
function rewriteSubscriptionBodyForBackend(payload, service, routingAdapter) {
	if (typeof payload.pattern === `string`) payload.pattern = routingAdapter.toBackendStreamPath(service, payload.pattern);
	if (Array.isArray(payload.streams)) payload.streams = payload.streams.map((stream) => typeof stream === `string` ? routingAdapter.toBackendStreamPath(service, stream) : stream);
	if (typeof payload.wake_stream === `string`) payload.wake_stream = routingAdapter.toBackendStreamPath(service, payload.wake_stream);
	if (Array.isArray(payload.acks)) payload.acks = payload.acks.map((ack) => {
		if (!ack || typeof ack !== `object`) return ack;
		const next = { ...ack };
		if (typeof next.stream === `string`) next.stream = routingAdapter.toBackendStreamPath(service, next.stream);
		if (typeof next.path === `string`) next.path = routingAdapter.toBackendStreamPath(service, next.path);
		return next;
	});
}
function rewriteSubscriptionResponseForClient(bytes, response, service, routingAdapter) {
	if (!response.headers.get(`content-type`)?.includes(`application/json`)) return bytes;
	const payload = decodeJson(bytes);
	if (!payload) return bytes;
	if (typeof payload.pattern === `string`) payload.pattern = routingAdapter.toRuntimeStreamPath(service, payload.pattern);
	if (Array.isArray(payload.streams)) payload.streams = payload.streams.map((stream) => {
		if (typeof stream === `string`) return routingAdapter.toRuntimeStreamPath(service, stream);
		if (stream && typeof stream === `object` && typeof stream.path === `string`) return {
			...stream,
			path: routingAdapter.toRuntimeStreamPath(service, stream.path)
		};
		return stream;
	});
	if (typeof payload.wake_stream === `string`) payload.wake_stream = routingAdapter.toRuntimeStreamPath(service, payload.wake_stream);
	if (typeof payload.stream === `string`) payload.stream = routingAdapter.toRuntimeStreamPath(service, payload.stream);
	if (Array.isArray(payload.acks)) payload.acks = payload.acks.map((ack) => {
		if (!ack || typeof ack !== `object`) return ack;
		const next = { ...ack };
		if (typeof next.stream === `string`) next.stream = routingAdapter.toRuntimeStreamPath(service, next.stream);
		if (typeof next.path === `string`) next.path = routingAdapter.toRuntimeStreamPath(service, next.path);
		return next;
	});
	return new TextEncoder().encode(JSON.stringify(payload));
}
function decodeJson(bytes) {
	try {
		const parsed = JSON.parse(new TextDecoder().decode(bytes));
		return parsed && typeof parsed === `object` && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
function rewriteSubscriptionStreamPathInUrl(requestUrl, service, routingAdapter) {
	const match = /^(\/v1\/stream-meta\/subscriptions\/[^/]+\/streams\/)(.+)$/.exec(requestUrl.pathname);
	if (!match) return requestUrl.toString();
	const [, prefix, encodedPath] = match;
	const streamPath = decodeURIComponent(encodedPath);
	requestUrl.pathname = `${prefix}${encodeURIComponent(routingAdapter.toBackendStreamPath(service, streamPath))}`;
	return requestUrl.toString();
}
async function subscriptionProxy(request, ctx) {
	const url = new URL(request.url);
	const subscriptionId = subscriptionIdFromPath(url.pathname);
	if (!subscriptionId) return void 0;
	const routingAdapter = resolveDurableStreamsRoutingAdapter(ctx.durableStreamsRouting);
	let requestBody;
	let targetWebhookUrl = null;
	let requestUrl = request.url;
	if ([`PUT`, `POST`].includes(request.method.toUpperCase())) {
		requestBody = await readRequestBody(request);
		if (requestBody.length > 0) {
			const validation = validateBody(subscriptionProxyBodySchema, requestBody);
			if (!validation.ok) return validation.response;
			const payload = validation.value;
			if (payload.webhook?.url !== void 0) {
				targetWebhookUrl = rewriteLoopbackWebhookUrl(payload.webhook.url) ?? null;
				payload.webhook.url = appendPathToUrl(ctx.publicUrl, `/_electric/webhook-forward/${encodeURIComponent(subscriptionId)}`);
			}
			rewriteSubscriptionBodyForBackend(payload, ctx.service, routingAdapter);
			requestBody = new TextEncoder().encode(JSON.stringify(payload));
		}
	}
	if (request.method.toUpperCase() === `DELETE` && /\/streams\/.+$/.test(url.pathname)) requestUrl = rewriteSubscriptionStreamPathInUrl(url, ctx.service, routingAdapter);
	const upstream = await forwardToDurableStreams(ctx, request, requestBody, `stream-meta`, requestUrl);
	let responseBytes = upstream.body ? new Uint8Array(await upstream.arrayBuffer()) : new Uint8Array();
	responseBytes = rewriteSubscriptionResponseForClient(responseBytes, upstream, ctx.service, routingAdapter);
	const response = responseFromUpstream$1(upstream, responseBytes);
	if (!upstream.ok) return response;
	if (request.method.toUpperCase() === `DELETE` && isSubscriptionBasePath(url.pathname)) await ctx.pgDb.delete(subscriptionWebhooks).where(and(eq(subscriptionWebhooks.tenantId, ctx.service), eq(subscriptionWebhooks.subscriptionId, subscriptionId)));
	else if (targetWebhookUrl) await ctx.pgDb.insert(subscriptionWebhooks).values({
		tenantId: ctx.service,
		subscriptionId,
		webhookUrl: targetWebhookUrl
	}).onConflictDoUpdate({
		target: [subscriptionWebhooks.tenantId, subscriptionWebhooks.subscriptionId],
		set: { webhookUrl: targetWebhookUrl }
	});
	return response;
}
async function streamAppend(request, ctx) {
	return await electricAgentsStreamAppendRouter.fetch(createStreamAppendRouteRequest(request), ctx.runtime, (req, body) => forwardFetchRequest({
		request: {
			method: req.method,
			url: req.url,
			headers: req.headers
		},
		body,
		durableStreamsUrl: ctx.durableStreamsUrl,
		durableStreamsBearer: ctx.durableStreamsBearer,
		durableStreamsBearerMode: `overwrite`,
		durableStreamsRouting: ctx.durableStreamsRouting,
		serviceId: ctx.service,
		dispatcher: ctx.durableStreamsDispatcher
	}));
}
async function proxyPassThrough(request, ctx) {
	const upstream = await forwardToDurableStreams(ctx, request);
	const streamPath = new URL(request.url).pathname;
	const method = request.method.toUpperCase();
	const isControlPath = streamPath.startsWith(`/v1/stream-meta/`);
	const endTrackedRead = method === `GET` && !isControlPath ? await ctx.entityBridgeManager.beginClientRead(streamPath) : null;
	try {
		if (method === `HEAD` && !isControlPath) await ctx.entityBridgeManager.touchByStreamPath(streamPath);
		return responseFromUpstream$1(upstream);
	} finally {
		await endTrackedRead?.();
	}
}

//#endregion
//#region src/routing/cron-router.ts
const cronRegisterBodySchema = Type.Object({
	expression: Type.String(),
	timezone: Type.Optional(Type.String())
});
const cronRouter = Router({ base: `/_electric/cron` });
cronRouter.post(`/register`, withSchema(cronRegisterBodySchema), registerCron);
async function registerCron(request, ctx) {
	const parsed = routeBody(request);
	const streamPath = await ctx.entityManager.getOrCreateCronStream(parsed.expression, parsed.timezone);
	return json({ streamUrl: streamPath });
}

//#endregion
//#region src/routing/electric-proxy-router.ts
const electricProxyRouter = Router({ base: `/_electric/electric` });
electricProxyRouter.get(`/*`, proxyElectric);
async function proxyElectric(request, ctx) {
	if (!ctx.electricUrl) return apiError(500, `ELECTRIC_PROXY_FAILED`, `Electric URL not configured`);
	const target = buildElectricProxyTarget({
		incomingUrl: new URL(request.url),
		electricUrl: ctx.electricUrl,
		electricSecret: ctx.electricSecret,
		tenantId: ctx.service
	});
	const headers = new Headers(request.headers);
	headers.delete(`host`);
	let upstream;
	try {
		upstream = await fetch(target, {
			method: request.method,
			headers
		});
	} catch (err) {
		return apiError(502, `ELECTRIC_PROXY_FAILED`, err instanceof Error ? err.message : String(err));
	}
	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders(upstream)
	});
}

//#endregion
//#region src/principal.ts
const ELECTRIC_PRINCIPAL_HEADER = `electric-principal`;
const PRINCIPAL_KINDS = new Set([
	`user`,
	`agent`,
	`service`,
	`system`
]);
function parsePrincipalKey(input) {
	const colon = input.indexOf(`:`);
	if (colon <= 0) throw new Error(`Invalid principal key`);
	const kind = input.slice(0, colon);
	const id = input.slice(colon + 1);
	if (!PRINCIPAL_KINDS.has(kind)) throw new Error(`Invalid principal kind`);
	if (!id || id.includes(`/`)) throw new Error(`Invalid principal id`);
	const key = `${kind}:${id}`;
	return {
		kind,
		id,
		key,
		url: `/principal/${encodeURIComponent(key)}`
	};
}
function principalUrl(key) {
	return parsePrincipalKey(key).url;
}
function principalKeyFromUrl(url) {
	if (!url.startsWith(`/principal/`)) return null;
	const segment = url.slice(`/principal/`.length);
	if (!segment || segment.includes(`/`)) return null;
	try {
		const key = decodeURIComponent(segment);
		return parsePrincipalKey(key).key;
	} catch {
		return null;
	}
}
function getPrincipalFromRequest(request) {
	const value = request.headers.get(ELECTRIC_PRINCIPAL_HEADER);
	return value ? parsePrincipalKey(value) : null;
}
function getDevPrincipal() {
	return parsePrincipalKey(`system:dev-local`);
}
const BUILT_IN_SYSTEM_PRINCIPAL_IDS = new Set([
	`framework`,
	`auth-sync`,
	`dev-local`
]);
function isBuiltInSystemPrincipalUrl(url) {
	if (!url?.startsWith(`/principal/`)) return false;
	try {
		const key = principalKeyFromUrl(url);
		if (!key) return false;
		const principal = parsePrincipalKey(key);
		return principal.kind === `system` && BUILT_IN_SYSTEM_PRINCIPAL_IDS.has(principal.id);
	} catch {
		return false;
	}
}
function principalFromCreatedBy(createdBy) {
	if (!createdBy) return void 0;
	const key = principalKeyFromUrl(createdBy);
	if (!key) return {
		url: createdBy,
		key: null
	};
	const principal = parsePrincipalKey(key);
	return {
		url: principal.url,
		key: principal.key,
		kind: principal.kind,
		id: principal.id
	};
}
const principalIdentityStateSchema = Type.Object({
	kind: Type.Union([
		Type.Literal(`user`),
		Type.Literal(`agent`),
		Type.Literal(`service`),
		Type.Literal(`system`)
	]),
	id: Type.String(),
	key: Type.String(),
	url: Type.String(),
	updated_at: Type.String(),
	display_name: Type.Optional(Type.String()),
	email: Type.Optional(Type.String()),
	avatar_url: Type.Optional(Type.String()),
	auth_provider: Type.Optional(Type.String()),
	auth_subject: Type.Optional(Type.String()),
	claims: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	created_at: Type.Optional(Type.String())
}, { additionalProperties: false });
const principalUpdateIdentityMessageSchema = Type.Object({ identity: principalIdentityStateSchema }, { additionalProperties: false });

//#endregion
//#region src/dispatch-policy-schema.ts
const nonEmptyStringSchema = Type.String({ minLength: 1 });
const webhookDispatchTargetSchema = Type.Object({
	type: Type.Literal(`webhook`),
	url: nonEmptyStringSchema,
	subscription_id: Type.Optional(nonEmptyStringSchema)
}, { additionalProperties: false });
const runnerDispatchTargetSchema = Type.Object({
	type: Type.Literal(`runner`),
	runnerId: nonEmptyStringSchema,
	subscription_id: Type.Optional(nonEmptyStringSchema)
}, { additionalProperties: false });
const dispatchPolicySchema = Type.Object({ targets: Type.Tuple([Type.Union([webhookDispatchTargetSchema, runnerDispatchTargetSchema])]) }, { additionalProperties: false });
function parseDispatchPolicy(value, label = `dispatch_policy`) {
	const validate = schemaValidator(dispatchPolicySchema);
	if (validate(value)) return value;
	const details = (validate.errors ?? []).map((error) => {
		const path$1 = error.instancePath || `/`;
		return `${path$1} ${error.message ?? `failed validation`}`;
	}).join(`; `);
	throw new Error(details ? `${label} does not match dispatch policy schema: ${details}` : `${label} does not match dispatch policy schema`);
}

//#endregion
//#region src/tenant.ts
const DEFAULT_TENANT_ID = `default`;
var UnregisteredTenantError = class extends Error {
	constructor(tenantId, processName) {
		super(`tenant "${tenantId}" is not registered on this host for ${processName}`);
		this.tenantId = tenantId;
		this.processName = processName;
		this.name = `UnregisteredTenantError`;
	}
};
function isUnregisteredTenantError(error) {
	return error instanceof UnregisteredTenantError || typeof error === `object` && error !== null && `name` in error && error.name === `UnregisteredTenantError`;
}

//#endregion
//#region src/entity-registry.ts
var EntityAlreadyExistsError = class extends Error {
	constructor(url) {
		super(`Entity already exists at URL "${url}"`);
		this.url = url;
		this.name = `EntityAlreadyExistsError`;
	}
};
function isDuplicateUrlError(err) {
	if (!err || typeof err !== `object`) return false;
	const e = err;
	return e.code === `23505`;
}
const DEFAULT_RUNNER_LEASE_MS = 3e4;
function runnerWakeStream(runnerId) {
	return `/runners/${runnerId}/wake`;
}
var PostgresRegistry = class {
	constructor(db, tenantId = DEFAULT_TENANT_ID) {
		this.db = db;
		this.tenantId = tenantId;
	}
	async initialize() {}
	close() {}
	async createRunner(input) {
		const now = new Date();
		const wakeStream = input.wakeStream ?? runnerWakeStream(input.id);
		await this.db.insert(runners).values({
			tenantId: this.tenantId,
			id: input.id,
			ownerUserId: input.ownerUserId,
			label: input.label,
			kind: input.kind ?? `local`,
			adminStatus: input.adminStatus ?? `enabled`,
			wakeStream,
			updatedAt: now
		}).onConflictDoUpdate({
			target: [runners.tenantId, runners.id],
			set: {
				ownerUserId: input.ownerUserId,
				label: input.label,
				kind: input.kind ?? `local`,
				adminStatus: input.adminStatus ?? `enabled`,
				wakeStream,
				updatedAt: now
			}
		});
		const runner = await this.getRunner(input.id);
		if (!runner) throw new Error(`Failed to read back runner "${input.id}"`);
		return runner;
	}
	async getRunner(id) {
		const rows = await this.db.select().from(runners).where(and(eq(runners.tenantId, this.tenantId), eq(runners.id, id))).limit(1);
		return rows[0] ? this.rowToRunner(rows[0]) : null;
	}
	async listRunners(filter) {
		const conditions = [eq(runners.tenantId, this.tenantId)];
		if (filter?.ownerUserId) conditions.push(eq(runners.ownerUserId, filter.ownerUserId));
		const rows = await this.db.select().from(runners).where(and(...conditions)).orderBy(desc(runners.createdAt));
		return rows.map((row) => this.rowToRunner(row));
	}
	async heartbeatRunner(input) {
		const now = input.heartbeatAt ?? new Date();
		const leaseExpiresAt = input.livenessLeaseExpiresAt ?? new Date(now.getTime() + (input.leaseMs ?? DEFAULT_RUNNER_LEASE_MS));
		const rows = await this.db.update(runners).set({
			lastSeenAt: now,
			livenessLeaseExpiresAt: leaseExpiresAt,
			...input.wakeStreamOffset !== void 0 ? { wakeStreamOffset: input.wakeStreamOffset } : {},
			updatedAt: now
		}).where(and(eq(runners.tenantId, this.tenantId), eq(runners.id, input.runnerId))).returning();
		return rows[0] ? this.rowToRunner(rows[0]) : null;
	}
	async setRunnerAdminStatus(runnerId, adminStatus) {
		const rows = await this.db.update(runners).set({
			adminStatus,
			updatedAt: new Date()
		}).where(and(eq(runners.tenantId, this.tenantId), eq(runners.id, runnerId))).returning();
		return rows[0] ? this.rowToRunner(rows[0]) : null;
	}
	async materializeActiveClaim(input) {
		const claimedAt = input.claimedAt ?? new Date();
		await this.db.transaction(async (tx) => {
			await tx.insert(consumerClaims).values({
				tenantId: this.tenantId,
				consumerId: input.consumerId,
				epoch: input.epoch,
				wakeId: input.wakeId ?? null,
				entityUrl: input.entityUrl,
				streamPath: input.streamPath,
				runnerId: input.runnerId ?? null,
				status: `active`,
				claimedAt,
				leaseExpiresAt: input.leaseExpiresAt ?? null,
				updatedAt: claimedAt
			}).onConflictDoUpdate({
				target: [
					consumerClaims.tenantId,
					consumerClaims.consumerId,
					consumerClaims.epoch
				],
				set: {
					wakeId: input.wakeId ?? null,
					entityUrl: input.entityUrl,
					streamPath: input.streamPath,
					runnerId: input.runnerId ?? null,
					status: `active`,
					claimedAt,
					leaseExpiresAt: input.leaseExpiresAt ?? null,
					releasedAt: null,
					updatedAt: claimedAt
				}
			});
			await tx.insert(entityDispatchState).values({
				tenantId: this.tenantId,
				entityUrl: input.entityUrl,
				activeConsumerId: input.consumerId,
				activeRunnerId: input.runnerId ?? null,
				activeEpoch: input.epoch,
				activeClaimedAt: claimedAt,
				activeLeaseExpiresAt: input.leaseExpiresAt ?? null,
				lastClaimedAt: claimedAt,
				updatedAt: claimedAt
			}).onConflictDoUpdate({
				target: [entityDispatchState.tenantId, entityDispatchState.entityUrl],
				set: {
					activeConsumerId: input.consumerId,
					activeRunnerId: input.runnerId ?? null,
					activeEpoch: input.epoch,
					activeClaimedAt: claimedAt,
					activeLeaseExpiresAt: input.leaseExpiresAt ?? null,
					lastClaimedAt: claimedAt,
					updatedAt: claimedAt
				}
			});
		});
	}
	async materializeHeartbeatClaim(input) {
		const heartbeatAt = input.heartbeatAt ?? new Date();
		await this.db.update(consumerClaims).set({
			lastHeartbeatAt: heartbeatAt,
			leaseExpiresAt: input.leaseExpiresAt ?? null,
			updatedAt: heartbeatAt
		}).where(and(eq(consumerClaims.tenantId, this.tenantId), eq(consumerClaims.consumerId, input.consumerId), eq(consumerClaims.epoch, input.epoch)));
	}
	async materializeReleasedClaim(input) {
		const releasedAt = input.releasedAt ?? new Date();
		const rows = await this.db.update(consumerClaims).set({
			status: `released`,
			releasedAt,
			ackedStreams: input.ackedStreams ?? null,
			updatedAt: releasedAt
		}).where(and(eq(consumerClaims.tenantId, this.tenantId), eq(consumerClaims.consumerId, input.consumerId), eq(consumerClaims.epoch, input.epoch))).returning();
		const claim = rows[0] ? this.rowToConsumerClaim(rows[0]) : null;
		if (claim) await this.db.update(entityDispatchState).set({
			activeConsumerId: null,
			activeRunnerId: null,
			activeEpoch: null,
			activeClaimedAt: null,
			activeLeaseExpiresAt: null,
			lastReleasedAt: releasedAt,
			lastCompletedAt: releasedAt,
			updatedAt: releasedAt
		}).where(and(eq(entityDispatchState.tenantId, this.tenantId), eq(entityDispatchState.entityUrl, claim.entity_url), eq(entityDispatchState.activeConsumerId, input.consumerId), eq(entityDispatchState.activeEpoch, input.epoch)));
		return claim;
	}
	entityTypeWhere(name) {
		return and(eq(entityTypes.tenantId, this.tenantId), eq(entityTypes.name, name));
	}
	entityWhere(url) {
		return and(eq(entities.tenantId, this.tenantId), eq(entities.url, url));
	}
	entityBridgeWhere(sourceRef) {
		return and(eq(entityBridges.tenantId, this.tenantId), eq(entityBridges.sourceRef, sourceRef));
	}
	async createEntityType(et) {
		await this.db.insert(entityTypes).values({
			tenantId: this.tenantId,
			name: et.name,
			description: et.description,
			creationSchema: et.creation_schema ?? null,
			inboxSchemas: et.inbox_schemas ?? null,
			stateSchemas: et.state_schemas ?? null,
			serveEndpoint: et.serve_endpoint ?? null,
			defaultDispatchPolicy: et.default_dispatch_policy ?? null,
			revision: et.revision,
			createdAt: et.created_at,
			updatedAt: et.updated_at
		}).onConflictDoUpdate({
			target: [entityTypes.tenantId, entityTypes.name],
			set: {
				description: et.description,
				creationSchema: et.creation_schema ?? null,
				inboxSchemas: et.inbox_schemas ?? null,
				stateSchemas: et.state_schemas ?? null,
				serveEndpoint: et.serve_endpoint ?? null,
				defaultDispatchPolicy: et.default_dispatch_policy ?? null,
				revision: et.revision,
				updatedAt: et.updated_at
			}
		});
	}
	async ensureEntityType(et) {
		const existing = await this.getEntityType(et.name);
		if (existing) return existing;
		await this.db.insert(entityTypes).values({
			tenantId: this.tenantId,
			name: et.name,
			description: et.description,
			creationSchema: et.creation_schema ?? null,
			inboxSchemas: et.inbox_schemas ?? null,
			stateSchemas: et.state_schemas ?? null,
			serveEndpoint: et.serve_endpoint ?? null,
			defaultDispatchPolicy: et.default_dispatch_policy ?? null,
			revision: et.revision,
			createdAt: et.created_at,
			updatedAt: et.updated_at
		}).onConflictDoNothing();
		return await this.getEntityType(et.name);
	}
	async getEntityType(name) {
		const rows = await this.db.select().from(entityTypes).where(this.entityTypeWhere(name)).limit(1);
		if (rows.length === 0) return null;
		return this.rowToEntityType(rows[0]);
	}
	async listEntityTypes() {
		const rows = await this.db.select().from(entityTypes).where(eq(entityTypes.tenantId, this.tenantId)).orderBy(entityTypes.name);
		return rows.map((row) => this.rowToEntityType(row));
	}
	async deleteEntityType(name) {
		await this.db.delete(entityTypes).where(this.entityTypeWhere(name));
	}
	async updateEntityTypeInPlace(et) {
		await this.db.update(entityTypes).set({
			description: et.description,
			creationSchema: et.creation_schema ?? null,
			inboxSchemas: et.inbox_schemas ?? null,
			stateSchemas: et.state_schemas ?? null,
			serveEndpoint: et.serve_endpoint ?? null,
			defaultDispatchPolicy: et.default_dispatch_policy ?? null,
			revision: et.revision,
			updatedAt: et.updated_at
		}).where(this.entityTypeWhere(et.name));
	}
	async createEntity(entity) {
		try {
			return await this.db.transaction(async (tx) => {
				const result = await tx.insert(entities).values({
					tenantId: this.tenantId,
					url: entity.url,
					type: entity.type,
					status: entity.status,
					subscriptionId: entity.subscription_id,
					dispatchPolicy: entity.dispatch_policy ?? null,
					writeToken: entity.write_token,
					tags: normalizeTags(entity.tags),
					tagsIndex: buildTagsIndex(entity.tags),
					spawnArgs: entity.spawn_args ?? {},
					parent: entity.parent ?? null,
					createdBy: entity.created_by ?? null,
					typeRevision: entity.type_revision ?? null,
					inboxSchemas: entity.inbox_schemas ?? null,
					stateSchemas: entity.state_schemas ?? null,
					createdAt: entity.created_at,
					updatedAt: entity.updated_at
				}).returning({ txid: sql`pg_current_xact_id()::xid::text` });
				await tx.insert(entityDispatchState).values({
					tenantId: this.tenantId,
					entityUrl: entity.url,
					pendingSourceStreams: [],
					updatedAt: new Date()
				}).onConflictDoNothing();
				return parseInt(result[0].txid);
			});
		} catch (err) {
			if (isDuplicateUrlError(err)) throw new EntityAlreadyExistsError(entity.url);
			throw err;
		}
	}
	async getEntity(url) {
		const rows = await this.db.select().from(entities).where(this.entityWhere(url)).limit(1);
		if (rows.length === 0) return null;
		return this.rowToEntity(rows[0]);
	}
	async updateEntityDispatchPolicy(url, dispatchPolicy) {
		const [row] = await this.db.update(entities).set({
			dispatchPolicy,
			updatedAt: Date.now()
		}).where(this.entityWhere(url)).returning();
		return row ? this.rowToEntity(row) : null;
	}
	async getEntityByStream(streamPath) {
		const mainSuffix = `/main`;
		const errorSuffix = `/error`;
		let entityUrl = null;
		if (streamPath.endsWith(mainSuffix)) entityUrl = streamPath.slice(0, -mainSuffix.length);
		else if (streamPath.endsWith(errorSuffix)) entityUrl = streamPath.slice(0, -errorSuffix.length);
		if (!entityUrl) return null;
		return this.getEntity(entityUrl);
	}
	async listEntities(filter) {
		const conditions = [eq(entities.tenantId, this.tenantId)];
		if (filter?.type) conditions.push(eq(entities.type, filter.type));
		if (filter?.status) conditions.push(eq(entities.status, filter.status));
		if (filter?.parent) conditions.push(eq(entities.parent, filter.parent));
		if (filter?.created_by) conditions.push(eq(entities.createdBy, filter.created_by));
		const whereClause = and(...conditions);
		const countResult = await this.db.select({ count: sql`count(*)` }).from(entities).where(whereClause);
		const total = Number(countResult[0].count);
		let query = this.db.select().from(entities).where(whereClause).orderBy(desc(entities.createdAt)).$dynamic();
		if (filter?.limit !== void 0) query = query.limit(filter.limit);
		if (filter?.offset !== void 0) query = query.offset(filter.offset);
		const rows = await query;
		return {
			entities: rows.map((row) => this.rowToEntity(row)),
			total
		};
	}
	async updateStatus(entityUrl, status$1) {
		const whereClause = status$1 === `stopped` ? this.entityWhere(entityUrl) : and(this.entityWhere(entityUrl), ne(entities.status, `stopped`));
		await this.db.update(entities).set({
			status: status$1,
			updatedAt: Date.now()
		}).where(whereClause);
	}
	async updateStatusWithTxid(entityUrl, status$1) {
		return await this.db.transaction(async (tx) => {
			const whereClause = status$1 === `stopped` ? this.entityWhere(entityUrl) : and(this.entityWhere(entityUrl), ne(entities.status, `stopped`));
			await tx.update(entities).set({
				status: status$1,
				updatedAt: Date.now()
			}).where(whereClause);
			const result = await tx.execute(sql`SELECT pg_current_xact_id()::xid::text AS txid`);
			return parseInt(result[0].txid);
		});
	}
	async setEntityTag(url, key, value) {
		return this.mutateEntityTags(url, (oldTags) => {
			const previous = oldTags[key];
			if (previous === value) return null;
			return {
				nextTags: {
					...oldTags,
					[key]: value
				},
				outbox: {
					op: previous === void 0 ? `insert` : `update`,
					key,
					rowData: {
						key,
						value
					}
				}
			};
		});
	}
	async removeEntityTag(url, key) {
		return this.mutateEntityTags(url, (oldTags) => {
			if (!(key in oldTags)) return null;
			const { [key]: _removed,...remaining } = oldTags;
			return {
				nextTags: remaining,
				outbox: {
					op: `delete`,
					key
				}
			};
		});
	}
	async mutateEntityTags(url, compute) {
		return await this.db.transaction(async (tx) => {
			const [row] = await tx.select().from(entities).where(this.entityWhere(url)).limit(1).for(`update`);
			if (!row) return {
				entity: null,
				changed: false
			};
			const oldTags = row.tags ?? {};
			const mutation = compute(oldTags);
			if (!mutation) return {
				entity: this.rowToEntity(row),
				changed: false
			};
			const nextTags = normalizeTags(mutation.nextTags);
			const updatedAt = Date.now();
			await tx.update(entities).set({
				tags: nextTags,
				tagsIndex: buildTagsIndex(nextTags),
				updatedAt
			}).where(this.entityWhere(url));
			await tx.insert(tagStreamOutbox).values({
				tenantId: this.tenantId,
				entityUrl: url,
				collection: `tags`,
				op: mutation.outbox.op,
				key: mutation.outbox.key,
				rowData: mutation.outbox.rowData
			});
			const entity = this.rowToEntity({
				...row,
				tags: nextTags,
				updatedAt
			});
			const op = mutation.outbox.op;
			return {
				entity,
				changed: true,
				...op === `insert` || op === `update` ? { op } : {}
			};
		});
	}
	async upsertEntityBridge(row) {
		await this.db.insert(entityBridges).values({
			tenantId: this.tenantId,
			sourceRef: row.sourceRef,
			tags: normalizeTags(row.tags),
			streamUrl: row.streamUrl
		}).onConflictDoNothing();
		const existing = await this.getEntityBridge(row.sourceRef);
		if (!existing) throw new Error(`Failed to load entity bridge ${row.sourceRef}`);
		return existing;
	}
	async getEntityBridge(sourceRef) {
		const rows = await this.db.select().from(entityBridges).where(this.entityBridgeWhere(sourceRef)).limit(1);
		return rows[0] ? this.rowToEntityBridge(rows[0]) : null;
	}
	async listEntityBridges(tenantId = this.tenantId) {
		const rows = tenantId === null ? await this.db.select().from(entityBridges) : await this.db.select().from(entityBridges).where(eq(entityBridges.tenantId, tenantId));
		return rows.map((row) => this.rowToEntityBridge(row));
	}
	async listStaleEntityBridges(before) {
		const rows = await this.db.select().from(entityBridges).where(and(eq(entityBridges.tenantId, this.tenantId), lt(entityBridges.lastObserverActivityAt, before)));
		return rows.map((row) => this.rowToEntityBridge(row));
	}
	async replaceEntityManifestSource(ownerEntityUrl, manifestKey, sourceRef) {
		await this.db.delete(entityManifestSources).where(and(eq(entityManifestSources.tenantId, this.tenantId), eq(entityManifestSources.ownerEntityUrl, ownerEntityUrl), eq(entityManifestSources.manifestKey, manifestKey)));
		if (!sourceRef) return;
		await this.db.insert(entityManifestSources).values({
			tenantId: this.tenantId,
			ownerEntityUrl,
			manifestKey,
			sourceRef
		}).onConflictDoUpdate({
			target: [
				entityManifestSources.tenantId,
				entityManifestSources.ownerEntityUrl,
				entityManifestSources.manifestKey
			],
			set: {
				sourceRef,
				updatedAt: new Date()
			}
		});
	}
	async clearEntityManifestSources() {
		await this.db.delete(entityManifestSources).where(eq(entityManifestSources.tenantId, this.tenantId));
	}
	async listReferencedEntitySourceRefs() {
		const rows = await this.db.selectDistinct({ sourceRef: entityManifestSources.sourceRef }).from(entityManifestSources).where(eq(entityManifestSources.tenantId, this.tenantId)).orderBy(entityManifestSources.sourceRef);
		return rows.map((row) => row.sourceRef);
	}
	async touchEntityBridge(sourceRef) {
		await this.db.update(entityBridges).set({
			lastObserverActivityAt: new Date(),
			updatedAt: new Date()
		}).where(this.entityBridgeWhere(sourceRef));
	}
	async updateEntityBridgeCursor(sourceRef, shapeHandle, shapeOffset) {
		await this.db.update(entityBridges).set({
			shapeHandle,
			shapeOffset,
			updatedAt: new Date()
		}).where(this.entityBridgeWhere(sourceRef));
	}
	async clearEntityBridgeCursor(sourceRef) {
		await this.db.update(entityBridges).set({
			shapeHandle: null,
			shapeOffset: null,
			updatedAt: new Date()
		}).where(this.entityBridgeWhere(sourceRef));
	}
	async deleteEntityBridge(sourceRef) {
		await this.db.delete(entityBridges).where(this.entityBridgeWhere(sourceRef));
	}
	async claimTagOutboxRows(workerId, limit = 25, tenantId = this.tenantId) {
		const tenantFilter = tenantId === null ? sql`` : sql`AND ${tagStreamOutbox.tenantId} = ${tenantId}`;
		const claimed = await this.db.execute(sql`
      WITH candidates AS (
        SELECT id
          FROM ${tagStreamOutbox}
         WHERE ${tagStreamOutbox.deadLetteredAt} IS NULL
           ${tenantFilter}
           AND (
             ${tagStreamOutbox.claimedAt} IS NULL
             OR ${tagStreamOutbox.claimedAt} < now() - interval '30 seconds'
           )
         ORDER BY ${tagStreamOutbox.createdAt}
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE ${tagStreamOutbox}
         SET claimed_by = ${workerId},
             claimed_at = now()
       WHERE ${tagStreamOutbox.id} IN (SELECT id FROM candidates)
      RETURNING
        id,
        tenant_id AS "tenantId",
        entity_url AS "entityUrl",
        collection,
        op,
        key,
        row_data AS "rowData",
        attempt_count AS "attemptCount",
        last_error AS "lastError",
        claimed_by AS "claimedBy",
        claimed_at AS "claimedAt",
        dead_lettered_at AS "deadLetteredAt",
        created_at AS "createdAt"
    `);
		return claimed.map((row) => this.rowToTagStreamOutbox(row));
	}
	async failTagOutboxRow(id, workerId, errorMessage, maxAttempts, tenantId = this.tenantId) {
		const tenantFilter = tenantId === null ? sql`` : sql`AND ${tagStreamOutbox.tenantId} = ${tenantId}`;
		const [row] = await this.db.execute(sql`
      UPDATE ${tagStreamOutbox}
         SET attempt_count = ${tagStreamOutbox.attemptCount} + 1,
             last_error = ${errorMessage},
             claimed_by = null,
             claimed_at = null,
         dead_lettered_at = CASE
               WHEN ${tagStreamOutbox.attemptCount} + 1 >= ${maxAttempts}
                 THEN now()
               ELSE ${tagStreamOutbox.deadLetteredAt}
             END
       WHERE ${tagStreamOutbox.id} = ${id}
         ${tenantFilter}
         AND ${tagStreamOutbox.claimedBy} = ${workerId}
      RETURNING
        attempt_count AS "attemptCount",
        dead_lettered_at AS "deadLetteredAt"
    `);
		if (!row) throw new Error(`Failed to mark tag outbox row ${id} as failed`);
		const typedRow = row;
		return {
			attemptCount: typedRow.attemptCount,
			deadLettered: typedRow.deadLetteredAt != null
		};
	}
	async deleteTagOutboxRow(id, tenantId = this.tenantId) {
		const conditions = [eq(tagStreamOutbox.id, id)];
		if (tenantId !== null) conditions.unshift(eq(tagStreamOutbox.tenantId, tenantId));
		await this.db.delete(tagStreamOutbox).where(and(...conditions));
	}
	async releaseTagOutboxClaims(workerId, tenantId = this.tenantId) {
		const conditions = [eq(tagStreamOutbox.claimedBy, workerId), sql`${tagStreamOutbox.deadLetteredAt} IS NULL`];
		if (tenantId !== null) conditions.unshift(eq(tagStreamOutbox.tenantId, tenantId));
		await this.db.update(tagStreamOutbox).set({
			claimedBy: null,
			claimedAt: null
		}).where(and(...conditions));
	}
	async deleteEntity(url) {
		await this.db.delete(entities).where(this.entityWhere(url));
	}
	rowToEntityType(row) {
		return {
			name: row.name,
			description: row.description,
			creation_schema: row.creationSchema,
			inbox_schemas: row.inboxSchemas,
			state_schemas: row.stateSchemas,
			serve_endpoint: row.serveEndpoint ?? void 0,
			default_dispatch_policy: row.defaultDispatchPolicy ?? void 0,
			revision: row.revision,
			created_at: row.createdAt,
			updated_at: row.updatedAt
		};
	}
	rowToEntity(row) {
		return {
			url: row.url,
			type: row.type,
			status: assertEntityStatus(row.status),
			streams: {
				main: `${row.url}/main`,
				error: `${row.url}/error`
			},
			subscription_id: row.subscriptionId,
			dispatch_policy: row.dispatchPolicy ?? void 0,
			write_token: row.writeToken,
			tags: row.tags ?? {},
			spawn_args: row.spawnArgs,
			parent: row.parent ?? void 0,
			created_by: row.createdBy ?? void 0,
			type_revision: row.typeRevision ?? void 0,
			inbox_schemas: row.inboxSchemas,
			state_schemas: row.stateSchemas,
			created_at: row.createdAt,
			updated_at: row.updatedAt
		};
	}
	rowToEntityBridge(row) {
		return {
			tenantId: row.tenantId,
			sourceRef: row.sourceRef,
			tags: row.tags ?? {},
			streamUrl: row.streamUrl,
			shapeHandle: row.shapeHandle ?? void 0,
			shapeOffset: row.shapeOffset ?? void 0,
			lastObserverActivityAt: row.lastObserverActivityAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt
		};
	}
	rowToTagStreamOutbox(row) {
		return {
			id: row.id,
			tenantId: row.tenantId,
			entityUrl: row.entityUrl,
			collection: row.collection,
			op: row.op,
			key: row.key,
			rowData: row.rowData ?? void 0,
			attemptCount: row.attemptCount,
			lastError: row.lastError ?? void 0,
			claimedBy: row.claimedBy ?? void 0,
			claimedAt: row.claimedAt ?? void 0,
			deadLetteredAt: row.deadLetteredAt ?? void 0,
			createdAt: row.createdAt
		};
	}
	rowToRunner(row) {
		const now = Date.now();
		const livenessExpiry = row.livenessLeaseExpiresAt?.getTime();
		return {
			id: row.id,
			owner_user_id: row.ownerUserId,
			label: row.label,
			kind: assertRunnerKind(row.kind),
			admin_status: assertRunnerAdminStatus(row.adminStatus),
			liveness: livenessExpiry !== void 0 && livenessExpiry > now ? `online` : `offline`,
			last_seen_at: row.lastSeenAt?.toISOString(),
			liveness_lease_expires_at: row.livenessLeaseExpiresAt?.toISOString(),
			wake_stream: row.wakeStream,
			wake_stream_offset: row.wakeStreamOffset ?? void 0,
			created_at: row.createdAt.toISOString(),
			updated_at: row.updatedAt.toISOString()
		};
	}
	rowToConsumerClaim(row) {
		return {
			consumer_id: row.consumerId,
			epoch: row.epoch,
			wake_id: row.wakeId ?? void 0,
			entity_url: row.entityUrl,
			stream_path: row.streamPath,
			runner_id: row.runnerId ?? void 0,
			status: row.status,
			claimed_at: row.claimedAt.toISOString(),
			last_heartbeat_at: row.lastHeartbeatAt?.toISOString(),
			lease_expires_at: row.leaseExpiresAt?.toISOString(),
			released_at: row.releasedAt?.toISOString(),
			acked_streams: row.ackedStreams ?? void 0,
			updated_at: row.updatedAt.toISOString()
		};
	}
};

//#endregion
//#region src/manifest-side-effects.ts
function isRecord$1(value) {
	return typeof value === `object` && value !== null && !Array.isArray(value);
}
function extractManifestSourceUrl(manifest) {
	if (!manifest) return void 0;
	if (manifest.kind === `child` || manifest.kind === `observe`) return typeof manifest.entity_url === `string` ? manifest.entity_url : void 0;
	if (manifest.kind === `source`) {
		const config = isRecord$1(manifest.config) ? manifest.config : void 0;
		if (manifest.sourceType === `entity`) return typeof config?.entityUrl === `string` ? config.entityUrl : typeof manifest.sourceRef === `string` ? manifest.sourceRef : void 0;
		if (manifest.sourceType === `cron` && config) {
			const expression = config.expression;
			if (typeof expression === `string`) return getCronStreamPathFromSpec(resolveCronScheduleSpec(expression, typeof config.timezone === `string` ? config.timezone : void 0, { fallback: `utc` }));
		}
		if (manifest.sourceType === `entities`) return typeof manifest.sourceRef === `string` ? `/_entities/${manifest.sourceRef}` : void 0;
		if (manifest.sourceType === `db`) return typeof manifest.sourceRef === `string` ? getSharedStateStreamPath(manifest.sourceRef) : void 0;
		return void 0;
	}
	if (manifest.kind === `shared-state`) return typeof manifest.id === `string` ? getSharedStateStreamPath(manifest.id) : void 0;
	if (manifest.kind === `schedule` && manifest.scheduleType === `cron` && typeof manifest.expression === `string`) return getCronStreamPathFromSpec(resolveCronScheduleSpec(manifest.expression, typeof manifest.timezone === `string` ? manifest.timezone : void 0, { fallback: `utc` }));
	return void 0;
}
function extractManifestCronSpec(manifest) {
	if (!manifest) return void 0;
	if (manifest.kind === `source` && manifest.sourceType === `cron`) {
		const config = isRecord$1(manifest.config) ? manifest.config : void 0;
		if (typeof config?.expression === `string`) return resolveCronScheduleSpec(config.expression, typeof config.timezone === `string` ? config.timezone : void 0, { fallback: `utc` });
	}
	if (manifest.kind === `schedule` && manifest.scheduleType === `cron` && typeof manifest.expression === `string`) return resolveCronScheduleSpec(manifest.expression, typeof manifest.timezone === `string` ? manifest.timezone : void 0, { fallback: `utc` });
	return void 0;
}
function buildManifestWakeRegistration(subscriberUrl, manifest, manifestKey) {
	if (!manifest) return null;
	const sourceUrl = extractManifestSourceUrl(manifest);
	if (!sourceUrl) return null;
	const wake = manifest.kind === `schedule` && manifest.scheduleType === `cron` ? manifest.wake ?? { on: `change` } : manifest.wake;
	if (wake === `runFinished`) return {
		subscriberUrl,
		sourceUrl,
		condition: `runFinished`,
		oneShot: false,
		manifestKey
	};
	if (!isRecord$1(wake)) return null;
	if (wake.on === `runFinished`) return {
		subscriberUrl,
		sourceUrl,
		condition: `runFinished`,
		oneShot: false,
		includeResponse: typeof wake.includeResponse === `boolean` ? wake.includeResponse : void 0,
		manifestKey
	};
	if (wake.on !== `change`) return null;
	const collections = Array.isArray(wake.collections) ? wake.collections.filter((c) => typeof c === `string`) : void 0;
	const ops = Array.isArray(wake.ops) ? wake.ops.filter((op) => op === `insert` || op === `update` || op === `delete`) : void 0;
	return {
		subscriberUrl,
		sourceUrl,
		condition: {
			on: `change`,
			...collections ? { collections } : {},
			...ops ? { ops } : {}
		},
		debounceMs: typeof wake.debounceMs === `number` ? wake.debounceMs : void 0,
		timeoutMs: typeof wake.timeoutMs === `number` ? wake.timeoutMs : void 0,
		oneShot: false,
		manifestKey
	};
}

//#endregion
//#region src/entity-manager.ts
function createInitialQueuePosition(date) {
	return `${String(date.getTime()).padStart(16, `0`)}:a0`;
}
const DEFAULT_FORK_WAIT_TIMEOUT_MS = 12e4;
const DEFAULT_FORK_WAIT_POLL_MS = 250;
function sleep(ms) {
	return new Promise((resolve$1) => setTimeout(resolve$1, ms));
}
function omitUndefined$1(value) {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0));
}
function isRecord(value) {
	return typeof value === `object` && value !== null && !Array.isArray(value);
}
function cloneRecord(value) {
	return JSON.parse(JSON.stringify(value));
}
/**
* Orchestrates the Electric Agents entity lifecycle: register types, spawn, send, kill.
*
* Entity identity is the URL (/{type}/{instance_id}). Entity tags and
* lifecycle state are persisted directly in Postgres. Durable streams remain
* the append-only transport for inbox/state events.
*/
var EntityManager = class {
	registry;
	tenantId;
	streamClient;
	validator;
	scheduler = null;
	entityBridgeManager = null;
	writeTokenValidator = null;
	wakeRegistry;
	forkWorkLockedEntities = new Map();
	forkWriteLockedEntities = new Map();
	forkWriteLockedStreams = new Map();
	spawnPersistQueue;
	stopWakeRegistryOnShutdown;
	constructor(opts) {
		this.registry = opts.registry;
		this.tenantId = opts.registry.tenantId ?? DEFAULT_TENANT_ID;
		this.streamClient = opts.streamClient;
		this.validator = opts.validator;
		this.wakeRegistry = opts.wakeRegistry;
		this.scheduler = opts.scheduler ?? null;
		this.entityBridgeManager = opts.entityBridgeManager ?? null;
		this.writeTokenValidator = opts.writeTokenValidator ?? null;
		this.stopWakeRegistryOnShutdown = opts.stopWakeRegistryOnShutdown ?? true;
		const spawnConcurrency = opts.spawnConcurrency ?? Number(process.env.ELECTRIC_AGENTS_SPAWN_CONCURRENCY ?? 16);
		this.spawnPersistQueue = fastq.promise(async (job) => job(), spawnConcurrency);
		this.wakeRegistry.setTimeoutCallback((result) => {
			this.deliverWakeResult(result);
		}, this.tenantId);
		this.wakeRegistry.setDebounceCallback((result) => {
			this.deliverWakeResult(result);
		}, this.tenantId);
	}
	async rebuildWakeRegistry(electricUrl, electricSecret) {
		if (electricUrl) {
			await this.wakeRegistry.startSync(electricUrl, electricSecret);
			return;
		}
		await this.wakeRegistry.loadRegistrations();
	}
	setWriteTokenValidator(validator) {
		this.writeTokenValidator = validator;
	}
	isValidWriteToken(entity, token) {
		return this.writeTokenValidator ? this.writeTokenValidator(entity, token) : token === entity.write_token;
	}
	encodeChangeEvent(event) {
		return new TextEncoder().encode(JSON.stringify(event));
	}
	async registerEntityType(req) {
		if (!req.name) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Missing required field: name`, 400);
		if (req.name === `principal`) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Entity type "principal" is built in and cannot be registered or updated`, 400);
		if (req.name.startsWith(`_`)) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Entity type names starting with "_" are reserved`, 400);
		if (!req.description) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Missing required field: description`, 400);
		this.validateSchema(req.creation_schema);
		this.validateSchemaMap(req.inbox_schemas);
		this.validateSchemaMap(req.state_schemas);
		const defaultDispatchPolicy = req.default_dispatch_policy ? this.validateDispatchPolicy(req.default_dispatch_policy, { label: `default_dispatch_policy` }) : void 0;
		const existing = await this.registry.getEntityType(req.name);
		const now = new Date().toISOString();
		const entityType = {
			name: req.name,
			description: req.description,
			creation_schema: req.creation_schema,
			inbox_schemas: req.inbox_schemas,
			state_schemas: req.state_schemas,
			serve_endpoint: req.serve_endpoint,
			default_dispatch_policy: defaultDispatchPolicy,
			revision: existing ? existing.revision + 1 : 1,
			created_at: existing?.created_at ?? now,
			updated_at: now
		};
		await this.registry.createEntityType(entityType);
		const stored = await this.registry.getEntityType(req.name);
		if (!stored) throw new Error(`Failed to read back entity type "${req.name}"`);
		return stored;
	}
	async deleteEntityType(name) {
		if (name === `principal`) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Entity type "principal" is built in and cannot be deleted`, 400);
		const existing = await this.registry.getEntityType(name);
		if (!existing) throw new ElectricAgentsError(ErrCodeNotFound, `Entity type "${name}" not found`, 404);
		await this.registry.deleteEntityType(name);
	}
	async ensurePrincipalEntityType() {
		const now = new Date().toISOString();
		return await this.registry.ensureEntityType({
			name: `principal`,
			description: `built-in principal entity`,
			inbox_schemas: { update_identity: principalUpdateIdentityMessageSchema },
			state_schemas: { identity: principalIdentityStateSchema },
			revision: 1,
			created_at: now,
			updated_at: now
		});
	}
	async ensurePrincipal(principal) {
		const existing = await this.registry.getEntity(principal.url);
		if (existing) return existing;
		await this.ensurePrincipalEntityType();
		try {
			const entity = await this.spawn(`principal`, {
				instance_id: principal.key,
				args: {
					kind: principal.kind,
					id: principal.id,
					key: principal.key
				},
				tags: {
					principal_kind: principal.kind,
					principal_id: principal.id
				},
				created_by: principal.url
			});
			const now = new Date().toISOString();
			await this.streamClient.append(entity.streams.main, this.encodeChangeEvent({
				type: `identity`,
				key: `self`,
				value: {
					kind: principal.kind,
					id: principal.id,
					key: principal.key,
					url: principal.url,
					created_at: now,
					updated_at: now
				}
			}));
			return entity;
		} catch (error) {
			if (error instanceof ElectricAgentsError && error.code === ErrCodeDuplicateURL) {
				const raced = await this.registry.getEntity(principal.url);
				if (raced) return raced;
			}
			throw error;
		}
	}
	/**
	* Spawn a new entity of the given type with durable streams.
	*/
	async spawn(typeName, req) {
		return await withSpan(`electric_agents.spawn`, async (span) => {
			span.setAttributes({
				[ATTR.ENTITY_TYPE]: typeName,
				...req.parent ? { [ATTR.PARENT_URL]: req.parent } : {}
			});
			const entity = await this.spawnInner(typeName, req);
			span.setAttribute(ATTR.ENTITY_URL, entity.url);
			return entity;
		});
	}
	async spawnInner(typeName, req) {
		if (typeName === `principal` && req.created_by !== principalUrl(req.instance_id)) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Principal entities are built in and can only be materialized by the system`, 400);
		if (typeName.startsWith(`_`)) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Entity type names starting with "_" are reserved`, 400);
		const entityType = await this.registry.getEntityType(typeName);
		if (!entityType) throw new ElectricAgentsError(ErrCodeUnknownEntityType, `Entity type "${typeName}" not found`, 404);
		if (entityType.creation_schema && req.args) {
			const valErr = this.validator.validate(entityType.creation_schema, req.args);
			if (valErr) throw new ElectricAgentsError(valErr.code, valErr.message, 422, valErr.details);
		}
		const initialTags = this.validateTags(req.tags ?? {});
		const instanceId = req.instance_id || randomUUID();
		if (instanceId.includes(`/`)) throw new ElectricAgentsError(ErrCodeInvalidRequest, `instance_id must not contain forward slashes`, 400);
		const writeToken = randomUUID();
		const entityURL = typeName === `principal` ? principalUrl(instanceId) : `/${typeName}/${instanceId}`;
		const mainPath = `${entityURL}/main`;
		const errorPath = `${entityURL}/error`;
		const subscriptionId = `${typeName}-handler`;
		const spawnT0 = performance.now();
		const existingByURL = await this.registry.getEntity(entityURL);
		if (existingByURL) throw new ElectricAgentsError(ErrCodeDuplicateURL, `Entity already exists at URL "${entityURL}"`, 409);
		let parentEntity = null;
		if (req.parent) {
			parentEntity = await this.registry.getEntity(req.parent);
			if (!parentEntity) throw new ElectricAgentsError(ErrCodeNotFound, `Parent entity "${req.parent}" not found`, 404);
		}
		const dispatchPolicy = req.dispatch_policy ? this.validateDispatchPolicy(req.dispatch_policy, { label: `dispatch_policy` }) : parentEntity?.dispatch_policy ? applyTypeDefaultSubscriptionScope(parentEntity.dispatch_policy, entityType.default_dispatch_policy) : entityType.default_dispatch_policy;
		const now = Date.now();
		const entityData = {
			type: typeName,
			status: `idle`,
			url: entityURL,
			streams: {
				main: mainPath,
				error: errorPath
			},
			subscription_id: subscriptionId,
			dispatch_policy: dispatchPolicy,
			write_token: writeToken,
			tags: initialTags,
			spawn_args: req.args,
			type_revision: entityType.revision,
			inbox_schemas: entityType.inbox_schemas,
			state_schemas: entityType.state_schemas,
			created_at: now,
			created_by: req.created_by ?? parentEntity?.created_by,
			updated_at: now
		};
		if (req.parent) entityData.parent = req.parent;
		if (req.wake) await this.wakeRegistry.register({
			tenantId: this.tenantId,
			subscriberUrl: req.wake.subscriberUrl,
			sourceUrl: entityURL,
			condition: req.wake.condition,
			debounceMs: req.wake.debounceMs,
			timeoutMs: req.wake.timeoutMs,
			oneShot: false,
			includeResponse: req.wake.includeResponse
		});
		const contentType = `application/json`;
		const createdEvent = entityStateSchema.entityCreated.insert({
			key: `entity-created`,
			value: {
				entity_type: typeName,
				timestamp: new Date().toISOString(),
				args: req.args ?? {},
				...req.parent ? { parent_url: req.parent } : {}
			}
		});
		const initialEvents = [createdEvent];
		if (req.initialMessage !== void 0) {
			const msgNow = new Date().toISOString();
			const inboxEvent = entityStateSchema.inbox.insert({
				key: `msg-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				value: {
					from: req.created_by ?? req.parent ?? `spawn`,
					payload: req.initialMessage,
					timestamp: msgNow
				}
			});
			initialEvents.push(inboxEvent);
		}
		const initialBody = `[${initialEvents.map((e) => JSON.stringify(e)).join(`,`)}]`;
		const queueEnterT0 = performance.now();
		const queueWaiting = this.spawnPersistQueue.length();
		const queueRunning = this.spawnPersistQueue.running();
		const [mainStreamResult, errorStreamResult, entityResult] = await this.spawnPersistQueue.push(async () => {
			let entityTxid;
			try {
				entityTxid = await withSpan(`db.createEntity`, () => this.registry.createEntity(entityData));
			} catch (err) {
				return [
					{
						status: `fulfilled`,
						value: void 0
					},
					{
						status: `fulfilled`,
						value: void 0
					},
					{
						status: `rejected`,
						reason: err
					}
				];
			}
			const [mainStreamResult$1, errorStreamResult$1] = await Promise.allSettled([this.streamClient.create(mainPath, {
				contentType,
				body: initialBody
			}), this.streamClient.create(errorPath, { contentType })]);
			return [
				mainStreamResult$1,
				errorStreamResult$1,
				{
					status: `fulfilled`,
					value: entityTxid
				}
			];
		});
		const parallelMs = +(performance.now() - queueEnterT0).toFixed(2);
		if (mainStreamResult.status === `rejected` || errorStreamResult.status === `rejected` || entityResult.status === `rejected`) {
			const entityReason = entityResult.status === `rejected` ? entityResult.reason : null;
			const streamReason = mainStreamResult.status === `rejected` ? mainStreamResult.reason : errorStreamResult.status === `rejected` ? errorStreamResult.reason : null;
			const isDuplicate = entityReason instanceof EntityAlreadyExistsError;
			const isStreamConflict = !!streamReason && typeof streamReason === `object` && (`status` in streamReason && streamReason.status === 409 || `code` in streamReason && streamReason.code === `CONFLICT_SEQ`);
			const rollbacks = [];
			if (!isDuplicate && !isStreamConflict) {
				if (mainStreamResult.status === `fulfilled`) rollbacks.push(this.streamClient.delete(mainPath));
				if (errorStreamResult.status === `fulfilled`) rollbacks.push(this.streamClient.delete(errorPath));
				if (entityResult.status === `fulfilled`) rollbacks.push(this.registry.deleteEntity(entityURL));
				if (req.wake) rollbacks.push(this.wakeRegistry.unregisterBySubscriberAndSource(req.wake.subscriberUrl, entityURL, this.tenantId));
				await Promise.allSettled(rollbacks);
			}
			if (isDuplicate || isStreamConflict) throw new ElectricAgentsError(ErrCodeDuplicateURL, `Entity already exists at URL "${entityURL}"`, 409);
			const failure = mainStreamResult.status === `rejected` ? mainStreamResult.reason : errorStreamResult.status === `rejected` ? errorStreamResult.reason : entityResult.reason;
			if (failure instanceof Error) throw failure;
			throw new ElectricAgentsError(`SPAWN_FAILED`, `Spawn failed: ${String(failure)}`, 500);
		}
		const txid = entityResult.value;
		serverLog.event({
			event: `spawn`,
			url: entityURL,
			type: typeName,
			parent: req.parent,
			parallelMs,
			totalMs: +(performance.now() - spawnT0).toFixed(2),
			queueWaiting,
			queueRunning
		}, `spawn done`);
		return {
			...entityData,
			txid
		};
	}
	async forkSubtree(rootUrl, opts = {}) {
		return await withSpan(`electric_agents.forkSubtree`, async (span) => {
			span.setAttribute(ATTR.ENTITY_URL, rootUrl);
			const result = await this.forkSubtreeInner(rootUrl, opts);
			span.setAttribute(`electric_agents.fork.root_url`, result.root.url);
			span.setAttribute(`electric_agents.fork.entity_count`, result.entities.length);
			return result;
		});
	}
	async forkSubtreeInner(rootUrl, opts) {
		const forkT0 = performance.now();
		const workLocks = new Set();
		const writeEntityLocks = new Set();
		const writeStreamLocks = new Set();
		try {
			const sourceTree = await this.waitForIdleSubtree(rootUrl, opts, workLocks);
			const sourceRoot = sourceTree[0];
			if (sourceRoot.parent) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Only top-level entities can be forked`, 400);
			const snapshot = await this.readForkStateSnapshot(sourceTree);
			const suffix = randomUUID().slice(0, 8);
			const entityUrlMap = await this.buildForkEntityUrlMap(sourceTree, {
				suffix,
				rootUrl,
				rootInstanceId: opts.rootInstanceId
			});
			const sharedStateIdMap = await this.buildForkSharedStateIdMap(snapshot.sharedStateIds, suffix);
			const stringMap = this.buildForkStringMap(entityUrlMap, sharedStateIdMap);
			const entityPlans = this.buildForkEntityPlans(sourceTree, entityUrlMap, stringMap);
			this.addForkLocks(this.forkWriteLockedEntities, sourceTree.map((entity) => entity.url), writeEntityLocks);
			this.addForkLocks(this.forkWriteLockedStreams, [...snapshot.sharedStateIds].map((id) => getSharedStateStreamPath(id)), writeStreamLocks);
			const createdStreams = [];
			const createdEntities = [];
			const activeManifestsByEntity = new Map();
			try {
				for (const plan of entityPlans) {
					await this.streamClient.fork(plan.fork.streams.main, plan.source.streams.main);
					createdStreams.push(plan.fork.streams.main);
					await this.streamClient.fork(plan.fork.streams.error, plan.source.streams.error);
					createdStreams.push(plan.fork.streams.error);
				}
				for (const [sourceId, forkId] of sharedStateIdMap) {
					const sourcePath = getSharedStateStreamPath(sourceId);
					const forkPath = getSharedStateStreamPath(forkId);
					await this.streamClient.fork(forkPath, sourcePath);
					createdStreams.push(forkPath);
				}
				for (const plan of entityPlans) {
					const reconciliation = this.buildForkReconciliation(plan, snapshot, entityUrlMap, sharedStateIdMap, stringMap);
					activeManifestsByEntity.set(plan.fork.url, reconciliation.manifests);
					for (const event of reconciliation.events) await this.streamClient.append(plan.fork.streams.main, this.encodeChangeEvent(event));
				}
				for (const plan of entityPlans) {
					await this.registry.createEntity(plan.fork);
					createdEntities.push(plan.fork.url);
				}
				for (const plan of entityPlans) {
					const manifests = activeManifestsByEntity.get(plan.fork.url) ?? new Map();
					await this.materializeForkManifestSideEffects(plan.fork.url, manifests);
				}
				const root = entityPlans.find((plan) => plan.source.url === rootUrl).fork;
				serverLog.event({
					event: `fork`,
					url: rootUrl,
					forkUrl: root.url,
					entities: entityPlans.length,
					sharedStateStreams: sharedStateIdMap.size,
					totalMs: +(performance.now() - forkT0).toFixed(2)
				}, `fork done`);
				return {
					root,
					entities: entityPlans.map((plan) => plan.fork)
				};
			} catch (err) {
				await Promise.allSettled([
					...createdEntities.flatMap((entityUrl) => [
						this.wakeRegistry.unregisterBySubscriber(entityUrl, this.tenantId),
						this.wakeRegistry.unregisterBySource(entityUrl, this.tenantId),
						this.registry.deleteEntity(entityUrl)
					]),
					...Array.from(sharedStateIdMap.values()).map((id) => this.wakeRegistry.unregisterBySource(getSharedStateStreamPath(id), this.tenantId)),
					...createdStreams.map((streamPath) => this.streamClient.delete(streamPath))
				]);
				throw err;
			} finally {
				this.releaseForkLocks(this.forkWriteLockedStreams, writeStreamLocks);
				this.releaseForkLocks(this.forkWriteLockedEntities, writeEntityLocks);
			}
		} finally {
			this.releaseForkLocks(this.forkWorkLockedEntities, workLocks);
		}
	}
	isForkWorkLockedEntity(entityUrl) {
		return (this.forkWorkLockedEntities.get(entityUrl) ?? 0) > 0;
	}
	isForkWriteLockedEntity(entityUrl) {
		return (this.forkWriteLockedEntities.get(entityUrl) ?? 0) > 0;
	}
	isForkWriteLockedStream(streamPath) {
		return (this.forkWriteLockedStreams.get(streamPath) ?? 0) > 0;
	}
	assertEntityNotForkWorkLocked(entityUrl) {
		if (!this.isForkWorkLockedEntity(entityUrl)) return;
		throw new ElectricAgentsError(ErrCodeForkInProgress, `Entity subtree is being forked`, 409);
	}
	addForkLocks(locks, keys, held) {
		for (const key of keys) {
			if (held.has(key)) continue;
			locks.set(key, (locks.get(key) ?? 0) + 1);
			held.add(key);
		}
	}
	releaseForkLocks(locks, held) {
		for (const key of held) {
			const count = locks.get(key) ?? 0;
			if (count <= 1) locks.delete(key);
			else locks.set(key, count - 1);
		}
		held.clear();
	}
	async waitForIdleSubtree(rootUrl, opts, workLocks) {
		const timeoutMs = opts.waitTimeoutMs ?? DEFAULT_FORK_WAIT_TIMEOUT_MS;
		const pollMs = opts.waitPollMs ?? DEFAULT_FORK_WAIT_POLL_MS;
		if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new ElectricAgentsError(ErrCodeInvalidRequest, `waitTimeoutMs must be a non-negative number`, 400);
		if (!Number.isFinite(pollMs) || pollMs <= 0) throw new ElectricAgentsError(ErrCodeInvalidRequest, `waitPollMs must be a positive number`, 400);
		const deadline = Date.now() + timeoutMs;
		while (true) {
			const root = await this.registry.getEntity(rootUrl);
			if (!root) throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404);
			if (root.parent) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Only top-level entities can be forked`, 400);
			const subtree = await this.listEntitySubtree(root);
			const stopped = subtree.find((entity) => entity.status === `stopped`);
			if (stopped) throw new ElectricAgentsError(ErrCodeNotRunning, `Cannot fork stopped entity "${stopped.url}"`, 409);
			let active = subtree.filter((entity) => entity.status !== `idle`);
			if (active.length === 0) {
				this.addForkLocks(this.forkWorkLockedEntities, subtree.map((entity) => entity.url), workLocks);
				const lockedRoot = await this.registry.getEntity(rootUrl);
				if (!lockedRoot) throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404);
				const lockedSubtree = await this.listEntitySubtree(lockedRoot);
				this.addForkLocks(this.forkWorkLockedEntities, lockedSubtree.map((entity) => entity.url), workLocks);
				const lockedActive = lockedSubtree.filter((entity) => entity.status !== `idle`);
				if (lockedActive.length === 0) return lockedSubtree;
				this.releaseForkLocks(this.forkWorkLockedEntities, workLocks);
				active = lockedActive;
			}
			if (Date.now() >= deadline) throw new ElectricAgentsError(ErrCodeForkWaitTimeout, `Timed out waiting for subtree to become idle`, 409, { active: active.map((entity) => entity.url) });
			await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
		}
	}
	async listEntitySubtree(root) {
		const result = [];
		const queue = [root];
		const seen = new Set();
		while (queue.length > 0) {
			const entity = queue.shift();
			if (seen.has(entity.url)) continue;
			seen.add(entity.url);
			result.push(entity);
			const { entities: children } = await this.registry.listEntities({
				parent: entity.url,
				limit: 1e4
			});
			for (const child of children) queue.push(child);
		}
		return result;
	}
	async readForkStateSnapshot(entitiesToFork) {
		const manifestsByEntity = new Map();
		const childStatusesByEntity = new Map();
		const replayWatermarksByEntity = new Map();
		const sharedStateIds = new Set();
		for (const entity of entitiesToFork) {
			const events = await this.streamClient.readJson(entity.streams.main);
			const manifests = this.reduceStateRows(events, `manifest`);
			const childStatuses = this.reduceStateRows(events, `child_status`);
			const replayWatermarks = this.reduceStateRows(events, `replay_watermark`);
			manifestsByEntity.set(entity.url, manifests);
			childStatusesByEntity.set(entity.url, childStatuses);
			replayWatermarksByEntity.set(entity.url, replayWatermarks);
			for (const manifest of manifests.values()) this.collectSharedStateIds(manifest, sharedStateIds);
		}
		return {
			manifestsByEntity,
			childStatusesByEntity,
			replayWatermarksByEntity,
			sharedStateIds
		};
	}
	reduceStateRows(rawEvents, eventType) {
		const rows = new Map();
		const events = rawEvents.flatMap((item) => Array.isArray(item) ? item : [item]);
		for (const event of events) {
			if (!isRecord(event) || event.type !== eventType) continue;
			if (typeof event.key !== `string`) continue;
			const headers = isRecord(event.headers) ? event.headers : void 0;
			const operation = headers?.operation;
			if (operation === `delete`) {
				rows.delete(event.key);
				continue;
			}
			if (isRecord(event.value)) rows.set(event.key, cloneRecord(event.value));
		}
		return rows;
	}
	collectSharedStateIds(manifest, sharedStateIds) {
		if (manifest.kind === `shared-state` && typeof manifest.id === `string`) {
			sharedStateIds.add(manifest.id);
			return;
		}
		if (manifest.kind !== `source` || manifest.sourceType !== `db`) return;
		if (typeof manifest.sourceRef === `string`) sharedStateIds.add(manifest.sourceRef);
		const config = isRecord(manifest.config) ? manifest.config : void 0;
		if (typeof config?.id === `string`) sharedStateIds.add(config.id);
	}
	async buildForkEntityUrlMap(entitiesToFork, opts) {
		const map = new Map();
		const reserved = new Set();
		for (const entity of entitiesToFork) {
			const { type, instanceId } = this.parseEntityUrl(entity.url);
			const rootRequestedId = entity.url === opts.rootUrl ? opts.rootInstanceId : void 0;
			const baseId = rootRequestedId ?? `${instanceId}-fork-${opts.suffix}`;
			const forkUrl = await this.reserveForkEntityUrl(type, baseId, reserved, { exact: rootRequestedId !== void 0 });
			map.set(entity.url, forkUrl);
		}
		return map;
	}
	async reserveForkEntityUrl(type, baseId, reserved, opts) {
		if (!baseId || baseId.includes(`/`)) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Fork instance_id must not be empty or contain forward slashes`, 400);
		let attempt = 0;
		while (true) {
			const instanceId = attempt === 0 ? baseId : `${baseId}-${attempt}`;
			const url = `/${type}/${instanceId}`;
			const exists = reserved.has(url) || await this.registry.getEntity(url);
			if (!exists) {
				reserved.add(url);
				return url;
			}
			if (opts?.exact) throw new ElectricAgentsError(ErrCodeDuplicateURL, `Entity already exists at URL "${url}"`, 409);
			attempt += 1;
		}
	}
	async buildForkSharedStateIdMap(sourceIds, suffix) {
		const map = new Map();
		const reserved = new Set();
		for (const sourceId of [...sourceIds].sort()) {
			const baseId = `${sourceId}-fork-${suffix}`;
			let attempt = 0;
			while (true) {
				const candidate = attempt === 0 ? baseId : `${baseId}-${attempt}`;
				const path$1 = getSharedStateStreamPath(candidate);
				if (!reserved.has(candidate) && !await this.streamClient.exists(path$1)) {
					reserved.add(candidate);
					map.set(sourceId, candidate);
					break;
				}
				attempt += 1;
			}
		}
		return map;
	}
	buildForkStringMap(entityUrlMap, sharedStateIdMap) {
		const stringMap = new Map();
		for (const [sourceUrl, forkUrl] of entityUrlMap) {
			stringMap.set(sourceUrl, forkUrl);
			stringMap.set(`${sourceUrl}/main`, `${forkUrl}/main`);
			stringMap.set(`${sourceUrl}/error`, `${forkUrl}/error`);
		}
		for (const [sourceId, forkId] of sharedStateIdMap) {
			stringMap.set(sourceId, forkId);
			stringMap.set(getSharedStateStreamPath(sourceId), getSharedStateStreamPath(forkId));
		}
		return stringMap;
	}
	buildForkEntityPlans(entitiesToFork, entityUrlMap, stringMap) {
		const now = Date.now();
		return entitiesToFork.map((source) => {
			const forkUrl = entityUrlMap.get(source.url);
			if (!forkUrl) throw new Error(`Missing fork URL for ${source.url}`);
			const { type } = this.parseEntityUrl(forkUrl);
			const parent = source.parent ? entityUrlMap.get(source.parent) : void 0;
			const spawnArgs = isRecord(source.spawn_args) ? this.remapJsonValue(source.spawn_args, stringMap) : source.spawn_args;
			const fork = {
				...source,
				url: forkUrl,
				type,
				status: `idle`,
				streams: {
					main: `${forkUrl}/main`,
					error: `${forkUrl}/error`
				},
				subscription_id: `${type}-handler`,
				write_token: randomUUID(),
				spawn_args: spawnArgs,
				parent,
				created_at: now,
				updated_at: now
			};
			if (!parent) delete fork.parent;
			return {
				source,
				fork
			};
		});
	}
	buildForkReconciliation(plan, snapshot, entityUrlMap, sharedStateIdMap, stringMap) {
		const txid = `fork-${randomUUID()}`;
		const headers = {
			txid,
			forkedFrom: plan.source.url
		};
		const events = [entityStateSchema.entityCreated.update({
			key: `entity-created`,
			value: omitUndefined$1({
				entity_type: plan.fork.type,
				timestamp: new Date().toISOString(),
				args: plan.fork.spawn_args ?? {},
				parent_url: plan.fork.parent
			}),
			headers
		})];
		const activeManifests = new Map();
		const sourceManifests = snapshot.manifestsByEntity.get(plan.source.url) ?? new Map();
		for (const [key, value] of sourceManifests) {
			const remapped = this.remapManifestEntry(key, value, entityUrlMap, sharedStateIdMap);
			activeManifests.set(remapped.key, remapped.value);
			if (!remapped.changed) continue;
			if (remapped.key !== key) {
				events.push(entityStateSchema.manifests.delete({
					key,
					headers
				}));
				events.push(entityStateSchema.manifests.insert({
					key: remapped.key,
					value: remapped.value,
					headers
				}));
			} else events.push(entityStateSchema.manifests.update({
				key,
				value: remapped.value,
				headers
			}));
		}
		const childStatuses = snapshot.childStatusesByEntity.get(plan.source.url) ?? new Map();
		for (const [key, value] of childStatuses) {
			const remapped = this.remapChildStatus(value, entityUrlMap);
			if (!remapped) continue;
			events.push(entityStateSchema.childStatus.update({
				key,
				value: remapped,
				headers
			}));
		}
		const replayWatermarks = snapshot.replayWatermarksByEntity.get(plan.source.url) ?? new Map();
		for (const [key, value] of replayWatermarks) {
			const remapped = this.remapReplayWatermark(key, value, stringMap);
			if (!remapped) continue;
			if (remapped.key !== key) {
				events.push(entityStateSchema.replayWatermarks.delete({
					key,
					headers
				}));
				events.push(entityStateSchema.replayWatermarks.insert({
					key: remapped.key,
					value: remapped.value,
					headers
				}));
			} else events.push(entityStateSchema.replayWatermarks.update({
				key,
				value: remapped.value,
				headers
			}));
		}
		return {
			events,
			manifests: activeManifests
		};
	}
	remapManifestEntry(key, value, entityUrlMap, sharedStateIdMap) {
		const next = cloneRecord(value);
		if (next.kind === `child` && typeof next.entity_url === `string`) {
			const forkUrl = entityUrlMap.get(next.entity_url);
			if (!forkUrl) return {
				key,
				value: next,
				changed: false
			};
			const { instanceId } = this.parseEntityUrl(forkUrl);
			next.id = instanceId;
			next.entity_url = forkUrl;
			next.key = manifestChildKey(String(next.entity_type), instanceId);
			return {
				key: String(next.key),
				value: next,
				changed: true
			};
		}
		if (next.kind === `shared-state` && typeof next.id === `string`) {
			const forkId = sharedStateIdMap.get(next.id);
			if (!forkId) return {
				key,
				value: next,
				changed: false
			};
			next.id = forkId;
			next.key = manifestSharedStateKey(forkId);
			return {
				key: String(next.key),
				value: next,
				changed: true
			};
		}
		if (next.kind === `source` && next.sourceType === `entity`) {
			const config = isRecord(next.config) ? next.config : {};
			const sourceUrl = typeof config.entityUrl === `string` ? config.entityUrl : typeof next.sourceRef === `string` ? next.sourceRef : void 0;
			const forkUrl = sourceUrl ? entityUrlMap.get(sourceUrl) : void 0;
			if (!forkUrl) return {
				key,
				value: next,
				changed: false
			};
			const { type } = this.parseEntityUrl(forkUrl);
			next.sourceRef = forkUrl;
			next.key = manifestSourceKey(`entity`, forkUrl);
			next.config = {
				...config,
				entityUrl: forkUrl,
				streamPath: `${forkUrl}/main`,
				entityType: type
			};
			return {
				key: String(next.key),
				value: next,
				changed: true
			};
		}
		if (next.kind === `source` && next.sourceType === `db`) {
			const config = isRecord(next.config) ? next.config : {};
			const sourceId = typeof next.sourceRef === `string` ? next.sourceRef : typeof config.id === `string` ? config.id : void 0;
			const forkId = sourceId ? sharedStateIdMap.get(sourceId) : void 0;
			if (!forkId) return {
				key,
				value: next,
				changed: false
			};
			next.sourceRef = forkId;
			next.key = manifestSourceKey(`db`, forkId);
			next.config = {
				...config,
				id: forkId
			};
			return {
				key: String(next.key),
				value: next,
				changed: true
			};
		}
		if (next.kind === `schedule` && next.scheduleType === `future_send`) {
			let changed = false;
			if (typeof next.targetUrl === `string`) {
				const forkTarget = entityUrlMap.get(next.targetUrl);
				if (forkTarget) {
					next.targetUrl = forkTarget;
					changed = true;
				}
			}
			if (typeof next.senderUrl === `string`) {
				const forkSender = entityUrlMap.get(next.senderUrl);
				if (forkSender) {
					next.senderUrl = forkSender;
					changed = true;
				}
			}
			return {
				key,
				value: next,
				changed
			};
		}
		return {
			key,
			value: next,
			changed: false
		};
	}
	remapChildStatus(value, entityUrlMap) {
		if (typeof value.entity_url !== `string`) return null;
		const forkUrl = entityUrlMap.get(value.entity_url);
		if (!forkUrl) return null;
		const { type } = this.parseEntityUrl(forkUrl);
		return {
			...value,
			entity_url: forkUrl,
			entity_type: type
		};
	}
	remapReplayWatermark(key, value, stringMap) {
		if (typeof value.source_id !== `string`) return null;
		const sourceId = value.source_id;
		const forkSourceId = stringMap.get(sourceId);
		if (!forkSourceId) return null;
		const next = {
			...value,
			source_id: forkSourceId
		};
		return {
			key: key === sourceId ? forkSourceId : key,
			value: next
		};
	}
	remapJsonValue(value, stringMap) {
		if (typeof value === `string`) return stringMap.get(value) ?? value;
		if (Array.isArray(value)) return value.map((item) => this.remapJsonValue(item, stringMap));
		if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.remapJsonValue(item, stringMap)]));
		return value;
	}
	async materializeForkManifestSideEffects(entityUrl, manifests) {
		for (const [manifestKey, manifest] of manifests) {
			await this.syncEntitiesManifestSource(entityUrl, manifestKey, `upsert`, manifest);
			const wake = buildManifestWakeRegistration(entityUrl, manifest, manifestKey);
			if (wake) await this.wakeRegistry.register({
				...wake,
				tenantId: this.tenantId
			});
			const cronSpec = extractManifestCronSpec(manifest);
			if (cronSpec && this.scheduler) await this.getOrCreateCronStream(cronSpec.expression, cronSpec.timezone);
			await this.syncManifestFutureSendSchedule(entityUrl, manifestKey, manifest);
		}
	}
	async syncManifestFutureSendSchedule(ownerEntityUrl, manifestKey, manifest) {
		if (!this.scheduler) return;
		if (manifest.kind !== `schedule` || manifest.scheduleType !== `future_send` || manifest.status !== void 0 && manifest.status !== `pending`) return;
		const fireAtRaw = manifest.fireAt;
		const producerId = manifest.producerId;
		const targetUrl = manifest.targetUrl;
		const senderUrl = typeof manifest.senderUrl === `string` ? manifest.senderUrl : ownerEntityUrl;
		if (typeof fireAtRaw !== `string` || typeof producerId !== `string` || typeof targetUrl !== `string`) {
			serverLog.warn(`[agent-server] invalid forked future_send manifest entry for ${ownerEntityUrl}/${manifestKey}`);
			return;
		}
		const fireAt = new Date(fireAtRaw);
		if (Number.isNaN(fireAt.getTime())) {
			serverLog.warn(`[agent-server] invalid forked future_send fireAt for ${ownerEntityUrl}/${manifestKey}: ${fireAtRaw}`);
			return;
		}
		await this.scheduler.syncManifestDelayedSend(ownerEntityUrl, manifestKey, {
			entityUrl: targetUrl,
			from: senderUrl,
			payload: manifest.payload,
			key: `scheduled-${producerId}`,
			type: typeof manifest.messageType === `string` ? manifest.messageType : void 0,
			producerId,
			manifest: {
				ownerEntityUrl,
				key: manifestKey,
				entry: omitUndefined$1({
					...manifest,
					key: manifestKey,
					kind: `schedule`,
					scheduleType: `future_send`,
					targetUrl,
					senderUrl,
					fireAt: fireAt.toISOString(),
					producerId,
					status: `pending`
				})
			}
		}, fireAt);
	}
	parseEntityUrl(url) {
		const segments = url.split(`/`).filter(Boolean);
		if (segments.length !== 2 || !segments[0] || !segments[1]) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Invalid entity URL "${url}"`, 400);
		return {
			type: segments[0],
			instanceId: segments[1]
		};
	}
	/**
	* Deliver a message to an entity's main stream, with optional input schema
	* validation.
	*/
	async send(entityUrl, req, opts) {
		const entity = await this.validateSendRequest(entityUrl, req);
		if (this.isForkWorkLockedEntity(entityUrl) && !(req.from && this.isForkWorkLockedEntity(req.from))) this.assertEntityNotForkWorkLocked(entityUrl);
		const now = new Date().toISOString();
		const key = req.key ?? `msg-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const value = {
			from: req.from,
			payload: req.payload,
			timestamp: now,
			mode: req.mode ?? `immediate`,
			status: req.mode === `queued` || req.mode === `paused` ? `pending` : `processed`
		};
		if (req.type) value.message_type = req.type;
		if (req.position) value.position = req.position;
		else if (value.mode === `queued` || value.mode === `paused`) value.position = createInitialQueuePosition(new Date(now));
		if (value.status === `processed`) value.processed_at = now;
		const envelope = entityStateSchema.inbox.insert({
			key,
			value
		});
		const encoded = this.encodeChangeEvent(envelope);
		try {
			if (opts?.producerId) {
				await this.streamClient.appendIdempotent(entity.streams.main, encoded, { producerId: opts.producerId });
				return;
			}
			await this.streamClient.append(entity.streams.main, encoded);
			if (entity.type === `principal` && req.type === `update_identity`) {
				const identity = req.payload?.identity;
				await this.streamClient.append(entity.streams.main, this.encodeChangeEvent({
					type: `identity`,
					key: `self`,
					value: identity
				}));
			}
		} catch (err) {
			if (this.isClosedStreamError(err)) throw new ElectricAgentsError(ErrCodeNotRunning, `Entity is stopped`, 409);
			throw err;
		}
	}
	async updateInboxMessage(entityUrl, key, req) {
		const entity = await this.registry.getEntity(entityUrl);
		if (!entity) throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404);
		if (entity.status === `stopped`) throw new ElectricAgentsError(ErrCodeNotRunning, `Entity is stopped`, 409);
		const now = new Date().toISOString();
		const value = {};
		if (`payload` in req) value.payload = req.payload;
		if (req.position !== void 0) value.position = req.position;
		if (req.mode !== void 0) value.mode = req.mode;
		if (req.status !== void 0) {
			value.status = req.status;
			if (req.status === `processed`) value.processed_at = now;
			if (req.status === `cancelled`) value.cancelled_at = now;
		}
		if (Object.keys(value).length === 0) throw new ElectricAgentsError(ErrCodeInvalidRequest, `No inbox fields to update`, 400);
		const envelope = entityStateSchema.inbox.update({
			key,
			value
		});
		await this.streamClient.append(entity.streams.main, this.encodeChangeEvent(envelope));
	}
	async deleteInboxMessage(entityUrl, key) {
		const entity = await this.registry.getEntity(entityUrl);
		if (!entity) throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404);
		if (entity.status === `stopped`) throw new ElectricAgentsError(ErrCodeNotRunning, `Entity is stopped`, 409);
		const envelope = entityStateSchema.inbox.delete({ key });
		await this.streamClient.append(entity.streams.main, this.encodeChangeEvent(envelope));
	}
	async setTag(entityUrl, key, req, token) {
		const entity = await this.registry.getEntity(entityUrl);
		if (!entity) throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404);
		if (!this.isValidWriteToken(entity, token)) throw new ElectricAgentsError(ErrCodeUnauthorized, `Invalid write token`, 401);
		if (entity.status === `stopped`) throw new ElectricAgentsError(ErrCodeNotRunning, `Entity is stopped`, 409);
		if (typeof req.value !== `string`) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Tag values must be strings`, 400);
		const result = await this.registry.setEntityTag(entityUrl, key, req.value);
		const updated = result.entity;
		if (!updated) throw new ElectricAgentsError(ErrCodeEntityPersistFailed, `Entity not found after tag write`, 500);
		if (result.changed && this.entityBridgeManager) await this.entityBridgeManager.onEntityChanged(entityUrl);
		return updated;
	}
	async removeTag(entityUrl, key, token) {
		const entity = await this.registry.getEntity(entityUrl);
		if (!entity) throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404);
		if (!this.isValidWriteToken(entity, token)) throw new ElectricAgentsError(ErrCodeUnauthorized, `Invalid write token`, 401);
		if (entity.status === `stopped`) throw new ElectricAgentsError(ErrCodeNotRunning, `Entity is stopped`, 409);
		const result = await this.registry.removeEntityTag(entityUrl, key);
		const updated = result.entity;
		if (!updated) throw new ElectricAgentsError(ErrCodeEntityPersistFailed, `Entity not found after tag delete`, 500);
		if (result.changed && this.entityBridgeManager) await this.entityBridgeManager.onEntityChanged(entityUrl);
		return updated;
	}
	async registerEntitiesSource(tags) {
		if (!this.entityBridgeManager) throw new Error(`Entity bridge manager not configured`);
		return this.entityBridgeManager.register(this.validateTags(tags));
	}
	async writeManifestEntry(entityUrl, key, operation, value, opts) {
		const entity = await this.registry.getEntity(entityUrl);
		if (!entity) throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404);
		const event = {
			type: `manifest`,
			key,
			headers: {
				operation,
				timestamp: new Date().toISOString(),
				...opts?.txid ? { txid: opts.txid } : {}
			}
		};
		if (value !== void 0) event.value = value;
		const encoded = this.encodeChangeEvent(event);
		if (opts?.producerId) {
			await this.streamClient.appendIdempotent(entity.streams.main, encoded, { producerId: opts.producerId });
			await this.syncEntitiesManifestSource(entityUrl, key, operation, value);
			return;
		}
		await this.streamClient.append(entity.streams.main, encoded);
		await this.syncEntitiesManifestSource(entityUrl, key, operation, value);
	}
	async upsertCronSchedule(entityUrl, req) {
		if (req.payload === void 0) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Missing required field: payload`, 400);
		const spec = resolveCronScheduleSpec(req.expression, req.timezone);
		const manifestKey = `schedule:${req.id}`;
		await this.wakeRegistry.unregisterByManifestKey(entityUrl, manifestKey, this.tenantId);
		await this.wakeRegistry.register({
			tenantId: this.tenantId,
			subscriberUrl: entityUrl,
			sourceUrl: getCronStreamPath(spec.expression, spec.timezone),
			condition: { on: `change` },
			debounceMs: req.debounceMs,
			timeoutMs: req.timeoutMs,
			oneShot: false,
			manifestKey
		});
		await this.getOrCreateCronStream(spec.expression, spec.timezone);
		const txid = randomUUID();
		await this.writeManifestEntry(entityUrl, manifestKey, `upsert`, {
			key: manifestKey,
			kind: `schedule`,
			id: req.id,
			scheduleType: `cron`,
			expression: spec.expression,
			timezone: spec.timezone,
			payload: req.payload,
			wake: {
				on: `change`,
				...typeof req.debounceMs === `number` ? { debounceMs: req.debounceMs } : {},
				...typeof req.timeoutMs === `number` ? { timeoutMs: req.timeoutMs } : {}
			}
		}, { txid });
		return { txid };
	}
	async upsertFutureSendSchedule(ownerEntityUrl, req) {
		if (!this.scheduler) throw new Error(`Scheduler not configured`);
		const targetUrl = req.targetUrl ?? ownerEntityUrl;
		const from = req.senderUrl ?? ownerEntityUrl;
		const fireAt = new Date(req.fireAt);
		if (Number.isNaN(fireAt.getTime())) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Invalid fireAt timestamp: ${req.fireAt}`, 400);
		await this.validateSendRequest(targetUrl, {
			from,
			payload: req.payload,
			type: req.messageType
		});
		const manifestKey = `schedule:${req.id}`;
		const producerId = `future-send-${randomUUID()}`;
		await this.wakeRegistry.unregisterByManifestKey(ownerEntityUrl, manifestKey, this.tenantId);
		await this.scheduler.syncManifestDelayedSend(ownerEntityUrl, manifestKey, {
			entityUrl: targetUrl,
			from,
			payload: req.payload,
			key: `scheduled-${producerId}`,
			type: req.messageType,
			producerId,
			manifest: {
				ownerEntityUrl,
				key: manifestKey,
				entry: {
					key: manifestKey,
					kind: `schedule`,
					id: req.id,
					scheduleType: `future_send`,
					fireAt: fireAt.toISOString(),
					targetUrl,
					senderUrl: from,
					payload: req.payload,
					producerId,
					...req.messageType ? { messageType: req.messageType } : {},
					status: `pending`
				}
			}
		}, fireAt);
		const txid = randomUUID();
		await this.writeManifestEntry(ownerEntityUrl, manifestKey, `upsert`, {
			key: manifestKey,
			kind: `schedule`,
			id: req.id,
			scheduleType: `future_send`,
			fireAt: fireAt.toISOString(),
			targetUrl,
			senderUrl: from,
			payload: req.payload,
			producerId,
			...req.messageType ? { messageType: req.messageType } : {},
			status: `pending`
		}, { txid });
		return { txid };
	}
	async deleteSchedule(entityUrl, req) {
		const manifestKey = `schedule:${req.id}`;
		if (this.scheduler) await this.scheduler.cancelManifestDelayedSend(entityUrl, manifestKey);
		await this.wakeRegistry.unregisterByManifestKey(entityUrl, manifestKey, this.tenantId);
		const txid = randomUUID();
		await this.writeManifestEntry(entityUrl, manifestKey, `delete`, void 0, { txid });
		return { txid };
	}
	/**
	* Register a wake subscription from a subscriber to a source entity.
	*/
	async registerWake(opts) {
		await this.wakeRegistry.register({
			tenantId: this.tenantId,
			subscriberUrl: opts.subscriberUrl,
			sourceUrl: opts.sourceUrl,
			condition: opts.condition,
			oneShot: false,
			debounceMs: opts.debounceMs,
			timeoutMs: opts.timeoutMs,
			includeResponse: opts.includeResponse,
			manifestKey: opts.manifestKey
		});
	}
	async enqueueDelayedSend(entityUrl, req, fireAt) {
		if (!this.scheduler) throw new Error(`Scheduler not configured`);
		await this.validateSendRequest(entityUrl, req);
		await this.scheduler.enqueueDelayedSend({
			entityUrl,
			from: req.from,
			payload: req.payload,
			key: req.key,
			type: req.type,
			mode: req.mode,
			position: req.position
		}, fireAt);
	}
	/**
	* Evaluate an event against registered wake conditions and deliver results.
	*/
	async evaluateWakes(sourceUrl, event) {
		return await withSpan(`electric_agents.evaluateWakes`, async (span) => {
			span.setAttribute(ATTR.WAKE_SOURCE, sourceUrl);
			const results = this.wakeRegistry.evaluate(sourceUrl, event, this.tenantId);
			span.setAttribute(`electric_agents.wake.subscriber_count`, results.length);
			const settled = await Promise.allSettled(results.map((result) => this.deliverWakeResult(result)));
			for (const [index$1, result] of settled.entries()) if (result.status === `rejected`) serverLog.warn(`[agent-server] failed to deliver wake for ${results[index$1].subscriberUrl}:`, result.reason);
		});
	}
	/**
	* Deliver a wake result: append WakeMessage to subscriber's stream and
	* trigger webhook notification.
	*/
	async deliverWakeResult(result) {
		if (result.tenantId !== this.tenantId) return;
		return await withSpan(`electric_agents.deliverWake`, async (span) => {
			span.setAttributes({
				[ATTR.WAKE_SUBSCRIBER]: result.subscriberUrl,
				[ATTR.WAKE_SOURCE]: result.wakeMessage.source,
				[ATTR.WAKE_KIND]: result.wakeMessage.timeout ? `timeout` : `change`
			});
			const needsSource = result.runFinishedStatus !== void 0;
			const [subscriber, sourceEntity] = await Promise.all([this.registry.getEntity(result.subscriberUrl), needsSource ? this.registry.getEntity(result.wakeMessage.source) : Promise.resolve(null)]);
			if (!subscriber) return;
			const wakeMessage = await this.buildWakeMessage(subscriber, result, sourceEntity);
			const wakeEvent = entityStateSchema.wakes.insert({
				key: `wake-${result.registrationDbId}-${result.sourceEventKey}`,
				value: wakeMessage
			});
			await this.streamClient.appendIdempotent(subscriber.streams.main, this.encodeChangeEvent(wakeEvent), { producerId: `wake-reg-${result.registrationDbId}-${result.sourceEventKey}` });
		});
	}
	async syncEntitiesManifestSource(entityUrl, manifestKey, operation, value) {
		const sourceRef = operation === `delete` ? void 0 : this.extractEntitiesSourceRef(value);
		await this.registry.replaceEntityManifestSource(entityUrl, manifestKey, sourceRef);
	}
	extractEntitiesSourceRef(manifest) {
		if (manifest?.kind === `source` && manifest.sourceType === `entities` && typeof manifest.sourceRef === `string`) return manifest.sourceRef;
		return void 0;
	}
	/**
	* Read a child entity's stream and extract concatenated text deltas
	* for a specific run, plus any error messages for that run.
	*/
	async extractRunResponse(entity, runKey, runStatus) {
		let events;
		try {
			events = await this.streamClient.readJson(entity.streams.main);
		} catch (err) {
			serverLog.warn(`[agent-server] failed to read child stream for ${entity.url} (${runKey}): ${err instanceof Error ? err.message : String(err)}`);
			return { error: `Failed to load child response` };
		}
		const textDeltas = [];
		const errors = [];
		for (const parsed of events) {
			const value = parsed.value;
			if (!value) continue;
			if (parsed.type === `text_delta`) {
				if (value.run_id === runKey) textDeltas.push(value.delta || ``);
			} else if (parsed.type === `error` && runStatus === `failed`) {
				if (value.run_id === runKey) errors.push(value.message || ``);
			}
		}
		const result = {};
		const runText = textDeltas.join(``);
		if (runText.length > 0) result.response = runText;
		if (errors.length > 0) result.error = errors.join(`\n`);
		return result;
	}
	async buildWakeMessage(subscriber, result, sourceEntity) {
		const wakeMessage = {
			timestamp: new Date().toISOString(),
			...result.wakeMessage
		};
		if (!result.runFinishedStatus) return wakeMessage;
		if (!sourceEntity) throw new Error(`[agent-server] runFinished wake source entity not found: ${result.wakeMessage.source}`);
		if (sourceEntity.parent !== subscriber.url) return wakeMessage;
		const includeResponse = result.includeResponse !== false;
		const changes = result.wakeMessage.changes;
		const runKey = changes[changes.length - 1]?.key;
		const { response, error } = includeResponse && runKey ? await this.extractRunResponse(sourceEntity, runKey, result.runFinishedStatus) : {};
		return {
			...wakeMessage,
			finished_child: {
				url: sourceEntity.url,
				type: sourceEntity.type,
				run_status: result.runFinishedStatus,
				...response !== void 0 ? { response } : {},
				...error !== void 0 ? { error } : {}
			}
		};
	}
	async kill(entityUrl) {
		const entity = await this.registry.getEntity(entityUrl);
		if (!entity) throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404);
		await this.wakeRegistry.unregisterBySubscriber(entityUrl, this.tenantId);
		await this.wakeRegistry.unregisterBySource(entityUrl, this.tenantId);
		const txid = await this.registry.updateStatusWithTxid(entityUrl, `stopped`);
		if (this.entityBridgeManager) await this.entityBridgeManager.onEntityChanged(entityUrl);
		const stoppedEvent = entityStateSchema.entityStopped.insert({
			key: `stopped`,
			value: { timestamp: new Date().toISOString() }
		});
		const eofData = this.encodeChangeEvent(stoppedEvent);
		for (const streamPath of [entity.streams.main, entity.streams.error]) try {
			await this.streamClient.append(streamPath, eofData, { close: true });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (/closed/i.test(message) || /not found/i.test(message) || /404/.test(message) || /409/.test(message)) continue;
			throw err;
		}
		return { txid };
	}
	async validateWriteEvent(entity, event) {
		if (!entity.type) return null;
		const { stateSchemas } = await this.getEffectiveSchemas(entity);
		if (!stateSchemas) return null;
		const eventType = event.type;
		if (!eventType) return null;
		if (!(eventType in stateSchemas)) return {
			code: ErrCodeUnknownEventType,
			message: `Unknown event type "${eventType}"`,
			status: 422
		};
		const schema = stateSchemas[eventType];
		if (schema) {
			const headers = event.headers;
			const operation = headers?.operation;
			const rawPayload = operation === `delete` && `old_value` in event ? event.old_value : event.value;
			if (rawPayload === void 0) return null;
			const payload = typeof rawPayload === `object` && rawPayload !== null ? rawPayload : rawPayload;
			const valErr = this.validator.validate(schema, payload);
			if (valErr) return {
				code: ErrCodeSchemaValidationFailed,
				message: valErr.message,
				status: 422
			};
		}
		return null;
	}
	/**
	* Add new input/output schema keys to an entity type directly in Postgres.
	*/
	async amendSchemas(typeName, schemas) {
		if (typeName === `principal`) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Entity type "principal" is built in and cannot be amended`, 400);
		this.validateSchemaMap(schemas.inbox_schemas);
		this.validateSchemaMap(schemas.state_schemas);
		const existing = await this.registry.getEntityType(typeName);
		if (!existing) throw new ElectricAgentsError(ErrCodeUnknownEntityType, `Entity type "${typeName}" not found`, 404);
		if (schemas.inbox_schemas && existing.inbox_schemas) {
			for (const key of Object.keys(schemas.inbox_schemas)) if (key in existing.inbox_schemas) throw new ElectricAgentsError(ErrCodeSchemaKeyExists, `Cannot amend existing inbox schema key: ${key}`, 409);
		}
		if (schemas.state_schemas && existing.state_schemas) {
			for (const key of Object.keys(schemas.state_schemas)) if (key in existing.state_schemas) throw new ElectricAgentsError(ErrCodeSchemaKeyExists, `Cannot amend existing state schema key: ${key}`, 409);
		}
		const mergedInbox = schemas.inbox_schemas ? {
			...existing.inbox_schemas ?? {},
			...schemas.inbox_schemas
		} : existing.inbox_schemas;
		const mergedState = schemas.state_schemas ? {
			...existing.state_schemas ?? {},
			...schemas.state_schemas
		} : existing.state_schemas;
		const now = new Date().toISOString();
		const nextRevision = existing.revision + 1;
		const updatedType = {
			name: existing.name,
			description: existing.description,
			creation_schema: existing.creation_schema,
			inbox_schemas: mergedInbox,
			state_schemas: mergedState,
			serve_endpoint: existing.serve_endpoint,
			revision: nextRevision,
			created_at: existing.created_at,
			updated_at: now
		};
		await this.registry.updateEntityTypeInPlace(updatedType);
		return await this.registry.getEntityType(typeName) ?? updatedType;
	}
	/**
	* Enrich webhook payload with entity context.
	* Called by ElectricAgentsServer during webhook forwarding to inject entity context.
	*/
	async enrichPayload(payload, consumer) {
		const entity = await this.registry.getEntityByStream(consumer.primary_stream);
		if (!entity) return payload;
		return {
			...payload,
			entity: {
				type: entity.type,
				status: entity.status,
				url: entity.url,
				streams: entity.streams,
				tags: entity.tags,
				spawnArgs: entity.spawn_args,
				createdBy: entity.created_by
			},
			principal: principalFromCreatedBy(entity.created_by),
			triggerEvent: `inbox`
		};
	}
	validateSchema(schema) {
		if (!schema) return;
		const err = this.validator.validateSchemaSubset(schema);
		if (err) throw new ElectricAgentsError(err.code, err.message, 400);
	}
	validateSchemaMap(schemas) {
		if (!schemas) return;
		for (const schema of Object.values(schemas)) this.validateSchema(schema);
	}
	validateDispatchPolicy(input, opts) {
		try {
			return parseDispatchPolicy(input, opts.label);
		} catch (error) {
			throw new ElectricAgentsError(ErrCodeInvalidRequest, error instanceof Error ? error.message : `Invalid dispatch policy`, 400);
		}
	}
	validateTags(input) {
		try {
			return assertTags(input);
		} catch (error) {
			throw new ElectricAgentsError(ErrCodeInvalidRequest, error instanceof Error ? error.message : `Invalid tags`, 400);
		}
	}
	async validateSendRequest(entityUrl, req) {
		const entity = await this.registry.getEntity(entityUrl);
		if (!entity) throw new ElectricAgentsError(ErrCodeNotFound, `Entity not found`, 404);
		if (entity.status === `stopped`) throw new ElectricAgentsError(ErrCodeNotRunning, `Entity is stopped`, 409);
		if (req.type && entity.type) {
			const { inboxSchemas } = await this.getEffectiveSchemas(entity);
			if (inboxSchemas) {
				const schema = inboxSchemas[req.type];
				if (!schema) throw new ElectricAgentsError(ErrCodeUnknownMessageType, `Unknown message type "${req.type}"`, 422);
				const valErr = this.validator.validate(schema, req.payload);
				if (valErr) throw new ElectricAgentsError(valErr.code, valErr.message, 422, valErr.details);
			}
		}
		if (!req.from) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Missing required field: from`, 400);
		if (entity.type === `principal` && req.type === `update_identity` && !isBuiltInSystemPrincipalUrl(req.from)) throw new ElectricAgentsError(ErrCodeUnauthorized, `Only built-in system principals can update principal identity`, 403);
		if (req.payload === void 0) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Missing required field: payload`, 400);
		return entity;
	}
	async getEffectiveSchemas(entity) {
		if (!entity.type) return {
			inboxSchemas: entity.inbox_schemas,
			stateSchemas: entity.state_schemas
		};
		const latestType = await this.registry.getEntityType(entity.type);
		return {
			inboxSchemas: latestType?.inbox_schemas ? {
				...entity.inbox_schemas ?? {},
				...latestType.inbox_schemas
			} : entity.inbox_schemas,
			stateSchemas: latestType?.state_schemas ? {
				...entity.state_schemas ?? {},
				...latestType.state_schemas
			} : entity.state_schemas
		};
	}
	isClosedStreamError(err) {
		if (!(err instanceof Error)) return false;
		const status$1 = `status` in err ? err.status : void 0;
		return status$1 === 409 && /Stream is closed/i.test(err.message) || /Stream append failed:\s*409\s+Stream is closed/i.test(err.message) || /HTTP Error 409\b.*Stream is closed/i.test(err.message);
	}
	/**
	* Ensure a virtual cron stream exists and schedule its next tick.
	* Returns the stream path (e.g. `/_cron/<base64url>`).
	*/
	async getOrCreateCronStream(expression, timezone) {
		if (!this.scheduler) throw new Error(`Scheduler not configured`);
		const spec = resolveCronScheduleSpec(expression, timezone);
		const streamPath = getCronStreamPath(spec.expression, spec.timezone);
		const exists = await this.streamClient.exists(streamPath);
		if (!exists) await this.streamClient.create(streamPath, { contentType: `application/json` });
		const fireAt = getNextCronFireAt(spec.expression, spec.timezone);
		await this.scheduler.enqueueCronTick(spec.expression, spec.timezone, 0, streamPath, fireAt);
		return streamPath;
	}
	async shutdown() {
		if (this.stopWakeRegistryOnShutdown) await this.wakeRegistry.stopSync();
		this.registry.close();
	}
};
var ElectricAgentsError = class extends Error {
	details;
	constructor(code, message, status$1, details) {
		super(message);
		this.code = code;
		this.status = status$1;
		this.name = `ElectricAgentsError`;
		if (details !== void 0) this.details = details;
	}
};

//#endregion
//#region src/routing/dispatch-policy.ts
function subscriptionIdForDispatchTarget(target) {
	if (target.subscription_id) return target.subscription_id;
	if (target.type === `runner`) return `runner:${target.runnerId}`;
	const digest = createHash(`sha256`).update(target.url).digest(`hex`);
	return `webhook:${digest.slice(0, 16)}`;
}
function subscriptionIdForEntityDispatchTarget(target, entityUrl) {
	const base = subscriptionIdForDispatchTarget(target);
	if (!target.subscription_id) return base;
	const digest = createHash(`sha256`).update(entityUrl).digest(`hex`);
	return `${base}:${digest.slice(0, 16)}`;
}
async function resolveEffectiveDispatchPolicyForSpawn(ctx, typeName, opts) {
	if (opts.dispatchPolicy) return opts.dispatchPolicy;
	const entityType = await ctx.entityManager.registry.getEntityType(typeName);
	if (opts.parent) {
		const parent = await ctx.entityManager.registry.getEntity(opts.parent);
		if (parent?.dispatch_policy) return applyTypeDefaultSubscriptionScope(parent.dispatch_policy, entityType?.default_dispatch_policy);
	}
	return entityType?.default_dispatch_policy;
}
async function resolveEffectiveDispatchPolicyForEntity(ctx, entity) {
	if (entity.dispatch_policy) return entity.dispatch_policy;
	const entityType = await ctx.entityManager.registry.getEntityType(entity.type);
	return entityType?.default_dispatch_policy;
}
async function backfillEntityDispatchPolicy(ctx, entity) {
	if (entity.dispatch_policy) return entity;
	const dispatchPolicy = await resolveEffectiveDispatchPolicyForEntity(ctx, entity);
	if (!dispatchPolicy) return entity;
	return await ctx.entityManager.registry.updateEntityDispatchPolicy(entity.url, dispatchPolicy) ?? {
		...entity,
		dispatch_policy: dispatchPolicy
	};
}
function applyTypeDefaultSubscriptionScope(policy, typeDefault) {
	const target = policy.targets[0];
	const defaultTarget = typeDefault?.targets[0];
	if (!target || !defaultTarget?.subscription_id) return policy;
	if (!sameDispatchDestination(target, defaultTarget)) return policy;
	if (target.subscription_id === defaultTarget.subscription_id) return policy;
	return { targets: [{
		...target,
		subscription_id: defaultTarget.subscription_id
	}] };
}
function sameDispatchDestination(a, b) {
	if (a.type !== b.type) return false;
	if (a.type === `runner` && b.type === `runner`) return a.runnerId === b.runnerId;
	if (a.type === `webhook` && b.type === `webhook`) return a.url === b.url;
	return false;
}
async function assertDispatchPolicyAllowed(ctx, policy) {
	const target = policy?.targets[0];
	if (!target || target.type !== `runner`) return;
	const runner = await ctx.entityManager.registry.getRunner(target.runnerId);
	if (!runner) throw new ElectricAgentsError(ErrCodeNotFound, `Runner "${target.runnerId}" not found`, 404);
	if (ctx.principal && runner.owner_user_id !== ctx.principal.key) throw new ElectricAgentsError(ErrCodeUnauthorized, `Runner dispatch requires the authenticated owner`, 403);
}
async function linkEntityDispatchSubscription(ctx, entity) {
	const dispatchPolicy = await resolveEffectiveDispatchPolicyForEntity(ctx, entity);
	const target = dispatchPolicy?.targets[0];
	if (!target) return;
	await linkStreamToTargetSubscription(ctx, target, entity);
}
async function unlinkEntityDispatchSubscription(ctx, entity) {
	const dispatchPolicy = await resolveEffectiveDispatchPolicyForEntity(ctx, entity);
	const target = dispatchPolicy?.targets[0];
	if (!target) return;
	const subscriptionId = subscriptionIdForEntityDispatchTarget(target, entity.url);
	await ctx.streamClient.removeSubscriptionStream(subscriptionId, entity.streams.main).catch((err) => {
		serverLog.warn(`[dispatch-policy] failed to remove stream from subscription`, {
			subscriptionId,
			stream: entity.streams.main
		}, err);
	});
}
async function linkStreamToTargetSubscription(ctx, target, entity) {
	const streamPath = entity.streams.main;
	const subscriptionId = subscriptionIdForEntityDispatchTarget(target, entity.url);
	const existing = await ctx.streamClient.getSubscription(subscriptionId);
	if (target.type === `runner`) {
		const runner = await ctx.entityManager.registry.getRunner(target.runnerId);
		if (!runner) throw new ElectricAgentsError(ErrCodeNotFound, `Runner "${target.runnerId}" not found`, 404);
		const wakeStream = runner.wake_stream || runnerWakeStream(target.runnerId);
		await ctx.streamClient.ensure(wakeStream, { contentType: `application/json` });
		if (!existing) {
			await ctx.streamClient.putSubscription(subscriptionId, {
				type: `pull-wake`,
				streams: [streamPath],
				wake_stream: wakeStream,
				description: `Electric Agents runner ${target.runnerId}`
			});
			return;
		}
		await ctx.streamClient.addSubscriptionStreams(subscriptionId, [streamPath]);
		return;
	}
	const webhookUrl = rewriteLoopbackWebhookUrl(target.url);
	if (!webhookUrl) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Webhook dispatch target must include a valid URL`, 400);
	const forwardUrl = appendPathToUrl(ctx.publicUrl, `/_electric/webhook-forward/${encodeURIComponent(subscriptionId)}`);
	if (!existing) await ctx.streamClient.putSubscription(subscriptionId, {
		type: `webhook`,
		streams: [streamPath],
		webhook: { url: forwardUrl },
		description: `Electric Agents webhook ${subscriptionId}`
	});
	else await ctx.streamClient.addSubscriptionStreams(subscriptionId, [streamPath]);
	await ctx.pgDb.insert(subscriptionWebhooks).values({
		tenantId: ctx.service,
		subscriptionId,
		webhookUrl
	}).onConflictDoUpdate({
		target: [subscriptionWebhooks.tenantId, subscriptionWebhooks.subscriptionId],
		set: { webhookUrl }
	});
}

//#endregion
//#region src/routing/entities-router.ts
const stringRecordSchema = Type.Record(Type.String(), Type.String());
function writeTokenFromRequest(request) {
	const electricClaimToken = request.headers.get(`electric-claim-token`)?.trim();
	if (electricClaimToken) return electricClaimToken;
	return request.headers.get(`authorization`)?.replace(/^Bearer\s+/i, ``).trim() ?? ``;
}
const wakeConditionSchema = Type.Union([Type.Literal(`runFinished`), Type.Object({
	on: Type.Literal(`change`),
	collections: Type.Optional(Type.Array(Type.String())),
	ops: Type.Optional(Type.Array(Type.Union([
		Type.Literal(`insert`),
		Type.Literal(`update`),
		Type.Literal(`delete`)
	])))
})]);
const spawnBodySchema = Type.Object({
	args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	tags: Type.Optional(stringRecordSchema),
	parent: Type.Optional(Type.String()),
	dispatch_policy: Type.Optional(dispatchPolicySchema),
	initialMessage: Type.Optional(Type.Unknown()),
	wake: Type.Optional(Type.Object({
		subscriberUrl: Type.String(),
		condition: wakeConditionSchema,
		debounceMs: Type.Optional(Type.Number()),
		timeoutMs: Type.Optional(Type.Number()),
		includeResponse: Type.Optional(Type.Boolean())
	}))
});
const sendBodySchema = Type.Object({
	payload: Type.Optional(Type.Unknown()),
	key: Type.Optional(Type.String()),
	type: Type.Optional(Type.String()),
	mode: Type.Optional(Type.Union([
		Type.Literal(`immediate`),
		Type.Literal(`queued`),
		Type.Literal(`paused`),
		Type.Literal(`steer`)
	])),
	position: Type.Optional(Type.String()),
	afterMs: Type.Optional(Type.Number()),
	from: Type.Optional(Type.String())
});
const inboxMessageBodySchema = Type.Object({
	payload: Type.Optional(Type.Unknown()),
	position: Type.Optional(Type.String()),
	mode: Type.Optional(Type.Union([
		Type.Literal(`immediate`),
		Type.Literal(`queued`),
		Type.Literal(`paused`),
		Type.Literal(`steer`)
	])),
	status: Type.Optional(Type.Union([
		Type.Literal(`pending`),
		Type.Literal(`processed`),
		Type.Literal(`cancelled`)
	]))
});
const forkBodySchema = Type.Object({
	instance_id: Type.Optional(Type.String()),
	waitTimeoutMs: Type.Optional(Type.Number())
});
const setTagBodySchema = Type.Object({ value: Type.String() });
const scheduleBodySchema = Type.Union([Type.Object({
	scheduleType: Type.Literal(`cron`),
	expression: Type.String(),
	timezone: Type.Optional(Type.String()),
	payload: Type.Unknown(),
	debounceMs: Type.Optional(Type.Number()),
	timeoutMs: Type.Optional(Type.Number())
}), Type.Object({
	scheduleType: Type.Literal(`future_send`),
	payload: Type.Unknown(),
	targetUrl: Type.Optional(Type.String()),
	fireAt: Type.String(),
	messageType: Type.Optional(Type.String()),
	from: Type.Optional(Type.String())
})]);
const entitiesRegisterBodySchema = Type.Object({ tags: Type.Optional(stringRecordSchema) });
const entitiesRouter = Router({ base: `/_electric/entities` });
entitiesRouter.get(`/`, listEntities);
entitiesRouter.post(`/register`, withSchema(entitiesRegisterBodySchema), registerEntitiesSource);
entitiesRouter.put(`/:type/:instanceId`, withSpawnableEntityType, withSchema(spawnBodySchema), spawnEntity);
entitiesRouter.get(`/:type/:instanceId`, withExistingEntity, getEntity);
entitiesRouter.head(`/:type/:instanceId`, withExistingEntity, headEntity);
entitiesRouter.delete(`/:type/:instanceId`, withExistingEntity, killEntity);
entitiesRouter.post(`/:type/:instanceId/send`, withExistingEntity, withSchema(sendBodySchema), sendEntity);
entitiesRouter.patch(`/:type/:instanceId/inbox/:messageKey`, withExistingEntity, withSchema(inboxMessageBodySchema), updateInboxMessage);
entitiesRouter.delete(`/:type/:instanceId/inbox/:messageKey`, withExistingEntity, deleteInboxMessage);
entitiesRouter.post(`/:type/:instanceId/fork`, withExistingEntity, withSchema(forkBodySchema), forkEntity);
entitiesRouter.post(`/:type/:instanceId/tags/:tagKey`, withExistingEntity, withSchema(setTagBodySchema), setTag);
entitiesRouter.delete(`/:type/:instanceId/tags/:tagKey`, withExistingEntity, removeTag);
entitiesRouter.put(`/:type/:instanceId/schedules/:scheduleId`, withExistingEntity, withSchema(scheduleBodySchema), upsertSchedule);
entitiesRouter.delete(`/:type/:instanceId/schedules/:scheduleId`, withExistingEntity, deleteSchedule);
function entityUrlFromSegments(type, instanceId) {
	if (!type || !instanceId) return null;
	if (type.startsWith(`_`) || type.includes(`*`) || instanceId.includes(`*`)) return null;
	if (type === `principal`) try {
		return principalUrl(decodeURIComponent(instanceId));
	} catch {
		return null;
	}
	return `/${type}/${instanceId}`;
}
function firstQueryValue$1(value) {
	return Array.isArray(value) ? value[0] : value;
}
function requireExistingEntityRoute(request) {
	if (!request.entityRoute) throw new Error(`existing entity middleware did not run`);
	return request.entityRoute;
}
function rejectPrincipalEntityMutation(request, action) {
	const { entity } = requireExistingEntityRoute(request);
	if (entity.type !== `principal`) return void 0;
	return apiError(400, ErrCodeInvalidRequest, `Principal entities are built in and cannot be ${action}`);
}
async function withExistingEntity(request, ctx) {
	const entityUrl = entityUrlFromSegments(request.params.type, request.params.instanceId);
	if (!entityUrl) return void 0;
	const entity = await ctx.entityManager.registry.getEntity(entityUrl);
	if (!entity) {
		const entityType = await ctx.entityManager.registry.getEntityType(request.params.type);
		if (request.params.type === `principal`) try {
			const materialized = await ctx.entityManager.ensurePrincipal(parsePrincipalKey(decodeURIComponent(request.params.instanceId)));
			request.entityRoute = {
				entityUrl,
				entity: materialized
			};
			return void 0;
		} catch (error) {
			return apiError(400, ErrCodeInvalidRequest, error instanceof Error ? error.message : `Invalid principal`);
		}
		if (entityType) return apiError(404, ErrCodeNotFound, `Entity not found at ${entityUrl}`);
		return apiError(404, ErrCodeUnknownEntityType, `Entity type "${request.params.type}" not found`);
	}
	request.entityRoute = {
		entityUrl,
		entity
	};
	return void 0;
}
async function withSpawnableEntityType(request, ctx) {
	if (!entityUrlFromSegments(request.params.type, request.params.instanceId)) return void 0;
	if (request.params.type === `principal`) return apiError(400, ErrCodeInvalidRequest, `Principal entities are built in and cannot be spawned directly`);
	const entityType = await ctx.entityManager.registry.getEntityType(request.params.type);
	if (!entityType) return apiError(404, ErrCodeUnknownEntityType, `Entity type "${request.params.type}" not found`);
	return void 0;
}
async function listEntities({ query }, ctx) {
	const { entities: entities$1 } = await ctx.entityManager.registry.listEntities({
		type: firstQueryValue$1(query.type),
		status: firstQueryValue$1(query.status),
		parent: firstQueryValue$1(query.parent),
		created_by: firstQueryValue$1(query.created_by)
	});
	return json(entities$1.map((entity) => toPublicEntity(entity)));
}
async function registerEntitiesSource(request, ctx) {
	const parsed = routeBody(request);
	const result = await ctx.entityManager.registerEntitiesSource(parsed.tags ?? {});
	return json(result);
}
async function upsertSchedule(request, ctx) {
	const principalMutationError = rejectPrincipalEntityMutation(request, `scheduled`);
	if (principalMutationError) return principalMutationError;
	const parsed = routeBody(request);
	const { entityUrl } = requireExistingEntityRoute(request);
	const scheduleId = decodeURIComponent(request.params.scheduleId);
	if (parsed.scheduleType === `cron`) {
		const result = await ctx.entityManager.upsertCronSchedule(entityUrl, {
			id: scheduleId,
			expression: parsed.expression,
			timezone: parsed.timezone,
			payload: parsed.payload,
			debounceMs: parsed.debounceMs,
			timeoutMs: parsed.timeoutMs
		});
		return json(result);
	}
	if (parsed.scheduleType === `future_send`) {
		if (parsed.from !== void 0 && parsed.from !== ctx.principal.url) return apiError(400, ErrCodeInvalidRequest, `Request from must match Electric-Principal`);
		const result = await ctx.entityManager.upsertFutureSendSchedule(entityUrl, {
			id: scheduleId,
			payload: parsed.payload,
			targetUrl: parsed.targetUrl,
			fireAt: parsed.fireAt,
			senderUrl: ctx.principal.url,
			messageType: parsed.messageType
		});
		return json(result);
	}
	throw new Error(`schedule schema accepted an unknown scheduleType`);
}
async function deleteSchedule(request, ctx) {
	const principalMutationError = rejectPrincipalEntityMutation(request, `unscheduled`);
	if (principalMutationError) return principalMutationError;
	const { entityUrl } = requireExistingEntityRoute(request);
	const result = await ctx.entityManager.deleteSchedule(entityUrl, { id: decodeURIComponent(request.params.scheduleId) });
	return json(result);
}
async function setTag(request, ctx) {
	const principalMutationError = rejectPrincipalEntityMutation(request, `tagged`);
	if (principalMutationError) return principalMutationError;
	const parsed = routeBody(request);
	const { entityUrl } = requireExistingEntityRoute(request);
	const token = writeTokenFromRequest(request);
	const updated = await ctx.entityManager.setTag(entityUrl, decodeURIComponent(request.params.tagKey), { value: parsed.value }, token);
	return json(toPublicEntity(updated));
}
async function removeTag(request, ctx) {
	const principalMutationError = rejectPrincipalEntityMutation(request, `untagged`);
	if (principalMutationError) return principalMutationError;
	const { entityUrl } = requireExistingEntityRoute(request);
	const token = writeTokenFromRequest(request);
	const updated = await ctx.entityManager.removeTag(entityUrl, decodeURIComponent(request.params.tagKey), token);
	return json(toPublicEntity(updated));
}
async function forkEntity(request, ctx) {
	const principalMutationError = rejectPrincipalEntityMutation(request, `forked`);
	if (principalMutationError) return principalMutationError;
	const parsed = routeBody(request);
	const { entityUrl, entity } = requireExistingEntityRoute(request);
	await assertDispatchPolicyAllowed(ctx, entity.dispatch_policy);
	const result = await ctx.entityManager.forkSubtree(entityUrl, {
		rootInstanceId: parsed.instance_id,
		waitTimeoutMs: parsed.waitTimeoutMs
	});
	for (const forkedEntity of result.entities) await linkEntityDispatchSubscription(ctx, forkedEntity);
	return json({
		root: toPublicEntity(result.root),
		entities: result.entities.map((entity$1) => toPublicEntity(entity$1))
	}, { status: 201 });
}
async function sendEntity(request, ctx) {
	const parsed = routeBody(request);
	const principal = ctx.principal;
	if (parsed.from !== void 0 && parsed.from !== principal.url) return apiError(400, ErrCodeInvalidRequest, `Request from must match Electric-Principal`);
	await ctx.entityManager.ensurePrincipal(principal);
	const { entityUrl, entity } = requireExistingEntityRoute(request);
	if (!entity.dispatch_policy) {
		const updatedEntity = await backfillEntityDispatchPolicy(ctx, entity);
		await linkEntityDispatchSubscription(ctx, updatedEntity);
	}
	if (parsed.afterMs && parsed.afterMs > 0) await ctx.entityManager.enqueueDelayedSend(entityUrl, {
		from: principal.url,
		payload: parsed.payload,
		key: parsed.key,
		type: parsed.type,
		mode: parsed.mode,
		position: parsed.position
	}, new Date(Date.now() + parsed.afterMs));
	else await ctx.entityManager.send(entityUrl, {
		from: principal.url,
		payload: parsed.payload,
		key: parsed.key,
		type: parsed.type,
		mode: parsed.mode,
		position: parsed.position
	});
	return status(204);
}
async function updateInboxMessage(request, ctx) {
	const parsed = routeBody(request);
	const { entityUrl } = requireExistingEntityRoute(request);
	await ctx.entityManager.updateInboxMessage(entityUrl, decodeURIComponent(request.params.messageKey), parsed);
	return status(204);
}
async function deleteInboxMessage(request, ctx) {
	const { entityUrl } = requireExistingEntityRoute(request);
	await ctx.entityManager.deleteInboxMessage(entityUrl, decodeURIComponent(request.params.messageKey));
	return status(204);
}
async function spawnEntity(request, ctx) {
	const parsed = routeBody(request);
	const principal = ctx.principal;
	await ctx.entityManager.ensurePrincipal(principal);
	const dispatchPolicy = await resolveEffectiveDispatchPolicyForSpawn(ctx, request.params.type, {
		dispatchPolicy: parsed.dispatch_policy,
		parent: parsed.parent
	});
	await assertDispatchPolicyAllowed(ctx, dispatchPolicy);
	const entity = await ctx.entityManager.spawn(request.params.type, {
		instance_id: request.params.instanceId,
		args: parsed.args,
		tags: parsed.tags,
		parent: parsed.parent,
		dispatch_policy: dispatchPolicy,
		initialMessage: void 0,
		wake: parsed.wake,
		created_by: principal.url
	});
	if (parsed.initialMessage !== void 0) await ctx.entityManager.send(entity.url, {
		from: principal.url,
		payload: parsed.initialMessage
	});
	await linkEntityDispatchSubscription(ctx, entity);
	return json({
		...toPublicEntity(entity),
		txid: entity.txid
	}, {
		status: 201,
		headers: { "x-write-token": entity.write_token }
	});
}
function getEntity(request) {
	return json(toPublicEntity(requireExistingEntityRoute(request).entity));
}
function headEntity() {
	return status(200);
}
async function killEntity(request, ctx) {
	const principalMutationError = rejectPrincipalEntityMutation(request, `killed`);
	if (principalMutationError) return principalMutationError;
	const { entityUrl, entity } = requireExistingEntityRoute(request);
	await unlinkEntityDispatchSubscription(ctx, entity);
	const result = await ctx.entityManager.kill(entityUrl);
	ctx.runtime.claimWriteTokens.clearStream(ctx.service, entity.streams.main);
	return json(result);
}

//#endregion
//#region src/routing/entity-types-router.ts
const jsonObjectSchema = Type.Record(Type.String(), Type.Unknown());
const schemaMapSchema = Type.Record(Type.String(), jsonObjectSchema);
const registerEntityTypeBodySchema = Type.Object({
	name: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	creation_schema: Type.Optional(jsonObjectSchema),
	inbox_schemas: Type.Optional(schemaMapSchema),
	state_schemas: Type.Optional(schemaMapSchema),
	input_schemas: Type.Optional(schemaMapSchema),
	output_schemas: Type.Optional(schemaMapSchema),
	serve_endpoint: Type.Optional(Type.String()),
	default_dispatch_policy: Type.Optional(dispatchPolicySchema)
});
const amendEntityTypeSchemasBodySchema = Type.Object({
	input_schemas: Type.Optional(schemaMapSchema),
	output_schemas: Type.Optional(schemaMapSchema),
	inbox_schemas: Type.Optional(schemaMapSchema),
	state_schemas: Type.Optional(schemaMapSchema)
});
const entityTypesRouter = Router({ base: `/_electric/entity-types` });
entityTypesRouter.get(`/`, listEntityTypes);
entityTypesRouter.post(`/`, withSchema(registerEntityTypeBodySchema), registerEntityType);
entityTypesRouter.patch(`/:name/schemas`, withSchema(amendEntityTypeSchemasBodySchema), amendSchemas);
entityTypesRouter.get(`/:name`, getEntityType);
entityTypesRouter.delete(`/:name`, deleteEntityType);
async function registerEntityType(request, ctx) {
	const parsed = routeBody(request);
	const normalized = normalizeEntityTypeRequest(parsed);
	if (normalized.serve_endpoint && !normalized.description && !normalized.creation_schema) return await discoverServeEndpoint(ctx, normalized);
	const entityType = await ctx.entityManager.registerEntityType(normalized);
	return json(toPublicEntityType(entityType), { status: 201 });
}
async function listEntityTypes(_request, ctx) {
	const entityTypes$1 = await ctx.entityManager.registry.listEntityTypes();
	return json(entityTypes$1.map((entityType) => toPublicEntityType(entityType)));
}
async function discoverServeEndpoint(ctx, parsed) {
	try {
		const response = await fetch(parsed.serve_endpoint, { method: `PUT` });
		if (!response.ok) return apiError(502, ErrCodeServeEndpointUnreachable, `Serve endpoint returned status ${response.status}`);
		const manifest = await response.json();
		if (manifest.name !== parsed.name) return apiError(400, ErrCodeServeEndpointNameMismatch, `Serve endpoint returned name "${manifest.name}" but expected "${parsed.name}"`);
		manifest.serve_endpoint = parsed.serve_endpoint;
		const entityType = await ctx.entityManager.registerEntityType(normalizeEntityTypeRequest(manifest));
		return json(toPublicEntityType(entityType), { status: 201 });
	} catch (err) {
		if (err instanceof ElectricAgentsError) throw err;
		return apiError(502, ErrCodeServeEndpointUnreachable, `Failed to reach serve endpoint: ${err instanceof Error ? err.message : String(err)}`);
	}
}
async function getEntityType(request, ctx) {
	const entityType = await ctx.entityManager.registry.getEntityType(request.params.name);
	if (!entityType) return apiError(404, ErrCodeNotFound, `Entity type not found`);
	return json(toPublicEntityType(entityType));
}
async function amendSchemas(request, ctx) {
	const parsed = routeBody(request);
	const updated = await ctx.entityManager.amendSchemas(request.params.name, {
		inbox_schemas: parsed.inbox_schemas ?? parsed.input_schemas,
		state_schemas: parsed.state_schemas ?? parsed.output_schemas
	});
	return json(toPublicEntityType(updated));
}
async function deleteEntityType(request, ctx) {
	await ctx.entityManager.deleteEntityType(request.params.name);
	return status(204);
}
function normalizeEntityTypeRequest(parsed) {
	const serveEndpoint = rewriteLoopbackWebhookUrl(parsed.serve_endpoint);
	const compatibilityFields = parsed;
	return {
		name: parsed.name ?? ``,
		description: parsed.description ?? ``,
		creation_schema: parsed.creation_schema,
		inbox_schemas: parsed.inbox_schemas ?? compatibilityFields.input_schemas,
		state_schemas: parsed.state_schemas ?? compatibilityFields.output_schemas,
		serve_endpoint: serveEndpoint,
		default_dispatch_policy: parsed.default_dispatch_policy ?? (serveEndpoint ? { targets: [{
			type: `webhook`,
			url: serveEndpoint
		}] } : void 0)
	};
}
function toPublicEntityType(entityType) {
	return {
		...entityType,
		input_schemas: entityType.inbox_schemas,
		output_schemas: entityType.state_schemas,
		revision: entityType.revision
	};
}

//#endregion
//#region src/routing/hooks.ts
const SPAN_KEY = Symbol(`agents-server.otel-span`);
function headersRecord(headers) {
	const out = {};
	headers.forEach((value, key) => {
		out[key] = value;
	});
	return out;
}
function carrier(req) {
	return req;
}
function startRequestSpan(req, ctx) {
	const existing = carrier(req)[SPAN_KEY];
	if (existing) return existing;
	const url = new URL(req.url);
	const parentCtx = extractTraceContext(headersRecord(req.headers));
	const span = tracer.startSpan(`HTTP ${req.method}`, {
		kind: SpanKind.SERVER,
		attributes: {
			[ATTR.HTTP_METHOD]: req.method,
			[ATTR.HTTP_ROUTE]: url.pathname,
			"electric_agents.tenant_id": ctx.service
		}
	}, parentCtx);
	carrier(req)[SPAN_KEY] = span;
	return span;
}
function otelStartSpan(req, ctx) {
	startRequestSpan(req, ctx);
	return void 0;
}
function otelEndSpan(response, req) {
	const span = carrier(req)[SPAN_KEY];
	if (!span) return;
	if (response) span.setAttribute(ATTR.HTTP_STATUS, response.status);
	span.end();
	carrier(req)[SPAN_KEY] = void 0;
}
function applyCors(response) {
	if (!response) return response;
	const headers = new Headers(response.headers);
	headers.set(`access-control-allow-origin`, `*`);
	headers.set(`access-control-allow-methods`, `GET, POST, PUT, PATCH, DELETE, OPTIONS`);
	headers.set(`access-control-allow-headers`, `content-type, authorization, electric-claim-token, ngrok-skip-browser-warning`);
	headers.set(`access-control-expose-headers`, `*`);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
function preflightCors(req) {
	if (req.method !== `OPTIONS`) return void 0;
	return new Response(null, { status: 204 });
}
function errorMapper(err, req) {
	const span = carrier(req)[SPAN_KEY];
	if (err instanceof Error) {
		span?.recordException(err);
		span?.setStatus({
			code: SpanStatusCode.ERROR,
			message: err.message
		});
	}
	if (err instanceof ElectricAgentsError) return apiError(err.status, err.code, err.message, err.details);
	serverLog.error(`[agent-server] Unhandled error:`, err);
	return apiError(500, `INTERNAL_SERVER_ERROR`, `Internal server error`);
}
function rejectIfShuttingDown(req, ctx) {
	if (!ctx.isShuttingDown()) return void 0;
	const path$1 = new URL(req.url).pathname;
	if (!path$1.startsWith(`/_electric/webhook-forward/`)) return void 0;
	return apiError(503, `SERVER_STOPPING`, `Server is shutting down`);
}
function getRequestSpan(req) {
	return carrier(req)[SPAN_KEY];
}

//#endregion
//#region src/routing/runners-router.ts
const registerRunnerBodySchema = Type.Object({
	id: Type.String(),
	owner_user_id: Type.Optional(Type.String()),
	label: Type.String(),
	kind: Type.Optional(Type.Union([
		Type.Literal(`local`),
		Type.Literal(`cloud-worker`),
		Type.Literal(`sandbox`),
		Type.Literal(`ci`),
		Type.Literal(`server`)
	])),
	admin_status: Type.Optional(Type.Union([Type.Literal(`enabled`), Type.Literal(`disabled`)])),
	wake_stream: Type.Optional(Type.String())
});
const heartbeatBodySchema = Type.Object({
	lease_ms: Type.Optional(Type.Number()),
	wake_stream_offset: Type.Optional(Type.String()),
	wakeStreamOffset: Type.Optional(Type.String()),
	liveness_lease_expires_at: Type.Optional(Type.String())
});
const claimBodySchema = Type.Object({
	subscription_id: Type.Optional(Type.String()),
	stream: Type.Optional(Type.String()),
	generation: Type.Optional(Type.Number()),
	ts: Type.Optional(Type.Union([Type.String(), Type.Number()]))
}, { additionalProperties: true });
const runnersRouter = Router({ base: `/_electric/runners` });
runnersRouter.post(`/`, withSchema(registerRunnerBodySchema), registerRunner);
runnersRouter.get(`/`, listRunners);
runnersRouter.get(`/:id`, getRunner);
runnersRouter.post(`/:id/heartbeat`, withSchema(heartbeatBodySchema), heartbeat);
runnersRouter.post(`/:id/enable`, setEnabled);
runnersRouter.post(`/:id/disable`, setDisabled);
runnersRouter.post(`/:id/claim`, withSchema(claimBodySchema), claimWake);
function routeParam$1(request, name) {
	const value = request.params[name];
	return decodeURIComponent(Array.isArray(value) ? value[0] : value);
}
function firstQueryValue(value) {
	return Array.isArray(value) ? value[0] : value;
}
async function registerRunner(request, ctx) {
	const parsed = routeBody(request);
	const ownerUserId = parsed.owner_user_id ?? ctx.principal?.key;
	if (!ownerUserId) throw new ElectricAgentsError(ErrCodeInvalidRequest, `owner_user_id is required when no authenticated user is present`, 400);
	if (ctx.principal && ownerUserId !== ctx.principal.key) throw new ElectricAgentsError(ErrCodeUnauthorized, `owner_user_id must match the authenticated user`, 403);
	const runner = await ctx.entityManager.registry.createRunner({
		id: parsed.id,
		ownerUserId,
		label: parsed.label,
		kind: parsed.kind,
		adminStatus: parsed.admin_status,
		wakeStream: parsed.wake_stream
	});
	await ctx.streamClient.ensure(runner.wake_stream, { contentType: `application/json` });
	return json(runner, { status: 201 });
}
async function listRunners(request, ctx) {
	const requestedOwner = firstQueryValue(request.query.owner_user_id);
	if (ctx.principal && requestedOwner && requestedOwner !== ctx.principal.key) throw new ElectricAgentsError(ErrCodeUnauthorized, `owner_user_id must match the authenticated user`, 403);
	const runners$1 = await ctx.entityManager.registry.listRunners({ ownerUserId: ctx.principal?.key ?? requestedOwner });
	return json(runners$1);
}
async function getRunner(request, ctx) {
	const runner = await requireRunner(ctx, routeParam$1(request, `id`));
	assertRunnerOwnerIfAuthenticated(ctx, runner.owner_user_id);
	return json(runner);
}
async function heartbeat(request, ctx) {
	const runnerId = routeParam$1(request, `id`);
	const existing = await requireRunner(ctx, runnerId);
	assertRunnerOwnerIfAuthenticated(ctx, existing.owner_user_id);
	const parsed = routeBody(request);
	const runner = await ctx.entityManager.registry.heartbeatRunner({
		runnerId,
		leaseMs: parsed.lease_ms,
		wakeStreamOffset: parsed.wake_stream_offset ?? parsed.wakeStreamOffset,
		livenessLeaseExpiresAt: parsed.liveness_lease_expires_at ? new Date(parsed.liveness_lease_expires_at) : void 0
	});
	if (!runner) throw new ElectricAgentsError(ErrCodeNotFound, `Runner not found`, 404);
	return json(runner);
}
async function setEnabled(request, ctx) {
	return await setRunnerStatus(request, ctx, `enabled`);
}
async function setDisabled(request, ctx) {
	return await setRunnerStatus(request, ctx, `disabled`);
}
async function setRunnerStatus(request, ctx, adminStatus) {
	const runnerId = routeParam$1(request, `id`);
	const existing = await requireRunner(ctx, runnerId);
	assertRunnerOwnerIfAuthenticated(ctx, existing.owner_user_id);
	const runner = await ctx.entityManager.registry.setRunnerAdminStatus(runnerId, adminStatus);
	if (!runner) throw new ElectricAgentsError(ErrCodeNotFound, `Runner not found`, 404);
	return json(runner);
}
async function claimWake(request, ctx) {
	const runnerId = routeParam$1(request, `id`);
	const runner = await requireRunner(ctx, runnerId);
	if (ctx.principal && runner.owner_user_id !== ctx.principal.key) throw new ElectricAgentsError(ErrCodeUnauthorized, `Runner claim requires the authenticated owner`, 403);
	if (runner.admin_status !== `enabled`) throw new ElectricAgentsError(ErrCodeNotRunning, `Runner is disabled`, 409);
	const parsed = routeBody(request);
	const expectedSubscriptionId = subscriptionIdForDispatchTarget({
		type: `runner`,
		runnerId
	});
	const subscriptionId = parsed.subscription_id ?? expectedSubscriptionId;
	if (subscriptionId !== expectedSubscriptionId && !subscriptionId.startsWith(`${expectedSubscriptionId}:`)) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Wake event subscription_id does not match runner`, 400);
	const claim = await ctx.streamClient.claimSubscription(subscriptionId, runnerId).catch((err) => {
		if (isExpectedClaimConflict(err)) return err;
		throw err;
	});
	if (claim instanceof DurableStreamsSubscriptionError) return apiError(claim.status, claim.code ?? `SUBSCRIPTION_CLAIM_FAILED`, claim.errorMessage ?? claim.body);
	if (!claim) return status(204);
	const notification = await notificationFromClaim(ctx, {
		runnerId,
		runnerWakeStream: runner.wake_stream,
		subscriptionId,
		claim
	});
	return json(notification);
}
function isExpectedClaimConflict(err) {
	return err instanceof DurableStreamsSubscriptionError && err.status === 409 && (err.code === `NO_PENDING_WORK` || err.code === `ALREADY_CLAIMED`);
}
async function requireRunner(ctx, runnerId) {
	const runner = await ctx.entityManager.registry.getRunner(runnerId);
	if (!runner) throw new ElectricAgentsError(ErrCodeNotFound, `Runner not found`, 404);
	return runner;
}
function assertRunnerOwnerIfAuthenticated(ctx, ownerUserId) {
	if (!ctx.principal) return;
	if (ownerUserId === ctx.principal.key) return;
	throw new ElectricAgentsError(ErrCodeUnauthorized, `Runner access requires the authenticated owner`, 403);
}
async function notificationFromClaim(ctx, input) {
	const primary = input.claim.streams.find((stream) => stream.has_pending === true) ?? input.claim.streams[0];
	if (!primary?.path) throw new ElectricAgentsError(ErrCodeInvalidRequest, `Claim response did not include a stream`, 502);
	const primaryStream = withLeadingSlash(primary.path);
	const entity = await ctx.entityManager.registry.getEntityByStream(primaryStream);
	if (!entity) throw new ElectricAgentsError(ErrCodeNotFound, `Claim stream is not attached to an entity`, 404);
	if (entity.status === `stopped`) {
		await ctx.streamClient.releaseSubscription(input.subscriptionId, input.claim.token, {
			wake_id: input.claim.wake_id,
			generation: input.claim.generation
		});
		return { done: true };
	}
	await ctx.pgDb.insert(consumerCallbacks).values({
		tenantId: ctx.service,
		consumerId: input.claim.wake_id,
		callbackUrl: `ds-subscription:${input.subscriptionId}`,
		primaryStream
	}).onConflictDoUpdate({
		target: [consumerCallbacks.tenantId, consumerCallbacks.consumerId],
		set: {
			callbackUrl: `ds-subscription:${input.subscriptionId}`,
			primaryStream
		}
	});
	await ctx.entityManager.registry.materializeActiveClaim({
		consumerId: input.claim.wake_id,
		epoch: input.claim.generation,
		wakeId: input.claim.wake_id,
		entityUrl: entity.url,
		streamPath: primaryStream,
		runnerId: input.runnerId,
		leaseExpiresAt: input.claim.lease_ttl_ms ? new Date(Date.now() + input.claim.lease_ttl_ms) : void 0
	});
	await ctx.entityManager.registry.updateStatus(entity.url, `running`);
	const streams$1 = input.claim.streams.map((stream) => ({
		path: withLeadingSlash(stream.path),
		offset: stream.tail_offset ?? ``
	}));
	return {
		consumerId: input.claim.wake_id,
		epoch: input.claim.generation,
		wakeId: input.claim.wake_id,
		streamPath: primaryStream,
		streams: streams$1,
		callback: appendPathToUrl(ctx.publicUrl, `/_electric/callback-forward/${encodeURIComponent(input.claim.wake_id)}`),
		claimToken: input.claim.token,
		triggerEvent: `message_received`,
		entity: {
			type: entity.type,
			status: entity.status,
			url: entity.url,
			streams: entity.streams,
			tags: entity.tags,
			spawnArgs: entity.spawn_args,
			createdBy: entity.created_by
		},
		principal: principalFromCreatedBy(entity.created_by)
	};
}

//#endregion
//#region src/routing/internal-router.ts
const wakeRegistrationBodySchema = Type.Object({
	subscriberUrl: Type.String(),
	sourceUrl: Type.String(),
	condition: Type.Union([Type.Literal(`runFinished`), Type.Object({
		on: Type.Literal(`change`),
		collections: Type.Optional(Type.Array(Type.String())),
		ops: Type.Optional(Type.Array(Type.Union([
			Type.Literal(`insert`),
			Type.Literal(`update`),
			Type.Literal(`delete`)
		])))
	})]),
	debounceMs: Type.Optional(Type.Number()),
	timeoutMs: Type.Optional(Type.Number()),
	includeResponse: Type.Optional(Type.Boolean()),
	manifestKey: Type.Optional(Type.String())
});
const webhookForwardBodySchema = Type.Object({
	subscription_id: Type.Optional(Type.String()),
	wake_id: Type.Optional(Type.String()),
	generation: Type.Optional(Type.Number()),
	streams: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
	callback_url: Type.Optional(Type.String()),
	callback_token: Type.Optional(Type.String()),
	primary_stream: Type.Optional(Type.String()),
	primaryStream: Type.Optional(Type.String()),
	streamPath: Type.Optional(Type.String()),
	consumerId: Type.Optional(Type.String()),
	consumer_id: Type.Optional(Type.String()),
	callback: Type.Optional(Type.String())
}, { additionalProperties: true });
const callbackForwardBodySchema = Type.Object({
	epoch: Type.Optional(Type.Number()),
	generation: Type.Optional(Type.Number()),
	wakeId: Type.Optional(Type.String()),
	wake_id: Type.Optional(Type.String()),
	acks: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
	done: Type.Optional(Type.Boolean())
}, { additionalProperties: true });
const DS_SUBSCRIPTION_CALLBACK_PREFIX = `ds-subscription:`;
const internalRouter = Router({ base: `/_electric` });
internalRouter.get(`/health`, () => json({ status: `ok` }));
internalRouter.post(`/wake`, withSchema(wakeRegistrationBodySchema), registerWake);
internalRouter.post(`/webhook-forward/:subscriptionId`, webhookForward);
internalRouter.post(`/callback-forward/:consumerId`, callbackForward);
internalRouter.all(`/runners`, runnersRouter.fetch);
internalRouter.all(`/runners/*`, runnersRouter.fetch);
internalRouter.all(`/entities/*`, entitiesRouter.fetch);
internalRouter.all(`/entity-types/*`, entityTypesRouter.fetch);
internalRouter.all(`/cron/*`, cronRouter.fetch);
internalRouter.get(`/electric/*`, electricProxyRouter.fetch);
internalRouter.all(`*`, () => status(404));
function routeParam(request, name) {
	const value = request.params[name];
	return decodeURIComponent(Array.isArray(value) ? value[0] : value);
}
function bodyFromBytes(body) {
	return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
}
function responseFromUpstream(response, body) {
	return new Response(body ? bodyFromBytes(body) : response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: responseHeaders(response)
	});
}
function forwardHeadersFromRequest(request) {
	const headers = new Headers(request.headers);
	headers.delete(`host`);
	return headers;
}
function durableStreamsSubscriptionCallback(value) {
	return value.startsWith(DS_SUBSCRIPTION_CALLBACK_PREFIX) ? value.slice(DS_SUBSCRIPTION_CALLBACK_PREFIX.length) : null;
}
function claimTokenFromRequest(request) {
	const electricClaimToken = request.headers.get(`electric-claim-token`)?.trim();
	if (electricClaimToken) return electricClaimToken;
	return request.headers.get(`authorization`)?.replace(/^Bearer\s+/i, ``).trim() || void 0;
}
function newWebhookPayload(body) {
	if (!body || typeof body.subscription_id !== `string` || typeof body.wake_id !== `string` || typeof body.generation !== `number` || typeof body.callback_url !== `string` || typeof body.callback_token !== `string` || !Array.isArray(body.streams)) return null;
	const streamInfos = body.streams;
	const firstStream = streamInfos.find((stream) => stream?.has_pending === true) ?? streamInfos[0];
	const selectedStream = firstStream;
	if (typeof selectedStream?.path !== `string` || typeof selectedStream.tail_offset !== `string`) return null;
	return {
		wakeId: body.wake_id,
		generation: body.generation,
		primaryStream: withLeadingSlash(selectedStream.path),
		tailOffset: selectedStream.tail_offset,
		callbackUrl: body.callback_url,
		callbackToken: body.callback_token
	};
}
function toRuntimeStreamPath(path$1, service, routingAdapter) {
	return withLeadingSlash(routingAdapter.toRuntimeStreamPath(service, path$1));
}
async function registerWake(request, ctx) {
	const opts = routeBody(request);
	await ctx.entityManager.registerWake(opts);
	return status(204);
}
async function webhookForward(request, ctx) {
	const subscriptionId = routeParam(request, `subscriptionId`);
	const rootSpan = getRequestSpan(request);
	rootSpan?.updateName(`webhook-forward`);
	rootSpan?.setAttribute(`electric_agents.webhook.subscription_id`, subscriptionId);
	const lookupPromise = tracer.startActiveSpan(`db.lookupSubscription`, async (span) => {
		try {
			const rows = await ctx.pgDb.select().from(subscriptionWebhooks).where(and(eq(subscriptionWebhooks.tenantId, ctx.service), eq(subscriptionWebhooks.subscriptionId, subscriptionId))).limit(1);
			return rows[0]?.webhookUrl ?? null;
		} finally {
			span.end();
		}
	});
	const [targetWebhookUrl, body] = await Promise.all([lookupPromise, readRequestBody(request)]);
	if (!targetWebhookUrl) return apiError(404, ErrCodeSubscriptionNotFound, `Unknown webhook subscription`);
	const parsedBodyResult = validateOptionalJsonBody(webhookForwardBodySchema, body, request.headers.get(`content-type`));
	if (!parsedBodyResult.ok) return parsedBodyResult.response;
	let forwardBody = body;
	let runningEntityUrl = null;
	const parsedBody = parsedBodyResult.value;
	const newWebhook = newWebhookPayload(parsedBody);
	const routingAdapter = resolveDurableStreamsRoutingAdapter(ctx.durableStreamsRouting);
	if (parsedBody) {
		const rawPrimaryStream = newWebhook?.primaryStream ?? parsedBody.primary_stream ?? parsedBody.primaryStream ?? parsedBody.streamPath ?? null;
		const primaryStream = typeof rawPrimaryStream === `string` ? toRuntimeStreamPath(rawPrimaryStream, ctx.service, routingAdapter) : null;
		const consumerId = newWebhook?.wakeId ?? parsedBody.consumerId ?? parsedBody.consumer_id ?? null;
		const callbackUrl = newWebhook?.callbackUrl ?? parsedBody.callback ?? null;
		if (primaryStream) {
			rootSpan?.setAttribute(ATTR.STREAM_PATH, primaryStream);
			const entityPromise = tracer.startActiveSpan(`db.getEntityByStream`, async (span) => {
				try {
					return await ctx.entityManager.registry.getEntityByStream(primaryStream);
				} finally {
					span.end();
				}
			});
			const enrichPromise = tracer.startActiveSpan(`electric_agents.enrichPayload`, async (span) => {
				try {
					return await ctx.entityManager.enrichPayload(parsedBody, { primary_stream: primaryStream });
				} finally {
					span.end();
				}
			});
			const upsertPromise = consumerId && callbackUrl ? tracer.startActiveSpan(`db.upsertConsumerCallback`, async (span) => {
				try {
					await ctx.pgDb.insert(consumerCallbacks).values({
						tenantId: ctx.service,
						consumerId,
						callbackUrl,
						primaryStream
					}).onConflictDoUpdate({
						target: [consumerCallbacks.tenantId, consumerCallbacks.consumerId],
						set: {
							callbackUrl,
							primaryStream
						}
					});
				} finally {
					span.end();
				}
			}).catch((err) => {
				serverLog.warn(`[webhook-forward] consumerCallbacks upsert failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
			}) : void 0;
			const [entity, enriched] = await Promise.all([entityPromise, enrichPromise]);
			if (entity?.status === `stopped`) {
				if (upsertPromise) await upsertPromise;
				return json({ done: true });
			}
			if (upsertPromise) await upsertPromise;
			if (entity && ctx.entityManager.isForkWorkLockedEntity(entity.url)) return apiError(409, ErrCodeForkInProgress, `Entity subtree is being forked`);
			if (entity) {
				rootSpan?.setAttribute(ATTR.ENTITY_URL, entity.url);
				await tracer.startActiveSpan(`db.updateStatus.running`, async (span) => {
					try {
						await ctx.entityManager.registry.updateStatus(entity.url, `running`);
					} finally {
						span.end();
					}
				});
				runningEntityUrl = entity.url;
			}
			if (consumerId && callbackUrl) {
				const callback = appendPathToUrl(ctx.publicUrl, `/_electric/callback-forward/${encodeURIComponent(consumerId)}`);
				enriched.callback = callback;
				if (newWebhook) {
					enriched.consumerId = newWebhook.wakeId;
					enriched.epoch = newWebhook.generation;
					enriched.wakeId = newWebhook.wakeId;
					enriched.streamPath = primaryStream;
					enriched.streams = [{
						path: primaryStream,
						offset: newWebhook.tailOffset
					}];
					enriched.claimToken = newWebhook.callbackToken;
				}
			}
			forwardBody = new TextEncoder().encode(JSON.stringify(enriched));
		}
	}
	const headers = forwardHeadersFromRequest(request);
	headers.set(`content-type`, `application/json`);
	headers.delete(`content-length`);
	let upstream;
	try {
		upstream = await tracer.startActiveSpan(`fetch.agent-handler`, async (span) => {
			span.setAttribute(`http.url`, targetWebhookUrl);
			try {
				return await fetch(targetWebhookUrl, {
					method: request.method,
					headers,
					body: bodyFromBytes(forwardBody)
				});
			} finally {
				span.end();
			}
		});
	} catch (err) {
		if (runningEntityUrl) await ctx.entityManager.registry.updateStatus(runningEntityUrl, `idle`);
		return apiError(502, `WEBHOOK_FORWARD_FAILED`, err instanceof Error ? err.message : String(err));
	}
	const responseBytes = upstream.body ? new Uint8Array(await upstream.arrayBuffer()) : new Uint8Array();
	return responseFromUpstream(upstream, responseBytes);
}
async function callbackForward(request, ctx) {
	const consumerId = routeParam(request, `consumerId`);
	const rows = await ctx.pgDb.select().from(consumerCallbacks).where(and(eq(consumerCallbacks.tenantId, ctx.service), eq(consumerCallbacks.consumerId, consumerId))).limit(1);
	const target = rows[0] ? {
		callbackUrl: rows[0].callbackUrl,
		primaryStream: rows[0].primaryStream
	} : void 0;
	if (!target) return apiError(404, ErrCodeCallbackNotFound, `Unknown callback-forward consumer`);
	const body = await readRequestBody(request);
	const parsedBodyResult = validateOptionalJsonBody(callbackForwardBodySchema, body, request.headers.get(`content-type`));
	if (!parsedBodyResult.ok) return parsedBodyResult.response;
	const requestBody = parsedBodyResult.value;
	const isClaimRequest = requestBody?.wakeId !== void 0 || requestBody?.wake_id !== void 0;
	const isDoneRequest = requestBody?.done === true;
	const headers = forwardHeadersFromRequest(request);
	headers.delete(`content-length`);
	if (isClaimRequest && !isDoneRequest) {
		let responseBody = { ok: true };
		if (target.primaryStream) {
			const writeToken = await mintClaimWriteToken(ctx, target.primaryStream, consumerId);
			if (writeToken) responseBody = {
				...responseBody,
				writeToken
			};
		}
		return json(responseBody);
	}
	const upstreamBody = encodeCallbackForwardBody(ctx.service, consumerId, requestBody, resolveDurableStreamsRoutingAdapter(ctx.durableStreamsRouting));
	let upstream;
	try {
		const subscriptionId = durableStreamsSubscriptionCallback(target.callbackUrl);
		if (subscriptionId) {
			const token = claimTokenFromRequest(request);
			if (!token) return apiError(401, `UNAUTHORIZED`, `Missing claim token`);
			const upstreamPayload = encodeCallbackForwardPayload(consumerId, requestBody, (stream) => stream.replace(/^\/+/, ``));
			const result = await ctx.streamClient.ackSubscription(subscriptionId, token, upstreamPayload);
			upstream = json(result);
		} else upstream = await fetch(target.callbackUrl, {
			method: request.method,
			headers,
			body: bodyFromBytes(upstreamBody)
		});
	} catch (err) {
		return apiError(502, `CALLBACK_FORWARD_FAILED`, err instanceof Error ? err.message : String(err));
	}
	let responseBytes = upstream.body ? new Uint8Array(await upstream.arrayBuffer()) : new Uint8Array();
	if (isClaimRequest && upstream.ok && target.primaryStream) {
		const responseBody = decodeJsonObject(responseBytes);
		if (responseBody?.ok === true) {
			const writeToken = await mintClaimWriteToken(ctx, target.primaryStream, consumerId);
			if (writeToken) {
				responseBody.writeToken = writeToken;
				responseBytes = new TextEncoder().encode(JSON.stringify(responseBody));
			}
		}
	}
	try {
		const epoch = requestBody?.generation ?? requestBody?.epoch;
		if (upstream.ok && !isDoneRequest && epoch !== void 0 && target.primaryStream) await ctx.entityManager.registry.materializeHeartbeatClaim?.({
			consumerId,
			epoch
		});
		if (upstream.ok && isDoneRequest && target.primaryStream) {
			serverLog.info(`[callback-forward] done received for stream=${target.primaryStream} consumer=${consumerId}`);
			const stillOwnsClaim = ctx.runtime.claimWriteTokens.owns(ctx.service, target.primaryStream, consumerId);
			const entity = await ctx.entityManager.registry.getEntityByStream(target.primaryStream);
			if (entity && stillOwnsClaim) {
				if (epoch !== void 0) await ctx.entityManager.registry.materializeReleasedClaim?.({
					consumerId,
					epoch,
					ackedStreams: Array.isArray(requestBody?.acks) ? requestBody.acks.flatMap((ack) => {
						const stream = typeof ack.stream === `string` ? ack.stream : typeof ack.path === `string` ? ack.path : void 0;
						const offset = typeof ack.offset === `string` ? ack.offset : void 0;
						return stream && offset ? [{
							path: stream,
							offset
						}] : [];
					}) : void 0
				});
				await ctx.entityManager.registry.updateStatus(entity.url, `idle`);
				ctx.runtime.claimWriteTokens.clearStream(ctx.service, target.primaryStream);
				await ctx.entityBridgeManager.onEntityChanged(entity.url);
				serverLog.info(`[callback-forward] status updated to idle for ${entity.url}`);
			} else if (stillOwnsClaim) ctx.runtime.claimWriteTokens.clearStream(ctx.service, target.primaryStream);
			else if (entity) serverLog.info(`[callback-forward] done ignored for stale claim stream=${target.primaryStream} consumer=${consumerId}`);
			else serverLog.warn(`[callback-forward] done received but no entity found for stream=${target.primaryStream}`);
		} else if (requestBody?.done === true) serverLog.warn(`[callback-forward] done received but skipped: upstream.ok=${upstream.ok} primaryStream=${target.primaryStream ?? `null`} consumer=${consumerId}`);
	} catch (err) {
		serverLog.error(`[callback-forward] error processing done for consumer=${consumerId}: ${err instanceof Error ? err.message : String(err)}`);
	}
	return responseFromUpstream(upstream, responseBytes);
}
async function mintClaimWriteToken(ctx, streamPath, consumerId) {
	const entity = await ctx.entityManager.registry.getEntityByStream(streamPath);
	if (!entity) return void 0;
	return ctx.runtime.claimWriteTokens.mint(ctx.service, streamPath, consumerId);
}
function encodeCallbackForwardBody(service, consumerId, body, routingAdapter) {
	const payload = encodeCallbackForwardPayload(consumerId, body, (stream) => routingAdapter.toBackendStreamPath(service, stream));
	return new TextEncoder().encode(JSON.stringify(payload));
}
function encodeCallbackForwardPayload(consumerId, body, mapStream) {
	if (!body) return {};
	const generation = body.generation ?? body.epoch;
	const wakeId = body.wake_id ?? body.wakeId ?? consumerId;
	const acks = Array.isArray(body.acks) ? body.acks.map((ack) => {
		const input = ack;
		const stream = typeof input.stream === `string` ? input.stream : typeof input.path === `string` ? input.path : ``;
		return {
			stream: mapStream(stream),
			offset: typeof input.offset === `string` ? input.offset : ``
		};
	}) : [];
	return {
		wake_id: wakeId,
		...generation !== void 0 ? { generation } : {},
		acks,
		...body.done !== void 0 ? { done: body.done } : {}
	};
}

//#endregion
//#region src/routing/global-router.ts
const globalRouter = AutoRouter({
	before: [
		preflightCors,
		withParams,
		otelStartSpan,
		rejectIfShuttingDown
	],
	catch: errorMapper,
	finally: [otelEndSpan, applyCors]
});
globalRouter.all(`/_electric/shared-state/*`, durableStreamsRouter.fetch);
globalRouter.all(`/_electric/*`, internalRouter.fetch);
globalRouter.all(`*`, durableStreamsRouter.fetch);

//#endregion
//#region src/routing/oss-server-router.ts
const ossServerRouter = AutoRouter({
	before: [preflightCors],
	catch: errorMapper,
	finally: [applyCors]
});
ossServerRouter.get(`/`, redirectToAgentUi);
ossServerRouter.head(`/`, redirectToAgentUi);
ossServerRouter.all(`/__agent_ui/*`, agentUiRouter.fetch);
ossServerRouter.post(`/_electric/mock-agent-handler`, mockAgentHandler);
ossServerRouter.all(`*`, (request, ctx) => globalRouter.fetch(request, ctx));
function redirectToAgentUi() {
	return new Response(null, {
		status: 302,
		headers: { location: `/__agent_ui/` }
	});
}
async function mockAgentHandler(request, ctx) {
	if (!ctx.mockAgent) return status(404);
	return await ctx.mockAgent.runtime.handleWebhookRequest(request);
}

//#endregion
//#region src/entity-bridge-manager.ts
const ENTITY_SHAPE_COLUMNS = [
	`tenant_id`,
	`url`,
	`type`,
	`status`,
	`tags`,
	`spawn_args`,
	`parent`,
	`type_revision`,
	`inbox_schemas`,
	`state_schemas`,
	`created_at`,
	`updated_at`
];
function parseElectricOffset(offset) {
	if (offset === `-1`) return offset;
	return /^\d+_\d+$/.test(offset) ? offset : null;
}
function sameMember(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}
function toMemberRow(entity) {
	return {
		url: entity.url,
		type: entity.type,
		status: entity.status,
		tags: entity.tags,
		spawn_args: entity.spawn_args ?? {},
		parent: entity.parent ?? null,
		type_revision: entity.type_revision ?? null,
		inbox_schemas: entity.inbox_schemas ?? null,
		state_schemas: entity.state_schemas ?? null,
		created_at: entity.created_at,
		updated_at: entity.updated_at
	};
}
function buildTagsWhereClause(tags) {
	const encoded = buildTagsIndex(tags).map((entry) => `'${entry.replace(/'/g, `''`)}'`);
	if (encoded.length === 0) return `TRUE`;
	return `tags_index @> ARRAY[${encoded.join(`, `)}]::text[]`;
}
function sqlStringLiteral$1(value) {
	return `'${value.replace(/'/g, `''`)}'`;
}
function buildTenantTagsWhereClause(tenantId, tags) {
	return `tenant_id = ${sqlStringLiteral$1(tenantId)} AND (${buildTagsWhereClause(tags)})`;
}
function shapeEntityKey(message) {
	return message.value.url;
}
var EntityBridge = class {
	sourceRef;
	tags;
	streamUrl;
	currentMembers = new Map();
	producer = null;
	liveAbortController = null;
	liveUnsubscribe = null;
	stopped = false;
	resyncPromise = null;
	bootstrapState = null;
	constructor(row, registry, streamClient, electricUrl, tenantId, electricSecret) {
		this.registry = registry;
		this.streamClient = streamClient;
		this.electricUrl = electricUrl;
		this.tenantId = tenantId;
		this.electricSecret = electricSecret;
		this.sourceRef = row.sourceRef;
		this.tags = normalizeTags(row.tags);
		this.streamUrl = row.streamUrl;
		this.initialShapeHandle = row.shapeHandle;
		this.initialShapeOffset = row.shapeOffset;
	}
	initialShapeHandle;
	initialShapeOffset;
	async start() {
		await this.ensureStream();
		this.producer = new IdempotentProducer(new DurableStream({
			url: `${this.streamClient.baseUrl}${this.streamUrl}`,
			contentType: `application/json`
		}), `entity-bridge-${this.sourceRef}`, {
			autoClaim: true,
			onError: (error) => {
				serverLog.warn(`[entity-bridge] producer write failed for ${this.sourceRef}:`, error);
			}
		});
		await this.loadCurrentMembers();
		if (this.initialShapeHandle && this.initialShapeOffset) {
			const initialOffset = parseElectricOffset(this.initialShapeOffset);
			if (initialOffset) {
				this.startLiveStream(initialOffset, this.initialShapeHandle);
				return;
			}
		}
		await this.resync(`startup`);
	}
	async stop() {
		this.stopped = true;
		this.stopLiveStream();
		this.clearBootstrapState()?.resolve(`up-to-date`);
		if (this.producer) {
			try {
				await this.producer.flush();
			} catch {}
			await this.producer.detach();
			this.producer = null;
		}
	}
	async requestResync(reason) {
		if (this.stopped) return;
		if (this.resyncPromise) {
			await this.resyncPromise;
			return;
		}
		this.resyncPromise = this.resync(reason).finally(() => {
			this.resyncPromise = null;
		});
		await this.resyncPromise;
	}
	async resync(reason) {
		if (this.stopped) return;
		serverLog.info(`[entity-bridge] resyncing ${this.sourceRef} from shape log bootstrap (${reason})`);
		this.stopLiveStream();
		if (this.producer) try {
			await this.producer.flush();
		} catch {}
		for (;;) {
			await this.loadCurrentMembers();
			const result = await this.startBootstrapStream();
			if (result === `up-to-date`) return;
		}
	}
	async ensureStream() {
		if (!await this.streamClient.exists(this.streamUrl)) await this.streamClient.create(this.streamUrl, { contentType: `application/json` });
	}
	startBootstrapStream() {
		return new Promise((resolve$1, reject) => {
			this.bootstrapState = {
				staleMembers: new Map(this.currentMembers),
				resolve: resolve$1,
				reject
			};
			this.startLiveStream(`-1`);
		});
	}
	finalizeBootstrap() {
		if (!this.bootstrapState) return;
		for (const [url, existing] of this.bootstrapState.staleMembers) {
			this.append(`delete`, existing);
			this.currentMembers.delete(url);
		}
	}
	clearBootstrapState() {
		const state = this.bootstrapState;
		this.bootstrapState = null;
		return state;
	}
	async loadCurrentMembers() {
		this.currentMembers.clear();
		const events = await this.streamClient.readJson(this.streamUrl);
		for (const event of events) {
			if (event.type !== `members` || typeof event.key !== `string`) continue;
			const headers = typeof event.headers === `object` && event.headers !== null ? event.headers : void 0;
			const operation = headers?.operation;
			if (operation === `delete`) {
				this.currentMembers.delete(event.key);
				continue;
			}
			const value = event.value;
			if (value) this.currentMembers.set(event.key, value);
		}
	}
	createShapeStream(opts) {
		return new ShapeStream({
			url: electricUrlWithPath(this.electricUrl, `/v1/shape`).toString(),
			params: {
				table: `entities`,
				where: buildTenantTagsWhereClause(this.tenantId, this.tags),
				...this.electricSecret ? { secret: this.electricSecret } : {},
				columns: [...ENTITY_SHAPE_COLUMNS],
				replica: `full`
			},
			parser: { int8: (value) => Number.parseInt(value, 10) },
			...opts?.offset ? { offset: opts.offset } : {},
			...opts?.handle ? { handle: opts.handle } : {},
			...opts?.signal ? { signal: opts.signal } : {},
			onError: (error) => {
				if (opts?.signal?.aborted) return {};
				serverLog.warn(`[entity-bridge] live shape error for ${this.sourceRef}:`, error);
				return {};
			}
		});
	}
	startLiveStream(offset, handle) {
		if (this.stopped) return;
		const abortController = new AbortController();
		const stream = this.createShapeStream({
			offset,
			handle,
			signal: abortController.signal
		});
		this.liveAbortController = abortController;
		this.liveUnsubscribe = stream.subscribe(async (messages) => {
			let shouldPersistCursor = false;
			let bootstrapResult = null;
			for (const message of messages) {
				if (isControlMessage(message)) {
					if (message.headers.control === `must-refetch`) {
						await this.registry.clearEntityBridgeCursor(this.sourceRef);
						const bootstrapState = this.clearBootstrapState();
						if (bootstrapState) {
							this.stopLiveStream();
							bootstrapResult = `must-refetch`;
							bootstrapState.resolve(`must-refetch`);
							return;
						}
						await this.requestResync(`shape-reset`);
						return;
					}
					if (message.headers.control === `up-to-date` && this.bootstrapState) {
						this.finalizeBootstrap();
						bootstrapResult = `up-to-date`;
					}
					shouldPersistCursor = true;
					continue;
				}
				if (!isChangeMessage(message)) continue;
				this.bootstrapState?.staleMembers.delete(shapeEntityKey(message));
				this.applyChange(message);
				shouldPersistCursor = true;
			}
			if (shouldPersistCursor) await this.persistCursor(stream);
			if (bootstrapResult === `up-to-date`) {
				const bootstrapState = this.clearBootstrapState();
				bootstrapState?.resolve(`up-to-date`);
			}
		}, (error) => {
			const bootstrapState = this.clearBootstrapState();
			if (bootstrapState) bootstrapState.reject(error instanceof Error ? error : new Error(String(error)));
			if (abortController.signal.aborted) return;
			serverLog.warn(`[entity-bridge] live subscription failed for ${this.sourceRef}:`, error);
			this.requestResync(`subscription-error`);
		});
	}
	async persistCursor(stream) {
		const shapeHandle = stream.shapeHandle;
		const shapeOffset = stream.lastOffset;
		if (!shapeHandle || shapeOffset === `-1`) return;
		await this.registry.updateEntityBridgeCursor(this.sourceRef, shapeHandle, shapeOffset);
	}
	stopLiveStream() {
		this.liveUnsubscribe?.();
		this.liveUnsubscribe = null;
		this.liveAbortController?.abort();
		this.liveAbortController = null;
	}
	applyChange(message) {
		const next = toMemberRow(message.value);
		const key = shapeEntityKey(message);
		const existing = this.currentMembers.get(key);
		const operation = message.headers.operation;
		if (operation === `delete`) {
			if (!existing) return;
			this.append(`delete`, existing);
			this.currentMembers.delete(key);
			return;
		}
		if (!existing) {
			this.append(`insert`, next);
			this.currentMembers.set(key, next);
			return;
		}
		if (!sameMember(existing, next)) {
			this.append(`update`, next);
			this.currentMembers.set(key, next);
		}
	}
	append(operation, row) {
		if (!this.producer) throw new Error(`[entity-bridge] producer is not initialized for ${this.sourceRef}`);
		const event = operation === `delete` ? {
			type: `members`,
			key: row.url,
			old_value: row,
			headers: {
				operation,
				timestamp: new Date().toISOString()
			}
		} : {
			type: `members`,
			key: row.url,
			value: row,
			headers: {
				operation,
				timestamp: new Date().toISOString()
			}
		};
		this.producer.append(JSON.stringify(event));
	}
};
var EntityBridgeManager = class {
	bridges = new Map();
	startingBridges = new Map();
	activeReaders = new Map();
	gcTimer = null;
	constructor(registry, streamClient, electricUrl, electricSecret, tenantId = DEFAULT_TENANT_ID) {
		this.registry = registry;
		this.streamClient = streamClient;
		this.electricUrl = electricUrl;
		this.electricSecret = electricSecret;
		this.tenantId = tenantId;
	}
	async start() {
		if (!this.electricUrl || typeof this.registry.listEntityBridges !== `function`) return;
		const rows = await this.registry.listEntityBridges();
		await Promise.all(rows.map(async (row) => {
			try {
				await this.ensureBridge(row);
			} catch (error) {
				serverLog.warn(`[entity-bridge] failed to start ${row.sourceRef}:`, error);
			}
		}));
		this.gcTimer = setInterval(() => {
			this.sweepIdleBridges().catch((error) => {
				serverLog.warn(`[entity-bridge] idle sweep failed:`, error);
			});
		}, 5 * 6e4);
	}
	async stop() {
		if (this.gcTimer) {
			clearInterval(this.gcTimer);
			this.gcTimer = null;
		}
		const bridges = [...this.bridges.values()];
		this.bridges.clear();
		this.startingBridges.clear();
		this.activeReaders.clear();
		await Promise.all(bridges.map(async (bridge) => {
			await bridge.stop();
		}));
	}
	async register(tagsInput) {
		if (!this.electricUrl) throw new Error(`[entity-bridge] Electric URL is required for entities()`);
		const tags = normalizeTags(assertTags(tagsInput));
		const sourceRef = sourceRefForTags(tags);
		const streamUrl = getEntitiesStreamPath(sourceRef);
		const row = await this.registry.upsertEntityBridge({
			sourceRef,
			tags,
			streamUrl
		});
		await this.registry.touchEntityBridge(sourceRef);
		await this.ensureBridge(row);
		return {
			sourceRef,
			streamUrl
		};
	}
	async onEntityChanged(_entityUrl) {}
	async touchByStreamPath(streamPath) {
		const sourceRef = this.sourceRefFromStreamPath(streamPath);
		if (!sourceRef) return;
		await this.touchSourceRef(sourceRef, `head`);
	}
	async beginClientRead(streamPath) {
		const sourceRef = this.sourceRefFromStreamPath(streamPath);
		if (!sourceRef) return null;
		const current = this.activeReaders.get(sourceRef) ?? 0;
		this.activeReaders.set(sourceRef, current + 1);
		await this.touchSourceRef(sourceRef, `read-open`);
		return async () => {
			const remaining = (this.activeReaders.get(sourceRef) ?? 1) - 1;
			if (remaining <= 0) this.activeReaders.delete(sourceRef);
			else this.activeReaders.set(sourceRef, remaining);
			await this.touchSourceRef(sourceRef, `read-close`);
		};
	}
	async ensureBridge(row) {
		if (this.bridges.has(row.sourceRef)) return;
		const starting = this.startingBridges.get(row.sourceRef);
		if (starting) {
			await starting;
			return;
		}
		if (!this.electricUrl) throw new Error(`[entity-bridge] Electric URL is required for entities()`);
		const startPromise = (async () => {
			const bridge = new EntityBridge(row, this.registry, this.streamClient, this.electricUrl, this.tenantId, this.electricSecret);
			await bridge.start();
			this.bridges.set(row.sourceRef, bridge);
		})().finally(() => {
			this.startingBridges.delete(row.sourceRef);
		});
		this.startingBridges.set(row.sourceRef, startPromise);
		await startPromise;
	}
	async sweepIdleBridges() {
		const activeSourceRefs = await this.collectReferencedSourceRefs();
		for (const sourceRef of activeSourceRefs) await this.registry.touchEntityBridge(sourceRef);
		const stale = await this.registry.listStaleEntityBridges(new Date(Date.now() - 15 * 6e4));
		for (const row of stale) {
			if (activeSourceRefs.has(row.sourceRef)) continue;
			if ((this.activeReaders.get(row.sourceRef) ?? 0) > 0) continue;
			const bridge = this.bridges.get(row.sourceRef);
			this.bridges.delete(row.sourceRef);
			await bridge?.stop();
			await this.registry.deleteEntityBridge(row.sourceRef);
		}
	}
	async collectReferencedSourceRefs() {
		return new Set(await this.registry.listReferencedEntitySourceRefs());
	}
	sourceRefFromStreamPath(streamPath) {
		const match = streamPath.match(/^\/_entities\/([^/]+)$/);
		return match?.[1] ?? null;
	}
	async touchSourceRef(sourceRef, reason) {
		try {
			await this.registry.touchEntityBridge(sourceRef);
		} catch (error) {
			serverLog.warn(`[entity-bridge] failed to touch ${sourceRef} during ${reason}:`, error);
		}
	}
};

//#endregion
//#region src/claim-write-token-store.ts
var ClaimWriteTokenStore = class {
	claimsByStream = new Map();
	streamByConsumer = new Map();
	mint(service, streamPath, consumerId) {
		const streamKey = this.streamKey(service, streamPath);
		const consumerKey = this.consumerKey(service, consumerId);
		const previousClaimForStream = this.claimsByStream.get(streamKey);
		if (previousClaimForStream) this.streamByConsumer.delete(this.consumerKey(service, previousClaimForStream.consumerId));
		const previousStreamForConsumer = this.streamByConsumer.get(consumerKey);
		if (previousStreamForConsumer) this.claimsByStream.delete(previousStreamForConsumer);
		const token = randomUUID();
		this.claimsByStream.set(streamKey, {
			token,
			consumerId
		});
		this.streamByConsumer.set(consumerKey, streamKey);
		return token;
	}
	isValid(service, streamPath, token) {
		return this.claimsByStream.get(this.streamKey(service, streamPath))?.token === token;
	}
	owns(service, streamPath, consumerId) {
		return this.claimsByStream.get(this.streamKey(service, streamPath))?.consumerId === consumerId;
	}
	clearStream(service, streamPath) {
		const streamKey = this.streamKey(service, streamPath);
		const activeClaim = this.claimsByStream.get(streamKey);
		if (!activeClaim) return;
		this.claimsByStream.delete(streamKey);
		this.streamByConsumer.delete(this.consumerKey(service, activeClaim.consumerId));
	}
	clearConsumer(service, consumerId) {
		const consumerKey = this.consumerKey(service, consumerId);
		const streamKey = this.streamByConsumer.get(consumerKey);
		if (!streamKey) return;
		this.streamByConsumer.delete(consumerKey);
		this.claimsByStream.delete(streamKey);
	}
	streamKey(service, streamPath) {
		return `${service}\0${streamPath}`;
	}
	consumerKey(service, consumerId) {
		return `${service}\0${consumerId}`;
	}
};

//#endregion
//#region src/electric-agents/schema-validator.ts
var SchemaValidator = class {
	ajv;
	constructor() {
		this.ajv = new Ajv({ allErrors: true });
	}
	/**
	* Validate data against a JSON Schema. Returns null if valid.
	* Returns error details on failure.
	*/
	validate(schema, data) {
		const validate = this.ajv.compile(schema);
		if (validate(data)) return null;
		return {
			code: ErrCodeSchemaValidationFailed,
			message: `Validation failed`,
			details: (validate.errors ?? []).map((err) => ({
				path: err.instancePath || `/`,
				message: err.message ?? `validation error`
			}))
		};
	}
	/**
	* Check that a JSON Schema only uses allowed keywords.
	* Returns null if valid, error details if disallowed keywords found.
	*/
	validateSchemaSubset(schema) {
		const disallowed = this.findDisallowedKeywords(schema, ``);
		if (disallowed.length === 0) return null;
		return {
			code: ErrCodeInvalidRequest,
			message: `Schema uses disallowed keywords`,
			details: disallowed
		};
	}
	findDisallowedKeywords(obj, path$1) {
		const issues = [];
		for (const [key, value] of Object.entries(obj)) {
			if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) issues.push({
				path: path$1 ? `${path$1}/${key}` : `/${key}`,
				message: `Disallowed keyword: ${key}`
			});
			if (Array.isArray(value)) {
				if (key === `anyOf` || key === `oneOf` || key === `allOf`) {
					for (const [index$1, item] of value.entries()) if (isPlainObject(item)) issues.push(...this.findDisallowedKeywords(item, `${path$1}/${key}/${index$1}`));
				}
				continue;
			}
			if (!isPlainObject(value)) continue;
			if (key === `properties` || key === `$defs` || key === `definitions`) {
				for (const [subKey, subValue] of Object.entries(value)) if (isPlainObject(subValue)) issues.push(...this.findDisallowedKeywords(subValue, `${path$1}/${key}/${subKey}`));
			} else if (key === `items`) issues.push(...this.findDisallowedKeywords(value, `${path$1}/items`));
		}
		return issues;
	}
};
const ALLOWED_SCHEMA_KEYWORDS = new Set([
	`type`,
	`properties`,
	`required`,
	`enum`,
	`const`,
	`minimum`,
	`maximum`,
	`exclusiveMinimum`,
	`exclusiveMaximum`,
	`minLength`,
	`maxLength`,
	`pattern`,
	`items`,
	`minItems`,
	`maxItems`,
	`$ref`,
	`anyOf`,
	`oneOf`,
	`allOf`,
	`not`,
	`format`,
	`title`,
	`description`,
	`default`,
	`additionalProperties`,
	`nullable`,
	`$schema`,
	`$id`,
	`$defs`,
	`definitions`
]);
function isPlainObject(value) {
	return value !== null && typeof value === `object` && !Array.isArray(value);
}

//#endregion
//#region src/scheduler.ts
const POSTGRES_TEXT_OID = 25;
function isPermanentElectricAgentsError(err) {
	const status$1 = typeof err === `object` && err !== null && `status` in err ? err.status : void 0;
	const name = typeof err === `object` && err !== null && `name` in err ? err.name : void 0;
	return name === `ElectricAgentsError` && typeof status$1 === `number` && status$1 >= 400 && status$1 < 500;
}
function normalizeTask(row) {
	return {
		id: Number(row.id),
		tenantId: row.tenant_id,
		kind: row.kind,
		payload: row.payload,
		fireAt: row.fire_at instanceof Date ? row.fire_at : new Date(row.fire_at),
		cronExpression: row.cron_expression,
		cronTimezone: row.cron_timezone,
		cronTickNumber: row.cron_tick_number,
		ownerEntityUrl: row.owner_entity_url,
		manifestKey: row.manifest_key
	};
}
var Scheduler = class {
	claimExpiryMs;
	safetyPollMs;
	listenEnabled;
	pgClient;
	instanceId;
	tenantId;
	tenantIds;
	running = false;
	loopPromise = null;
	currentSleepResolve = null;
	currentSleepTimer = null;
	listenerMeta = null;
	constructor(options) {
		this.options = options;
		this.pgClient = options.pgClient;
		this.instanceId = options.instanceId;
		this.tenantId = options.tenantId === void 0 ? DEFAULT_TENANT_ID : options.tenantId;
		this.tenantIds = options.tenantIds;
		this.claimExpiryMs = options.claimExpiryMs ?? 3e4;
		this.safetyPollMs = options.safetyPollMs ?? 1e4;
		this.listenEnabled = options.listen !== false;
	}
	resolveTenantId(tenantId) {
		if (tenantId) return tenantId;
		if (this.tenantId) return this.tenantId;
		throw new Error(`Scheduler tenantId is required in shared mode`);
	}
	async start() {
		if (this.running) return;
		this.running = true;
		if (this.listenEnabled) this.listenerMeta = await this.pgClient.listen(`scheduled_tasks_wake`, () => {
			this.wakeEarly();
		});
		this.loopPromise = this.runLoop().catch((err) => {
			console.error(`[agent-server] scheduler loop failed:`, err);
			this.running = false;
			this.wakeEarly();
		});
	}
	async stop() {
		this.running = false;
		this.wakeEarly();
		if (this.loopPromise) {
			await this.loopPromise;
			this.loopPromise = null;
		}
		if (this.listenerMeta) {
			await this.listenerMeta.unlisten();
			this.listenerMeta = null;
		}
	}
	wake() {
		this.wakeEarly();
	}
	async enqueueDelayedSend(payload, fireAt, opts) {
		const tenantId = this.resolveTenantId();
		await this.pgClient`
      insert into scheduled_tasks (
        tenant_id,
        kind,
        payload,
        fire_at,
        owner_entity_url,
        manifest_key
      )
      values (
        ${tenantId},
        'delayed_send',
        ${JSON.stringify(payload)}::jsonb,
        ${fireAt.toISOString()}::timestamptz,
        ${opts?.ownerEntityUrl ?? null},
        ${opts?.manifestKey ?? null}
      )
    `;
		this.wakeEarly();
	}
	async syncManifestDelayedSend(ownerEntityUrl, manifestKey, payload, fireAt) {
		const tenantId = this.resolveTenantId();
		await this.pgClient.begin(async (sql$1) => {
			await sql$1`
        update scheduled_tasks
        set completed_at = now(), claimed_at = null, claimed_by = null
        where tenant_id = ${tenantId}
          and kind = 'delayed_send'
          and owner_entity_url = ${ownerEntityUrl}
          and manifest_key = ${manifestKey}
          and completed_at is null
      `;
			await sql$1`
        insert into scheduled_tasks (
          tenant_id,
          kind,
          payload,
          fire_at,
          owner_entity_url,
          manifest_key
        )
        values (
          ${tenantId},
          'delayed_send',
          ${JSON.stringify(payload)}::jsonb,
          ${fireAt.toISOString()}::timestamptz,
          ${ownerEntityUrl},
          ${manifestKey}
        )
      `;
		});
		this.wakeEarly();
	}
	async cancelManifestDelayedSend(ownerEntityUrl, manifestKey) {
		const tenantId = this.resolveTenantId();
		await this.pgClient`
      update scheduled_tasks
      set completed_at = now(), claimed_at = null, claimed_by = null
      where tenant_id = ${tenantId}
        and kind = 'delayed_send'
        and owner_entity_url = ${ownerEntityUrl}
        and manifest_key = ${manifestKey}
        and completed_at is null
    `;
		this.wakeEarly();
	}
	async enqueueCronTick(expression, timezone, tickNumber, streamPath, fireAt) {
		const tenantId = this.resolveTenantId();
		await this.pgClient`
      insert into scheduled_tasks (
        tenant_id,
        kind,
        payload,
        fire_at,
        cron_expression,
        cron_timezone,
        cron_tick_number
      )
      values (
        ${tenantId},
        'cron_tick',
        ${JSON.stringify({ streamPath })}::jsonb,
        ${fireAt.toISOString()}::timestamptz,
        ${expression},
        ${timezone},
        ${tickNumber}
      )
      on conflict (tenant_id, cron_expression, cron_timezone, cron_tick_number) do nothing
    `;
		this.wakeEarly();
	}
	async runLoop() {
		while (this.running) try {
			await this.reclaimStaleClaims();
			await this.fireReadyTasks();
			const nextFireAt = await this.getNextFireAt();
			const sleepTargetMs = nextFireAt ? Math.max(0, nextFireAt.getTime() - Date.now()) : this.safetyPollMs;
			await this.sleepOrWake(Math.min(sleepTargetMs, this.safetyPollMs));
		} catch (err) {
			console.error(`[agent-server] scheduler iteration failed:`, err);
			await this.sleepOrWake(this.safetyPollMs);
		}
	}
	async reclaimStaleClaims() {
		if (this.tenantId === null) {
			const tenantIds = this.sharedTenantIds();
			if (tenantIds && tenantIds.length === 0) return;
			if (tenantIds) {
				await this.pgClient`
          update scheduled_tasks
          set claimed_by = null, claimed_at = null
          where tenant_id = any(${this.sharedTenantIdsParameter(tenantIds)})
            and completed_at is null
            and claimed_at < now() - (${this.claimExpiryMs} * interval '1 millisecond')
        `;
				return;
			}
			await this.pgClient`
        update scheduled_tasks
        set claimed_by = null, claimed_at = null
        where completed_at is null
          and claimed_at < now() - (${this.claimExpiryMs} * interval '1 millisecond')
      `;
			return;
		}
		await this.pgClient`
      update scheduled_tasks
      set claimed_by = null, claimed_at = null
      where tenant_id = ${this.tenantId}
        and completed_at is null
        and claimed_at < now() - (${this.claimExpiryMs} * interval '1 millisecond')
    `;
	}
	async fireReadyTasks() {
		while (this.running) {
			const tasks = await this.claimReadyTasks();
			if (tasks.length === 0) return;
			for (const task of tasks) await this.executeTask(task);
		}
	}
	async claimReadyTasks() {
		if (this.tenantId === null) {
			const tenantIds = this.sharedTenantIds();
			if (tenantIds && tenantIds.length === 0) return [];
			if (tenantIds) {
				const rows$2 = await this.pgClient`
          update scheduled_tasks
          set claimed_by = ${this.instanceId}, claimed_at = now()
          where id in (
            select id
            from scheduled_tasks
            where tenant_id = any(${this.sharedTenantIdsParameter(tenantIds)})
              and completed_at is null
              and claimed_at is null
              and fire_at <= now()
            order by fire_at, id
            for update skip locked
            limit 50
          )
          returning tenant_id, id, kind, payload, fire_at, cron_expression, cron_timezone, cron_tick_number
            , owner_entity_url, manifest_key
        `;
				return rows$2.map(normalizeTask);
			}
			const rows$1 = await this.pgClient`
        update scheduled_tasks
        set claimed_by = ${this.instanceId}, claimed_at = now()
        where id in (
          select id
          from scheduled_tasks
          where completed_at is null
            and claimed_at is null
            and fire_at <= now()
          order by fire_at, id
          for update skip locked
          limit 50
        )
        returning tenant_id, id, kind, payload, fire_at, cron_expression, cron_timezone, cron_tick_number
          , owner_entity_url, manifest_key
      `;
			return rows$1.map(normalizeTask);
		}
		const rows = await this.pgClient`
      update scheduled_tasks
      set claimed_by = ${this.instanceId}, claimed_at = now()
      where tenant_id = ${this.tenantId}
        and id in (
        select id
        from scheduled_tasks
        where tenant_id = ${this.tenantId}
          and completed_at is null
          and claimed_at is null
          and fire_at <= now()
        order by fire_at, id
        for update skip locked
        limit 50
      )
      returning tenant_id, id, kind, payload, fire_at, cron_expression, cron_timezone, cron_tick_number
        , owner_entity_url, manifest_key
    `;
		return rows.map(normalizeTask);
	}
	async executeTask(task) {
		try {
			if (task.kind === `delayed_send`) {
				await this.options.executors.delayed_send(task.payload, task.id, task.tenantId);
				await this.markTaskComplete(task.id, task.tenantId);
				return;
			}
			const tickNumber = task.cronTickNumber;
			if (tickNumber == null || !task.cronExpression || !task.cronTimezone) throw new Error(`cron task ${task.id} is missing cron metadata`);
			await this.options.executors.cron_tick(task.payload, tickNumber, task.id, task.tenantId);
			await this.completeAndRescheduleCron(task);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (isUnregisteredTenantError(err)) {
				await this.releaseClaim(task.id, message, task.tenantId);
				serverLog.warn(`[scheduler] skipped ${task.kind} task ${task.id} for unregistered tenant "${task.tenantId}": ${message}`);
				return;
			}
			if (isPermanentElectricAgentsError(err)) {
				await this.markTaskPermanentFailure(task.id, message, task.tenantId);
				return;
			}
			await this.releaseClaim(task.id, message, task.tenantId);
		}
	}
	async markTaskComplete(taskId, tenantId = this.resolveTenantId()) {
		await this.pgClient`
      update scheduled_tasks
      set completed_at = now(), last_error = null
      where tenant_id = ${tenantId}
        and id = ${taskId}
        and claimed_by = ${this.instanceId}
        and completed_at is null
    `;
	}
	async markTaskPermanentFailure(taskId, message, tenantId = this.resolveTenantId()) {
		await this.pgClient`
      update scheduled_tasks
      set completed_at = now(), last_error = ${message}
      where tenant_id = ${tenantId}
        and id = ${taskId}
        and claimed_by = ${this.instanceId}
        and completed_at is null
    `;
	}
	async releaseClaim(taskId, message, tenantId = this.resolveTenantId()) {
		await this.pgClient`
      update scheduled_tasks
      set claimed_at = null, claimed_by = null, last_error = ${message}
      where tenant_id = ${tenantId}
        and id = ${taskId}
        and claimed_by = ${this.instanceId}
        and completed_at is null
    `;
	}
	async completeAndRescheduleCron(task) {
		const tenantId = task.tenantId ?? this.resolveTenantId();
		await this.pgClient.begin(async (sql$1) => {
			const completed = await sql$1`
        update scheduled_tasks
        set completed_at = now(), last_error = null
        where tenant_id = ${tenantId}
          and id = ${task.id}
          and claimed_by = ${this.instanceId}
          and completed_at is null
        returning id
      `;
			if (completed.length === 0) return;
			const nextFireAt = getNextCronFireAt(task.cronExpression, task.cronTimezone, task.fireAt);
			await sql$1`
        insert into scheduled_tasks (
          tenant_id,
          kind,
          payload,
          fire_at,
          cron_expression,
          cron_timezone,
          cron_tick_number
        )
        values (
          ${tenantId},
          'cron_tick',
          ${JSON.stringify(task.payload)}::jsonb,
          ${nextFireAt.toISOString()}::timestamptz,
          ${task.cronExpression},
          ${task.cronTimezone},
          ${task.cronTickNumber + 1}
        )
        on conflict (tenant_id, cron_expression, cron_timezone, cron_tick_number) do nothing
      `;
		});
	}
	async getNextFireAt() {
		if (this.tenantId === null) {
			const tenantIds = this.sharedTenantIds();
			if (tenantIds && tenantIds.length === 0) return null;
			if (tenantIds) {
				const rows$2 = await this.pgClient`
          select fire_at
          from scheduled_tasks
          where tenant_id = any(${this.sharedTenantIdsParameter(tenantIds)})
            and completed_at is null
            and claimed_at is null
          order by fire_at, id
          limit 1
        `;
				if (rows$2.length === 0) return null;
				const fireAt$2 = rows$2[0].fire_at;
				return fireAt$2 instanceof Date ? fireAt$2 : new Date(fireAt$2);
			}
			const rows$1 = await this.pgClient`
        select fire_at
        from scheduled_tasks
        where completed_at is null
          and claimed_at is null
        order by fire_at, id
        limit 1
      `;
			if (rows$1.length === 0) return null;
			const fireAt$1 = rows$1[0].fire_at;
			return fireAt$1 instanceof Date ? fireAt$1 : new Date(fireAt$1);
		}
		const rows = await this.pgClient`
      select fire_at
      from scheduled_tasks
      where tenant_id = ${this.tenantId}
        and completed_at is null
        and claimed_at is null
      order by fire_at, id
      limit 1
    `;
		if (rows.length === 0) return null;
		const fireAt = rows[0].fire_at;
		return fireAt instanceof Date ? fireAt : new Date(fireAt);
	}
	async sleepOrWake(durationMs) {
		if (!this.running) return;
		await new Promise((resolve$1) => {
			const finish = () => {
				if (this.currentSleepTimer) {
					clearTimeout(this.currentSleepTimer);
					this.currentSleepTimer = null;
				}
				this.currentSleepResolve = null;
				resolve$1();
			};
			this.currentSleepResolve = finish;
			this.currentSleepTimer = setTimeout(finish, Math.max(durationMs, 0));
		});
	}
	wakeEarly() {
		const resolve$1 = this.currentSleepResolve;
		this.currentSleepResolve = null;
		if (this.currentSleepTimer) {
			clearTimeout(this.currentSleepTimer);
			this.currentSleepTimer = null;
		}
		resolve$1?.();
	}
	sharedTenantIds() {
		if (this.tenantId !== null || !this.tenantIds) return null;
		return [...new Set(this.tenantIds())];
	}
	sharedTenantIdsParameter(tenantIds) {
		return this.pgClient.array(tenantIds, POSTGRES_TEXT_OID);
	}
};

//#endregion
//#region src/runtime.ts
function omitUndefined(value) {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0));
}
var ElectricAgentsTenantRuntime = class {
	serviceId;
	service;
	db;
	streamClient;
	registry;
	wakeRegistry;
	scheduler;
	entityBridgeManager;
	claimWriteTokens;
	manager;
	constructor(options) {
		this.serviceId = options.service ?? options.tenantId ?? DEFAULT_TENANT_ID;
		this.service = this.serviceId;
		this.db = options.db;
		if (options.streamClient) this.streamClient = options.streamClient;
		else if (options.durableStreamsUrl) this.streamClient = new StreamClient(durableStreamsServiceUrl(options.durableStreamsUrl, this.serviceId), { bearer: options.durableStreamsBearer });
		else throw new Error(`Either durableStreamsUrl or streamClient is required`);
		this.registry = options.registry ?? new PostgresRegistry(this.db, this.serviceId);
		this.wakeRegistry = options.wakeRegistry;
		this.scheduler = options.scheduler;
		this.entityBridgeManager = options.entityBridgeManager;
		this.claimWriteTokens = options.claimWriteTokens ?? new ClaimWriteTokenStore();
		this.manager = new EntityManager({
			registry: this.registry,
			streamClient: this.streamClient,
			validator: new SchemaValidator(),
			wakeRegistry: this.wakeRegistry,
			scheduler: this.scheduler,
			entityBridgeManager: this.entityBridgeManager,
			writeTokenValidator: (entity, token) => this.claimWriteTokens.isValid(this.serviceId, entity.streams.main, token),
			stopWakeRegistryOnShutdown: options.stopWakeRegistryOnShutdown ?? false
		});
	}
	async stop() {
		await this.manager.shutdown();
	}
	async rehydrateCronSchedules() {
		const rows = await this.db.select({ sourceUrl: wakeRegistrations.sourceUrl }).from(wakeRegistrations).where(eq(wakeRegistrations.tenantId, this.serviceId));
		const cronSpecs = new Map();
		for (const row of rows) {
			if (!row.sourceUrl.startsWith(`/_cron/`)) continue;
			try {
				const spec = parseCronStreamPath(row.sourceUrl, { fallback: `utc` });
				cronSpecs.set(JSON.stringify(spec), spec);
			} catch (err) {
				serverLog.warn(`[agent-server] invalid cron wake registration:`, err);
			}
		}
		for (const spec of cronSpecs.values()) try {
			await this.manager.getOrCreateCronStream(spec.expression, spec.timezone);
		} catch (err) {
			serverLog.warn(`[agent-server] cron rehydration failed:`, err);
		}
		const { entities: entities$1 } = await this.manager.registry.listEntities({ limit: 1e4 });
		await this.manager.registry.clearEntityManifestSources();
		for (const entity of entities$1) try {
			const events = await this.streamClient.readJson(entity.streams.main);
			const manifestEvents = new Map();
			for (const event of events) {
				if (event.type !== `manifest` || typeof event.key !== `string`) continue;
				manifestEvents.set(event.key, event);
			}
			for (const [manifestKey, event] of manifestEvents) {
				const headers = event.headers;
				const operation = headers?.operation;
				const value = event.value;
				await this.applyManifestEntitySource(entity.url, manifestKey, operation, value);
				await this.applyManifestFutureSendSchedule(entity.url, manifestKey, operation, value);
			}
		} catch (err) {
			serverLog.warn(`[agent-server] manifest future_send rehydration failed for ${entity.url}:`, err);
		}
	}
	async evaluateWakePayload(sourceUrl, event) {
		if (Array.isArray(event)) {
			await Promise.all(event.map((item) => this.manager.evaluateWakes(sourceUrl, item)));
			return;
		}
		await this.manager.evaluateWakes(sourceUrl, event);
	}
	checkRunFinished(sourceUrl, event) {
		const events = Array.isArray(event) ? event : [event];
		for (const item of events) {
			if (item.type !== `run`) continue;
			const value = item.value;
			const headers = item.headers;
			const status$1 = value?.status;
			const operation = headers?.operation;
			if (operation === `update` && (status$1 === `completed` || status$1 === `failed`)) {
				this.maybeMarkEntityIdleAfterRunFinished(sourceUrl);
				return;
			}
		}
	}
	async syncManifestWakes(subscriberUrl, event) {
		const events = Array.isArray(event) ? event : [event];
		for (const item of events) {
			const eventType = item.type;
			if (eventType !== `manifest`) continue;
			const headers = item.headers;
			const operation = headers?.operation;
			const manifestKey = item.key;
			const value = item.value;
			if (!manifestKey) continue;
			if (operation === `delete`) {
				await this.manager.wakeRegistry.unregisterByManifestKey(subscriberUrl, manifestKey, this.serviceId);
				continue;
			}
			await this.manager.wakeRegistry.unregisterByManifestKey(subscriberUrl, manifestKey, this.serviceId);
			if (value) {
				const reg = buildManifestWakeRegistration(subscriberUrl, value, manifestKey);
				if (reg) {
					reg.tenantId = this.serviceId;
					await this.manager.wakeRegistry.register(reg);
				}
				const cronSpec = extractManifestCronSpec(value);
				if (cronSpec) this.manager.getOrCreateCronStream(cronSpec.expression, cronSpec.timezone).catch((err) => serverLog.warn(`[agent-server] cron schedule failed:`, err));
			}
		}
	}
	async syncManifestEntitySources(ownerEntityUrl, event) {
		const events = Array.isArray(event) ? event : [event];
		for (const item of events) {
			if (item.type !== `manifest`) continue;
			const manifestKey = item.key;
			const headers = item.headers;
			const operation = headers?.operation;
			const value = item.value;
			if (!manifestKey) continue;
			await this.applyManifestEntitySource(ownerEntityUrl, manifestKey, operation, value);
		}
	}
	async syncManifestSchedules(ownerEntityUrl, event) {
		const events = Array.isArray(event) ? event : [event];
		for (const item of events) {
			if (item.type !== `manifest`) continue;
			const manifestKey = item.key;
			const headers = item.headers;
			const operation = headers?.operation;
			const value = item.value;
			if (!manifestKey) continue;
			await this.applyManifestFutureSendSchedule(ownerEntityUrl, manifestKey, operation, value);
		}
	}
	async executeDelayedSend(payload, taskId) {
		const producerId = payload.producerId ?? `scheduler-task-${taskId}`;
		try {
			await this.manager.send(payload.entityUrl, {
				from: payload.from,
				payload: payload.payload,
				key: payload.key ?? `scheduled-task-${taskId}`,
				type: payload.type
			}, { producerId });
			if (payload.manifest) await this.manager.writeManifestEntry(payload.manifest.ownerEntityUrl, payload.manifest.key, `update`, omitUndefined({
				...payload.manifest.entry,
				status: `sent`,
				sentAt: new Date().toISOString(),
				failedAt: void 0,
				lastError: void 0
			}), { producerId: `manifest-status-${producerId}-sent` });
		} catch (err) {
			if (payload.manifest && isPermanentElectricAgentsError(err)) await this.manager.writeManifestEntry(payload.manifest.ownerEntityUrl, payload.manifest.key, `update`, omitUndefined({
				...payload.manifest.entry,
				status: `failed`,
				failedAt: new Date().toISOString(),
				sentAt: void 0,
				lastError: err instanceof Error ? err.message : String(err)
			}), { producerId: `manifest-status-${producerId}-failed` });
			throw err;
		}
	}
	async executeCronTick(payload, tickNumber) {
		const streamPath = payload.streamPath;
		const encodedExpression = streamPath.split(`/`).at(-1);
		const spec = parseCronStreamPath(streamPath, { fallback: `utc` });
		const tickEvent = {
			type: `cron_tick`,
			key: `tick-${tickNumber}`,
			value: {
				expression: spec.expression,
				timezone: spec.timezone,
				firedAt: new Date().toISOString(),
				tickNumber
			},
			headers: {
				operation: `insert`,
				timestamp: new Date().toISOString()
			}
		};
		await this.streamClient.appendIdempotent(streamPath, new TextEncoder().encode(JSON.stringify(tickEvent)), { producerId: `scheduler-cron-${encodedExpression}-${tickNumber}` });
		await this.manager.evaluateWakes(streamPath, tickEvent);
	}
	async applyManifestFutureSendSchedule(ownerEntityUrl, manifestKey, operation, value) {
		if (operation === `delete`) {
			await this.scheduler.cancelManifestDelayedSend(ownerEntityUrl, manifestKey);
			return;
		}
		if (!value || value.kind !== `schedule` || value.scheduleType !== `future_send`) {
			await this.scheduler.cancelManifestDelayedSend(ownerEntityUrl, manifestKey);
			return;
		}
		if (value.status !== void 0 && value.status !== `pending`) {
			await this.scheduler.cancelManifestDelayedSend(ownerEntityUrl, manifestKey);
			return;
		}
		const fireAtRaw = value.fireAt;
		const producerId = value.producerId;
		const targetUrl = value.targetUrl;
		const senderUrl = typeof value.senderUrl === `string` ? value.senderUrl : ownerEntityUrl;
		if (typeof fireAtRaw !== `string` || typeof producerId !== `string` || typeof targetUrl !== `string`) {
			serverLog.warn(`[agent-server] invalid future_send manifest entry for ${ownerEntityUrl}/${manifestKey}`);
			return;
		}
		const fireAt = new Date(fireAtRaw);
		if (Number.isNaN(fireAt.getTime())) {
			serverLog.warn(`[agent-server] invalid future_send fireAt for ${ownerEntityUrl}/${manifestKey}: ${fireAtRaw}`);
			return;
		}
		await this.scheduler.syncManifestDelayedSend(ownerEntityUrl, manifestKey, {
			entityUrl: targetUrl,
			from: senderUrl,
			payload: value.payload,
			key: `scheduled-${producerId}`,
			type: typeof value.messageType === `string` ? value.messageType : void 0,
			producerId,
			manifest: {
				ownerEntityUrl,
				key: manifestKey,
				entry: omitUndefined({
					...value,
					key: manifestKey,
					kind: `schedule`,
					scheduleType: `future_send`,
					targetUrl,
					senderUrl,
					fireAt: fireAt.toISOString(),
					producerId,
					status: `pending`
				})
			}
		}, fireAt);
	}
	async applyManifestEntitySource(ownerEntityUrl, manifestKey, operation, value) {
		const sourceRef = operation === `delete` ? void 0 : this.extractEntitiesSourceRef(value);
		await this.manager.registry.replaceEntityManifestSource(ownerEntityUrl, manifestKey, sourceRef);
	}
	extractEntitiesSourceRef(manifest) {
		if (manifest?.kind === `source` && manifest.sourceType === `entities` && typeof manifest.sourceRef === `string`) return manifest.sourceRef;
		return void 0;
	}
	async maybeMarkEntityIdleAfterRunFinished(entityUrl) {
		const primaryStream = `${entityUrl}/main`;
		const callbacks = await this.db.select().from(consumerCallbacks).where(and(eq(consumerCallbacks.tenantId, this.serviceId), eq(consumerCallbacks.primaryStream, primaryStream))).limit(1);
		if (callbacks.length > 0) return;
		await this.manager.registry.updateStatus(entityUrl, `idle`);
		await this.entityBridgeManager.onEntityChanged(entityUrl);
	}
};

//#endregion
//#region src/tag-stream-outbox-drainer.ts
const DRAIN_INTERVAL_MS = 500;
const MAX_FAILURE_ATTEMPTS = 10;
var TagStreamOutboxDrainer = class {
	timer = null;
	draining = false;
	activeDrain = null;
	stopping = false;
	workerId = randomUUID();
	streamClientForTenant;
	tenantId;
	tenantIds;
	constructor(registry, streamClient, options) {
		this.registry = registry;
		this.streamClientForTenant = typeof streamClient === `function` ? streamClient : () => streamClient;
		this.tenantId = options?.tenantId !== void 0 ? options.tenantId : registry.tenantId ?? DEFAULT_TENANT_ID;
		this.tenantIds = options?.tenantIds;
	}
	start() {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.runDrain().catch((error) => {
				serverLog.warn(`[tag-outbox] drain failed:`, error);
			});
		}, DRAIN_INTERVAL_MS);
	}
	async stop() {
		this.stopping = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		try {
			await this.activeDrain;
		} finally {
			await this.registry.releaseTagOutboxClaims(this.workerId, this.tenantId);
		}
	}
	async drainOnce() {
		await this.runDrain();
	}
	async runDrain() {
		if (this.stopping) return;
		if (this.draining) return;
		this.draining = true;
		const drainPromise = (async () => {
			const rows = await this.claimRows(25);
			for (const row of rows) await this.publishRow(row).catch((error) => {
				return this.handlePublishFailure(row, error);
			});
		})();
		this.activeDrain = drainPromise;
		try {
			await drainPromise;
		} finally {
			this.activeDrain = null;
			this.draining = false;
		}
	}
	async claimRows(limit) {
		const tenantIds = this.sharedTenantIds();
		if (!tenantIds) return await this.registry.claimTagOutboxRows(this.workerId, limit, this.tenantId);
		if (tenantIds.length === 0) return [];
		const rows = [];
		for (const tenantId of tenantIds) {
			const remaining = limit - rows.length;
			if (remaining <= 0) break;
			rows.push(...await this.registry.claimTagOutboxRows(this.workerId, remaining, tenantId));
		}
		return rows;
	}
	async publishRow(row) {
		const event = buildTagChangeEvent(row);
		const streamClient = await this.streamClientForTenant(row.tenantId);
		await streamClient.appendWithProducerHeaders(`${row.entityUrl}/main`, JSON.stringify(event), {
			producerId: `tag-outbox-${row.id}`,
			epoch: 0,
			seq: 0
		});
		await this.registry.deleteTagOutboxRow(row.id, row.tenantId);
	}
	async handlePublishFailure(row, error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isUnregisteredTenantError(error)) {
			await this.registry.releaseTagOutboxClaims(this.workerId, row.tenantId);
			serverLog.warn(`[tag-outbox] skipped row ${row.id} for unregistered tenant "${row.tenantId}": ${message}`);
			return;
		}
		const result = await this.registry.failTagOutboxRow(row.id, this.workerId, message, MAX_FAILURE_ATTEMPTS, row.tenantId);
		const logLine = `[tag-outbox] row ${row.id} failed (attempt ${result.attemptCount}/${MAX_FAILURE_ATTEMPTS})`;
		if (result.deadLettered) {
			serverLog.error(`${logLine}; dead-lettered: ${message}`);
			return;
		}
		serverLog.warn(`${logLine}: ${message}`);
	}
	sharedTenantIds() {
		if (this.tenantId !== null || !this.tenantIds) return null;
		return [...new Set(this.tenantIds())];
	}
};
function buildTagChangeEvent(row) {
	const headers = { timestamp: new Date().toISOString() };
	if (row.op === `delete`) return entityStateSchema.tags.delete({
		key: row.key,
		headers
	});
	const value = row.rowData ?? {
		key: row.key,
		value: ``
	};
	if (row.op === `insert`) return entityStateSchema.tags.insert({
		key: row.key,
		value,
		headers
	});
	return entityStateSchema.tags.update({
		key: row.key,
		value,
		headers
	});
}

//#endregion
//#region src/wake-registry.ts
function wakeSourceEventId(event) {
	const headers = typeof event.headers === `object` && event.headers !== null ? event.headers : void 0;
	const offset = headers?.offset;
	if (typeof offset === `string` && offset.length > 0) return offset;
	const operation = headers?.operation;
	const key = event.key;
	if (typeof operation === `string` && typeof key === `string`) return `${operation}:${key}`;
	if (typeof key === `string`) return key;
	return crypto.randomUUID();
}
function sqlStringLiteral(value) {
	return `'${value.replace(/'/g, `''`)}'`;
}
var WakeRegistry = class {
	db;
	registrationCache = new Map();
	debounceTimers = new Map();
	debounceBuffers = new Map();
	debounceRunStatus = new Map();
	timeoutTimers = new Map();
	timeoutDelivered = new Set();
	timeoutCallbacks = new Map();
	debounceCallbacks = new Map();
	syncElectricUrl = null;
	syncElectricSecret;
	syncAbortController = null;
	syncUnsubscribe = null;
	syncReadyPromise = null;
	syncRecoveryPromise = null;
	constructor(db, tenantId = DEFAULT_TENANT_ID) {
		this.tenantId = tenantId;
		this.db = db;
	}
	setTimeoutCallback(cb, tenantId) {
		const resolvedTenantId = this.resolveTenantId(tenantId);
		this.timeoutCallbacks.set(resolvedTenantId, cb);
		this.syncTenantTimeoutTimers(resolvedTenantId);
	}
	setDebounceCallback(cb, tenantId) {
		this.debounceCallbacks.set(this.resolveTenantId(tenantId), cb);
	}
	resolveTenantId(tenantId) {
		if (tenantId) return tenantId;
		if (this.tenantId) return this.tenantId;
		throw new Error(`WakeRegistry tenantId is required in shared mode`);
	}
	cacheKey(tenantId, sourceUrl) {
		return `${tenantId}:${sourceUrl}`;
	}
	registrationKey(reg) {
		return [
			reg.tenantId,
			reg.subscriberUrl,
			reg.sourceUrl,
			reg.manifestKey ?? ``,
			reg.oneShot ? `1` : `0`,
			reg.debounceMs ?? ``,
			reg.timeoutMs ?? ``,
			JSON.stringify(reg.condition),
			reg.includeResponse === false ? `0` : `1`
		].join(`:`);
	}
	deliverTimeout(result) {
		const callback = this.timeoutCallbacks.get(result.tenantId);
		if (!callback) return false;
		callback(result);
		return true;
	}
	deliverDebounce(result) {
		this.debounceCallbacks.get(result.tenantId)?.(result);
	}
	async startSync(electricUrl, electricSecret) {
		if (this.syncReadyPromise) {
			await this.syncReadyPromise;
			return;
		}
		this.syncElectricUrl = electricUrl;
		this.syncElectricSecret = electricSecret;
		const abortController = new AbortController();
		const stream = new ShapeStream({
			url: electricUrlWithPath(electricUrl, `/v1/shape`).toString(),
			params: {
				table: `wake_registrations`,
				...this.tenantId ? { where: `tenant_id = ${sqlStringLiteral(this.tenantId)}` } : {},
				...electricSecret ? { secret: electricSecret } : {},
				columns: [
					`id`,
					`tenant_id`,
					`subscriber_url`,
					`source_url`,
					`condition`,
					`debounce_ms`,
					`timeout_ms`,
					`one_shot`,
					`timeout_consumed`,
					`include_response`,
					`manifest_key`,
					`created_at`
				],
				replica: `full`
			},
			parser: { timestamptz: (value) => new Date(value) },
			signal: abortController.signal,
			onError: (error) => {
				if (abortController.signal.aborted) return {};
				if (this.syncReadyPromise) this.recoverSync(error, `shape stream error`);
				return {};
			}
		});
		this.syncAbortController = abortController;
		this.syncReadyPromise = new Promise((resolve$1, reject) => {
			let settled = false;
			this.syncUnsubscribe = stream.subscribe(async (messages) => {
				try {
					for (const message of messages) {
						await this.applyShapeMessage(message);
						if (!settled && `control` in message.headers && message.headers.control === `up-to-date`) {
							settled = true;
							resolve$1();
						}
					}
				} catch (error) {
					if (!settled) {
						settled = true;
						reject(error);
						return;
					}
					serverLog.error(`[wake-registry] failed to apply shape change:`, error);
				}
			}, (error) => {
				if (!settled) {
					settled = true;
					reject(error);
					return;
				}
				this.recoverSync(error, `subscription error`);
			});
		});
		try {
			await this.syncReadyPromise;
		} catch (error) {
			await this.stopSync();
			throw error;
		}
	}
	async stopSync() {
		this.syncUnsubscribe?.();
		this.syncUnsubscribe = null;
		this.syncAbortController?.abort();
		this.syncAbortController = null;
		this.syncReadyPromise = null;
	}
	async recoverSync(error, source) {
		if (this.syncRecoveryPromise) return this.syncRecoveryPromise;
		const electricUrl = this.syncElectricUrl;
		if (!electricUrl) {
			serverLog.error(`[wake-registry] Electric sync failed (${source}):`, error);
			return;
		}
		this.syncRecoveryPromise = (async () => {
			serverLog.error(`[wake-registry] Electric sync failed (${source}):`, error);
			await this.stopSync();
			await this.loadRegistrations();
			try {
				await this.startSync(electricUrl, this.syncElectricSecret);
				serverLog.info(`[wake-registry] Electric sync recovered`);
			} catch (recoveryError) {
				serverLog.error(`[wake-registry] Electric sync recovery failed:`, recoveryError);
			} finally {
				this.syncRecoveryPromise = null;
			}
		})();
		return this.syncRecoveryPromise;
	}
	async register(reg) {
		const tenantId = this.resolveTenantId(reg.tenantId);
		const result = await this.db.insert(wakeRegistrations).values({
			tenantId,
			subscriberUrl: reg.subscriberUrl,
			sourceUrl: reg.sourceUrl,
			condition: reg.condition,
			debounceMs: reg.debounceMs ?? 0,
			timeoutMs: reg.timeoutMs ?? 0,
			oneShot: reg.oneShot,
			includeResponse: reg.includeResponse !== false,
			manifestKey: reg.manifestKey ?? null
		}).onConflictDoNothing().returning({ id: wakeRegistrations.id });
		if (result.length === 0) {
			await this.loadRegistrations();
			return;
		}
		const dbId = result[0].id;
		this.upsertCachedRegistration({
			...reg,
			tenantId,
			dbId,
			createdAt: new Date(),
			timeoutConsumed: false
		});
	}
	startTimeoutTimer(reg, dbId) {
		if (reg.timeoutMs == null || reg.timeoutMs <= 0) return;
		this.startTimeoutTimerWithDuration(reg, dbId, reg.timeoutMs);
	}
	async markTimeoutConsumed(dbId, tenantId) {
		await this.db.update(wakeRegistrations).set({ timeoutConsumed: true }).where(and(eq(wakeRegistrations.tenantId, tenantId), eq(wakeRegistrations.id, dbId)));
	}
	async unregisterByManifestKey(subscriberUrl, manifestKey, tenantId) {
		const resolvedTenantId = this.resolveTenantId(tenantId);
		await this.db.delete(wakeRegistrations).where(and(eq(wakeRegistrations.tenantId, resolvedTenantId), eq(wakeRegistrations.subscriberUrl, subscriberUrl), eq(wakeRegistrations.manifestKey, manifestKey)));
		const toRemove = Array.from(this.registrationCache.values()).flatMap((regs) => regs.filter((r) => r.tenantId === resolvedTenantId && r.subscriberUrl === subscriberUrl && r.manifestKey === manifestKey).map((r) => r.dbId));
		for (const dbId of toRemove) this.removeCachedRegistrationByDbId(dbId);
	}
	async unregisterBySubscriber(subscriberUrl, tenantId) {
		const resolvedTenantId = this.resolveTenantId(tenantId);
		await this.db.delete(wakeRegistrations).where(and(eq(wakeRegistrations.tenantId, resolvedTenantId), eq(wakeRegistrations.subscriberUrl, subscriberUrl)));
		const toRemove = Array.from(this.registrationCache.values()).flatMap((regs) => regs.filter((r) => r.tenantId === resolvedTenantId && r.subscriberUrl === subscriberUrl).map((r) => r.dbId));
		for (const dbId of toRemove) this.removeCachedRegistrationByDbId(dbId);
	}
	async unregisterBySource(sourceUrl, tenantId) {
		const resolvedTenantId = this.resolveTenantId(tenantId);
		await this.db.delete(wakeRegistrations).where(and(eq(wakeRegistrations.tenantId, resolvedTenantId), eq(wakeRegistrations.sourceUrl, sourceUrl)));
		const key = this.cacheKey(resolvedTenantId, sourceUrl);
		const regs = this.registrationCache.get(key);
		if (regs) {
			for (const reg of [...regs]) this.removeCachedRegistrationByDbId(reg.dbId);
			this.registrationCache.delete(key);
		}
	}
	async unregisterBySubscriberAndSource(subscriberUrl, sourceUrl, tenantId) {
		const resolvedTenantId = this.resolveTenantId(tenantId);
		await this.db.delete(wakeRegistrations).where(and(eq(wakeRegistrations.tenantId, resolvedTenantId), eq(wakeRegistrations.subscriberUrl, subscriberUrl), eq(wakeRegistrations.sourceUrl, sourceUrl)));
		const regs = this.registrationCache.get(this.cacheKey(resolvedTenantId, sourceUrl));
		if (regs) {
			const toRemove = regs.filter((r) => r.tenantId === resolvedTenantId && r.subscriberUrl === subscriberUrl).map((r) => r.dbId);
			for (const dbId of toRemove) this.removeCachedRegistrationByDbId(dbId);
		}
	}
	async loadRegistrations() {
		const rows = this.tenantId === null ? await this.db.select().from(wakeRegistrations) : await this.db.select().from(wakeRegistrations).where(eq(wakeRegistrations.tenantId, this.tenantId));
		this.resetCachedRegistrations();
		for (const row of rows) {
			const reg = {
				tenantId: row.tenantId,
				subscriberUrl: row.subscriberUrl,
				sourceUrl: row.sourceUrl,
				condition: row.condition,
				debounceMs: row.debounceMs || void 0,
				timeoutMs: row.timeoutMs || void 0,
				oneShot: row.oneShot,
				includeResponse: row.includeResponse === false ? false : void 0,
				manifestKey: row.manifestKey ?? void 0,
				dbId: row.id,
				createdAt: row.createdAt,
				timeoutConsumed: row.timeoutConsumed
			};
			this.upsertCachedRegistration(reg);
		}
	}
	startTimeoutTimerWithDuration(reg, dbId, durationMs) {
		const timerKey = this.registrationKey(reg);
		const timer = setTimeout(() => {
			this.timeoutTimers.delete(timerKey);
			this.deliverTimeoutForRegistration(reg, dbId);
		}, durationMs);
		this.timeoutTimers.set(timerKey, timer);
	}
	clearDebounceState(timerKey) {
		const debounceTimer = this.debounceTimers.get(timerKey);
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			this.debounceTimers.delete(timerKey);
			this.debounceBuffers.delete(timerKey);
			this.debounceRunStatus.delete(timerKey);
		}
	}
	clearTimeoutState(timerKey) {
		const timeoutTimer = this.timeoutTimers.get(timerKey);
		if (timeoutTimer) {
			clearTimeout(timeoutTimer);
			this.timeoutTimers.delete(timerKey);
		}
	}
	clearRegistrationState(reg) {
		const timerKey = this.registrationKey(reg);
		this.clearDebounceState(timerKey);
		this.clearTimeoutState(timerKey);
	}
	resetCachedRegistrations() {
		for (const timer of this.debounceTimers.values()) clearTimeout(timer);
		this.debounceTimers.clear();
		this.debounceBuffers.clear();
		this.debounceRunStatus.clear();
		for (const timer of this.timeoutTimers.values()) clearTimeout(timer);
		this.timeoutTimers.clear();
		this.registrationCache.clear();
	}
	findCachedRegistration(dbId) {
		for (const [cacheKey, regs] of this.registrationCache) {
			const index$1 = regs.findIndex((reg) => reg.dbId === dbId);
			if (index$1 >= 0) return {
				cacheKey,
				index: index$1,
				reg: regs[index$1]
			};
		}
		return null;
	}
	upsertCachedRegistration(reg) {
		const existing = this.findCachedRegistration(reg.dbId);
		const nextKey = this.registrationKey(reg);
		if (existing) {
			const previousKey = this.registrationKey(existing.reg);
			const regs = this.registrationCache.get(existing.cacheKey);
			if (regs) {
				regs.splice(existing.index, 1);
				if (regs.length === 0) this.registrationCache.delete(existing.cacheKey);
			}
			if (previousKey !== nextKey) this.clearRegistrationState(existing.reg);
		}
		const cacheKey = this.cacheKey(reg.tenantId, reg.sourceUrl);
		const cached = this.registrationCache.get(cacheKey) ?? [];
		cached.push(reg);
		this.registrationCache.set(cacheKey, cached);
		this.syncTimeoutTimer(reg);
	}
	removeCachedRegistrationByDbId(dbId) {
		const existing = this.findCachedRegistration(dbId);
		if (!existing) return;
		this.clearRegistrationState(existing.reg);
		this.timeoutDelivered.delete(dbId);
		const regs = this.registrationCache.get(existing.cacheKey);
		if (!regs) return;
		regs.splice(existing.index, 1);
		if (regs.length === 0) this.registrationCache.delete(existing.cacheKey);
	}
	syncTimeoutTimer(reg) {
		const timerKey = this.registrationKey(reg);
		if (reg.timeoutConsumed || reg.timeoutMs == null || reg.timeoutMs <= 0) {
			this.clearTimeoutState(timerKey);
			return;
		}
		if (this.timeoutTimers.has(timerKey)) return;
		if (!reg.createdAt) {
			this.startTimeoutTimer(reg, reg.dbId);
			return;
		}
		const remaining = reg.createdAt.getTime() + reg.timeoutMs - Date.now();
		if (remaining > 0) {
			this.startTimeoutTimerWithDuration(reg, reg.dbId, remaining);
			return;
		}
		if (this.timeoutDelivered.has(reg.dbId)) return;
		this.deliverTimeoutForRegistration(reg, reg.dbId);
	}
	deliverTimeoutForRegistration(reg, dbId) {
		if (this.deliverTimeout(this.timeoutWakeResult(reg, dbId))) {
			this.timeoutDelivered.add(dbId);
			this.markTimeoutConsumed(dbId, reg.tenantId);
		}
	}
	syncTenantTimeoutTimers(tenantId) {
		for (const regs of this.registrationCache.values()) for (const reg of regs) if (reg.tenantId === tenantId) this.syncTimeoutTimer(reg);
	}
	timeoutWakeResult(reg, dbId) {
		return {
			tenantId: reg.tenantId,
			subscriberUrl: reg.subscriberUrl,
			registrationDbId: dbId,
			sourceEventKey: `timeout`,
			wakeMessage: {
				source: reg.sourceUrl,
				timeout: true,
				changes: []
			}
		};
	}
	normalizeShapeRow(row) {
		return {
			tenantId: row.tenant_id ?? this.resolveTenantId(),
			subscriberUrl: row.subscriber_url,
			sourceUrl: row.source_url,
			condition: row.condition,
			debounceMs: row.debounce_ms || void 0,
			timeoutMs: row.timeout_ms || void 0,
			oneShot: row.one_shot,
			includeResponse: row.include_response === false ? false : void 0,
			manifestKey: row.manifest_key ?? void 0,
			dbId: row.id,
			createdAt: row.created_at,
			timeoutConsumed: row.timeout_consumed
		};
	}
	async applyShapeMessage(message) {
		if (isControlMessage(message)) {
			if (message.headers.control === `must-refetch`) this.resetCachedRegistrations();
			return;
		}
		if (!isChangeMessage(message)) return;
		if (message.headers.operation === `delete`) {
			this.removeCachedRegistrationByDbId(Number(message.key));
			return;
		}
		this.upsertCachedRegistration(this.normalizeShapeRow(message.value));
	}
	evaluate(sourceUrl, event, tenantId) {
		const resolvedTenantId = this.resolveTenantId(tenantId);
		const cacheKey = this.cacheKey(resolvedTenantId, sourceUrl);
		const regs = this.registrationCache.get(cacheKey);
		if (!regs || regs.length === 0) return [];
		const results = [];
		const toRemove = [];
		for (let i = 0; i < regs.length; i++) {
			const reg = regs[i];
			const match = this.matchCondition(reg, event);
			if (!match) continue;
			const timerKey = this.registrationKey(reg);
			const timeoutTimer = this.timeoutTimers.get(timerKey);
			if (timeoutTimer) {
				clearTimeout(timeoutTimer);
				this.timeoutTimers.delete(timerKey);
				this.markTimeoutConsumed(reg.dbId, reg.tenantId);
			}
			if (reg.debounceMs != null && reg.debounceMs > 0) {
				const buffer = this.debounceBuffers.get(timerKey) ?? [];
				buffer.push(match.change);
				this.debounceBuffers.set(timerKey, buffer);
				if (match.runFinishedStatus) this.debounceRunStatus.set(timerKey, match.runFinishedStatus);
				const existing = this.debounceTimers.get(timerKey);
				if (existing) clearTimeout(existing);
				const timer = setTimeout(() => {
					this.debounceTimers.delete(timerKey);
					const flushed = this.debounceBuffers.get(timerKey);
					if (flushed && flushed.length > 0) {
						this.debounceBuffers.delete(timerKey);
						const runStatus = this.debounceRunStatus.get(timerKey);
						this.debounceRunStatus.delete(timerKey);
						this.deliverDebounce({
							tenantId: reg.tenantId,
							subscriberUrl: reg.subscriberUrl,
							registrationDbId: reg.dbId,
							sourceEventKey: flushed[flushed.length - 1].key,
							wakeMessage: {
								source: sourceUrl,
								timeout: false,
								changes: flushed
							},
							runFinishedStatus: runStatus,
							includeResponse: reg.includeResponse
						});
					}
				}, reg.debounceMs);
				this.debounceTimers.set(timerKey, timer);
			} else results.push({
				tenantId: reg.tenantId,
				subscriberUrl: reg.subscriberUrl,
				registrationDbId: reg.dbId,
				sourceEventKey: wakeSourceEventId(event),
				wakeMessage: {
					source: sourceUrl,
					timeout: false,
					changes: [match.change]
				},
				runFinishedStatus: match.runFinishedStatus,
				includeResponse: reg.includeResponse
			});
			if (reg.oneShot) toRemove.push(i);
		}
		for (let j = toRemove.length - 1; j >= 0; j--) {
			const removed = regs.splice(toRemove[j], 1);
			if (removed[0]) {
				this.clearRegistrationState(removed[0]);
				this.timeoutDelivered.delete(removed[0].dbId);
				this.db.delete(wakeRegistrations).where(and(eq(wakeRegistrations.tenantId, removed[0].tenantId), eq(wakeRegistrations.id, removed[0].dbId)));
			}
		}
		if (regs.length === 0) this.registrationCache.delete(cacheKey);
		return results;
	}
	/** Flush any pending debounce buffers for a subscriber and return them. */
	flushDebounce(subscriberUrl, sourceUrl, tenantId) {
		const resolvedTenantId = this.resolveTenantId(tenantId);
		const timerKeyPrefix = `${resolvedTenantId}:${subscriberUrl}:${sourceUrl}:`;
		const changes = [];
		for (const [timerKey, buffer] of this.debounceBuffers.entries()) {
			if (!timerKey.startsWith(timerKeyPrefix)) continue;
			changes.push(...buffer);
			this.debounceBuffers.delete(timerKey);
			const timer = this.debounceTimers.get(timerKey);
			if (timer) {
				clearTimeout(timer);
				this.debounceTimers.delete(timerKey);
			}
			this.debounceRunStatus.delete(timerKey);
		}
		if (changes.length === 0) return null;
		return {
			tenantId: resolvedTenantId,
			subscriberUrl,
			registrationDbId: -1,
			sourceEventKey: changes[changes.length - 1].key,
			wakeMessage: {
				source: sourceUrl,
				timeout: false,
				changes
			}
		};
	}
	matchCondition(reg, event) {
		if (reg.condition === `runFinished`) {
			if (event.type !== `run`) return null;
			const value = event.value;
			const headers$1 = event.headers;
			const status$1 = value?.status;
			const operation$1 = headers$1?.operation;
			if (operation$1 !== `update`) return null;
			if (status$1 !== `completed` && status$1 !== `failed`) return null;
			return {
				change: {
					collection: `runs`,
					kind: `update`,
					key: event.key || `run`
				},
				runFinishedStatus: status$1
			};
		}
		const condition = reg.condition;
		const eventType = event.type;
		const headers = event.headers;
		const operation = headers?.operation;
		if (!eventType) return null;
		if (condition.collections && condition.collections.length > 0) {
			if (!condition.collections.includes(eventType)) return null;
		}
		const kind = operation === `delete` ? `delete` : operation === `update` ? `update` : `insert`;
		if (condition.ops && condition.ops.length > 0 && !condition.ops.includes(kind)) return null;
		return { change: {
			collection: eventType,
			kind,
			key: event.key || ``
		} };
	}
};

//#endregion
//#region src/standalone-runtime.ts
async function startStandaloneAgentsRuntime(options) {
	const serviceId = options.service ?? options.tenantId ?? DEFAULT_TENANT_ID;
	const streamClient = options.streamClient ?? (options.durableStreamsUrl ? new StreamClient(durableStreamsServiceUrl(options.durableStreamsUrl, serviceId), { bearer: options.durableStreamsBearer }) : void 0);
	if (!streamClient) throw new Error(`Either durableStreamsUrl or streamClient is required`);
	const registry = new PostgresRegistry(options.db, serviceId);
	const wakeRegistry = options.wakeRegistry ?? new WakeRegistry(options.db, serviceId);
	let runtime;
	const scheduler = new Scheduler({
		pgClient: options.pgClient,
		instanceId: options.instanceId ?? randomUUID(),
		tenantId: serviceId,
		executors: {
			delayed_send: async (payload, taskId) => {
				await runtime.executeDelayedSend(payload, taskId);
			},
			cron_tick: async (payload, tickNumber) => {
				await runtime.executeCronTick(payload, tickNumber);
			}
		}
	});
	const entityBridgeManager = options.entityBridgeManager ?? new EntityBridgeManager(registry, streamClient, options.electricUrl, options.electricSecret, serviceId);
	const tagStreamOutboxDrainer = new TagStreamOutboxDrainer(registry, streamClient);
	runtime = new ElectricAgentsTenantRuntime({
		service: serviceId,
		db: options.db,
		registry,
		streamClient,
		wakeRegistry,
		scheduler,
		entityBridgeManager,
		stopWakeRegistryOnShutdown: options.wakeRegistry ? false : true
	});
	const startWakeRegistry = options.startWakeRegistry ?? true;
	const startScheduler = options.startScheduler ?? true;
	const startTagStreamOutboxDrainer = options.startTagStreamOutboxDrainer ?? true;
	const startEntityBridgeManager = options.startEntityBridgeManager ?? true;
	const rehydrateOnStart = options.rehydrateOnStart ?? true;
	let entityBridgeManagerStarted = false;
	let tagStreamOutboxDrainerStarted = false;
	let schedulerStarted = false;
	let stopped = false;
	const stop = async () => {
		if (stopped) return;
		stopped = true;
		if (schedulerStarted) {
			await scheduler.stop();
			schedulerStarted = false;
		}
		if (tagStreamOutboxDrainerStarted) {
			await tagStreamOutboxDrainer.stop();
			tagStreamOutboxDrainerStarted = false;
		}
		if (entityBridgeManagerStarted) {
			await entityBridgeManager.stop();
			entityBridgeManagerStarted = false;
		}
		await runtime.stop();
	};
	try {
		if (startWakeRegistry) {
			serverLog.info(`[agent-server] rebuilding wake registry...`);
			await runtime.manager.rebuildWakeRegistry(options.electricUrl, options.electricSecret);
		}
		if (rehydrateOnStart) {
			serverLog.info(`[agent-server] rehydrating cron schedules...`);
			await runtime.rehydrateCronSchedules();
		}
		if (startEntityBridgeManager) {
			serverLog.info(`[agent-server] starting entity bridge manager...`);
			await entityBridgeManager.start();
			entityBridgeManagerStarted = true;
		}
		if (startTagStreamOutboxDrainer) {
			serverLog.info(`[agent-server] starting tag stream outbox drainer...`);
			tagStreamOutboxDrainer.start();
			tagStreamOutboxDrainerStarted = true;
		}
		if (startScheduler) {
			serverLog.info(`[agent-server] starting scheduler...`);
			schedulerStarted = true;
			await scheduler.start();
			serverLog.info(`[agent-server] scheduler started`);
		}
	} catch (error) {
		await stop().catch(() => {});
		throw error;
	}
	return {
		serviceId,
		service: serviceId,
		db: options.db,
		pgClient: options.pgClient,
		streamClient,
		registry,
		wakeRegistry,
		runtime,
		manager: runtime.manager,
		scheduler,
		entityBridgeManager,
		tagStreamOutboxDrainer,
		stop
	};
}

//#endregion
//#region src/server.ts
const MOCK_AGENT_HANDLER_PATH = `/_electric/mock-agent-handler`;
const MOCK_CHAT_MODEL = {
	id: `mock-chat`,
	name: `Mock Chat`,
	api: `anthropic-messages`,
	provider: `anthropic`,
	baseUrl: `http://mock`,
	reasoning: false,
	input: [`text`],
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0
	},
	contextWindow: 2e5,
	maxTokens: 4096
};
function createMockAgentBootstrap(options) {
	const registry = createEntityRegistry();
	registry.define(`chat`, {
		description: `Mock chat entity for conformance and end-to-end tests.`,
		handler: async (ctx) => {
			ctx.useAgent({
				systemPrompt: `You are a concise test assistant.`,
				model: MOCK_CHAT_MODEL,
				tools: [],
				streamFn: options.streamFn
			});
			await ctx.agent.run();
		}
	});
	const runtime = createRuntimeHandler({
		baseUrl: options.agentServerUrl,
		serveEndpoint: appendPathToUrl(options.agentServerUrl, MOCK_AGENT_HANDLER_PATH),
		registry,
		subscriptionPathForType: (name) => `/${name}/*/main`,
		idleTimeout: 100
	});
	return {
		runtime,
		registry
	};
}
var ElectricAgentsServer = class {
	server;
	electricAgentsManager;
	pgDb;
	pgClient;
	entityBridgeManager;
	mockAgentBootstrap;
	_url;
	shuttingDown = false;
	streamsAgent;
	standaloneRuntime;
	streamClient;
	options;
	constructor(options) {
		if (!options.durableStreamsUrl && !options.durableStreamsServer) throw new Error(`Either durableStreamsUrl or durableStreamsServer is required`);
		this.options = options;
		this.streamClient = options.durableStreamsUrl ? new StreamClient(durableStreamsServiceUrl(options.durableStreamsUrl, this.tenantId), { bearer: options.durableStreamsBearer }) : null;
	}
	get url() {
		if (!this._url) throw new Error(`Server not started`);
		return this._url;
	}
	get publicUrl() {
		if (!this._url) throw new Error(`Server not started`);
		return this.options.baseUrl?.replace(/\/+$/, ``) ?? this._url;
	}
	get tenantId() {
		return this.options.service ?? this.options.tenantId ?? DEFAULT_TENANT_ID;
	}
	async start() {
		if (this.server) throw new Error(`Server already started`);
		try {
			if (this.options.durableStreamsServer && !this.options.durableStreamsUrl) {
				serverLog.info(`[agent-server] starting durable streams server...`);
				const streamsUrl = await this.options.durableStreamsServer.start();
				serverLog.info(`[agent-server] durable streams server started at ${streamsUrl}`);
				this.options.durableStreamsUrl = streamsUrl;
				this.streamClient = new StreamClient(durableStreamsServiceUrl(streamsUrl, this.tenantId), { bearer: this.options.durableStreamsBearer });
			}
			this.streamsAgent = new Agent({
				keepAliveTimeout: 6e4,
				keepAliveMaxTimeout: 6e5,
				connections: 256,
				pipelining: 1,
				bodyTimeout: 0,
				headersTimeout: 0
			});
			serverLog.info(`[agent-server] running migrations...`);
			await runMigrations(this.options.postgresUrl);
			serverLog.info(`[agent-server] migrations complete`);
			const { db, client } = createDb(this.options.postgresUrl);
			this.pgDb = db;
			this.pgClient = client;
			this.standaloneRuntime = await startStandaloneAgentsRuntime({
				service: this.tenantId,
				db,
				pgClient: client,
				streamClient: this.streamClient,
				electricUrl: this.options.electricUrl,
				electricSecret: this.options.electricSecret
			});
			this.electricAgentsManager = this.standaloneRuntime.manager;
			this.entityBridgeManager = this.standaloneRuntime.entityBridgeManager;
			await this.electricAgentsManager.ensurePrincipalEntityType();
			const serverAdapter = createServerAdapter((request) => this.handleRequest(request));
			const server = createServer(serverAdapter);
			this.server = server;
			const host = this.options.host ?? `127.0.0.1`;
			await this.listen(server, host);
			if (this.options.mockStreamFn) {
				this.mockAgentBootstrap = createMockAgentBootstrap({
					agentServerUrl: this.publicUrl,
					workingDirectory: this.options.workingDirectory,
					streamFn: this.options.mockStreamFn
				});
				await this.mockAgentBootstrap.runtime.registerTypes();
				serverLog.info(`[agent-server] mock chat agent registered at ${MOCK_AGENT_HANDLER_PATH}`);
			}
			return this.url;
		} catch (err) {
			await this.stop().catch(() => {});
			throw err;
		}
	}
	async stop() {
		this.shuttingDown = true;
		if (this.server) {
			const server = this.server;
			await new Promise((resolve$1) => {
				server.close(() => resolve$1());
				server.closeIdleConnections?.();
				server.closeAllConnections?.();
			});
			this.server = void 0;
			this._url = void 0;
		}
		if (this.mockAgentBootstrap) {
			this.mockAgentBootstrap.runtime.abortWakes();
			await Promise.race([this.mockAgentBootstrap.runtime.drainWakes().catch(() => {}), new Promise((resolve$1) => setTimeout(resolve$1, 5e3))]);
			this.mockAgentBootstrap = void 0;
		}
		if (this.standaloneRuntime) {
			await this.standaloneRuntime.stop();
			this.standaloneRuntime = void 0;
			this.entityBridgeManager = void 0;
			this.electricAgentsManager = void 0;
		}
		if (this.options.durableStreamsServer) await this.options.durableStreamsServer.stop();
		if (this.pgClient) {
			await this.pgClient.end();
			this.pgClient = void 0;
			this.pgDb = void 0;
		}
		if (this.streamsAgent) {
			await this.streamsAgent.close().catch(() => {});
			this.streamsAgent = void 0;
		}
		this.shuttingDown = false;
	}
	async listen(server, host) {
		await new Promise((resolve$1, reject) => {
			const onError = (err) => {
				server.off?.(`listening`, onListening);
				reject(err);
			};
			const onListening = () => {
				server.off?.(`error`, onError);
				resolve$1();
			};
			server.once?.(`error`, onError) ?? server.on(`error`, onError);
			server.listen(this.options.port, host, onListening);
		});
		const addr = server.address();
		if (typeof addr === `string`) this._url = addr;
		else if (addr) {
			const resolvedHost = host === `0.0.0.0` ? `127.0.0.1` : host;
			this._url = `http://${resolvedHost}:${addr.port}`;
		} else throw new Error(`Could not determine server address`);
	}
	async handleRequest(request) {
		if (!this._url || !this.standaloneRuntime || !this.electricAgentsManager || !this.entityBridgeManager || !this.pgDb || !this.streamsAgent || !this.options.durableStreamsUrl) return new Response(null, { status: 503 });
		try {
			return await ossServerRouter.fetch(request, await this.buildTenantContext(request));
		} catch (error) {
			if (error instanceof ElectricAgentsError) return apiError(error.status, error.code, error.message, error.details);
			throw error;
		}
	}
	allowDevPrincipalFallback() {
		if (this.options.allowDevPrincipalFallback !== void 0) return this.options.allowDevPrincipalFallback;
		return process.env.ELECTRIC_INSECURE === `true` || process.env.NODE_ENV !== `production` || Boolean(this.options.durableStreamsServer);
	}
	async buildTenantContext(request) {
		if (!this.standaloneRuntime || !this.electricAgentsManager || !this.entityBridgeManager || !this.pgDb || !this.streamsAgent || !this.options.durableStreamsUrl) throw new Error(`agents-server runtime is not started`);
		let principal;
		try {
			principal = await this.options.authenticateRequest?.(request) ?? getPrincipalFromRequest(request);
		} catch (error) {
			throw new ElectricAgentsError(ErrCodeInvalidRequest, error instanceof Error ? error.message : `Invalid principal`, 400);
		}
		if (!principal && this.allowDevPrincipalFallback()) principal = getDevPrincipal();
		if (!principal) throw new ElectricAgentsError(ErrCodeUnauthorized, `Missing Electric-Principal`, 401);
		return {
			service: this.tenantId,
			principal,
			publicUrl: this.publicUrl,
			localUrl: this._url,
			durableStreamsUrl: this.options.durableStreamsUrl,
			durableStreamsBearer: this.options.durableStreamsBearer,
			durableStreamsRouting: this.options.durableStreamsRouting ?? pathPrefixedSingleTenantDurableStreamsRoutingAdapter,
			durableStreamsDispatcher: this.streamsAgent,
			electricUrl: this.options.electricUrl,
			electricSecret: this.options.electricSecret,
			ownAgentHandlerPaths: this.mockAgentBootstrap ? [MOCK_AGENT_HANDLER_PATH] : void 0,
			pgDb: this.pgDb,
			entityManager: this.electricAgentsManager,
			streamClient: this.streamClient,
			runtime: this.standaloneRuntime.runtime,
			entityBridgeManager: this.entityBridgeManager,
			isShuttingDown: () => this.shuttingDown,
			mockAgent: this.mockAgentBootstrap ? { runtime: this.mockAgentBootstrap.runtime } : void 0
		};
	}
};

//#endregion
//#region src/entrypoint-lib.ts
const DEFAULT_HOST = `0.0.0.0`;
const DEFAULT_PORT = 4437;
const DEFAULT_STREAMS_HOST = `127.0.0.1`;
function readEnv(env, names) {
	for (const name of names) {
		const value = env[name]?.trim();
		if (value) return value;
	}
	return void 0;
}
function readRequiredEnv(env, names, description) {
	const value = readEnv(env, names);
	if (value) return value;
	throw new Error(`Missing ${description}. Set one of: ${names.map((name) => `"${name}"`).join(`, `)}`);
}
function readPort(env) {
	const raw = readEnv(env, [`ELECTRIC_AGENTS_PORT`, `PORT`]);
	if (!raw) return DEFAULT_PORT;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid ELECTRIC_AGENTS port "${raw}". Expected an integer between 1 and 65535.`);
	return port;
}
function validateUrl(name, value) {
	try {
		new URL(value);
		return value;
	} catch {
		throw new Error(`Invalid ${name}: "${value}"`);
	}
}
function readOptionalPositiveInteger(env, names, description) {
	const raw = readEnv(env, names);
	if (!raw) return void 0;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${description} "${raw}". Expected a positive integer.`);
	return value;
}
function readOptionalPort(env, names, description) {
	const raw = readEnv(env, names);
	if (!raw) return void 0;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid ${description} "${raw}". Expected an integer between 0 and 65535.`);
	return port;
}
function resolveElectricAgentsEntrypointOptions(env = process.env, cwd = process.cwd()) {
	const durableStreamsUrl = readEnv(env, [
		`ELECTRIC_AGENTS_DURABLE_STREAMS_URL`,
		`DURABLE_STREAMS_URL`,
		`STREAMS_URL`
	]);
	const durableStreamsBearer = readEnv(env, [`ELECTRIC_AGENTS_DURABLE_STREAMS_BEARER`, `DURABLE_STREAMS_BEARER`]);
	const postgresUrl = validateUrl(`Postgres URL`, readRequiredEnv(env, [`ELECTRIC_AGENTS_DATABASE_URL`, `DATABASE_URL`], `Postgres connection URL`));
	const electricUrl = readEnv(env, [`ELECTRIC_AGENTS_ELECTRIC_URL`, `ELECTRIC_URL`]);
	const electricSecret = readEnv(env, [`ELECTRIC_AGENTS_ELECTRIC_SECRET`]);
	const baseUrl = readEnv(env, [`ELECTRIC_AGENTS_BASE_URL`, `BASE_URL`]);
	return {
		service: readEnv(env, [`ELECTRIC_AGENTS_SERVICE`, `SERVICE`]),
		tenantId: readEnv(env, [`ELECTRIC_AGENTS_TENANT_ID`, `TENANT_ID`]),
		baseUrl: baseUrl ? validateUrl(`base URL`, baseUrl) : void 0,
		durableStreamsUrl: durableStreamsUrl ? validateUrl(`durable streams URL`, durableStreamsUrl) : void 0,
		...durableStreamsBearer ? { durableStreamsBearer } : {},
		postgresUrl,
		electricUrl: electricUrl ? validateUrl(`Electric URL`, electricUrl) : void 0,
		electricSecret,
		host: readEnv(env, [`ELECTRIC_AGENTS_HOST`, `HOST`]) ?? DEFAULT_HOST,
		port: readPort(env),
		workingDirectory: readEnv(env, [`ELECTRIC_AGENTS_WORKING_DIRECTORY`, `WORKING_DIRECTORY`]) ?? cwd,
		dispatchRecoveryIntervalMs: readOptionalPositiveInteger(env, [`ELECTRIC_AGENTS_DISPATCH_RECOVERY_INTERVAL_MS`], `dispatch recovery interval`),
		staleOutstandingWakeAfterMs: readOptionalPositiveInteger(env, [`ELECTRIC_AGENTS_STALE_OUTSTANDING_WAKE_AFTER_MS`], `stale outstanding wake age`)
	};
}
function createEmbeddedStreamsServer(env, cwd) {
	const externalUrl = readEnv(env, [
		`ELECTRIC_AGENTS_DURABLE_STREAMS_URL`,
		`DURABLE_STREAMS_URL`,
		`STREAMS_URL`
	]);
	if (externalUrl) return void 0;
	const dataDir = readEnv(env, [`ELECTRIC_AGENTS_STREAMS_DATA_DIR`, `STREAMS_DATA_DIR`]) ?? `${cwd}/.streams-data`;
	return new DurableStreamTestServer({
		host: readEnv(env, [`ELECTRIC_AGENTS_STREAMS_HOST`, `STREAMS_HOST`]) ?? DEFAULT_STREAMS_HOST,
		port: readOptionalPort(env, [`ELECTRIC_AGENTS_STREAMS_PORT`, `STREAMS_PORT`], `embedded streams port`) ?? 0,
		dataDir,
		webhooks: true
	});
}
async function runElectricAgentsEntrypoint({ env = process.env, cwd = process.cwd(), createServer: createServer$1 = (options$1) => new ElectricAgentsServer(options$1) } = {}) {
	const embeddedStreamsServer = createEmbeddedStreamsServer(env, cwd);
	const options = {
		...resolveElectricAgentsEntrypointOptions(env, cwd),
		durableStreamsServer: embeddedStreamsServer
	};
	const server = createServer$1(options);
	const url = await server.start();
	return {
		options,
		server,
		url
	};
}
async function main() {
	try {
		process.loadEnvFile();
	} catch {}
	let server = null;
	let stopping = null;
	const stop = async (exitCode) => {
		if (!stopping) stopping = server?.stop().catch((error) => {
			console.error(`[agent-server] failed to stop cleanly`, error);
		}) ?? Promise.resolve();
		await stopping;
		process.exit(exitCode);
	};
	try {
		const started = await runElectricAgentsEntrypoint();
		server = started.server;
		console.log(`Electric Agents server running at ${started.url}`);
		console.log(`Durable Streams: ${started.options.durableStreamsUrl ?? `(embedded DurableStreamTestServer)`}`);
		console.log(`Postgres: ${started.options.postgresUrl}`);
		if (started.options.electricUrl) console.log(`Electric: ${started.options.electricUrl}`);
		console.log(`Working directory: ${started.options.workingDirectory}`);
		process.on(`SIGINT`, () => {
			stop(0);
		});
		process.on(`SIGTERM`, () => {
			stop(0);
		});
		process.on(`uncaughtException`, (error) => {
			console.error(error);
			stop(1);
		});
		process.on(`unhandledRejection`, (error) => {
			console.error(error);
			stop(1);
		});
	} catch (error) {
		console.error(error);
		if (server) await server.stop().catch(() => {});
		process.exit(1);
	}
}

//#endregion
//#region src/entrypoint.ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

//#endregion