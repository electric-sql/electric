#!/usr/bin/env python3
"""
Exhaustive model checker for the materialized-state exclusion algorithm.

Models the algorithm from PLAN_UPDATE.md and checks:
  1. No missed rows (every new match is delivered)
  2. No duplicate rows (each row delivered by exactly one move-in query)
  3. No spurious rows (only new matches are delivered)
  4. Order-independence (result is the same regardless of dep processing order)

Explores ALL permutations of dependency processing order.
"""

from itertools import permutations
from dataclasses import dataclass, field
from typing import FrozenSet


@dataclass(frozen=True)
class Scenario:
    """A test scenario for the move-in exclusion algorithm."""
    name: str
    rows: tuple                                        # Row IDs
    deps: tuple                                        # Dependency (subquery) IDs
    row_values: dict                                   # {row: {dep: value}}
    materializer_pre: dict                             # {dep: frozenset(values)}
    materializer_post: dict                            # {dep: frozenset(values)}

    def matches_pre(self, row):
        """Does row match the shape using pre-txn materializer state?"""
        return any(
            self.row_values[row][d] in self.materializer_pre[d]
            for d in self.deps
        )

    def matches_post(self, row):
        """Does row match the shape using post-txn materializer state?"""
        return any(
            self.row_values[row][d] in self.materializer_post[d]
            for d in self.deps
        )

    def is_new_match(self, row):
        """Row newly matches post-txn (wasn't matching pre-txn)."""
        return self.matches_post(row) and not self.matches_pre(row)

    def expected_new_matches(self):
        """All rows that should be delivered by move-in queries."""
        return frozenset(r for r in self.rows if self.is_new_match(r))

    def changed_deps(self):
        """Dependencies whose state changed in this transaction."""
        return [d for d in self.deps
                if self.materializer_pre[d] != self.materializer_post[d]]

    def new_values(self, dep):
        """Values newly added to dep in this transaction."""
        return self.materializer_post[dep] - self.materializer_pre[dep]


def exclusion_state(scenario, dep, seen_deps):
    """
    The materialized state to use for excluding dep's values.

    - Seen deps: use current (post-txn) state
    - Unseen deps: use pre-txn state
    """
    if dep in seen_deps:
        return scenario.materializer_post[dep]
    else:
        return scenario.materializer_pre[dep]


def move_in_query(scenario, dep, seen_deps):
    """
    Simulate the move-in query when processing dep's materializer_changes.

    Returns the set of rows that would be returned.

    Two layers of filtering:
    1. Pre-existing: rows already in the shape (matched pre-txn) are excluded.
       In the real system this is handled by the shape log / client state —
       the move-in query only targets rows not already delivered.
    2. Cross-dep exclusion: rows matching another dep's materialized state are
       excluded to prevent duplicates between concurrent move-ins.
    """
    new_vals = scenario.new_values(dep)
    result = set()

    for row in scenario.rows:
        # Row's value for this dep must be newly added
        if scenario.row_values[row][dep] not in new_vals:
            continue

        # Layer 1: Skip rows already in the shape from prior transactions.
        # In the real system, the consumer knows which rows are already
        # in the shape log and excludes them from move-in query results.
        if scenario.matches_pre(row):
            continue

        # Layer 2: Cross-dep exclusion (the seen/unseen algorithm)
        excluded = False
        for other_dep in scenario.deps:
            if other_dep == dep:
                continue
            exc_state = exclusion_state(scenario, other_dep, seen_deps)
            if scenario.row_values[row][other_dep] in exc_state:
                excluded = True
                break

        if not excluded:
            result.add(row)

    return frozenset(result)


def buggy_move_in_query(scenario, dep):
    """
    The BUGGY live-exclusion approach: always uses post-txn state.
    This is what PLAN_UPDATE.md identifies as broken.
    """
    new_vals = scenario.new_values(dep)
    result = set()

    for row in scenario.rows:
        if scenario.row_values[row][dep] not in new_vals:
            continue

        excluded = False
        for other_dep in scenario.deps:
            if other_dep == dep:
                continue
            # BUG: always uses post-txn state
            if scenario.row_values[row][other_dep] in scenario.materializer_post[other_dep]:
                excluded = True
                break

        if not excluded:
            result.add(row)

    return frozenset(result)


