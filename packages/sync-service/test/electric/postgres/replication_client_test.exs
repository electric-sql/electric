defmodule Electric.Postgres.ReplicationClientTest do
  use ExUnit.Case, async: true

  import Support.ComponentSetup,
    only: [with_stack_id_from_test: 1, with_status_monitor: 1, with_slot_name_and_stream_id: 1]

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

  # Larger than average timeout for assertions that require
  # seeing changes back from the database, as it can be especially
  # slow on CI/Docker etc
  @assert_receive_db_timeout 1000

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
    defp process_message({:"$gen_cast", :replication_client_created_new_slot}), do: nil
    defp process_message({:"$gen_cast", {:pg_info_obtained, _}}), do: nil

    defp process_message({:"$gen_cast", :replication_client_streamed_first_message}),
      do: {self(), :streaming_started}
  end

  setup do
    # Spawn a dummy process to serve as the black hole for the messages that
    # ReplicationClient normally sends to Connection.Manager.
    pid = spawn_link(MockConnectionManager, :receive_casts, [self()])
    %{connection_manager: pid}
  end

  setup :with_stack_id_from_test
  setup :with_slot_name_and_stream_id

  describe "ReplicationClient init" do
    setup [:with_unique_db, :with_basic_tables, :with_status_monitor]

    test "creates an empty publication on startup if requested",
         %{db_conn: conn, connection_manager: connection_manager, slot_name: slot_name} = ctx do
      replication_opts = [
        connection_opts: ctx.db_config,
        stack_id: ctx.stack_id,
        publication_name: ctx.slot_name,
        try_creating_publication?: true,
        slot_name: ctx.slot_name,
        transaction_received: nil,
        relation_received: nil,
        connection_manager: connection_manager
      ]

      start_client(ctx, replication_opts: replication_opts)

      assert %{rows: [[^slot_name]]} =
               Postgrex.query!(conn, "SELECT pubname FROM pg_publication", [])

      assert %{rows: []} = Postgrex.query!(conn, "SELECT pubname FROM pg_publication_tables", [])
    end
  end

  describe "ReplicationClient against real db" do
    setup [
      :with_unique_db,
      :with_basic_tables,
      :with_publication,
      :with_replication_opts,
      :with_status_monitor
    ]

    test "calls a provided function when receiving it from the PG", %{db_conn: conn} = ctx do
      start_client(ctx)

      insert_item(conn, "test value")

      assert %NewRecord{record: %{"value" => "test value"}} = receive_tx_change()
    end

    test "logs a message when connected & replication has started", %{db_conn: conn} = ctx do
      log =
        ExUnit.CaptureLog.capture_log(fn ->
          start_client(ctx)

          insert_item(conn, "test value")

          assert %NewRecord{record: %{"value" => "test value"}} = receive_tx_change()
        end)

      log =~ "Started replication from postgres"
    end

    test "works with an existing publication", %{replication_opts: replication_opts} = ctx do
      replication_opts = Keyword.put(replication_opts, :try_creating_publication?, true)
      start_client(ctx, replication_opts: replication_opts)
    end

    test "works with an existing replication slot",
         %{db_conn: conn, slot_name: slot_name} = ctx do
      pid = start_client(ctx)

      assert %{
               "slot_name" => ^slot_name,
               "temporary" => false,
               "confirmed_flush_lsn" => flush_lsn
             } = fetch_slot_info(conn, slot_name)

      # Check that the slot remains even when the replication client goes down
      true = Process.unlink(pid)
      true = Process.exit(pid, :kill)

      assert %{"slot_name" => ^slot_name, "confirmed_flush_lsn" => ^flush_lsn} =
               fetch_slot_info(conn, slot_name)

      # Check that the replication client works when the replication slot already exists
      start_client(ctx)

      assert %{"slot_name" => ^slot_name, "confirmed_flush_lsn" => ^flush_lsn} =
               fetch_slot_info(conn, slot_name)
    end

    test "can replay already seen transaction", %{db_conn: conn} = ctx do
      pid = start_client(ctx)

      insert_item(conn, "test value")
      assert %NewRecord{record: %{"value" => "test value"}} = receive_tx_change()

      insert_item(conn, "return: not ok")
      assert %NewRecord{record: %{"value" => "return: not ok"}} = receive_tx_change()

      # Verify that raising in the transaction callback crashes the connection process
      monitor = Process.monitor(pid)
      Process.unlink(pid)

      on_exit(fn -> Process.alive?(pid) && Process.exit(pid, :kill) end)

      interrupt_val = "interrupt #{inspect(pid)}"
      insert_item(conn, interrupt_val)

      assert_receive {
                       :DOWN,
                       ^monitor,
                       :process,
                       ^pid,
                       {%RuntimeError{message: "Interrupting transaction processing abnormally"},
                        _stacktrace}
                     },
                     @assert_receive_db_timeout

      refute_received _

      # Now, when we restart the connection process, it replays transactions from the last
      # confirmed one
      start_client(ctx)

      assert %NewRecord{record: %{"value" => "return: not ok"}} = receive_tx_change()
      assert %NewRecord{record: %{"value" => ^interrupt_val}} = receive_tx_change()

      refute_receive _
    end

    # Regression test for https://github.com/electric-sql/electric/issues/1548
    test "fares well when multiple concurrent transactions are writing to WAL",
         %{db_conn: conn} = ctx do
      start_client(ctx)

      num_txn = 2
      num_ops = 8
      max_sleep = 20
      receive_timeout = max((num_txn + num_ops) * max_sleep * 2, @assert_receive_db_timeout)

      # Insert `num_txn` transactions, each in a separate process. Every transaction has
      # `num_ops` INSERTs with a random delay between each operation.
      # The end result is that INSERTs from different transactions get interleaved in
      # the WAL, challenging any assumptions in ReplicationClient about cross-transaction operation
      # ordering.
      Enum.each(1..num_txn, fn i ->
        tx_fun = fn conn ->
          pid_str = inspect(self())

          Enum.each(1..num_ops, fn j ->
            insert_item(conn, "#{i}-#{j} in process #{pid_str}")
            Process.sleep(:rand.uniform(max_sleep))
          end)
        end

        spawn_link(Postgrex, :transaction, [conn, tx_fun])
      end)

      # Receive every transaction sent by ReplicationClient to the test process.
      set =
        Enum.reduce(1..num_txn, MapSet.new(1..num_txn), fn _, set ->
          assert_receive {:from_replication, %Transaction{changes: records}}, receive_timeout
          assert num_ops == length(records)

          [%NewRecord{record: %{"value" => val}} | _] = records
          {i, _} = Integer.parse(val)

          MapSet.delete(set, i)
        end)

      # Make sure there are no extraneous messages left.
      assert MapSet.size(set) == 0
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
    test "returns data formatted according to display settings", %{db_conn: conn} = ctx do
      start_client(ctx)

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
      assert %NewRecord{
               record: %{
                 "date" => "2022-05-17",
                 "timestamptz" => "2022-01-12 00:01:00+00",
                 "float" => "1.234567890123456",
                 "bytea" => "\\x0510fa",
                 "interval" => "P1DT12H59M10S"
               }
             } = receive_tx_change()
    end

    test "exits with irrecoverable slot error with large transactions", %{db_conn: conn} = ctx do
      pid =
        start_client(ctx,
          replication_opts: Keyword.put(ctx.replication_opts, :max_txn_size, 5000)
        )

      monitor = Process.monitor(pid)
      Process.unlink(pid)
      on_exit(fn -> Process.alive?(pid) && Process.exit(pid, :kill) end)

      insert_item(conn, gen_random_string(5001))

      # Verify that passing the txn size limit crashes the process

      assert_receive {
                       :DOWN,
                       ^monitor,
                       :process,
                       ^pid,
                       {:irrecoverable_slot,
                        {:exceeded_max_tx_size,
                         "Collected transaction exceeds limit of 5000 bytes."}}
                     },
                     @assert_receive_db_timeout
    end

    test "exits with irrecoverable slot error for invalid replica identity",
         %{db_conn: conn} = ctx do
      pid = start_client(ctx)

      {_id, bin_uuid} = gen_uuid()

      Postgrex.query!(conn, "INSERT INTO items (id, value) VALUES ($1, $2)", [bin_uuid, "test"])
      assert %NewRecord{record: %{"value" => "test"}} = receive_tx_change()
      Postgrex.query!(conn, "UPDATE items SET value = $2 WHERE id = $1", [bin_uuid, "new"])

      monitor = Process.monitor(pid)
      Process.unlink(pid)
      on_exit(fn -> Process.alive?(pid) && Process.exit(pid, :kill) end)

      # Verify that receiving updates without old values causes an exit
      assert_receive {
                       :DOWN,
                       ^monitor,
                       :process,
                       ^pid,
                       {:irrecoverable_slot, {:replica_not_full, msg}}
                     },
                     @assert_receive_db_timeout

      assert msg =~
               "Received an update from PG for public.items that did not have old data included in the message."
    end
  end

  describe "ReplicationClient against real db (toast)" do
    setup [
      :with_unique_db,
      :with_basic_tables,
      :with_publication,
      :with_replication_opts,
      :with_status_monitor
    ]

    setup %{db_conn: conn} = ctx do
      Postgrex.query!(
        conn,
        "CREATE TABLE items2 (id UUID PRIMARY KEY, val1 TEXT, val2 TEXT, num INTEGER)",
        []
      )

      Postgrex.query!(conn, "ALTER TABLE items2 REPLICA IDENTITY FULL", [])

      start_client(ctx)

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

      assert %NewRecord{
               record: %{"id" => ^id, "val1" => ^long_string_1, "val2" => ^long_string_2},
               relation: {"public", "items2"}
             } = receive_tx_change()

      Postgrex.query!(conn, "DELETE FROM items2 WHERE id = $1", [bin_uuid])

      assert %DeletedRecord{
               old_record: %{"id" => ^id, "val1" => ^long_string_1, "val2" => ^long_string_2},
               relation: {"public", "items2"}
             } = receive_tx_change()
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

      assert %NewRecord{
               record: %{"id" => ^id, "val1" => ^long_string_1, "val2" => ^long_string_2},
               relation: {"public", "items2"}
             } = receive_tx_change()

      Postgrex.query!(conn, "UPDATE items2 SET num = 11 WHERE id = $1", [bin_uuid])

      assert %UpdatedRecord{
               record: %{
                 "id" => ^id,
                 "val1" => ^long_string_1,
                 "val2" => ^long_string_2,
                 "num" => "11"
               },
               changed_columns: changed_columns,
               relation: {"public", "items2"}
             } = receive_tx_change()

      assert MapSet.new(["num"]) == changed_columns
    end
  end

  test "correctly responds to a status update request message from PG", ctx do
    state =
      ReplicationClient.State.new(
        stack_id: ctx.stack_id,
        transaction_received: nil,
        relation_received: nil,
        publication_name: "",
        try_creating_publication?: false,
        slot_name: "",
        connection_manager: ctx.connection_manager
      )

    state = %{state | applied_wal: lsn_to_wal("0/0")}
    pg_wal = lsn_to_wal("0/10")

    assert {:noreply, [<<?r, app_wal::64, app_wal::64, app_wal::64, _time::64, 0::8>>], state} =
             ReplicationClient.handle_data(<<?k, pg_wal::64, 0::64, 1::8>>, state)

    assert state.applied_wal == pg_wal
    assert app_wal == state.applied_wal + 1
  end

  defp with_publication(%{db_conn: conn, slot_name: slot_name}) do
    Postgrex.query!(conn, "CREATE PUBLICATION #{slot_name} FOR ALL TABLES", [])
    :ok
  end

  defp with_replication_opts(ctx) do
    %{
      replication_opts: [
        connection_opts: ctx.db_config,
        stack_id: ctx.stack_id,
        publication_name: ctx.slot_name,
        try_creating_publication?: false,
        slot_name: ctx.slot_name,
        transaction_received: {__MODULE__, :test_transaction_received, [self()]},
        relation_received: {__MODULE__, :test_relation_received, [self()]},
        connection_manager: ctx.connection_manager
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

  def test_relation_received(_change, _test_pid) do
    :ok
  end

  defp gen_random_string(length) do
    Stream.repeatedly(fn -> :rand.uniform(125 - 32) + 32 end)
    |> Enum.take(length)
    |> List.to_string()
  end

  defp lsn_to_wal(lsn_str) when is_binary(lsn_str),
    do: lsn_str |> Lsn.from_string() |> Lsn.to_integer()

  defp fetch_slot_info(conn, target_slot_name) do
    %Postgrex.Result{columns: cols, rows: rows} =
      Postgrex.query!(conn, "SELECT * FROM pg_replication_slots", [])

    [row] = Enum.filter(rows, fn [slot_name | _] -> slot_name == target_slot_name end)

    Enum.zip(cols, row) |> Map.new()
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

  defp receive_tx_change do
    assert_receive {:from_replication, %Transaction{changes: [change]}},
                   @assert_receive_db_timeout

    change
  end

  defp start_client(ctx, overrides \\ []) do
    ctx = Enum.into(overrides, ctx)

    client_pid =
      start_link_supervised!(%{
        id: ReplicationClient,
        start:
          {ReplicationClient, :start_link,
           [[stack_id: ctx.stack_id, replication_opts: ctx.replication_opts]]},
        restart: :temporary
      })

    conn_mgr = ctx.connection_manager
    assert_receive {^conn_mgr, :streaming_started}, @assert_receive_db_timeout

    client_pid
  end
end
