---
"@electric-sql/sync-service": patch
---

Fixed a bug where changes were incorrectly skipped when a record's subquery reference value was in a pending move-in, but the record didn't match other non-subquery conditions in the WHERE clause. For example, with a shape `parent_id IN (SELECT ...) AND status = 'published'`, if the parent became active (triggering a move-in) but the child had `status = 'draft'`, the change would incorrectly be skipped instead of being processed as a delete.
