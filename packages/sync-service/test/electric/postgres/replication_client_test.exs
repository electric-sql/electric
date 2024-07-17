defmodule Electric.Postgres.ReplicationClientTest do
  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.ReplicationClient
  use ExUnit.Case, async: true

  @moduletag :capture_log
  @publication_name "test_electric_publication"

  def create_publication_for_all_tables(conn),
    do: Postgrex.query!(conn, "CREATE PUBLICATION #{@publication_name} FOR ALL TABLES", [])

  describe "ReplicationClient against real db" do
    setup {Support.DbSetup, :with_unique_db}
    setup {Support.DbStructureSetup, :with_basic_tables}

    setup do
      %{
        init_opts: [
          publication_name: @publication_name,
          transaction_received: {__MODULE__, :test_transaction_received, [self()]},
          try_creating_publication?: false
        ]
      }
    end

    test "calls a provided function when receiving it from the PG",
         %{db_config: config, init_opts: init_opts, db_conn: conn} do
      create_publication_for_all_tables(conn)
      assert {:ok, _pid} = ReplicationClient.start_link(config ++ [init_opts: init_opts])

      {:ok, _} =
        Postgrex.query(conn, "INSERT INTO items (id, value) VALUES ($1, $2)", [
          Ecto.UUID.bingenerate(),
          "test value"
        ])

      assert_receive {:from_replication, %Transaction{changes: [change]}}
      assert %NewRecord{record: %{"value" => "test value"}} = change
    end

    test "logs a message when connected & replication has started",
         %{db_config: config, init_opts: init_opts, db_conn: conn} do
      create_publication_for_all_tables(conn)

      log =
        ExUnit.CaptureLog.capture_log(fn ->
          assert {:ok, _pid} = ReplicationClient.start_link(config ++ [init_opts: init_opts])

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

    test "creates an empty publication on startup if requested", %{
      db_config: config,
      init_opts: init_opts,
      db_conn: conn
    } do
      init_opts = Keyword.put(init_opts, :try_creating_publication?, true)
      assert {:ok, _} = ReplicationClient.start_link(config ++ [init_opts: init_opts])

      assert %{rows: [[@publication_name]]} =
               Postgrex.query!(conn, "SELECT pubname FROM pg_publication", [])

      assert %{rows: []} = Postgrex.query!(conn, "SELECT pubname FROM pg_publication_tables", [])
    end

    test "doesn't fail to start when publicaiton already exists", %{
      db_config: config,
      init_opts: init_opts,
      db_conn: conn
    } do
      init_opts = Keyword.put(init_opts, :try_creating_publication?, true)
      create_publication_for_all_tables(conn)

      assert {:ok, _} = ReplicationClient.start_link(config ++ [init_opts: init_opts])
    end
  end

  test "replication client correctly responds to a status update request message from PG" do
    lsn = Lsn.from_string("0/10")

    assert {:noreply, [<<?r, wal::64, wal::64, wal::64, _time::64, 0::8>>], nil} =
             ReplicationClient.handle_data(<<?k, Lsn.to_integer(lsn)::64, 0::64, 1::8>>, nil)

    assert Lsn.from_integer(wal) == Lsn.from_string("0/11")
  end

  def test_transaction_received(transaction, test_pid),
    do: send(test_pid, {:from_replication, transaction})
end
