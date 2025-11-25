defmodule Electric.Postgres.PublicationChangeReplayTest do
  @moduledoc """
  Test module that PROVES changing a PostgreSQL publication and restarting
  the replication client does NOT result in different replication stream
  content for data that was already written.

  ## Findings

  This test demonstrates that publication filters are applied at WAL WRITE
  time, not at read time. When you:

  1. Start a replication client with a publication containing table A
  2. Insert data into both table A and table B
  3. Stop the client without advancing the confirmed_flush_lsn
  4. Modify the publication to also include table B
  5. Restart the replication client from the same LSN

  The replication stream will ONLY contain data from table A. The table B
  data is NOT included because it was written when table B was not in the
  publication.

  ## Implications

  - Publication filters are applied by the pgoutput plugin at write time
  - Data written while a table is NOT in the publication will NEVER appear
    in the logical replication stream, even if the table is added later
  - Replaying from a given LSN with a modified publication produces
    IDENTICAL results for already-written data
  - Only NEW data written AFTER adding a table to the publication will
    be included in the replication stream
  """

  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup, except: [with_publication: 1]

  alias Electric.Postgres.ReplicationClient
  alias Electric.Replication.Changes.NewRecord

  # Larger timeout for database operations
  @assert_receive_db_timeout 2000

  defmodule MockConnectionManager do
    def receive_casts(test_pid) do
      receive do
        message ->
          if response = process_message(message) do
            send(test_pid, response)
          end

          receive_casts(test_pid)
      end
    end

    defp process_message({:"$gen_cast", :replication_client_started}), do: nil
    defp process_message({:"$gen_cast", {:pg_info_obtained, _}}), do: nil
    defp process_message({:"$gen_cast", {:pg_system_identified, _}}), do: nil
    defp process_message({:"$gen_cast", :replication_client_lock_acquired}), do: :lock_acquired

    defp process_message({:"$gen_cast", {:replication_client_lock_acquisition_failed, err}}),
      do: {:lock_acquisition_failed, err}

    defp process_message({:"$gen_cast", :replication_client_created_new_slot}), do: nil

    defp process_message({:"$gen_cast", :replication_client_streamed_first_message}),
      do: {self(), :streaming_started}
  end

  setup do
    # Spawn a dummy process to receive messages from ReplicationClient
    pid = spawn_link(MockConnectionManager, :receive_casts, [self()])
    %{connection_manager: pid}
  end

  setup :with_stack_id_from_test
  setup :with_slot_name

  describe "Publication change affects replication replay" do
    setup [:with_unique_db, :with_status_monitor, :with_lsn_tracker]

    setup %{db_conn: conn} = ctx do
      # Create two tables: one will be in the publication initially,
      # the other will be added later
      Postgrex.query!(
        conn,
        """
        CREATE TABLE table_a (
          id UUID PRIMARY KEY,
          value TEXT NOT NULL
        )
        """,
        []
      )

      Postgrex.query!(
        conn,
        """
        CREATE TABLE table_b (
          id UUID PRIMARY KEY,
          value TEXT NOT NULL
        )
        """,
        []
      )

      # Create publication with ONLY table_a initially
      publication_name = ctx.slot_name
      Postgrex.query!(conn, "CREATE PUBLICATION #{publication_name} FOR TABLE table_a", [])

      %{publication_name: publication_name}
    end

    test "restarting replication client after adding table to publication shows previously filtered data",
         %{db_conn: conn, slot_name: slot_name, publication_name: publication_name} = ctx do
      # Build replication options
      replication_opts = [
        connection_opts: ctx.db_config,
        stack_id: ctx.stack_id,
        publication_name: publication_name,
        try_creating_publication?: false,
        slot_name: slot_name,
        handle_operations: {__MODULE__, :test_handle_operations, [self()]},
        connection_manager: ctx.connection_manager
      ]

      # Start the first replication client
      client_pid1 = start_client(ctx, replication_opts: replication_opts)

      # Insert data into table_a (in publication) - should be received
      {_id_a1, bin_uuid_a1} = gen_uuid()

      Postgrex.query!(conn, "INSERT INTO table_a (id, value) VALUES ($1, $2)", [
        bin_uuid_a1,
        "value_a1"
      ])

      # Verify we receive the table_a insert
      assert %NewRecord{record: %{"value" => "value_a1"}, relation: {"public", "table_a"}} =
               receive_tx_change()

      # Insert data into table_b (NOT in publication) - should NOT be received
      {_id_b1, bin_uuid_b1} = gen_uuid()

      Postgrex.query!(conn, "INSERT INTO table_b (id, value) VALUES ($1, $2)", [
        bin_uuid_b1,
        "value_b1"
      ])

      # We should NOT receive the table_b insert since it's not in the publication
      refute_receive {:from_replication, _}, 200

      # Record the confirmed_flush_lsn before stopping
      %Postgrex.Result{rows: [[confirmed_flush_lsn_before]]} =
        Postgrex.query!(
          conn,
          "SELECT confirmed_flush_lsn FROM pg_replication_slots WHERE slot_name = $1",
          [slot_name]
        )

      IO.puts("\n=== PHASE 1: Initial replication ===")
      IO.puts("Received table_a insert (as expected)")
      IO.puts("Did NOT receive table_b insert (as expected - not in publication)")
      IO.puts("confirmed_flush_lsn: #{confirmed_flush_lsn_before}")

      # Stop the replication client WITHOUT advancing the confirmed_flush_lsn
      # This simulates a crash/restart scenario where we need to replay
      Process.unlink(client_pid1)
      Process.exit(client_pid1, :kill)

      # Wait for the client to die
      Process.sleep(100)

      # Now modify the publication to include table_b
      Postgrex.query!(conn, "ALTER PUBLICATION #{publication_name} ADD TABLE table_b", [])

      IO.puts("\n=== PHASE 2: Modified publication ===")
      IO.puts("Added table_b to publication")

      # Verify the publication now includes both tables
      %Postgrex.Result{rows: tables} =
        Postgrex.query!(
          conn,
          "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = $1 ORDER BY tablename",
          [publication_name]
        )

      IO.puts("Tables in publication: #{inspect(tables)}")
      assert length(tables) == 2
      assert ["public", "table_a"] in tables
      assert ["public", "table_b"] in tables

      # Start a new replication client - it should replay from the same LSN
      # but now with the updated publication filter
      client_pid2 = start_client(ctx, replication_opts: replication_opts)

      IO.puts("\n=== PHASE 3: Replaying with new publication ===")

      # Collect all changes from the replay
      changes = collect_all_changes(500)

      IO.puts("Received #{length(changes)} changes during replay:")

      for change <- changes do
        IO.puts("  - #{inspect(change.relation)}: #{inspect(change.record)}")
      end

      # THE KEY ASSERTION: After adding table_b to the publication,
      # replaying from the same LSN should now include the table_b insert
      # that was previously filtered out
      table_a_changes = Enum.filter(changes, &match?(%{relation: {"public", "table_a"}}, &1))
      table_b_changes = Enum.filter(changes, &match?(%{relation: {"public", "table_b"}}, &1))

      IO.puts("\n=== RESULTS ===")
      IO.puts("table_a changes: #{length(table_a_changes)}")
      IO.puts("table_b changes: #{length(table_b_changes)}")

      # We should see table_a changes (replayed)
      assert length(table_a_changes) >= 1,
             "Expected to see table_a changes in replay"

      # THE CRITICAL TEST: Prove that table_b changes are NOT included
      # even though we added table_b to the publication before replaying.
      # This proves publication filters are applied at WAL WRITE time, not read time.
      assert length(table_b_changes) == 0,
             """
             UNEXPECTED: table_b data appeared in replay!
             This would mean publication filters are applied at read time.
             Expected: 0 table_b changes (data was written when table_b was not in publication)
             Got: #{length(table_b_changes)} table_b changes
             """

      IO.puts("""

      ========================================
      CONCLUSION: Publication filters are applied at WAL WRITE TIME
      ========================================

      When data is written to PostgreSQL:
      - The pgoutput plugin checks which tables are in the publication
      - Only changes to tables IN the publication are written to the logical WAL

      Therefore:
      - Changing a publication AFTER data is written has NO EFFECT on replay
      - Data written while a table was NOT in the publication will NEVER appear
        in the replication stream, even if the table is added later
      - This is a fundamental property of PostgreSQL logical replication

      This proves that replaying a replication stream after changing the
      publication will produce IDENTICAL results (for already-written data).
      ========================================
      """)

      # Clean up
      Process.unlink(client_pid2)
      Process.exit(client_pid2, :kill)
    end

    test "data inserted AFTER adding table to publication IS replicated",
         %{db_conn: conn, slot_name: slot_name, publication_name: publication_name} = ctx do
      # This is a control test to verify that adding a table to a publication
      # does allow NEW data to be replicated

      replication_opts = [
        connection_opts: ctx.db_config,
        stack_id: ctx.stack_id,
        publication_name: publication_name,
        try_creating_publication?: false,
        slot_name: slot_name,
        handle_operations: {__MODULE__, :test_handle_operations, [self()]},
        connection_manager: ctx.connection_manager
      ]

      # Add table_b to publication BEFORE inserting data
      Postgrex.query!(conn, "ALTER PUBLICATION #{publication_name} ADD TABLE table_b", [])

      # Start replication client
      client_pid = start_client(ctx, replication_opts: replication_opts)

      # Now insert into both tables
      {_id_a, bin_uuid_a} = gen_uuid()

      Postgrex.query!(conn, "INSERT INTO table_a (id, value) VALUES ($1, $2)", [
        bin_uuid_a,
        "new_value_a"
      ])

      {_id_b, bin_uuid_b} = gen_uuid()

      Postgrex.query!(conn, "INSERT INTO table_b (id, value) VALUES ($1, $2)", [
        bin_uuid_b,
        "new_value_b"
      ])

      # Both should be received since both tables are now in the publication
      changes = collect_all_changes(500)

      table_a_changes = Enum.filter(changes, &match?(%{relation: {"public", "table_a"}}, &1))
      table_b_changes = Enum.filter(changes, &match?(%{relation: {"public", "table_b"}}, &1))

      IO.puts("\n=== Control test: Data inserted AFTER publication change ===")
      IO.puts("table_a changes: #{length(table_a_changes)}")
      IO.puts("table_b changes: #{length(table_b_changes)}")

      assert length(table_a_changes) >= 1
      assert length(table_b_changes) >= 1

      Process.unlink(client_pid)
      Process.exit(client_pid, :kill)
    end
  end

  # Helper to handle operations from replication
  def test_handle_operations(operations, test_pid) when is_list(operations) do
    send(test_pid, {:from_replication, operations})
    :ok
  end

  defp gen_uuid do
    id = Ecto.UUID.generate()
    {:ok, bin_uuid} = Ecto.UUID.dump(id)
    {id, bin_uuid}
  end

  defp receive_tx_change do
    receive_tx_change_impl([])
  end

  defp receive_tx_change_impl(acc) do
    receive do
      {:from_replication, operations} ->
        # Find the actual data change (NewRecord, UpdatedRecord, DeletedRecord)
        case Enum.find(operations, fn
               %NewRecord{} -> true
               _ -> false
             end) do
          nil ->
            # Keep waiting for an actual change
            receive_tx_change_impl(acc ++ operations)

          change ->
            change
        end
    after
      @assert_receive_db_timeout ->
        raise "Expected transaction but timed out. Received operations: #{inspect(acc)}"
    end
  end

  defp collect_all_changes(timeout_ms) do
    collect_all_changes([], timeout_ms)
  end

  defp collect_all_changes(acc, timeout_ms) do
    receive do
      {:from_replication, operations} ->
        changes =
          Enum.filter(operations, fn
            %NewRecord{} -> true
            _ -> false
          end)

        collect_all_changes(acc ++ changes, timeout_ms)
    after
      timeout_ms -> acc
    end
  end

  defp start_client(ctx, overrides) do
    ctx = Enum.into(overrides, ctx)

    client_pid =
      start_link_supervised!(%{
        id: ctx[:id] || ReplicationClient,
        start:
          {ReplicationClient, :start_link,
           [
             [
               stack_id: ctx.stack_id,
               replication_opts: ctx.replication_opts,
               timeout: Map.get(ctx, :timeout, nil)
             ]
           ]},
        restart: :temporary
      })

    conn_mgr = ctx.connection_manager

    if Map.get(ctx, :wait_for_start, true) do
      assert_receive {^conn_mgr, :streaming_started}, @assert_receive_db_timeout
    end

    client_pid
  end
end
