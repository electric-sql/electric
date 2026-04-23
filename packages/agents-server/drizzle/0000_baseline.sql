CREATE TABLE "consumer_callbacks" (
	"consumer_id" text PRIMARY KEY NOT NULL,
	"callback_url" text NOT NULL,
	"primary_stream" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"url" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"subscription_id" text NOT NULL,
	"write_token" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"spawn_args" jsonb DEFAULT '{}'::jsonb,
	"parent" text,
	"type_revision" integer,
	"inbox_schemas" jsonb,
	"state_schemas" jsonb,
	"metadata_schema" jsonb,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "chk_entities_status" CHECK ("entities"."status" IN ('spawning', 'running', 'idle', 'stopped'))
);
--> statement-breakpoint
CREATE TABLE "entity_types" (
	"name" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"creation_schema" jsonb,
	"inbox_schemas" jsonb,
	"state_schemas" jsonb,
	"metadata_schema" jsonb,
	"serve_endpoint" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"cron_expression" text,
	"cron_timezone" text,
	"cron_tick_number" integer,
	"owner_entity_url" text,
	"manifest_key" text,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cron_tick" UNIQUE("cron_expression","cron_timezone","cron_tick_number"),
	CONSTRAINT "chk_scheduled_tasks_kind" CHECK ("scheduled_tasks"."kind" IN ('delayed_send', 'cron_tick'))
);
--> statement-breakpoint
CREATE TABLE "subscription_webhooks" (
	"subscription_id" text PRIMARY KEY NOT NULL,
	"webhook_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wake_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscriber_url" text NOT NULL,
	"source_url" text NOT NULL,
	"condition" jsonb NOT NULL,
	"debounce_ms" integer DEFAULT 0 NOT NULL,
	"timeout_ms" integer DEFAULT 0 NOT NULL,
	"one_shot" boolean DEFAULT false NOT NULL,
	"timeout_consumed" boolean DEFAULT false NOT NULL,
	"include_response" boolean DEFAULT true NOT NULL,
	"manifest_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_wake_registration" UNIQUE("subscriber_url","source_url","one_shot","debounce_ms","timeout_ms","condition","manifest_key")
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_scheduled_tasks_wake() RETURNS trigger AS $$
BEGIN
	PERFORM pg_notify('scheduled_tasks_wake', '');
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER scheduled_tasks_notify
	AFTER INSERT ON "scheduled_tasks"
	FOR EACH ROW
	EXECUTE FUNCTION notify_scheduled_tasks_wake();
--> statement-breakpoint
CREATE INDEX "idx_entities_type" ON "entities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_entities_status" ON "entities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_entities_parent" ON "entities" USING btree ("parent");--> statement-breakpoint
CREATE INDEX "idx_scheduled_tasks_fire_ready" ON "scheduled_tasks" USING btree ("fire_at") WHERE "scheduled_tasks"."completed_at" IS NULL AND "scheduled_tasks"."claimed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_scheduled_tasks_manifest_pending" ON "scheduled_tasks" USING btree ("owner_entity_url","manifest_key") WHERE "scheduled_tasks"."kind" = 'delayed_send' AND "scheduled_tasks"."completed_at" IS NULL AND "scheduled_tasks"."manifest_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_scheduled_tasks_stale_claims" ON "scheduled_tasks" USING btree ("claimed_at") WHERE "scheduled_tasks"."completed_at" IS NULL AND "scheduled_tasks"."claimed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_wake_source_url" ON "wake_registrations" USING btree ("source_url");
