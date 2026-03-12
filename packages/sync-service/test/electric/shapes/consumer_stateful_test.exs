defmodule Electric.Shapes.ConsumerStatefulTest do
  @moduledoc """
  Each test targets a known case in the move-in/move-out algorithm.

  ## Available events:
  - `{:set_linked_values, values: [1, 2]}` - initial setup event, sets the linked values at the start of the test
  - `{:initial_rows, rows: [%{id: 1, value: "a", parent_id: 5}]}` - initial setup event, sets the initial rows at the start of the test
  - `{:move_in, values: [1], name: "m0"}` - move-in notification from the dependency materializer
  - `{:move_out, values: [1]}` - move-out notification from the dependency materializer
  - `{:snapshot, name: "m0", snapshot: {100, 101, []}, wal_lsn: 1000}` - snapshot notification from the dependency materializer
  - `{:query_result, name: "m0", snapshot: {100, 101, []}, rows: [%{id: 11, value: "v11", parent_id: 1}]}` - query result notification from the dependency materializer
  - `{:global_last_seen_lsn, lsn: 1001}` - global last seen LSN notification
  - `{:txn, xid: 100, lsn: 1000, ops: [insert: %{id: 1, value: "a", parent_id: 5}]}` - transaction notification
  - `{:txn, xid: 100, lsn: 1000, ops: [update: %{id: 1, value: [old: "b", new: "a"], parent_id: 5}, insert: %{id: 2, value: "b", parent_id: 4}]}` - transaction notification
  - `{:txn, xid: 100, lsn: 1000, ops: [delete: %{id: 1, value: "a", parent_id: 5}]}` - transaction notification
  """
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.Shapes.Shape

  alias Support.StubInspector
  alias Support.ConsumerProperty.Runner
  alias Support.ConsumerProperty.Scenario

  import Support.ComponentSetup

  @inspector StubInspector.new(
               tables: ["test_table", "other_table"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0},
                 %{name: "parent_id", type: "int8"},
                 %{name: "value", type: "text"}
               ]
             )

  @moduletag :tmp_dir

  setup :with_stack_id_from_test

  setup ctx do
    inspector = Map.get(ctx, :with_inspector, @inspector)
    %{inspector: inspector, pool: nil}
  end

  setup ctx do
    Electric.StackConfig.put(ctx.stack_id, :shape_hibernate_after, 60_000)
    Electric.StackConfig.put(ctx.stack_id, :feature_flags, ["tagged_subqueries"])
    :ok
  end

  setup [
    :with_registry,
    :with_pure_file_storage,
    :with_shape_status,
    :with_lsn_tracker,
    :with_log_chunking,
    :with_persistent_kv,
    :with_async_deleter,
    :with_shape_cleaner,
    :with_shape_log_collector,
    :with_noop_publication_manager,
    :with_status_monitor,
    {Runner, :with_patched_snapshotter},
    :with_shape_cache
  ]

  defp subquery_shape(ctx) do
    Shape.new!("public.test_table",
      inspector: ctx.inspector,
      where: "parent_id IN (SELECT id FROM other_table)"
    )
  end

  test "materializer bounds must cover all spliced move-in items", ctx do
    events = [
      {:move_in, values: [1], name: "m0"},
      {:move_in, values: [2], name: "m1"},
      {:snapshot, name: "m0", snapshot: {100, 101, []}, wal_lsn: 1000},
      {:snapshot, name: "m1", snapshot: {100, 101, []}, wal_lsn: 1000},
      {:query_result,
       name: "m0", snapshot: {100, 101, []}, rows: [%{id: 11, value: "v11", parent_id: 1}]},
      {:query_result,
       name: "m1", snapshot: {100, 101, []}, rows: [%{id: 12, value: "v12", parent_id: 2}]},
      {:global_last_seen_lsn, lsn: 1001}
    ]

    scenario =
      Scenario.new(
        events: events,
        expected_rows: %{
          "\"public\".\"test_table\"/\"11\"" => %{
            "id" => "11",
            "value" => "v11",
            "parent_id" => "1"
          },
          "\"public\".\"test_table\"/\"12\"" => %{
            "id" => "12",
            "value" => "v12",
            "parent_id" => "2"
          }
        }
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      with_materializer: true,
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "delegation persists after originating MI resolves — no orphan DELETE", ctx do
    # Sequence:
    #   1. MI m0 for value 1, MI m1 for value 2
    #   2. INSERT parent_id=1 → covered by m0 → delegated [I.2]
    #   3. UPDATE parent_id 1→2 → covered by both → skipped [Ub.6a]
    #   4. m0 resolves with empty result (row reparented away)
    #   5. DELETE parent_id=2 → covered by m1
    #   Row was never in the log. DELETE must be skipped (still delegated).
    #   m1 also sees the DELETE in its snapshot, so m1 returns nothing.
    #
    # Bug: change_to_filtering wiped delegates when m0 resolved, causing
    # the DELETE to be emitted as an orphan (DELETE for absent key).
    events = [
      {:move_in, values: [1], name: "m0"},
      {:move_in, values: [2], name: "m1"},
      {:snapshot, name: "m0", snapshot: {100, 102, []}, wal_lsn: 1000},
      {:snapshot, name: "m1", snapshot: {100, 103, []}, wal_lsn: 1002},
      # INSERT under parent 1 — covered by both, delegated to m0
      {:txn, xid: 100, lsn: 1000, ops: [insert: %{id: 10, value: "v", parent_id: 1}]},
      # UPDATE reparent 1→2 — covered by both, skipped
      {:txn,
       xid: 101, lsn: 1001, ops: [update: %{id: 10, value: "v", parent_id: [old: 1, new: 2]}]},
      # m0 resolves empty (row has parent_id=2, not 1)
      {:query_result, name: "m0", snapshot: {100, 102, []}, rows: []},
      # DELETE parent_id=2 — m0 splices here (xid 102 not visible in m0's snapshot),
      # then the DELETE is processed. m1 still covers it.
      {:txn, xid: 102, lsn: 1002, ops: [delete: %{id: 10, value: "v", parent_id: 2}]},
      # m1 resolves empty (row was deleted, visible in m1's snapshot)
      {:query_result, name: "m1", snapshot: {100, 103, []}, rows: []},
      {:global_last_seen_lsn, lsn: 1003}
    ]

    scenario =
      Scenario.new(
        events: events,
        expected_rows: %{}
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      with_materializer: true,
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "delete after a move-out must be skipped", ctx do
    events = [
      {:move_in, values: [1], name: "m0"},
      {:snapshot, name: "m0", snapshot: {100, 100, []}, wal_lsn: 1000},
      {:query_result, name: "m0", snapshot: {100, 100, []}, rows: []},
      {:txn, xid: 101, lsn: 1001, ops: [insert: %{id: 1, value: "a", parent_id: 1}]},
      {:move_out, values: [1]},
      {:move_in, values: [1], name: "m1"},
      {:txn, xid: 102, lsn: 1002, ops: [delete: %{id: 1, value: "a", parent_id: 1}]},
      {:global_last_seen_lsn, lsn: 1001}
    ]

    scenario =
      Scenario.new(
        events: events,
        expected_rows: %{}
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      tag_column: :parent_id,
      extended_output: true
    )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      with_materializer: true,
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "P.shadow must update shadow for new MIs when row moves to their values", ctx do
    # Root cause: when [P.shadow] fires, it emits via simple_process_and_continue
    # but does NOT update the shadow with newly-relevant MIs. When the row moves
    # from mi_A's value to mi_B's value via P.shadow, mi_B is never added to the
    # shadow. When mi_A resolves, its name is removed from the shadow (via
    # change_to_filtering), leaving no shadow at all. mi_B's splice then inserts
    # the row as a duplicate.
    #
    # Sequence:
    #   1. INSERT id=4, parent_id=1 (in stable) — emitted via simple path
    #   2. move_in mi_A (values [2]), move_in mi_B (values [3])
    #   3. UPDATE parent_id 1→2 — [Ub.2*] emit + shadow for [mi_A]
    #   4. UPDATE parent_id 2→3 — P.shadow fires, emits, but does NOT add mi_B
    #   5. mi_A resolves empty → shadow gone
    #   6. mi_B resolves with id=4 → not shadowed → duplicate INSERT
    scenario =
      Scenario.new(
        events: [
          {:set_linked_values, [values: [1]]},
          {:txn, xid: 100, lsn: 1000, ops: [insert: %{id: 4, value: "v", parent_id: 1}]},
          {:move_in, [values: [2], name: "mi_A"]},
          {:move_in, [values: [3], name: "mi_B"]},
          {:txn,
           xid: 101, lsn: 1001, ops: [update: %{id: 4, value: "v", parent_id: [old: 1, new: 2]}]},
          {:txn,
           xid: 102, lsn: 1002, ops: [update: %{id: 4, value: "v", parent_id: [old: 2, new: 3]}]},
          {:snapshot, [name: "mi_A", snapshot: {103, 104, []}, wal_lsn: 1003]},
          {:snapshot, [name: "mi_B", snapshot: {103, 104, []}, wal_lsn: 1003]},
          {:query_result, name: "mi_A", snapshot: {103, 104, []}, rows: []},
          {:query_result,
           name: "mi_B", snapshot: {103, 104, []}, rows: [%{id: 4, value: "v", parent_id: 3}]},
          {:global_last_seen_lsn, [lsn: 1003]}
        ],
        expected_rows: %{
          "\"public\".\"test_table\"/\"4\"" => %{
            "id" => "4",
            "parent_id" => "3",
            "value" => "v"
          }
        }
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "delegated row reparented into stable set under concurrent move-ins does not emit orphan UPDATE",
       ctx do
    scenario =
      Scenario.new(
        events: [
          {:set_linked_values, [values: [1, 4]]},
          {:initial_rows,
           [rows: [%{id: 1, value: "v1", parent_id: 4}, %{id: 2, value: "v1", parent_id: 1}]]},
          {:txn, xid: 100, lsn: 1000, ops: [insert: %{id: 3, value: "v", parent_id: 1}]},
          {:txn, xid: 101, lsn: 1001, ops: [insert: %{id: 4, value: "v", parent_id: 4}]},
          {:move_in, [values: [2, 7], name: "mi_2_7"]},
          {:snapshot, [name: "mi_2_7", snapshot: {113, 114, []}, wal_lsn: 1013]},
          {:query_result, name: "mi_2_7", snapshot: {113, 114, []}, rows: []},
          {:move_in, [values: [3], name: "mi_3"]},
          {:txn, xid: 102, lsn: 1002, ops: [delete: %{id: 4, value: "v", parent_id: 4}]},
          {:txn,
           xid: 103,
           lsn: 1003,
           ops: [
             delete: %{id: 3, value: "v", parent_id: 1},
             insert: %{id: 5, value: "b", parent_id: 2},
             update: %{id: 1, value: "v1", parent_id: [old: 4, new: 7]},
             insert: %{id: 6, value: "b", parent_id: 1}
           ]},
          {:txn,
           xid: 104,
           lsn: 1004,
           ops: [
             update: %{id: 6, value: "b", parent_id: 1},
             update: %{id: 1, value: "v1", parent_id: [old: 7, new: 2]},
             update: %{id: 2, value: [old: "v1", new: "a"], parent_id: 1}
           ]},
          {:txn,
           xid: 105,
           lsn: 1005,
           ops: [
             update: %{id: 1, value: "v1", parent_id: [old: 2, new: 8]},
             update: %{id: 2, value: "a", parent_id: 1},
             update: %{id: 5, value: "b", parent_id: [old: 2, new: 4]},
             update: %{id: 6, value: "b", parent_id: 1}
           ]},
          {:snapshot, [name: "mi_3", snapshot: {131, 132, []}, wal_lsn: 1031]},
          {:query_result, name: "mi_3", snapshot: {131, 132, []}, rows: []}
        ],
        expected_rows: %{
          "\"public\".\"test_table\"/\"2\"" => %{
            "id" => "2",
            "parent_id" => "1",
            "value" => "a"
          },
          "\"public\".\"test_table\"/\"5\"" => %{
            "id" => "5",
            "parent_id" => "4",
            "value" => "b"
          },
          "\"public\".\"test_table\"/\"6\"" => %{
            "id" => "6",
            "parent_id" => "1",
            "value" => "b"
          }
        }
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "shadowed delete must clear shadow so later delete is skipped", ctx do
    scenario =
      Scenario.new(
        events: [
          {:set_linked_values, [values: [4]]},
          {:txn, xid: 100, lsn: 1000, ops: [insert: %{id: 5, value: "a", parent_id: 4}]},
          {:move_in, [values: [3], name: "mi_3"]},
          {:txn,
           xid: 101, lsn: 1001, ops: [update: %{id: 5, value: "a", parent_id: [old: 4, new: 3]}]},
          {:txn,
           xid: 102, lsn: 1002, ops: [update: %{id: 5, value: "a", parent_id: [old: 3, new: 5]}]},
          {:txn, xid: 103, lsn: 1003, ops: [delete: %{id: 5, value: "a", parent_id: 5}]}
        ],
        expected_rows: %{}
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "move-out must retire stale shadow before a later covered delete", ctx do
    scenario =
      Scenario.new(
        events: [
          {:set_linked_values, [values: [7]]},
          {:txn, xid: 100, lsn: 1000, ops: [insert: %{id: 1, value: "v", parent_id: 7}]},
          {:move_in, [values: [1, 4], name: "mi_1_4"]},
          {:move_in, [values: [5], name: "mi_5"]},
          {:txn,
           xid: 101, lsn: 1001, ops: [update: %{id: 1, value: "v", parent_id: [old: 7, new: 5]}]},
          {:txn,
           xid: 102, lsn: 1002, ops: [update: %{id: 1, value: "v", parent_id: [old: 5, new: 4]}]},
          {:move_out, [values: [4]]},
          {:move_in, [values: [4], name: "mi_4"]},
          {:move_out, [values: [5]]},
          {:move_out, [values: [1]]},
          {:txn, xid: 103, lsn: 1003, ops: [delete: %{id: 1, value: "v", parent_id: 4}]}
        ],
        expected_rows: %{}
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "shadowed updates must not leave duplicate move-in names after splice", ctx do
    scenario =
      Scenario.new(
        events: [
          {:initial_rows, rows: [%{id: 7, value: "a", parent_id: 2}]},
          {:set_linked_values, [values: [2]]},
          {:move_in, [values: [1], name: "mi_1a"]},
          {:txn,
           xid: 100, lsn: 1000, ops: [update: %{id: 7, value: "a", parent_id: [old: 2, new: 1]}]},
          {:txn,
           xid: 101, lsn: 1001, ops: [update: %{id: 7, value: [old: "a", new: "b"], parent_id: 1}]},
          {:snapshot, [name: "mi_1a", snapshot: {102, 103, []}, wal_lsn: 1002]},
          {:query_result,
           name: "mi_1a", snapshot: {102, 103, []}, rows: [%{id: 7, value: "b", parent_id: 1}]},
          {:move_out, [values: [1]]},
          {:move_in, [values: [1], name: "mi_1b"]},
          {:txn,
           xid: 102, lsn: 1002, ops: [update: %{id: 7, value: [old: "b", new: "c"], parent_id: 1}]},
          {:snapshot, [name: "mi_1b", snapshot: {103, 104, []}, wal_lsn: 1003]},
          {:query_result,
           name: "mi_1b", snapshot: {103, 104, []}, rows: [%{id: 7, value: "c", parent_id: 1}]},
          {:global_last_seen_lsn, [lsn: 1003]}
        ],
        expected_rows: %{
          "\"public\".\"test_table\"/\"7\"" => %{
            "id" => "7",
            "parent_id" => "1",
            "value" => "c"
          }
        }
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "delete for re-entered key must ignore stale evicted mark", ctx do
    scenario =
      Scenario.new(
        events: [
          {:set_linked_values, [values: [7]]},
          {:move_in, [values: [4], name: "mi_4"]},
          {:snapshot, [name: "mi_4", snapshot: {100, 101, []}, wal_lsn: 1000]},
          {:query_result,
           name: "mi_4", snapshot: {100, 101, []}, rows: [%{id: 13, value: "b", parent_id: 4}]},
          {:move_out, [values: [4]]},
          {:txn,
           xid: 101, lsn: 1001, ops: [update: %{id: 13, value: "b", parent_id: [old: 4, new: 8]}]},
          {:txn,
           xid: 102, lsn: 1002, ops: [update: %{id: 13, value: "b", parent_id: [old: 8, new: 7]}]},
          {:txn, xid: 103, lsn: 1003, ops: [delete: %{id: 13, value: "b", parent_id: 7}]}
        ],
        expected_rows: %{}
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "move-out retires stale shadow before later updates on the same key", ctx do
    scenario =
      Scenario.new(
        events: [
          {:initial_rows, rows: [%{id: 2, value: "v1", parent_id: 4}]},
          {:set_linked_values, [values: [4]]},
          {:move_in, [values: [3, 5], name: "mi_3_5"]},
          {:txn,
           xid: 100, lsn: 1000, ops: [update: %{id: 2, value: "v1", parent_id: [old: 4, new: 3]}]},
          {:move_in, [values: [1], name: "mi_1a"]},
          {:move_out, [values: [1]]},
          {:move_out, [values: [3]]},
          {:txn,
           xid: 101, lsn: 1001, ops: [update: %{id: 2, value: "v1", parent_id: [old: 3, new: 1]}]},
          {:move_in, [values: [1], name: "mi_1b"]},
          {:txn,
           xid: 102, lsn: 1002, ops: [update: %{id: 2, value: "v1", parent_id: [old: 1, new: 3]}]},
          {:txn, xid: 103, lsn: 1003, ops: [delete: %{id: 2, value: "v1", parent_id: 3}]}
        ],
        expected_rows: %{}
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "emitted WAL update clears stale move-in ownership before later move-out", ctx do
    scenario =
      Scenario.new(
        events: [
          {:move_in, [values: [5], name: "mi_5"]},
          {:snapshot, [name: "mi_5", snapshot: {100, 101, []}, wal_lsn: 1000]},
          {:query_result,
           name: "mi_5", snapshot: {100, 101, []}, rows: [%{id: 8, value: "a", parent_id: 5}]},
          {:global_last_seen_lsn, [lsn: 1000]},
          {:move_in, [values: [4], name: "mi_4"]},
          {:txn,
           xid: 101, lsn: 1001, ops: [update: %{id: 8, value: [old: "a", new: "b"], parent_id: 5}]},
          {:txn,
           xid: 102, lsn: 1002, ops: [update: %{id: 8, value: "b", parent_id: [old: 5, new: 4]}]},
          {:txn,
           xid: 103, lsn: 1003, ops: [update: %{id: 8, value: [old: "b", new: "a"], parent_id: 4}]},
          {:txn,
           xid: 104, lsn: 1004, ops: [update: %{id: 8, value: [old: "a", new: "b"], parent_id: 4}]},
          {:move_out, [values: [5]]},
          {:txn, xid: 105, lsn: 1005, ops: [update: %{id: 8, value: "b", parent_id: 4}]},
          {:txn, xid: 106, lsn: 1006, ops: [delete: %{id: 8, value: "b", parent_id: 4}]}
        ],
        expected_rows: %{}
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      tag_column: :parent_id,
      extended_output: true
    )
  end

  test "move-in-aware emitted WAL update clears stale splice ownership before later move-out",
       ctx do
    scenario =
      Scenario.new(
        events: [
          {:move_in, [values: [8], name: "mi_8"]},
          {:snapshot, [name: "mi_8", snapshot: {100, 101, []}, wal_lsn: 1000]},
          {:query_result,
           name: "mi_8", snapshot: {100, 101, []}, rows: [%{id: 7, value: "b", parent_id: 8}]},
          {:global_last_seen_lsn, [lsn: 1000]},
          {:move_in, [values: [1, 6], name: "mi_1_6"]},
          {:txn,
           xid: 101, lsn: 1001, ops: [update: %{id: 7, value: "b", parent_id: [old: 8, new: 6]}]},
          {:move_out, [values: [8]]},
          {:txn, xid: 102, lsn: 1002, ops: [delete: %{id: 7, value: "b", parent_id: 6}]}
        ],
        expected_rows: %{}
      )

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      tag_column: :parent_id,
      extended_output: true
    )
  end
end
