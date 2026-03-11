## Excessive message passing and waking of consumers
- %LsnUpdate{} is sent to all consumers
- Filter treats `IN subquery` as `TRUE`

## Excessive memory usage
- Subquery materialized views are held in consumer memory in addition to be held in memory in the Materializer
- The log buffer is held in memory while the move-query is in flight but could get very large and so should be on disk
- the before and after views are held in consumer memory
