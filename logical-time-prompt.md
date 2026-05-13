 see the subquery work: a04b25962cdb7ca86c4434585b6f74c758e1a31b

and see docs/rfcs/subquery-index.md

The issue with the RFC's design is that the shape consumers still have a copy of the materialized views of subqueries, often two (one for before and one for after a move in). We need to consider this memory as well.

I also suspect that, even though removal of a shape might be O(1)ish, removal of a whole subquery would be O(n) with n as the total number of shapes, which is not acceptable.

I'm wondering if we could just have a single place we store a materialized view for any particular subquery, but have the ability to read it at separate logical times. e.g. the subquery `SELECT id FROM users WHERE enabled=true` might be materialized as [1,2,3,4] and then user 5 moves in an we increase logical time from 100, to 101, we need the ability to read the materialized view at both logical times, so M(100) = [1,2,3,4] and M(101) = [1,2,3,4,5]. Differencial Dataflow systems do something similar, right? That way the current materializer.ex could populate the ETS table and increase the logical time with each move, and pass the logical time to the shape consumer, which can then read the materialized view at the appropriate logical time. The where clause filter index needs to also read from this ETS table and be widened to allow through rows for all "in-flight" logical times. 

As a value can move in and out over time, it seems like we need to keep a history for a row, but if that gets expensive then we don't actually need to read logical times from before the earliest in-flight logical time.

How does this sound?
