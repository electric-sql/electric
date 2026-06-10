CREATE TABLE "pg_sync_bridges" (
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"source_ref" text NOT NULL,
	"options" jsonb NOT NULL,
	"stream_url" text NOT NULL,
	"shape_handle" text,
	"shape_offset" text,
	"initial_snapshot_complete" boolean DEFAULT false NOT NULL,
	"last_touched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pg_sync_bridges_tenant_id_source_ref_pk" PRIMARY KEY("tenant_id","source_ref"),
	CONSTRAINT "uq_pg_sync_bridges_stream_url" UNIQUE("tenant_id","stream_url")
);
