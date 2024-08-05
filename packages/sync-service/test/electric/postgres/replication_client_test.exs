defmodule Electric.Postgres.ReplicationClientTest do
  use ExUnit.Case, async: true

  import Support.DbSetup, except: [with_publication: 1]
  import Support.DbStructureSetup

  alias Electric.Postgres.Lsn
  alias Electric.Postgres.ReplicationClient

  alias Electric.Replication.Changes.{
    DeletedRecord,
    NewRecord,
    Transaction,
    UpdatedRecord
  }

  @moduletag :capture_log
  @publication_name "test_electric_publication"
  @slot_name "test_electric_slot"

  describe "ReplicationClient init" do
    setup [:with_unique_db, :with_basic_tables]

    test "creates an empty publication on startup if requested", %{
      db_config: config,
      db_conn: conn
    } do
      replication_opts = [
        publication_name: @publication_name,
        try_creating_publication?: true,
        slot_name: @slot_name,
        transaction_received: nil
      ]

      assert {:ok, _} = ReplicationClient.start_link(config, replication_opts)

      assert %{rows: [[@publication_name]]} =
               Postgrex.query!(conn, "SELECT pubname FROM pg_publication", [])

      assert %{rows: []} = Postgrex.query!(conn, "SELECT pubname FROM pg_publication_tables", [])
    end
  end

  describe "ReplicationClient against real db" do
    setup [:with_unique_db, :with_basic_tables, :with_publication, :with_replication_opts]

    test "calls a provided function when receiving it from the PG",
         %{db_config: config, replication_opts: replication_opts, db_conn: conn} do
      assert {:ok, _pid} = ReplicationClient.start_link(config, replication_opts)

      insert_item(conn, "test value")

      assert_receive {:from_replication, %Transaction{changes: [change]}}
      assert %NewRecord{record: %{"value" => "test value"}} = change
    end

    test "logs a message when connected & replication has started",
         %{db_config: config, replication_opts: replication_opts, db_conn: conn} do
      log =
        ExUnit.CaptureLog.capture_log(fn ->
          assert {:ok, _pid} = ReplicationClient.start_link(config, replication_opts)

          insert_item(conn, "test value")

          assert_receive {:from_replication, %Transaction{changes: [change]}}
          assert %NewRecord{record: %{"value" => "test value"}} = change
        end)

      log =~ "Started replication from postgres"
    end

    test "works with an existing publication", %{
      db_config: config,
      replication_opts: replication_opts
    } do
      replication_opts = Keyword.put(replication_opts, :try_creating_publication?, true)
      assert {:ok, _} = ReplicationClient.start_link(config, replication_opts)
    end

    test "works with an existing replication slot", %{
      db_config: config,
      replication_opts: replication_opts,
      db_conn: conn
    } do
      {:ok, pid} = ReplicationClient.start_link(config, replication_opts)

      assert %{
               "slot_name" => @slot_name,
               "temporary" => false,
               "confirmed_flush_lsn" => flush_lsn
             } = fetch_slot_info(conn)

      # Check that the slot remains even when the replication client goes down
      true = Process.unlink(pid)
      true = Process.exit(pid, :kill)

      assert %{"slot_name" => @slot_name, "confirmed_flush_lsn" => ^flush_lsn} =
               fetch_slot_info(conn)

      # Check that the replication client works when the replication slot already exists
      {:ok, _pid} = ReplicationClient.start_link(config, replication_opts)

      assert %{"slot_name" => @slot_name, "confirmed_flush_lsn" => ^flush_lsn} =
               fetch_slot_info(conn)
    end

    test "can replay already seen transaction", %{
      db_config: config,
      replication_opts: replication_opts,
      db_conn: conn
    } do
      assert {:ok, pid} = ReplicationClient.start_link(config, replication_opts)

      # Verify that inserting an item results in advancement of slot's confirmed_flush_lsn
      flushed_lsn_1 = fetch_slot_info(conn, "confirmed_flush_lsn")

      insert_item(conn, "test value")

      assert_receive {:from_replication, %Transaction{changes: [change]}}
      assert %NewRecord{record: %{"value" => "test value"}} = change

      flushed_lsn_2 = fetch_slot_info(conn, "confirmed_flush_lsn")
      assert Lsn.compare(flushed_lsn_2, flushed_lsn_1) == :gt

      # Verify that returning a value other than :ok from the transaction callback leaves slot's LSN unchanged.
      insert_item(conn, "return: not ok")

      assert_receive {:from_replication, %Transaction{changes: [change]}}
      assert %NewRecord{record: %{"value" => "return: not ok"}} = change

      assert flushed_lsn_2 == fetch_slot_info(conn, "confirmed_flush_lsn")

      # Verify that raising in the transaction callback crashes the connection process
      monitor = Process.monitor(pid)
      Process.unlink(pid)

      interrupt_val = "interrupt #{inspect(pid)}"
      insert_item(conn, interrupt_val)

      assert_receive {
        :DOWN,
        ^monitor,
        :process,
        ^pid,
        {%RuntimeError{message: "Interrupting transaction processing abnormally"}, _stacktrace}
      }

      refute_received _

      # Now, when we restart the connection process, it replays transactions from the last confirmed one
      assert {:ok, _pid} = ReplicationClient.start_link(config, replication_opts)

      assert_receive {:from_replication, %Transaction{changes: [change], lsn: tx_lsn_1}}
      assert %NewRecord{record: %{"value" => "return: not ok"}} = change

      assert Lsn.compare(tx_lsn_1, flushed_lsn_2) == :gt

      assert_receive {:from_replication, %Transaction{changes: [change], lsn: tx_lsn_2}}
      assert %NewRecord{record: %{"value" => ^interrupt_val}} = change

      assert Lsn.compare(tx_lsn_2, tx_lsn_1) == :gt

      assert Lsn.to_integer(tx_lsn_2) >=
               Lsn.to_integer(fetch_slot_info(conn, "confirmed_flush_lsn"))

      refute_receive _
    end

    # Set the DB's display settings to something else than Electric.Postgres.display_settings
    @tag database_settings: [
           "DateStyle='Postgres, DMY'",
           "TimeZone='CET'",
           "extra_float_digits=-1",
           "bytea_output='escape'",
           "IntervalStyle='postgres'"
         ]
    @tag additional_fields:
           "date DATE, timestamptz TIMESTAMPTZ, float FLOAT8, bytea BYTEA, interval INTERVAL"
    test "returns data formatted according to display settings", %{
      db_config: config,
      replication_opts: replication_opts,
      db_conn: conn
    } do
      assert {:ok, _} = ReplicationClient.start_link(config, replication_opts)

      Postgrex.query!(
        conn,
        """
        INSERT INTO items (
          id, value, date, timestamptz, float, bytea, interval
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )
        """,
        [
          Ecto.UUID.bingenerate(),
          "test value",
          ~D[2022-05-17],
          ~U[2022-01-12 00:01:00.00Z],
          1.234567890123456,
          <<0x5, 0x10, 0xFA>>,
          %Postgrex.Interval{
            days: 1,
            months: 0,
            # 12 hours, 59 minutes, 10 seconds
            secs: 46750,
            microsecs: 0
          }
        ]
      )

      # Check that the incoming data is formatted according to Electric.Postgres.display_settings
      assert_receive {:from_replication, %Transaction{changes: [change]}}

      assert %NewRecord{
               record: %{
                 "date" => "2022-05-17",
                 "timestamptz" => "2022-01-12 00:01:00+00",
                 "float" => "1.234567890123456",
                 "bytea" => "\\x0510fa",
                 "interval" => "P1DT12H59M10S"
               }
             } = change
    end
  end

  describe "ReplicationClient against real db (toast)" do
    setup [:with_unique_db, :with_basic_tables, :with_publication, :with_replication_opts]

    setup %{db_config: config, replication_opts: replication_opts, db_conn: conn} do
      Postgrex.query!(
        conn,
        "CREATE TABLE items2 (id UUID PRIMARY KEY, val1 TEXT, val2 TEXT, num INTEGER)",
        []
      )

      Postgrex.query!(conn, "ALTER TABLE items2 REPLICA IDENTITY FULL", [])

      assert {:ok, _pid} = ReplicationClient.start_link(config, replication_opts)

      :ok
    end

    test "detoasts column values in deletes", %{db_conn: conn} do
      {id, bin_uuid} = gen_uuid()
      long_string_1 = gen_random_string(2500)
      long_string_2 = gen_random_string(3000)

      Postgrex.query!(conn, "INSERT INTO items2 (id, val1, val2) VALUES ($1, $2, $3)", [
        bin_uuid,
        long_string_1,
        long_string_2
      ])

      assert_receive {:from_replication, %Transaction{changes: [change]}}

      assert %NewRecord{
               record: %{"id" => ^id, "val1" => ^long_string_1, "val2" => ^long_string_2},
               relation: {"public", "items2"}
             } = change

      Postgrex.query!(conn, "DELETE FROM items2 WHERE id = $1", [bin_uuid])

      assert_receive {:from_replication, %Transaction{changes: [change]}}

      assert %DeletedRecord{
               old_record: %{"id" => ^id, "val1" => ^long_string_1, "val2" => ^long_string_2},
               relation: {"public", "items2"}
             } = change
    end

    test "detoasts column values in updates", %{db_conn: conn} do
      {id, bin_uuid} = gen_uuid()
      long_string_1 = gen_random_string(2500)
      long_string_2 = gen_random_string(3000)

      Postgrex.query!(conn, "INSERT INTO items2 (id, val1, val2) VALUES ($1, $2, $3)", [
        bin_uuid,
        long_string_1,
        long_string_2
      ])

      assert_receive {:from_replication, %Transaction{changes: [change]}}

      assert %NewRecord{
               record: %{"id" => ^id, "val1" => ^long_string_1, "val2" => ^long_string_2},
               relation: {"public", "items2"}
             } = change

      Postgrex.query!(conn, "UPDATE items2 SET num = 11 WHERE id = $1", [bin_uuid])

      assert_receive {:from_replication, %Transaction{changes: [change]}}

      assert %UpdatedRecord{
               record: %{
                 "id" => ^id,
                 "val1" => ^long_string_1,
                 "val2" => ^long_string_2,
                 "num" => "11"
               },
               changed_columns: changed_columns,
               relation: {"public", "items2"}
             } = change

      assert MapSet.new(["num"]) == changed_columns
    end
  end

  test "correctly responds to a status update request message from PG" do
    pg_wal = lsn_to_wal("0/10")

    state =
      ReplicationClient.State.new(
        transaction_received: nil,
        publication_name: "",
        try_creating_publication?: false,
        slot_name: ""
      )

    # Received WAL is PG WAL while "applied" and "flushed" WAL are still at zero based on the `state`.
    assert {:noreply, [<<?r, wal::64, 0::64, 0::64, _time::64, 0::8>>], state} =
             ReplicationClient.handle_data(<<?k, pg_wal::64, 0::64, 1::8>>, state)

    assert wal == pg_wal

    ###

    state = %{state | applied_wal: lsn_to_wal("0/10")}
    pg_wal = lsn_to_wal("1/20")

    assert {:noreply, [<<?r, wal::64, app_wal::64, app_wal::64, _time::64, 0::8>>], state} =
             ReplicationClient.handle_data(<<?k, pg_wal::64, 0::64, 1::8>>, state)

    assert wal == pg_wal
    assert app_wal == state.applied_wal
  end

  defp with_publication(%{db_conn: conn}) do
    Postgrex.query!(conn, "CREATE PUBLICATION #{@publication_name} FOR ALL TABLES", [])
    :ok
  end

  defp with_replication_opts(_) do
    %{
      replication_opts: [
        publication_name: @publication_name,
        try_creating_publication?: false,
        slot_name: @slot_name,
        transaction_received: {__MODULE__, :test_transaction_received, [self()]}
      ]
    }
  end

  # Special handling for the items table to enable testing of various edge cases that depend on the result of transaction processing.
  def test_transaction_received(
        %Transaction{changes: [%NewRecord{relation: {"public", "items"}} = change]} = transaction,
        test_pid
      ) do
    case Map.fetch!(change.record, "value") do
      "return: " <> val ->
        send(test_pid, {:from_replication, transaction})
        val

      "interrupt #PID" <> pid_str ->
        pid = pid_str |> String.to_charlist() |> :erlang.list_to_pid()

        if pid == self() do
          raise "Interrupting transaction processing abnormally"
        else
          send(test_pid, {:from_replication, transaction})
          :ok
        end

      _ ->
        send(test_pid, {:from_replication, transaction})
        :ok
    end
  end

  def test_transaction_received(transaction, test_pid) do
    send(test_pid, {:from_replication, transaction})
    :ok
  end

  defp gen_random_string(length) do
    Stream.repeatedly(fn -> :rand.uniform(125 - 32) + 32 end)
    |> Enum.take(length)
    |> List.to_string()
  end

  defp lsn_to_wal(lsn_str) when is_binary(lsn_str),
    do: lsn_str |> Lsn.from_string() |> Lsn.to_integer()

  defp fetch_slot_info(conn) do
    %Postgrex.Result{columns: cols, rows: rows} =
      Postgrex.query!(conn, "SELECT * FROM pg_replication_slots", [])

    [row] = Enum.filter(rows, fn [slot_name | _] -> slot_name == @slot_name end)

    Enum.zip(cols, row) |> Map.new()
  end

  defp fetch_slot_info(conn, field) do
    conn
    |> fetch_slot_info()
    |> Map.fetch!(field)
  end

  defp insert_item(conn, val) do
    Postgrex.query!(conn, "INSERT INTO items (id, value) VALUES ($1, $2)", [
      Ecto.UUID.bingenerate(),
      val
    ])
  end

  defp gen_uuid do
    id = Ecto.UUID.generate()
    {:ok, bin_uuid} = Ecto.UUID.dump(id)
    {id, bin_uuid}
  end
end