def check_ordering(scenario, ordering):
    """
    Process changed deps in the given ordering, return (delivered, per_dep_results).
    Uses the correct seen/unseen algorithm.
    """
    seen_deps = set()
    delivered = set()
    per_dep_results = {}

    for dep in ordering:
        result = move_in_query(scenario, dep, frozenset(seen_deps))
        per_dep_results[dep] = result
        delivered.update(result)
        seen_deps.add(dep)

    return frozenset(delivered), per_dep_results


def check_buggy_ordering(scenario, ordering):
    """
    Process changed deps using the BUGGY algorithm.
    """
    delivered = set()
    per_dep_results = {}

    for dep in ordering:
        result = buggy_move_in_query(scenario, dep)
        per_dep_results[dep] = result
        delivered.update(result)

    return frozenset(delivered), per_dep_results


def verify_scenario(scenario):
    """
    Exhaustively check all orderings for a scenario.
    Returns (passed, failures, details).
    """
    changed = scenario.changed_deps()
    expected = scenario.expected_new_matches()
    all_orderings = list(permutations(changed))

    print(f"\n{'='*70}")
    print(f"Scenario: {scenario.name}")
    print(f"  Rows: {scenario.rows}")
    print(f"  Deps: {scenario.deps}")
    print(f"  Changed deps: {changed}")
    print(f"  Expected new matches: {expected}")
    print(f"  Orderings to check: {len(all_orderings)}")
    print(f"{'='*70}")

    failures = []
    all_delivered = set()

    for ordering in all_orderings:
        delivered, per_dep = check_ordering(scenario, ordering)
        all_delivered.add(delivered)

        order_str = " -> ".join(ordering)

        # Check 1: All new matches delivered
        missing = expected - delivered
        if missing:
            failures.append(f"  FAIL [{order_str}]: Missing rows: {missing}")

        # Check 2: No spurious deliveries
        spurious = delivered - expected
        if spurious:
            failures.append(f"  FAIL [{order_str}]: Spurious rows: {spurious}")

        # Check 3: No duplicates (rows returned by multiple dep queries)
        for d1 in changed:
            for d2 in changed:
                if d1 < d2:
                    overlap = per_dep[d1] & per_dep[d2]
                    if overlap:
                        failures.append(
                            f"  FAIL [{order_str}]: Duplicate delivery by "
                            f"{d1} and {d2}: {overlap}"
                        )

        # Print details
        print(f"\n  Order: {order_str}")
        for dep in ordering:
            print(f"    {dep} -> returned: {per_dep[dep]}")
        print(f"    Total delivered: {delivered}")
        status = "OK" if delivered == expected else "FAIL"
        print(f"    Status: {status}")

    # Check 4: Order independence
    if len(all_delivered) > 1:
        failures.append(
            f"  FAIL: Results differ across orderings: {all_delivered}"
        )

    # Now test the buggy algorithm
    print(f"\n  --- Buggy (live exclusion) comparison ---")
    buggy_failures = []
    for ordering in all_orderings:
        delivered, per_dep = check_buggy_ordering(scenario, ordering)
        order_str = " -> ".join(ordering)
        missing = expected - delivered
        if missing:
            buggy_failures.append((order_str, missing))
        print(f"  Buggy [{order_str}]: delivered={delivered}, missing={missing}")

    if buggy_failures:
        print(f"  Buggy algorithm FAILS for {len(buggy_failures)}/{len(all_orderings)} orderings")
    else:
        print(f"  Buggy algorithm happens to pass (no concurrent conflict in this scenario)")

    return len(failures) == 0, failures


