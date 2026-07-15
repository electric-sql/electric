defmodule Electric.Integration.OracleRestoreTest do
  @moduledoc """
  Targeted regression tests for subquery-shape restore across a server restart,
  each with a deterministic, minimal mutation sequence, reusing
  `Support.OracleHarness.test_against_oracle/4`.

  These tests use a small, readable "issue tracker" domain schema rather than
  the abstract `level_N` hierarchy from `Support.OracleHarness.StandardSchema`:

      projects (id, active)
          └── issues (id, project_id, title)

  The shape under test is "issues belonging to an active project", expressed
  as a subquery over `projects.active`.
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
        # A realistic long-poll timeout. A very short one (e.g. 100ms) can time
        # out before replication has caught up after a restart, yielding a
        # spurious 409 that is independent of the subquery-restore behaviour
        # under test here.
        router_opts: [long_poll_timeout: 5000],
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
  test "subquery shape stays consistent with oracle across a server restart", ctx do
    # A single `optimized: true` shape on `issues` with a subquery predicate over
    # `projects.active`. Toggling `projects.active` on either side of the restart
    # moves issue rows in and out of the shape via the subquery materializer; the
    # client view must stay consistent with the oracle across the restart.
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
  test "optimized subquery shapes stay consistent when the slot replays a backlog after restart",
       ctx do
    # Two `optimized: true` subquery shapes over the same `projects` source. After
    # the restart the persistent slot replays batch_1's already-applied
    # transactions; the source consumer skips those (at/below its restored
    # `latest_offset`) before re-notifying the subquery materializer, so the shapes
    # stay consistent and the polling client is not sent a 409 must-refetch.
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

  # A three-level "issue tracker": regions own projects own issues.
  #
  #     regions (id, active)
  #         └── projects (id, region_id)
  #                 └── issues (id, project_id, title)
  #
  # r1, r3 start active; r2 starts inactive. Two projects per region, two issues
  # per project.
  defp setup_nested_schema(ctx) do
    OracleHarness.apply_sql(ctx, [
      "DROP TABLE IF EXISTS issues CASCADE",
      "DROP TABLE IF EXISTS projects CASCADE",
      "DROP TABLE IF EXISTS regions CASCADE",
      """
      CREATE TABLE regions (
        id TEXT PRIMARY KEY,
        active BOOLEAN NOT NULL DEFAULT true
      )
      """,
      """
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        region_id TEXT NOT NULL REFERENCES regions(id) ON DELETE CASCADE
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

    OracleHarness.apply_sql(ctx, [
      "INSERT INTO regions (id, active) VALUES ('r1', true), ('r2', false), ('r3', true)",
      """
      INSERT INTO projects (id, region_id) VALUES
        ('p1', 'r1'), ('p2', 'r1'),
        ('p3', 'r2'), ('p4', 'r2'),
        ('p5', 'r3'), ('p6', 'r3')
      """,
      "INSERT INTO issues (id, project_id, title) VALUES " <>
        (for(n <- 1..12, do: "('i#{n}', 'p#{div(n - 1, 2) + 1}', 'Issue #{n}')")
         |> Enum.join(", "))
    ])

    :ok
  end

  @tag :oracle_restore_nested_subquery
  # As with the single-level case, force the source shape's log to span multiple
  # chunks so the post-restart replay path is exercised.
  @tag chunk_bytes_threshold: 200
  test "nested optimized subquery shape stays consistent with oracle across a restart", ctx do
    setup_nested_schema(ctx)

    # The shape under test is a *nested* subquery: issues whose project belongs to
    # an active region. Its dependency shape — `projects WHERE region_id IN (SELECT
    # id FROM regions WHERE active)` — is itself an optimized subquery shape, so
    # its log contains move-in/move-out *control messages* (projects moving in and
    # out as regions toggle). On restart the dependency materializer replays that
    # log to catch the outer consumer up; the control-message moves must be
    # re-emitted so the outer shape isn't left missing the issues of projects that
    # moved via a control message.
    shapes = [
      %{
        name: "issues_of_active_regions",
        table: "issues",
        where:
          "project_id IN (SELECT id FROM projects WHERE region_id IN " <>
            "(SELECT id FROM regions WHERE active = true))",
        columns: ["id", "project_id", "title"],
        pk: ["id"],
        optimized: true
      }
    ]

    # batch_1: 200 toggles of r3's `active` flag — each toggle moves p5/p6 in and
    # out of the inner subquery shape, writing control messages to its log. r3 ends
    # active, so pre-restart the shape matches the oracle.
    toggles =
      Enum.flat_map(1..100, fn _ ->
        [
          [%{name: "deactivate_r3", sql: "UPDATE regions SET active = false WHERE id = 'r3'"}],
          [%{name: "reactivate_r3", sql: "UPDATE regions SET active = true WHERE id = 'r3'"}]
        ]
      end)

    # batch_2 (after the restart): a single region deactivate that moves a project
    # out of the inner subquery via a control message.
    batch_2 = [
      [%{name: "deactivate_r1", sql: "UPDATE regions SET active = false WHERE id = 'r1'"}]
    ]

    batches = [toggles, batch_2]

    OracleHarness.test_against_oracle(ctx, shapes, batches, restart_server_every: 1)
  end
end
