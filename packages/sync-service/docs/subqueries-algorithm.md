Terms:
- "to cover": when an operation is visible in the postgres shapsnot at which the query has been executed. It doesn't on it's own imply that the operation is present in the result set of the query.
- "shadowed": a newer version of the row has been added to the shape log, so when splicing the query results into the log, we skip the row if it has been shadowed.
- "pending move-in": a move-in query has been executed and the results are in-flight, but not yet spliced into the log or we've spliced results but haven't finished filtering on them yet.

System invariants & behaviours:
- INSERT/UPDATE/DELETE order for a single key: for a given key (inferred from table + PK), we never insert an update before an insert, or 2 inserts without a delete in between
- Move-in queries back to postgres return at a defined but uncontrollable point in the replication stream, and we're trying to minimize replication stream processing buffering. Consumer's position in the replication stream may be arbitrarily behind or ahead the view of the database that the query had. It is the job of the consumer to reason about these timelines and place the results correctly and without duplicates
- Move-in query result placement in the output operation log is done with skipping the rows that have already observed a newer operation in the stream (e.g. if query results have r1 and r2 at txn 10, but consumer has already seen a newer change to r2' at txn 11, then old r2 is skipped when splicing the query results into the log)
- Move-out is applied immediately, because we see that operation in the correct order in the stream already, and it doesn't require query-back. If a move-out is observed over a pending move-in value, there are 2 possibilities:
    - If the move-in query results alread inlcude the move-out, then we append the move-out message to the log and do nothing else
    - If the move-in query results do not include the move-out, i.e. the move-out is after the move-in query results, then we append it to the log AND filter the move-in query results to remove the rows that should be no longer visible
        - _Alternatively_, we could buffer at this point and only apply the move-out when the query results are appended to the log, but we're trying to minimize replication stream processing buffering.
- Each row has a set of tags that are used by the client to reason about the row's lifecycle and apply the correct behavior when the row moves out of the shape. Tags are generated from the DNF-normalized where clause, where each tag corresponds to a disjunct. We're always sending an authoritative tag set & activation bitmap, not diffs, so move-in query results must generate complete tag information for each row.
- There are 3 operations, which may occur in some timing combination with move-ins/outs: INSERT, UPDATE, DELETE. If there are no active/recent moves for a shape, then the processing is trivial.
- For all operations, given a move-out is applied immediately, we never propagate the operation if it can be considered moved out
- INSERTs
    - If the pending move-in DOESN'T cover the insert, then we append the insert message to the log immediately and record this row key as shadowed [1].
    - If the pending move-in covers the insert, then we can check if the insert is expected to be present in the result set by executing the where clause. If it is going to be included, we can skip it. [2]
- DELETEs
    - If the pending move-in DOESN'T cover the delete, then we append the delete message to the log immediately and record this row key as shadowed [1].
    - If the pending move-in covers the delete, it still won't be reflected (i.e. absence is not communicated). We append it immediately but don't record it as shadowed, as it won't be visible in the result set anyway.
- UPDATEs - are more complicated because they might (a) change the row in a way that adds/removes itself to/from the shape, and (b) change the row in a way that touches the sublink value(s) which might be in-flight. There's also additional complexity for an `OR` - a given update might be affected by a move-in but also be already in the shape by the other `OR` clause. In that case, we're giving priority to the `OR` clause that is already in the shape in a way that UPDATEs are preferred to INSERTs/DELETEs.
    - (a) Update doesn't touch any sublink values, but references a moved-in value
        - If the pending move-in DOESN'T cover the update, then we append the update message to the log immediately and record this row key as shadowed [1].
        - If the pending move-in covers the update, then we can check if the update is expected to be present in the result set by executing the where clause. If it is going to be included, we can skip it. [2]
    - (b) Update updates a sublink value
        - If an updated value has been moved out prior to this, then we skip the update
        - If old value is NOT in the linked value set and new value has a pending move-in, then convert the update to insert and:
            - If pending move-in doesn't cover the update, then we append the update message to the log immediately and record this row key as shadowed [1].
            - If pending move-in covers the update, then we can check if the update is expected to be present in the result set by executing the where clause. If it is going to be included, we can skip it. [2]
        - If old value is in the linked value set and new value has a pending move-in, then keep update as update and:
            - If pending move-in doesn't cover the update, then we append the update message to the log immediately and record this row key as shadowed [1].
            - If pending move-in covers the update, then we can check if the update is expected to be present in the result set by executing the where clause. If it is going to be included, we can skip it. [2]
        - If old value is one of the pending move-in values and the new value is in the linked value set, then:
            - If pending move-in doesn't cover the update, then convert the update to insert, append to the log immediately and record this row key as shadowed [1].
            - If pending move-in covers the update, then it won't be present in the result set of the move-in (because link value has changed), so we convert it to insert and append to the log immediately, but don't record this row key as shadowed.
        - If old value is one of the pending move-in values and the new value is NOT in the linked value set,
            - If pending move-in doesn't cover the update, then it might be present in the result set, so we don't append it at all, but record this row key as shadowed for it to be skipped [1].
            - If pending move-in covers the update, then it won't be present in the result set of the move-in (because link value has changed), so we skip it
        - If old value is one of the pending move-in values (A) AND the new value is one of the pending move-in values (B), then we need to check whether the move-ins are the same or different.
            - If pending move-ins are the same, then we
                - If pending move-in doesn't cover the update, then we convert to insert and append to the log immediately and record this row key as shadowed [1].
                - If pending move-in covers the update, then we can check if the update is expected to be present in the result set by executing the where clause. If it is going to be included, we can skip it. [2]
            - If pending move-ins are different, then one is definitely ahead of the other
                - If update is covered by both move-ins, then we can check if the update is expected to be present in the result set by executing the where clause. If it is going to be included, we can skip it. [2]
                - If update is not covered by both move-ins, then we convert to insert and append to the log immediately, and record this row key as shadowed for both move-ins. [1]
                - If update is covered by (B) but not (A), then it (A) will return this row with the old value, and (B) will return this row with the new value. We thus check if this update will be included in the result set of (B). If it is, we can skip it. [2], otherwise we convert to insert and append to the log immediately. In both cases we record this row key as shadowed for move-in (A) (because it will be either covered by the update or result set of (B))
                - If update is covered by (A) but not (B), then move-in A's query sees the row with new_value. But new_value belongs to move-in B's linked set, not A's -> move-in A won't return this row. Move-in B's query sees the row with old_value. But old_value belongs to move-in A's linked set, not B's -> move-in B won't return this row either. Neither query captures the row, yet the row with new_value should be in the shape. So: convert to insert, append to log immediately, and shadow for both move-ins [1].

- On mutual exclusion of concurrent move-in queries for different disjuncts:
  Move-in queries for different disjuncts could theoretically produce a gap where a row matching both new linked values is excluded by both queries' NOT(other_disjunct) clauses. This doesn't happen because replication stream processing is sequential: when the first move-in event is processed, the second disjunct's linked value set hasn't been updated yet, so the first query's NOT clause doesn't exclude the row. By the time the second move-in is processed, the first disjunct's linked values already include the new value, so the second query correctly skips the row via NOT.

- On tag lifecycle for rows matching multiple disjuncts:
  Tags are always sent as complete sets (all disjuncts) with an activation bitmap (which disjuncts are TRUE). When a move-in adds a new linked value that causes an already-present row to match an additional disjunct, a "move-in tag activation" message is sent to the client to update the activation bitmap. The client already has the full tag set and can recalculate references. Move-out events similarly update tag activation. A row with no active disjuncts is implicitly deleted on the client side - it is not visible, and the next visible update or move-in will be sent as an INSERT.

- On move-in -> move-out -> move-in chains:
  A move-out functionally invalidates a prior pending move-in by filtering its results. The second move-in starts with a fresh shadow set. Operations between the move-out and the second move-in are skipped (the row is moved out at that point, so they are not propagated). A single operation that occurs after both move-ins may shadow both; an operation after only one shadows only that one.

[1]: _consistency note_: yes, that means one row might appear in the log earlier than the query results. Only avoidable with buffering. If a move-out occurs immediately after, then the client will know to remove/GC the row appropriately because move-outs are correctly ordered by stream definition.
[2]: _implementation note_: current code is using old logic which doesn't account for arbitrary where clauses, and only checks for the sublink value in the where clause, this should be replaced with a proper where clause evaluation