def main():
    scenarios = [
        # Scenario 1: The exact PLAN_UPDATE.md bug case
        Scenario(
            name="Two subqueries, same txn (PLAN_UPDATE.md example)",
            rows=("t1", "t2"),
            deps=("X", "Y"),
            row_values={
                "t1": {"X": "x1", "Y": "y1"},
                "t2": {"X": "x2", "Y": "y2"},
            },
            materializer_pre={"X": frozenset(), "Y": frozenset()},
            materializer_post={"X": frozenset({"x1"}), "Y": frozenset({"y1"})},
        ),

        # Scenario 2: Three subqueries all changing (6 orderings)
        Scenario(
            name="Three subqueries, all changing",
            rows=("t1",),
            deps=("X", "Y", "Z"),
            row_values={
                "t1": {"X": "x1", "Y": "y1", "Z": "z1"},
            },
            materializer_pre={"X": frozenset(), "Y": frozenset(), "Z": frozenset()},
            materializer_post={
                "X": frozenset({"x1"}),
                "Y": frozenset({"y1"}),
                "Z": frozenset({"z1"}),
            },
        ),

        # Scenario 3: Partial overlap
        Scenario(
            name="Partial overlap (some rows match one dep, some both)",
            rows=("t1", "t2", "t3"),
            deps=("X", "Y"),
            row_values={
                "t1": {"X": "x1", "Y": "y1"},
                "t2": {"X": "x2", "Y": "y2"},
                "t3": {"X": "x3", "Y": "y3"},
            },
            materializer_pre={"X": frozenset(), "Y": frozenset()},
            materializer_post={
                "X": frozenset({"x1", "x2"}),
                "Y": frozenset({"y1", "y3"}),
            },
        ),

        # Scenario 4: Pre-existing match (row already in shape)
        Scenario(
            name="Pre-existing match (t1 already matches via X)",
            rows=("t1", "t2"),
            deps=("X", "Y"),
            row_values={
                "t1": {"X": "x1", "Y": "y1"},
                "t2": {"X": "x2", "Y": "y2"},
            },
            materializer_pre={"X": frozenset({"x1"}), "Y": frozenset()},
            materializer_post={"X": frozenset({"x1"}), "Y": frozenset({"y1"})},
        ),

        # Scenario 5: Only one dep changes (baseline)
        Scenario(
            name="Single dep change (no concurrency issue)",
            rows=("t1", "t2"),
            deps=("X", "Y"),
            row_values={
                "t1": {"X": "x1", "Y": "y1"},
                "t2": {"X": "x2", "Y": "y2"},
            },
            materializer_pre={"X": frozenset(), "Y": frozenset()},
            materializer_post={"X": frozenset({"x1"}), "Y": frozenset()},
        ),

        # Scenario 6: Both deps add multiple values, multiple rows match
        Scenario(
            name="Multiple values per dep, multiple matching rows",
            rows=("t1", "t2", "t3", "t4"),
            deps=("X", "Y"),
            row_values={
                "t1": {"X": "x1", "Y": "y1"},   # matches both
                "t2": {"X": "x2", "Y": "y2"},   # matches both
                "t3": {"X": "x1", "Y": "y3"},   # matches X only
                "t4": {"X": "x4", "Y": "y1"},   # matches Y only
            },
            materializer_pre={"X": frozenset(), "Y": frozenset()},
            materializer_post={
                "X": frozenset({"x1", "x2"}),
                "Y": frozenset({"y1", "y2"}),
            },
        ),

        # Scenario 7: Value removed from one dep, added to another
        Scenario(
            name="Cross-movement: value leaves X, enters Y",
            rows=("t1", "t2"),
            deps=("X", "Y"),
            row_values={
                "t1": {"X": "x1", "Y": "y1"},
                "t2": {"X": "x2", "Y": "y2"},
            },
            materializer_pre={"X": frozenset({"x1"}), "Y": frozenset()},
            materializer_post={"X": frozenset(), "Y": frozenset({"y1"})},
        ),

        # Scenario 8: Four deps, only two change
        Scenario(
            name="Four deps, two change (mixed stable/changing)",
            rows=("t1",),
            deps=("A", "B", "C", "D"),
            row_values={
                "t1": {"A": "a1", "B": "b1", "C": "c1", "D": "d1"},
            },
            materializer_pre={
                "A": frozenset(), "B": frozenset(),
                "C": frozenset(), "D": frozenset(),
            },
            materializer_post={
                "A": frozenset({"a1"}), "B": frozenset(),
                "C": frozenset({"c1"}), "D": frozenset(),
            },
        ),

        # Scenario 9: Row matches via pre-existing dep, both deps change
        # t1 already in shape via X=x1, now Y adds y1 AND X adds x2
        # t1 should NOT be re-delivered (already in shape)
        # t2 has X=x2 which is newly added -> should be delivered
        Scenario(
            name="Existing row, both deps change, no re-delivery",
            rows=("t1", "t2"),
            deps=("X", "Y"),
            row_values={
                "t1": {"X": "x1", "Y": "y1"},
                "t2": {"X": "x2", "Y": "y2"},
            },
            materializer_pre={"X": frozenset({"x1"}), "Y": frozenset()},
            materializer_post={"X": frozenset({"x1", "x2"}), "Y": frozenset({"y1"})},
        ),

        # Scenario 10: Shared column value — two rows have the same x value
        # Both match via X, only one also matches via Y
        # Verifies that the exclusion correctly handles shared values
        Scenario(
            name="Shared column value between rows",
            rows=("t1", "t2"),
            deps=("X", "Y"),
            row_values={
                "t1": {"X": "x1", "Y": "y1"},
                "t2": {"X": "x1", "Y": "y2"},  # same x as t1
            },
            materializer_pre={"X": frozenset(), "Y": frozenset()},
            materializer_post={"X": frozenset({"x1"}), "Y": frozenset({"y1"})},
        ),

        # Scenario 11: All rows match ALL deps simultaneously
        # Every row matches every dep -> first dep processed claims all
        Scenario(
            name="All rows match all deps (maximum overlap)",
            rows=("t1", "t2"),
            deps=("X", "Y"),
            row_values={
                "t1": {"X": "x1", "Y": "y1"},
                "t2": {"X": "x2", "Y": "y2"},
            },
            materializer_pre={"X": frozenset(), "Y": frozenset()},
            materializer_post={
                "X": frozenset({"x1", "x2"}),
                "Y": frozenset({"y1", "y2"}),
            },
        ),

        # Scenario 12: Diamond — row t1 matches via X and Z but not Y,
        # row t2 matches via Y and Z but not X
        # Three deps, all change, complex overlap
        Scenario(
            name="Diamond overlap across three deps",
            rows=("t1", "t2"),
            deps=("X", "Y", "Z"),
            row_values={
                "t1": {"X": "x1", "Y": "y_miss", "Z": "z1"},
                "t2": {"X": "x_miss", "Y": "y2", "Z": "z1"},  # shares z1
            },
            materializer_pre={
                "X": frozenset(), "Y": frozenset(), "Z": frozenset(),
            },
            materializer_post={
                "X": frozenset({"x1"}),
                "Y": frozenset({"y2"}),
                "Z": frozenset({"z1"}),
            },
        ),

        # Scenario 13: Large — 3 deps, 4 rows, mixed pre-existing and new
        # t1: pre-existing via X, now also via Y -> no re-delivery
        # t2: new via X and Z -> delivered once
        # t3: new via Y only -> delivered
        # t4: doesn't match anything -> not delivered
        Scenario(
            name="Large mixed scenario (3 deps, 4 rows)",
            rows=("t1", "t2", "t3", "t4"),
            deps=("X", "Y", "Z"),
            row_values={
                "t1": {"X": "x1", "Y": "y1", "Z": "z_miss"},
                "t2": {"X": "x2", "Y": "y_miss", "Z": "z2"},
                "t3": {"X": "x_miss", "Y": "y3", "Z": "z_miss"},
                "t4": {"X": "x_miss", "Y": "y_miss", "Z": "z_miss"},
            },
            materializer_pre={
                "X": frozenset({"x1"}), "Y": frozenset(), "Z": frozenset(),
            },
            materializer_post={
                "X": frozenset({"x1", "x2"}),
                "Y": frozenset({"y1", "y3"}),
                "Z": frozenset({"z2"}),
            },
        ),
    ]

    total_passed = 0
    total_failed = 0
    all_failures = []

    for scenario in scenarios:
        passed, failures = verify_scenario(scenario)
        if passed:
            total_passed += 1
            print(f"\n  RESULT: PASSED")
        else:
            total_failed += 1
            print(f"\n  RESULT: FAILED")
            for f in failures:
                print(f)
            all_failures.extend(failures)

    print(f"\n{'='*70}")
    print(f"SUMMARY: {total_passed} passed, {total_failed} failed "
          f"out of {len(scenarios)} scenarios")
    print(f"{'='*70}")

    if all_failures:
        print("\nAll failures:")
        for f in all_failures:
            print(f)
        return 1

    print("\nAll scenarios passed. The seen/unseen algorithm is correct")
    print("for all tested scenarios across all processing orderings.")
    return 0


if __name__ == "__main__":
    exit(main())
