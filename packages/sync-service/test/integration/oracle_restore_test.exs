defmodule Electric.Integration.OracleRestoreTest do
  @moduledoc """
  Targeted regression tests for restore-from-file. Each test exercises a
  scenario from `bugs.md` with a deterministic, minimal mutation sequence,
  reusing `Support.OracleHarness.test_against_oracle/4`.

  These tests use a small, readable "issue tracker" domain schema rather than
  the abstract `level_N` hierarchy from `Support.OracleHarness.StandardSchema`:

      projects (id, active)
          └── issues (id, project_id, title)

  The shape under test is "issues belonging to an active project", expressed
  as a subquery over `projects.active`.

  These tests are expected to fail until the underlying Electric bugs are
  fixed.
  """

  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  alias Support.OracleHarness

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

    setup_issue_tracker_schema(ctx)
    ctx
  end

  # See `oracle_property_test.exs`: the StackSupervisor restart needs the
  # replication slot to persist so Electric reconnects rather than treating
  # a new slot as a slot-loss event and purging on-disk shape data.
  defp use_persistent_slot(_ctx) do
    %{replication_opts_overrides: [slot_temporary?: false]}
  end

  # A two-table "issue tracker": projects own issues. `projects.active` drives
  # the subquery shape under test. Seeded so that p1, p3, p5 start active and
  # p2, p4 start inactive; issues are spread round-robin across the projects
  # so each project owns four (e.g. p1 owns i1, i6, i11, i16).
  defp setup_issue_tracker_schema(ctx) do
    OracleHarness.apply_sql(ctx, [
      "DROP TABLE IF EXISTS issues CASCADE",
      "DROP TABLE IF EXISTS projects CASCADE",
      """
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        active BOOLEAN NOT NULL DEFAULT true
      )
      """,
      """
      CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL
      )
      """
    ])

    project_ids = for n <- 1..5, do: "p#{n}"

    project_values =
      project_ids
      |> Enum.with_index()
      |> Enum.map_join(", ", fn {id, idx} -> "('#{id}', #{rem(idx, 2) == 0})" end)

    issue_values =
      for n <- 1..20 do
        project_id = Enum.at(project_ids, rem(n - 1, length(project_ids)))
        "('i#{n}', '#{project_id}', 'Issue #{n}')"
      end
      |> Enum.join(", ")

    OracleHarness.apply_sql(ctx, [
      "INSERT INTO projects (id, active) VALUES #{project_values}",
      "INSERT INTO issues (id, project_id, title) VALUES #{issue_values}"
    ])

    :ok
  end

  @tag :oracle_restore_bug_1
  test "bug 1: subquery shape diverges from oracle after server restart", ctx do
    # Shape on `issues` with a subquery predicate over `projects.active`.
    # After the server is restarted, the subquery materializer state is not
    # restored from disk, so toggling `projects.active` on either side of the
    # restart produces a divergence between the client view and the oracle
    # (or a 409 must-refetch on this `optimized: true` shape).
    shapes = [
      %{
        name: "issues_of_active_projects",
        table: "issues",
        where: "project_id IN (SELECT id FROM projects WHERE active = true)",
        columns: ["id", "project_id", "title"],
        pk: ["id"],
        optimized: true
      }
    ]

    # Two batches with one mutation each. Restart fires after batch_1.
    # The mutations move rows in/out of the shape because they flip the
    # parent project's `active` flag — so the subquery's result set changes,
    # and the materializer is the component responsible for routing the
    # corresponding issue rows in or out.
    batches = [
      [
        [%{name: "deactivate_p1", sql: "UPDATE projects SET active = false WHERE id = 'p1'"}]
      ],
      [
        [%{name: "reactivate_p1", sql: "UPDATE projects SET active = true WHERE id = 'p1'"}]
      ]
    ]

    OracleHarness.test_against_oracle(ctx, shapes, batches, restart_server_every: 1)
  end

  @tag :oracle_restore_optimized_refetch
  # Build a large persisted backlog on the `projects` source shape: 200 toggles
  # under a small `chunk_bytes_threshold` so its log spans many chunks. After the
  # restart the persistent replication slot has to replay that backlog.
  @tag chunk_bytes_threshold: 200
  test "optimized subquery shape must-refetches after restart during slot catch-up replay",
       ctx do
    # Two `optimized: true` subquery shapes over the same `projects` source.
    #
    # Regression test. Before the fix: after the restart, the `projects` source
    # consumer replays batch_1 from the persistent slot and re-delivers those
    # already-applied changes to the subquery materializer via `new_changes`. The
    # materializer re-applied them and crashed ("Key ... already exists"), which
    # cascaded — handle_materializer_down -> stop_and_clean ->
    # handle_writer_termination({:shutdown, :cleanup}) -> remove_shape_async ->
    # notify_shape_rotation — removing the (healthy) shapes and sending the
    # polling client a 409 must-refetch.
    #
    # The fix makes the materializer ignore `new_changes` ranges it already
    # applied during its startup history replay, so the crash (and the whole
    # removal cascade) no longer happens. NB the underlying cascade — a
    # materializer crash tearing down and *removing* healthy dependent shapes —
    # is a separate hardening concern (the "bug 6" cascade) this fix leaves open.
    shapes = [
      %{
        name: "issues_of_active_projects",
        table: "issues",
        where: "project_id IN (SELECT id FROM projects WHERE active = true)",
        columns: ["id", "project_id", "title"],
        pk: ["id"],
        optimized: true
      },
      %{
        name: "issues_of_inactive_projects",
        table: "issues",
        where: "project_id IN (SELECT id FROM projects WHERE active = false)",
        columns: ["id", "project_id", "title"],
        pk: ["id"],
        optimized: true
      }
    ]

    # batch_1: 200 toggles of p5's `active` flag — the backlog. Under the small
    # `chunk_bytes_threshold` above this makes the `projects` source log span many
    # chunks. p5 ends active, so pre-restart both shapes match the oracle; the
    # restart then replays this backlog from the slot.
    toggles =
      Enum.flat_map(1..100, fn _ ->
        [
          [%{name: "deactivate_p5", sql: "UPDATE projects SET active = false WHERE id = 'p5'"}],
          [%{name: "reactivate_p5", sql: "UPDATE projects SET active = true WHERE id = 'p5'"}]
        ]
      end)

    # batch_2: a single dependency move applied after the restart. In practice the
    # test fails during the batch_1 replay before this is reached; it's kept so the
    # harness runs a post-restart batch/check.
    batch_2 = [
      [%{name: "deactivate_p3", sql: "UPDATE projects SET active = false WHERE id = 'p3'"}]
    ]

    batches = [toggles, batch_2]

    OracleHarness.test_against_oracle(ctx, shapes, batches, restart_server_every: 1)
  end
end
