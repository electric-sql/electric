INSERT INTO "entity_type_permission_grants" (
  "tenant_id",
  "entity_type",
  "permission",
  "subject_kind",
  "subject_value"
)
SELECT
  "entity_types"."tenant_id",
  "entity_types"."name",
  'manage',
  'principal_kind',
  'user'
FROM "entity_types"
WHERE "entity_types"."name" = 'horton'
  AND NOT EXISTS (
    SELECT 1
    FROM "entity_type_permission_grants"
    WHERE "entity_type_permission_grants"."tenant_id" = "entity_types"."tenant_id"
      AND "entity_type_permission_grants"."entity_type" = "entity_types"."name"
      AND "entity_type_permission_grants"."permission" = 'manage'
      AND "entity_type_permission_grants"."subject_kind" = 'principal_kind'
      AND "entity_type_permission_grants"."subject_value" = 'user'
      AND "entity_type_permission_grants"."expires_at" IS NULL
  );
