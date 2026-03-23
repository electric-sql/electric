# Task: Electric shape endpoint rejects stored generated columns on PostgreSQL 18

## Source
- Upstream issue: electric-sql/electric#4038
- Task issue: electric-sql/alco-agent-tasks#14

## Problem
A user reports that Electric rejects shape requests for tables containing stored generated columns on PostgreSQL 18, returning a 400 error:

```json
{
  "message": "Invalid request",
  "errors": {
    "columns": [
      "The following columns are generated and cannot be included in the shape: hours, shift_date. You can exclude them from the shape by explicitly listing which columns to fetch in the 'columns' query param"
    ]
  }
}
```

The user's publication is correctly configured with `publish_generated_columns = 'stored'` (verified via `pubgencols = 's'`).

## Analysis

### Two separate issues identified

#### 1. User's reported 400 error (likely version/environment issue)
The 400 error comes from `shape.ex:validate_selected_columns/4` which checks `supports_generated_column_replication` from the inspector. This is a PG version check (`server_version_num >= 180000`). On genuine PG18, this should return `true`.

The most likely explanation is:
- User is running an older Electric Docker image that predates PR #3297 (merged Oct 2025, available since v1.2.0)
- Or a stale Docker cache on Railway

#### 2. Real code gap: publication upgrade path (would cause 503)
When a publication was created by an older Electric version (or on PG < 18), it won't have `publish_generated_columns = stored`. If the user then upgrades to PG18, Electric:
- Detects PG18 → shape validation passes (no 400)
- But publication status check returns `publishes_generated_columns?: false`
- Relation tracker returns `DbConfigurationError` → 503 error

**The fix needed**: When Electric detects it owns the publication, is on PG18+, and the publication doesn't publish generated columns, it should `ALTER PUBLICATION ... SET (publish_generated_columns = stored)`.
