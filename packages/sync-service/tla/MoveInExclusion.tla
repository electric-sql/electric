------------------------------ MODULE MoveInExclusion ------------------------------
(***************************************************************************)
(* Models the "materialized-state exclusion with seen/unseen tracking"     *)
(* algorithm from PLAN_UPDATE.md.                                          *)
(*                                                                         *)
(* Shape: WHERE x IN (subqueryX) OR y IN (subqueryY) on table t           *)
(*                                                                         *)
(* The key insight: when multiple subqueries change in the same            *)
(* transaction, the consumer must use pre-txn state for "unseen"           *)
(* dependencies (whose materializer_changes haven't been processed yet)    *)
(* and current state for "seen" dependencies (already processed).          *)
(*                                                                         *)
(* We verify:                                                              *)
(*   1. No missed rows (every row matching the shape is delivered)         *)
(*   2. No duplicate rows (each row delivered at most once per txn)        *)
(*   3. Correctness independent of processing order                        *)
(***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets, TLC

(***************************************************************************)
(* CONSTANTS                                                               *)
(***************************************************************************)

CONSTANTS
    Rows,           \* Set of row identifiers, e.g. {"t1", "t2"}
    Deps,           \* Set of dependency (subquery) identifiers, e.g. {"X", "Y"}
    Values          \* Universe of possible values, e.g. {"x1", "x2", "y1", "y2"}

(***************************************************************************)
(* Each row has a column value per dependency. For the shape               *)
(* WHERE x IN sqX OR y IN sqY, row t1 has x-column = x1, y-column = y1.  *)
(*                                                                         *)
(* RowValues[r][d] = the value of row r in the column for dependency d.   *)
(* MaterializerPre[d] = set of values in dep d BEFORE the transaction.    *)
(* MaterializerPost[d] = set of values in dep d AFTER the transaction.    *)
(***************************************************************************)

CONSTANTS
    RowValues,          \* [Rows -> [Deps -> Values]]
    MaterializerPre,    \* [Deps -> SUBSET Values]  (pre-txn state)
    MaterializerPost    \* [Deps -> SUBSET Values]  (post-txn state)

(***************************************************************************)
(* A row matches the shape if ANY dependency's materializer contains       *)
(* the row's column value for that dependency.                             *)
(***************************************************************************)

MatchesPre(r) ==
    \E d \in Deps : RowValues[r][d] \in MaterializerPre[d]

MatchesPost(r) ==
    \E d \in Deps : RowValues[r][d] \in MaterializerPost[d]

(***************************************************************************)
(* A row is a "new match" if it matches post-txn but not pre-txn.         *)
(* These are the rows that move-in queries must deliver.                   *)
(***************************************************************************)

IsNewMatch(r) == MatchesPost(r) /\ ~MatchesPre(r)

(***************************************************************************)
(* Changed deps are those whose materializer state differs pre/post.      *)
(***************************************************************************)

ChangedDeps == {d \in Deps : MaterializerPre[d] # MaterializerPost[d]}

(***************************************************************************)
(* VARIABLES                                                               *)
(***************************************************************************)

VARIABLES
    seenDeps,       \* Set of deps whose materializer_changes have been processed
    processing,     \* The dep currently being processed ("none" if idle)
    delivered,      \* Set of rows returned by move-in queries so far
    moveInResults,  \* Sequence of (dep, rows) results for debugging
    done            \* Whether all changed deps have been processed

vars == <<seenDeps, processing, delivered, moveInResults, done>>

(***************************************************************************)
(* TYPE INVARIANT                                                          *)
(***************************************************************************)

TypeOK ==
    /\ seenDeps \subseteq Deps
    /\ processing \in Deps \cup {"none"}
    /\ delivered \subseteq Rows
    /\ done \in BOOLEAN

(***************************************************************************)
(* MOVE-IN QUERY SIMULATION                                                *)
(*                                                                         *)
(* When processing dep d's materializer_changes, the move-in query for    *)
(* dep d returns rows where:                                               *)
(*   1. The row's value for d is in the NEW values added to d             *)
(*   2. For every OTHER dep d2 in a different disjunct:                   *)
(*      - If d2 is "seen": exclude if row's d2-value in CURRENT state    *)
(*      - If d2 is "unseen": exclude if row's d2-value in PRE-TXN state  *)
(*                                                                         *)
(* This models the OR-of-disjuncts shape where each disjunct has one dep. *)
(***************************************************************************)

\* Values newly added to dep d in this transaction
NewValues(d) == MaterializerPost[d] \ MaterializerPre[d]

\* The materialized state used for exclusion of dep d2, given seen set
ExclusionState(d2, seen) ==
    IF d2 \in seen
    THEN MaterializerPost[d2]   \* seen: use current (post-txn) state
    ELSE MaterializerPre[d2]    \* unseen: use pre-txn state

\* Move-in query result when processing dep d, given current seen set
MoveInQuery(d, seen) ==
    {r \in Rows :
        \* Row's value for d is newly added
        /\ RowValues[r][d] \in NewValues(d)
        \* Row was not already in the shape (matched pre-txn)
        /\ ~MatchesPre(r)
        \* Not excluded by any other dep's materialized state
        /\ \A d2 \in Deps \ {d} :
            RowValues[r][d2] \notin ExclusionState(d2, seen)
    }

(***************************************************************************)
(* INITIAL STATE                                                           *)
(***************************************************************************)

Init ==
    /\ seenDeps = {}
    /\ processing = "none"
    /\ delivered = {}
    /\ moveInResults = <<>>
    /\ done = FALSE

(***************************************************************************)
(* ACTIONS                                                                 *)
(***************************************************************************)

\* Pick a changed dep that hasn't been processed yet
ProcessDep(d) ==
    /\ ~done
    /\ processing = "none"
    /\ d \in ChangedDeps
    /\ d \notin seenDeps
    /\ LET queryResult == MoveInQuery(d, seenDeps)
       IN /\ seenDeps' = seenDeps \cup {d}
          /\ delivered' = delivered \cup queryResult
          /\ moveInResults' = Append(moveInResults, <<d, queryResult>>)
          /\ processing' = "none"
          /\ done' = IF seenDeps' = ChangedDeps THEN TRUE ELSE FALSE

\* All changed deps processed — mark done
FinishProcessing ==
    /\ ~done
    /\ seenDeps = ChangedDeps
    /\ done' = TRUE
    /\ UNCHANGED <<seenDeps, processing, delivered, moveInResults>>

Next ==
    \/ \E d \in Deps : ProcessDep(d)
    \/ FinishProcessing

Spec == Init /\ [][Next]_vars /\ WF_vars(Next) /\ \A d \in Deps : WF_vars(ProcessDep(d))

(***************************************************************************)
(* CORRECTNESS PROPERTIES                                                  *)
(***************************************************************************)

\* The set of rows that SHOULD be delivered (new matches for this txn)
ExpectedNewMatches == {r \in Rows : IsNewMatch(r)}

\* SAFETY: No row is delivered that shouldn't be
\* (only new matches are delivered)
NoSpuriousDelivery ==
    delivered \subseteq ExpectedNewMatches

\* SAFETY: At any point, the delivered set contains no duplicates
\* (delivered is a set, so this is structural — but we also check
\* that move-in results don't overlap)
NoDuplicateResults ==
    \A i, j \in 1..Len(moveInResults) :
        i # j =>
            (moveInResults[i][2] \cap moveInResults[j][2]) = {}

\* LIVENESS: When done, all new matches have been delivered
AllNewMatchesDelivered ==
    done => (delivered = ExpectedNewMatches)

\* Combined invariant
SafetyInvariant ==
    /\ TypeOK
    /\ NoSpuriousDelivery
    /\ NoDuplicateResults

\* Temporal property: eventually all new matches are delivered
LivenessProperty ==
    <>(done /\ delivered = ExpectedNewMatches)

(***************************************************************************)
(* COMPARISON: The buggy "live exclusion" approach                        *)
(* This uses post-txn state for ALL deps, reproducing the bug.            *)
(***************************************************************************)

BuggyMoveInQuery(d) ==
    {r \in Rows :
        /\ RowValues[r][d] \in NewValues(d)
        /\ \A d2 \in Deps \ {d} :
            \* Bug: always uses post-txn state, even for unseen deps
            RowValues[r][d2] \notin MaterializerPost[d2]
    }

=============================================================================
