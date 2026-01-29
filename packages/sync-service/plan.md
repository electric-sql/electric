# Postgres as an Oracle

## Overview

look at the tests in ./test/integration . They're written at a level where electric (a combination of the sync-service and the elixir-client) starts to behave a lot like Postgres. It's not quite the same,
  the client doesn't materialize the view but Postgres does, but that's just a few logical steps. 

The pattern is:
- given some tables
- create a view by specifing one of those tables to select and a where clause (the where clause can mention the other tables in subqueries if it wants to)
- make a change to those tables
- check the view is updates accordingly

The view here is either:
- a materialized view based on the output of the electric client (in combination with the sync-service and postgres)
- a direct query to postgres

The key point here is that if Electric does not have bugs, these two views should match.

This pattern can be used over all known where clauses and we'll have a great way of ensuring electric is correct.

## Deep investigation

How could we impliment these tests? Property tests? What properties do we already have in the elixir code or should we consider alternatives? We're going to be using LLMs to generate code and humans may not read all of the code, but a human should be able to see what is happening at a high level and what is being tested.

Do some deep research. Consider at least 3 alternatives and weigh up the pros and cons of each.

## Defining correctness and whether a where clause is optimised

For any given change that affects the view, the live request to the elixir client may:

1) give the correct change
2) give an incorrect change
3) won't return for 20s
4) returns only up-to-date
5) give an 409
6) give an error other than a 409
7) does something else

2,3,4,6 and 7 are all bugs. 1 is ideal. 5 is acceptable but not optimised and we should be able to define a subset of where clauses that are optimised and be able to test that they are indeed optimsed (don't return 409s)

For any given change that affects the view, the live request to the elixir client may:

1) give an update that doesn't change any values in the view
2) gives an change that does change the values in the view
3) won't return for 20s
4) returns only up-to-date
5) gives an 409
6) give an error other than a 409
7) does something else

2,6 and 7 are all bugs. 1,3,4 are all fine. 5 is acceptable but not optimised and we should be able to define a subset of where clauses that are optimised and be able to test that they are indeed optimsed (don't return 409s)

## Other considerations

- It would be nice to run many tests in parralel on the same database, e.g. same set of tables, many differert where clauses (shapes) on them, make a change to the tables then check each shape's view matches the equivalent postgres view
- The test setup may be slow so having a single setup with many changes and checks would be good
- We may want to introduce other views, e.g. the typescript client, in the future
