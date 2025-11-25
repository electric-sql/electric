defmodule Electric.Postgres.PublicationChangeReplayTest do
  @moduledoc """
  Test module proving that PostgreSQL logical replication replay is DETERMINISTIC.

  ## Key Finding

  **Replaying from the same LSN will always produce identical results, even if the
  publication configuration has changed.**

  ## The Mechanism: Historic MVCC Snapshots

  When pgoutput decodes WAL records, it uses PostgreSQL's "historic MVCC snapshot"
  mechanism to look up catalog information (including publication membership).
  This historic snapshot shows the catalog state AS IT WAS at the time the WAL
  record was written, NOT the current catalog state.

  From PostgreSQL's snapmgr.c:

      GetCatalogSnapshot(Oid relid)
      {
          if (HistoricSnapshotActive())
              return HistoricSnapshot;  // Returns historical catalog state!
          ...
      }

  And the comment: "Return historic snapshot if doing logical decoding...
  Historic snapshots are only usable for catalog access."

  ## What This Means

  1. When you INSERT into a table, PostgreSQL records the WAL entry
  2. At decode time, pgoutput looks up "is this table in the publication?"
  3. But it uses a HISTORIC snapshot, so it sees the publication membership
     from the time of the INSERT, not the current membership
  4. Therefore, changing publication membership AFTER data is written has NO effect

  ## Test Summary

  | Scenario                                      | Result                    |
  |-----------------------------------------------|---------------------------|
  | Different publications on same slot           | Different data (expected) |
  | Modify publication, re-peek same data         | SAME data returned        |
  | Table in pub2 at write, add to pub1 later     | pub1 still can't see it   |
  | Table in NO publication, add later            | Still can't see old data  |

  ## Official Documentation

  - https://www.postgresql.org/docs/current/logical-replication-architecture.html
  - https://www.postgresql.org/docs/current/logicaldecoding-explanation.html
  - https://github.com/postgres/postgres/blob/master/src/backend/utils/time/snapmgr.c
  """

  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup, except: [with_publication: 1]

  alias Electric.Postgres.ReplicationClient
  alias Electric.Replication.Changes.NewRecord

  @assert_receive_db_timeout 2000

  # ---------------------------------------------------------------------------
  # Test Setup
  # ---------------------------------------------------------------------------

  defmodule MockConnectionManager do
    @moduledoc false
    def receive_casts(test_pid) do
      receive do
        message ->
          if response = process_message(message), do: send(test_pid, response)
          receive_casts(test_pid)
      end
    end

    defp process_message({:"$gen_cast", :replication_client_started}), do: nil
    defp process_message({:"$gen_cast", {:pg_info_obtained, _}}), do: nil
    defp process_message({:"$gen_cast", {:pg_system_identified, _}}), do: nil
    defp process_message({:"$gen_cast", :replication_client_lock_acquired}), do: :lock_acquired
    defp process_message({:"$gen_cast", {:replication_client_lock_acquisition_failed, e}}), do: {:lock_acquisition_failed, e}
    defp process_message({:"$gen_cast", :replication_client_created_new_slot}), do: nil
    defp process_message({:"$gen_cast", :replication_client_streamed_first_message}), do: {self(), :streaming_started}
  end

  setup do
    pid = spawn_link(MockConnectionManager, :receive_casts, [self()])
    %{connection_manager: pid}
  end

  setup :with_stack_id_from_test
  setup :with_slot_name

  # ---------------------------------------------------------------------------
  # Direct Slot Peek Tests (using pg_logical_slot_peek_binary_changes)
  # ---------------------------------------------------------------------------

  describe "Historic snapshot behavior - direct slot peek tests" do
    setup [:with_unique_db]

    test "BASELINE: different publications see different data from same slot position",
         %{db_conn: conn} = _ctx do
      # This test establishes the baseline: when tables are in their respective
      # publications AT WRITE TIME, each publication sees its own data.
      #
      # This works because the historic snapshot shows each table was in its
      # publication when the data was written.

      Postgrex.query!(conn, "CREATE TABLE baseline_a (id SERIAL PRIMARY KEY, val TEXT)", [])
      Postgrex.query!(conn, "CREATE TABLE baseline_b (id SERIAL PRIMARY KEY, val TEXT)", [])

      # Create publications BEFORE inserting data
      Postgrex.query!(conn, "CREATE PUBLICATION pub_a FOR TABLE baseline_a", [])
      Postgrex.query!(conn, "CREATE PUBLICATION pub_b FOR TABLE baseline_b", [])
      Postgrex.query!(conn, "CREATE PUBLICATION pub_both FOR TABLE baseline_a, baseline_b", [])

      slot_name = "baseline_slot_#{System.unique_integer([:positive])}"
      Postgrex.query!(conn, "SELECT pg_create_logical_replication_slot($1, 'pgoutput')", [slot_name])

      # Insert data - at this moment, each table is in its respective publication(s)
      Postgrex.query!(conn, "INSERT INTO baseline_a (val) VALUES ('a_value')", [])
      Postgrex.query!(conn, "INSERT INTO baseline_b (val) VALUES ('b_value')", [])

      # Peek with each publication
      %{rows: rows_a} = peek_slot(conn, slot_name, "pub_a")
      %{rows: rows_b} = peek_slot(conn, slot_name, "pub_b")
      %{rows: rows_both} = peek_slot(conn, slot_name, "pub_both")

      # pub_a sees only baseline_a data (4 messages: begin, relation, insert, commit)
      # pub_b sees only baseline_b data (4 messages)
      # pub_both sees both (8 messages: begin, relation_a, insert_a, relation_b, insert_b, commit... roughly)
      assert length(rows_a) == 4, "pub_a should see 4 messages (1 insert transaction)"
      assert length(rows_b) == 4, "pub_b should see 4 messages (1 insert transaction)"
      assert length(rows_both) == 8, "pub_both should see 8 messages (2 insert transactions)"

      Postgrex.query!(conn, "SELECT pg_drop_replication_slot($1)", [slot_name])
    end

    test "CRITICAL: modifying publication does NOT reveal previously-written data",
         %{db_conn: conn} = _ctx do
      # This is the KEY test proving deterministic replay.
      #
      # We write data when table_b is NOT in the publication, then add table_b
      # to the publication, then peek again. The historic snapshot mechanism
      # means we still see the OLD catalog state, so table_b data remains hidden.

      Postgrex.query!(conn, "CREATE TABLE modify_a (id SERIAL PRIMARY KEY, val TEXT)", [])
      Postgrex.query!(conn, "CREATE TABLE modify_b (id SERIAL PRIMARY KEY, val TEXT)", [])

      # Create publication with ONLY table_a
      Postgrex.query!(conn, "CREATE PUBLICATION pub_modify FOR TABLE modify_a", [])

      slot_name = "modify_slot_#{System.unique_integer([:positive])}"
      Postgrex.query!(conn, "SELECT pg_create_logical_replication_slot($1, 'pgoutput')", [slot_name])

      # Insert into both tables - table_b is NOT in publication at this moment
      Postgrex.query!(conn, "INSERT INTO modify_a (val) VALUES ('a_value')", [])
      Postgrex.query!(conn, "INSERT INTO modify_b (val) VALUES ('b_value')", [])

      # Peek BEFORE modifying publication
      %{rows: rows_before} = peek_slot(conn, slot_name, "pub_modify")

      # Now add table_b to the publication
      Postgrex.query!(conn, "ALTER PUBLICATION pub_modify ADD TABLE modify_b", [])

      # Peek AFTER modifying publication - same slot, same position
      %{rows: rows_after} = peek_slot(conn, slot_name, "pub_modify")

      # CRITICAL ASSERTION: The data should be IDENTICAL
      # Because the historic snapshot shows table_b was NOT in the publication
      # at the time the INSERT was written to WAL
      assert length(rows_before) == length(rows_after),
             """
             REPLAY IS NOT DETERMINISTIC!

             Before adding table_b: #{length(rows_before)} messages
             After adding table_b:  #{length(rows_after)} messages

             This would mean historic snapshots are not working as expected.
             """

      assert length(rows_before) == 4, "Should only see table_a's insert (4 messages)"

      Postgrex.query!(conn, "SELECT pg_drop_replication_slot($1)", [slot_name])
    end

    test "CRITICAL: table in ANOTHER publication at write time is still not visible",
         %{db_conn: conn} = _ctx do
      # This test proves that publication membership is tracked PER-PUBLICATION.
      #
      # Even if table_b was in pub2 at write time, adding table_b to pub1 later
      # does NOT make the data visible to pub1. The historic snapshot for pub1
      # shows table_b was not in pub1 at that time.

      Postgrex.query!(conn, "CREATE TABLE cross_a (id SERIAL PRIMARY KEY, val TEXT)", [])
      Postgrex.query!(conn, "CREATE TABLE cross_b (id SERIAL PRIMARY KEY, val TEXT)", [])

      # pub1 has table_a, pub2 has table_b
      Postgrex.query!(conn, "CREATE PUBLICATION cross_pub1 FOR TABLE cross_a", [])
      Postgrex.query!(conn, "CREATE PUBLICATION cross_pub2 FOR TABLE cross_b", [])

      slot_name = "cross_slot_#{System.unique_integer([:positive])}"
      Postgrex.query!(conn, "SELECT pg_create_logical_replication_slot($1, 'pgoutput')", [slot_name])

      # Insert data - table_b IS in a publication (pub2), just not pub1
      Postgrex.query!(conn, "INSERT INTO cross_a (val) VALUES ('a_value')", [])
      Postgrex.query!(conn, "INSERT INTO cross_b (val) VALUES ('b_value')", [])

      # Verify pub2 CAN see table_b data
      %{rows: rows_pub2} = peek_slot(conn, slot_name, "cross_pub2")
      assert length(rows_pub2) == 4, "pub2 should see table_b data"

      # pub1 before adding table_b
      %{rows: rows_pub1_before} = peek_slot(conn, slot_name, "cross_pub1")

      # Add table_b to pub1
      Postgrex.query!(conn, "ALTER PUBLICATION cross_pub1 ADD TABLE cross_b", [])

      # pub1 after adding table_b
      %{rows: rows_pub1_after} = peek_slot(conn, slot_name, "cross_pub1")

      # CRITICAL ASSERTION: pub1 still cannot see the table_b data
      # Even though table_b was in pub2 at write time, pub1's historic snapshot
      # shows table_b was not in pub1
      assert length(rows_pub1_before) == length(rows_pub1_after),
             """
             REPLAY IS NOT DETERMINISTIC!

             pub1 before adding table_b: #{length(rows_pub1_before)} messages
             pub1 after adding table_b:  #{length(rows_pub1_after)} messages

             Being in another publication (pub2) should not help pub1 see the data.
             """

      Postgrex.query!(conn, "SELECT pg_drop_replication_slot($1)", [slot_name])
    end

    test "table in NO publication at write time - data never becomes visible",
         %{db_conn: conn} = _ctx do
      # This test shows that even though wal_level=logical writes ALL changes
      # to WAL regardless of publication configuration, the pgoutput plugin
      # uses historic snapshots to filter based on publication membership
      # at write time.

      Postgrex.query!(conn, "CREATE TABLE nopub_a (id SERIAL PRIMARY KEY, val TEXT)", [])
      Postgrex.query!(conn, "CREATE TABLE nopub_b (id SERIAL PRIMARY KEY, val TEXT)", [])

      # Only table_a is in the publication - table_b is in NO publication
      Postgrex.query!(conn, "CREATE PUBLICATION pub_nopub FOR TABLE nopub_a", [])

      slot_name = "nopub_slot_#{System.unique_integer([:positive])}"
      Postgrex.query!(conn, "SELECT pg_create_logical_replication_slot($1, 'pgoutput')", [slot_name])

      # Insert into both - table_b data goes to WAL but is not in any publication
      Postgrex.query!(conn, "INSERT INTO nopub_a (val) VALUES ('a_value')", [])
      Postgrex.query!(conn, "INSERT INTO nopub_b (val) VALUES ('b_value')", [])

      %{rows: rows_before} = peek_slot(conn, slot_name, "pub_nopub")

      # Add table_b to publication
      Postgrex.query!(conn, "ALTER PUBLICATION pub_nopub ADD TABLE nopub_b", [])

      %{rows: rows_after} = peek_slot(conn, slot_name, "pub_nopub")

      # The data remains invisible because historic snapshot shows
      # table_b was not in pub_nopub at write time
      assert length(rows_before) == length(rows_after),
             """
             REPLAY IS NOT DETERMINISTIC!

             Before: #{length(rows_before)} messages
             After:  #{length(rows_after)} messages
             """

      Postgrex.query!(conn, "SELECT pg_drop_replication_slot($1)", [slot_name])
    end
  end

  # ---------------------------------------------------------------------------
  # ReplicationClient Tests (using actual streaming replication)
  # ---------------------------------------------------------------------------

  describe "ReplicationClient replay behavior" do
    setup [:with_unique_db, :with_status_monitor, :with_lsn_tracker]

    setup %{db_conn: conn} = ctx do
      Postgrex.query!(conn, "CREATE TABLE table_a (id UUID PRIMARY KEY, value TEXT NOT NULL)", [])
      Postgrex.query!(conn, "CREATE TABLE table_b (id UUID PRIMARY KEY, value TEXT NOT NULL)", [])

      publication_name = ctx.slot_name
      Postgrex.query!(conn, "CREATE PUBLICATION #{publication_name} FOR TABLE table_a", [])

      %{publication_name: publication_name}
    end

    test "replay only includes data written while table was in publication",
         %{db_conn: conn, slot_name: slot_name, publication_name: publication_name} = ctx do
      # This test uses the actual ReplicationClient to verify the behavior
      # in a realistic streaming replication scenario.

      replication_opts = [
        connection_opts: ctx.db_config,
        stack_id: ctx.stack_id,
        publication_name: publication_name,
        try_creating_publication?: false,
        slot_name: slot_name,
        handle_operations: {__MODULE__, :test_handle_operations, [self()]},
        connection_manager: ctx.connection_manager
      ]

      # Start replication client
      client_pid1 = start_client(ctx, replication_opts: replication_opts)

      # Insert into table_a (in publication) - should be received
      {_, bin_uuid_a1} = gen_uuid()
      Postgrex.query!(conn, "INSERT INTO table_a (id, value) VALUES ($1, 'before_change')", [bin_uuid_a1])
      assert %NewRecord{record: %{"value" => "before_change"}} = receive_tx_change()

      # Insert into table_b (NOT in publication) - should NOT be received
      {_, bin_uuid_b1} = gen_uuid()
      Postgrex.query!(conn, "INSERT INTO table_b (id, value) VALUES ($1, 'hidden_value')", [bin_uuid_b1])
      refute_receive {:from_replication, _}, 200

      # Modify publication to include table_b
      Postgrex.query!(conn, "ALTER PUBLICATION #{publication_name} ADD TABLE table_b", [])

      # Insert into table_b (now in publication) - should be received
      {_, bin_uuid_b2} = gen_uuid()
      Postgrex.query!(conn, "INSERT INTO table_b (id, value) VALUES ($1, 'visible_value')", [bin_uuid_b2])
      assert %NewRecord{record: %{"value" => "visible_value"}} = receive_tx_change()

      # Kill client to simulate crash (no LSN advancement)
      Process.unlink(client_pid1)
      Process.exit(client_pid1, :kill)
      Process.sleep(100)

      # Restart client - will replay from same position
      client_pid2 = start_client(ctx, replication_opts: replication_opts)

      # Collect replayed changes
      changes = collect_all_changes(500)
      table_b_values = changes
        |> Enum.filter(&match?(%{relation: {"public", "table_b"}}, &1))
        |> Enum.map(& &1.record["value"])

      # CRITICAL: hidden_value should NOT appear, visible_value should appear
      assert "hidden_value" not in table_b_values,
             "Data written before table was in publication should not appear in replay"

      assert "visible_value" in table_b_values,
             "Data written after table was added to publication should appear in replay"

      Process.unlink(client_pid2)
      Process.exit(client_pid2, :kill)
    end
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp peek_slot(conn, slot_name, publication_name) do
    Postgrex.query!(
      conn,
      """
      SELECT * FROM pg_logical_slot_peek_binary_changes($1, NULL, NULL,
        'publication_names', $2,
        'proto_version', '1')
      """,
      [slot_name, publication_name]
    )
  end

  def test_handle_operations(operations, test_pid) when is_list(operations) do
    send(test_pid, {:from_replication, operations})
    :ok
  end

  defp gen_uuid do
    id = Ecto.UUID.generate()
    {:ok, bin_uuid} = Ecto.UUID.dump(id)
    {id, bin_uuid}
  end

  defp receive_tx_change, do: receive_tx_change_impl([])

  defp receive_tx_change_impl(acc) do
    receive do
      {:from_replication, operations} ->
        case Enum.find(operations, &match?(%NewRecord{}, &1)) do
          nil -> receive_tx_change_impl(acc ++ operations)
          change -> change
        end
    after
      @assert_receive_db_timeout ->
        raise "Expected transaction but timed out. Received: #{inspect(acc)}"
    end
  end

  defp collect_all_changes(timeout_ms), do: collect_all_changes([], timeout_ms)

  defp collect_all_changes(acc, timeout_ms) do
    receive do
      {:from_replication, operations} ->
        changes = Enum.filter(operations, &match?(%NewRecord{}, &1))
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
        start: {ReplicationClient, :start_link, [[
          stack_id: ctx.stack_id,
          replication_opts: ctx.replication_opts,
          timeout: Map.get(ctx, :timeout, nil)
        ]]},
        restart: :temporary
      })

    conn_mgr = ctx.connection_manager
    if Map.get(ctx, :wait_for_start, true) do
      assert_receive {^conn_mgr, :streaming_started}, @assert_receive_db_timeout
    end

    client_pid
  end
end
