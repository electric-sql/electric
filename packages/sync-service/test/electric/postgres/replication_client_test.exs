defmodule Electric.Postgres.ReplicationClientTest do
  use ExUnit.Case, async: true

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

  describe "ReplicationClient init" do
    setup {Support.DbSetup, :with_unique_db}
    setup {Support.DbStructureSetup, :with_basic_tables}

    setup do
      %{
        replication_opts: [
          publication_name: @publication_name,
          transaction_received: {__MODULE__, :test_transaction_received, [self()]}
        ]
      }
    end

    test "creates an empty publication on startup if requested", %{
      db_config: config,
      replication_opts: replication_opts,
      db_conn: conn
    } do
      replication_opts = Keyword.put(replication_opts, :try_creating_publication?, true)
      assert {:ok, _} = ReplicationClient.start_link(config, replication_opts)

      assert %{rows: [[@publication_name]]} =
               Postgrex.query!(conn, "SELECT pubname FROM pg_publication", [])

      assert %{rows: []} = Postgrex.query!(conn, "SELECT pubname FROM pg_publication_tables", [])
    end
  end

  describe "ReplicationClient against real db" do
    setup [
      {Support.DbSetup, :with_unique_db},
      {Support.DbStructureSetup, :with_basic_tables},
      :setup_publication_and_replication_opts
    ]

    test "calls a provided function when receiving it from the PG",
         %{db_config: config, replication_opts: replication_opts, db_conn: conn} do
      assert {:ok, _pid} = ReplicationClient.start_link(config, replication_opts)

      {:ok, _} =
        Postgrex.query(conn, "INSERT INTO items (id, value) VALUES ($1, $2)", [
          Ecto.UUID.bingenerate(),
          "test value"
        ])

      assert_receive {:from_replication, %Transaction{changes: [change]}}
      assert %NewRecord{record: %{"value" => "test value"}} = change
    end

    test "logs a message when connected & replication has started",
         %{db_config: config, replication_opts: replication_opts, db_conn: conn} do
      log =
        ExUnit.CaptureLog.capture_log(fn ->
          assert {:ok, _pid} = ReplicationClient.start_link(config, replication_opts)

          {:ok, _} =
            Postgrex.query(conn, "INSERT INTO items (id, value) VALUES ($1, $2)", [
              Ecto.UUID.bingenerate(),
              "test value"
            ])

          assert_receive {:from_replication, %Transaction{changes: [change]}}
          assert %NewRecord{record: %{"value" => "test value"}} = change
        end)

      log =~ "Started replication from postgres"
    end

    test "doesn't fail to start when publicaiton already exists", %{
      db_config: config,
      replication_opts: replication_opts
    } do
      replication_opts = Keyword.put(replication_opts, :try_creating_publication?, true)
      assert {:ok, _} = ReplicationClient.start_link(config, replication_opts)
    end
  end

  describe "ReplicationClient against real db (toast)" do
    setup [
      {Support.DbSetup, :with_unique_db},
      {Support.DbStructureSetup, :with_basic_tables},
      :setup_publication_and_replication_opts
    ]

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
      id = Ecto.UUID.generate()
      {:ok, bin_uuid} = Ecto.UUID.dump(id)
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
      id = Ecto.UUID.generate()
      {:ok, bin_uuid} = Ecto.UUID.dump(id)
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

  test "replication client correctly responds to a status update request message from PG" do
    lsn = Lsn.from_string("0/10")

    assert {:noreply, [<<?r, wal::64, wal::64, wal::64, _time::64, 0::8>>], nil} =
             ReplicationClient.handle_data(<<?k, Lsn.to_integer(lsn)::64, 0::64, 1::8>>, nil)

    assert Lsn.from_integer(wal) == Lsn.from_string("0/11")
  end

  defp setup_publication_and_replication_opts(%{db_conn: conn}) do
    create_publication_for_all_tables(conn)

    %{
      replication_opts: [
        publication_name: @publication_name,
        transaction_received: {__MODULE__, :test_transaction_received, [self()]},
        try_creating_publication?: false
      ]
    }
  end

  def test_transaction_received(transaction, test_pid),
    do: send(test_pid, {:from_replication, transaction})

  defp create_publication_for_all_tables(conn),
    do: Postgrex.query!(conn, "CREATE PUBLICATION #{@publication_name} FOR ALL TABLES", [])

  defp gen_random_string(length) do
    Stream.repeatedly(fn -> :rand.uniform(125 - 32) + 32 end)
    |> Enum.take(length)
    |> List.to_string()
  end
end
