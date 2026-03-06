# Pretend the shape does not have subqueries!

the simplifying concept is we pretend that the shape doesn't have subqueries and instead the move in query uses parameters instead of subqueries where the parameters are populated by in-memory materialized views of the subqueries. so for a shape like `x IN subquery` we would do the move in query as `x IN $moved_in_values AND NOT x in $current_view` where current view does not include the moved in values. the view does not advance until we get the move in results.

## Definitions

virtual view - an imaginary materialized view of a shape's log
subquery view - an in-memory materialization of a subquery at a point in time, a shape will have a subquery view for each of it's direct subqueries. move-ins/outs don't imediately advance the subquery-view (rules below)
shape's log - a change stream a client of the shape consumes

## Invariants

### virtual view consistency (vvc)
the virtual view must match a snapshot at that lsn given the shape's where clause substituting in subquery views for the subqueries

why?
- a missing row in the virtual view may mean you append an update into the log that should have been an insert

how is the invariant maintained?
- move-ins queries use parameters instead of subqueries using appropriate subquery views:
  - the inclusion part of the where clause should use just a moved-in values
  - the exclusion part of the where clause should use the current view (which does not include the moved-in values)
  - the tags use the subquery view once the move is has been applied
- only one move at a time (they're queued) (you can't move out AND then get move-in results back because the exclusions on the move-in query will be wrong and you could have missing rows)
  - move-ins only advance the subquery view when the move-in response is spliced into the log
  - move-outs can go into the log imediately and advance the subquery view imediately, providing there isn't a move-in in flight
- tags for rows must be calulated using the subquery views for that time
  - logs can calculate them using the subquery view
  - move-in queries can get the database to calculate them using the subquery view for the view as it will be once the move-in is applied passed in a a parameter
- for a move-in:
  1) the subquery views (extra_refs) for replication stream filter (lib/electric/shapes/filter.ex) are updated to include the moved in values (for the prototype we'll just have the filter allow all values)
  2) the replication stream is streamed to a file unchanged rather than converted and sent to the shape's log
  3) the move-in query is sent with the appropriate parameters
  4) when the move-in response is received, the point in the buffered replication stream is found (using xmin, xmax, xip_list of the move in)
  5) The shape's log is appended to with:
    1) the rows from the buffered replication stream up to the move-in point, converted (with convert_change) using the subquery view from before the move-in
    2) the move-in response rows
    3) the rows from the buffered replication stream after the move-in point, converted (with convert_change) using the subquery view with the move-in values included
  6) the replication stream can now go back to being immediately converted and sent to the shape's log, however now it's converted using the new subquery view that includes the moved in values

### operation consistency
- there should be no inserts in the shape's log for rows already in the virtual view
- there should be no updates in the shape's log for rows not in the virtual view
- there should be no deletes in the shape's log for rows not in the virtual view

how is the invariant maintained?
- vvc
- Shape.convert_change/3 (lib/electric/shapes/shape.ex) using the subquery views for the time of the change


## Notes

this is a very complicated feature! we want well named modules, probably with their own data structures, that have easy to describe responsibilities, ideally just one responsibility, and that can have nice readable tests. Normal good coding practices but I really want to concentrate on getting these right. Ask me any questions you need to. Lets come up with a plan!

- the buffered log must contain enough for AFTER the move in
    - superset of before and after - we don't know this because a move-in might be late! - but we could know if there's a potential move-in and fall back to following
    - `condition AND x in subquery` → `condition AND true`
