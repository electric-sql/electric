# Task: Different value for the same DB column returned from subset query and PG replication

## Source
- Downstream: electric-sql/alco-agent-tasks#13
- Upstream: electric-sql/electric#4039

## Problem
When a table has a `CHAR(n)` primary key, values coming through PG replication are correctly space-padded (e.g., "b       " for CHAR(8)), but snapshot and subset queries return trimmed values (e.g., "b"). This creates inconsistency between change messages and full/subset responses.

Additionally, boolean columns are represented as "t"/"f" in replication but "true"/"false" in queries.

## Requirements
1. Write a unit test that reproduces the `char(n)` padding inconsistency
2. Analyze why the subset query returns trimmed values
3. Identify and fix the underlying bug
4. Ensure consistent representation across all response types
