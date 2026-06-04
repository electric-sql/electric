CREATE TABLE "entity_type_permission_grants" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" text DEFAULT 'default' NOT NULL,
  "entity_type" text NOT NULL,
  "permission" text NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_value" text NOT NULL,
  "created_by" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_type_permission_grants_permission" CHECK ("entity_type_permission_grants"."permission" IN ('spawn', 'manage')),
  CONSTRAINT "chk_type_permission_grants_subject_kind" CHECK ("entity_type_permission_grants"."subject_kind" IN ('principal', 'principal_kind'))
);
--> statement-breakpoint
CREATE TABLE "entity_lineage" (
  "tenant_id" text DEFAULT 'default' NOT NULL,
  "ancestor_url" text NOT NULL,
  "descendant_url" text NOT NULL,
  "depth" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "entity_lineage_pkey" PRIMARY KEY ("tenant_id", "ancestor_url", "descendant_url"),
  CONSTRAINT "chk_entity_lineage_depth" CHECK ("entity_lineage"."depth" >= 0)
);
--> statement-breakpoint
CREATE TABLE "entity_permission_grants" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" text DEFAULT 'default' NOT NULL,
  "entity_url" text NOT NULL,
  "permission" text NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_value" text NOT NULL,
  "propagation" text DEFAULT 'self' NOT NULL,
  "copy_to_children" boolean DEFAULT false NOT NULL,
  "created_by" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_entity_permission_grants_permission" CHECK ("entity_permission_grants"."permission" IN ('read', 'write', 'delete', 'signal', 'fork', 'schedule', 'spawn', 'manage')),
  CONSTRAINT "chk_entity_permission_grants_subject_kind" CHECK ("entity_permission_grants"."subject_kind" IN ('principal', 'principal_kind')),
  CONSTRAINT "chk_entity_permission_grants_propagation" CHECK ("entity_permission_grants"."propagation" IN ('self', 'descendants'))
);
--> statement-breakpoint
CREATE TABLE "entity_effective_permissions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "tenant_id" text DEFAULT 'default' NOT NULL,
  "entity_url" text NOT NULL,
  "source_entity_url" text NOT NULL,
  "source_grant_id" bigint NOT NULL,
  "permission" text NOT NULL,
  "subject_kind" text NOT NULL,
  "subject_value" text NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_entity_effective_permission" UNIQUE ("tenant_id", "entity_url", "source_grant_id"),
  CONSTRAINT "chk_entity_effective_permissions_permission" CHECK ("entity_effective_permissions"."permission" IN ('read', 'write', 'delete', 'signal', 'fork', 'schedule', 'spawn', 'manage')),
  CONSTRAINT "chk_entity_effective_permissions_subject_kind" CHECK ("entity_effective_permissions"."subject_kind" IN ('principal', 'principal_kind'))
);
--> statement-breakpoint
CREATE TABLE "shared_state_links" (
  "tenant_id" text DEFAULT 'default' NOT NULL,
  "shared_state_id" text NOT NULL,
  "owner_entity_url" text NOT NULL,
  "manifest_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shared_state_links_pkey" PRIMARY KEY ("tenant_id", "owner_entity_url", "manifest_key")
);
--> statement-breakpoint
CREATE INDEX "idx_type_permission_grants_lookup" ON "entity_type_permission_grants" USING btree ("tenant_id", "entity_type", "permission", "subject_kind", "subject_value");
--> statement-breakpoint
CREATE INDEX "idx_type_permission_grants_expiry" ON "entity_type_permission_grants" USING btree ("tenant_id", "expires_at");
--> statement-breakpoint
CREATE INDEX "idx_entity_lineage_descendant" ON "entity_lineage" USING btree ("tenant_id", "descendant_url");
--> statement-breakpoint
CREATE INDEX "idx_entity_permission_grants_entity" ON "entity_permission_grants" USING btree ("tenant_id", "entity_url");
--> statement-breakpoint
CREATE INDEX "idx_entity_permission_grants_subject" ON "entity_permission_grants" USING btree ("tenant_id", "permission", "subject_kind", "subject_value");
--> statement-breakpoint
CREATE INDEX "idx_entity_permission_grants_expiry" ON "entity_permission_grants" USING btree ("tenant_id", "expires_at");
--> statement-breakpoint
CREATE INDEX "idx_entity_effective_permissions_lookup" ON "entity_effective_permissions" USING btree ("tenant_id", "permission", "subject_kind", "subject_value", "entity_url");
--> statement-breakpoint
CREATE INDEX "idx_entity_effective_permissions_entity" ON "entity_effective_permissions" USING btree ("tenant_id", "entity_url");
--> statement-breakpoint
CREATE INDEX "idx_entity_effective_permissions_expiry" ON "entity_effective_permissions" USING btree ("tenant_id", "expires_at");
--> statement-breakpoint
CREATE INDEX "idx_shared_state_links_shared_state" ON "shared_state_links" USING btree ("tenant_id", "shared_state_id");
--> statement-breakpoint
CREATE INDEX "idx_shared_state_links_owner" ON "shared_state_links" USING btree ("tenant_id", "owner_entity_url");
--> statement-breakpoint
-- Pre-permission entity bridge rows do not carry principal attribution. Drop them
-- so observation bridges are rebuilt with principal_url/principal_kind scoping.
DELETE FROM "entity_bridges";
--> statement-breakpoint
ALTER TABLE "entity_bridges" ADD COLUMN "principal_url" text;
--> statement-breakpoint
ALTER TABLE "entity_bridges" ADD COLUMN "principal_kind" text;
--> statement-breakpoint
CREATE INDEX "idx_entity_bridges_principal" ON "entity_bridges" USING btree ("tenant_id", "principal_kind", "principal_url");
