defmodule Electric.Integration.OracleRestoreTest do
  @moduledoc """
  Targeted regression tests for restore-from-file. Each test exercises a
  scenario from `bugs.md` with a deterministic, minimal mutation sequence,
  reusing `Support.OracleHarness.test_against_oracle/4`.

  These tests are expected to fail until the underlying Electric bugs are
  fixed.
  """

  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  alias Support.OracleHarness
  alias Support.OracleHarness.StandardSchema

  @moduletag :oracle
  @moduletag timeout: :infinity
  @moduletag :tmp_dir

  setup [:with_unique_db]
  setup :use_persistent_slot
  setup :with_complete_stack

  setup ctx do
    ctx =
      with_electric_client(ctx,
        router_opts: [long_poll_timeout: 100],
        num_clients: 1
      )

    StandardSchema.setup_standard_schema(ctx)
    ctx
  end

  # See `oracle_property_test.exs`: the StackSupervisor restart needs the
  # replication slot to persist so Electric reconnects rather than treating
  # a new slot as a slot-loss event and purging on-disk shape data.
  defp use_persistent_slot(_ctx) do
    %{replication_opts_overrides: [slot_temporary?: false]}
  end

  @tag :oracle_restore_bug_4
  @tag chunk_size: 200
  test "bug 4: subquery shape returns 409 after restart with many persisted log entries",
       ctx do
    # Same shape as Bug 1 but with enough mutations between snapshot and
    # restart that the persisted main log spans more than one read range.
    # The materializer's startup replay re-reads main-log entries on
    # subsequent iterations because `stream_main_log` returns the whole
    # range in a single call but the iteration loop keeps advancing.
    # Re-replaying the same INSERTs raises "Key already exists" inside the
    # materializer, which crashes the dependent shape's consumer and
    # causes the server to return 409 must-refetch on the next poll.
    shapes = [
      %{
        name: "active_l3",
        table: "level_4",
        where: "level_3_id IN (SELECT id FROM level_3 WHERE active = true)",
        columns: ["id", "level_3_id", "value"],
        pk: ["id"],
        optimized: true
      }
    ]

    # Build a batch with many UPDATE entries on the source table (level_3)
    # so that the dependency materializer's source shape persists a long
    # log on disk before the restart. The bug surfaces when the
    # materializer's startup replay re-reads main-log entries.
    many_l3_mutations =
      for i <- 1..30 do
        active = if rem(i, 2) == 0, do: "true", else: "false"
        id = "l3-#{rem(i, 5) + 1}"

        %{
          name: "toggle_#{id}_#{i}",
          sql: "UPDATE level_3 SET active = #{active} WHERE id = '#{id}'"
        }
      end

    batches = [
      Enum.map(many_l3_mutations, &[&1]),
      [
        [%{name: "deactivate_l3-1", sql: "UPDATE level_3 SET active = false WHERE id = 'l3-1'"}]
      ]
    ]

    OracleHarness.test_against_oracle(ctx, shapes, batches, restart_server_every: 1)
  end

  @tag :oracle_restore_bug_5
  @tag chunk_size: 200
  test "bug 5: multiple subquery shapes diverge after restart with long persisted log",
       ctx do
    # Multiple shapes whose source-shape main logs span more than one chunk
    # (forced via `chunk_size: 200`). After a server restart the
    # materialized view of at least one shape no longer matches the oracle
    # — rows that should be in the view are missing. The single-shape
    # variants of this scenario (Bug 1 and Bug 4 regression tests) pass
    # cleanly, so this looks like an interaction between concurrent
    # materializer recoveries — possibly a shared per-stack ETS structure
    # (link-values cache, SubqueryIndex) being read by one shape's
    # consumer before another shape's materializer has finished
    # repopulating it on startup.
    shapes = [
      %{
        name: "shape_active_true",
        table: "level_4",
        where: "level_3_id IN (SELECT id FROM level_3 WHERE active = true)",
        columns: ["id", "level_3_id", "value"],
        pk: ["id"],
        optimized: true
      },
      %{
        name: "shape_active_false",
        table: "level_4",
        where: "level_3_id IN (SELECT id FROM level_3 WHERE active = false)",
        columns: ["id", "level_3_id", "value"],
        pk: ["id"],
        optimized: true
      }
    ]

    many_l3_mutations =
      for i <- 1..200 do
        active = if rem(i, 2) == 0, do: "true", else: "false"
        id = "l3-#{rem(i, 5) + 1}"

        %{
          name: "toggle_#{id}_#{i}",
          sql: "UPDATE level_3 SET active = #{active} WHERE id = '#{id}'"
        }
      end

    batches = [
      Enum.map(many_l3_mutations, &[&1]),
      [
        [%{name: "deactivate_l3-2", sql: "UPDATE level_3 SET active = false WHERE id = 'l3-2'"}]
      ]
    ]

    OracleHarness.test_against_oracle(ctx, shapes, batches, restart_server_every: 1)
  end

  @tag :oracle_restore_bug_1
  test "bug 1: subquery shape diverges from oracle after server restart", ctx do
    # Shape on level_4 with a subquery predicate over level_3.active. After
    # the server is restarted, the subquery materializer state is not
    # restored from disk, so toggling level_3.active on either side of the
    # restart produces a divergence between the client view and the oracle
    # (or a 409 must-refetch on this `optimized: true` shape).
    shapes = [
      %{
        name: "active_level_3_children",
        table: "level_4",
        where: "level_3_id IN (SELECT id FROM level_3 WHERE active = true)",
        columns: ["id", "level_3_id", "value"],
        pk: ["id"],
        optimized: true
      }
    ]

    # Two batches with one mutation each. Restart fires after batch_1.
    # The mutations move rows in/out of the shape because they flip the
    # parent level_3 row's `active` flag — so the subquery's result set
    # changes, and the materializer is the component responsible for
    # routing the corresponding level_4 rows in or out.
    batches = [
      [
        [%{name: "deactivate_l3-1", sql: "UPDATE level_3 SET active = false WHERE id = 'l3-1'"}]
      ],
      [
        [%{name: "reactivate_l3-1", sql: "UPDATE level_3 SET active = true WHERE id = 'l3-1'"}]
      ]
    ]

    OracleHarness.test_against_oracle(ctx, shapes, batches, restart_server_every: 1)
  end
end
