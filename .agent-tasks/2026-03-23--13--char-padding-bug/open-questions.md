# Open Questions

## char(n)[] array columns

The fix uses `pg_typeof(col) = 'character'::regtype` to detect bpchar columns. For `char(n)[]` array columns, `pg_typeof` returns `character[]` which does not match `'character'::regtype`. This means array elements of char(n) arrays may still have their padding trimmed.

This is a known limitation. Fixing it would require extending the CASE expression to also check for `'character[]'::regtype` and then handling the array elements individually (or using a different approach entirely). Given that char(n) arrays are rare and the primary use case is char(n) scalar columns, this can be addressed as a follow-up if needed.
