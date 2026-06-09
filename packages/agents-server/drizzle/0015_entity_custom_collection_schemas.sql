ALTER TABLE "entity_types" ADD COLUMN "custom_collection_schemas" jsonb;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "custom_collection_schemas" jsonb;
