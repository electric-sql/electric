defmodule Electric.Satellite.WsValidationsTest do
  use ExUnit.Case, async: false

  use Electric.Satellite.Protobuf

  import Electric.Postgres.TestConnection
  import ElectricTest.SatelliteHelpers

  alias Electric.Test.SatelliteWsClient, as: MockClient
  alias Electric.Satellite.Auth

  alias Electric.Satellite.Serialization
  alias Electric.Replication.Changes.{Transaction, NewRecord}

  @ws_listener_name :ws_validations_test
  @table_name "foo"

  setup :setup_replicated_db

  setup ctx do
    port = 55133

    {:ok, _sup_pid} =
      Electric.Satellite.WsServer.start_link(
        name: @ws_listener_name,
        port: port,
        auth_provider: Auth.provider(),
        pg_connector_opts: ctx.pg_connector_opts
      )

    on_exit(fn -> :cowboy.stop_listener(@ws_listener_name) end)

    client_id = "ws_pg_to_satellite_client"
    auth = %{token: Auth.Secure.create_token(Electric.Utils.uuid4())}

    %{db: ctx.conn, conn_opts: [port: port, auth: auth, id: client_id]}
  end

  test "accepts records with valid values", ctx do
    vsn = "2023072500"

    :ok =
      migrate(
        ctx.db,
        vsn,
        "public.foo",
        "CREATE TABLE public.foo (id TEXT PRIMARY KEY, num INTEGER, t1 TEXT, t2 VARCHAR NOT NULL)"
      )

    within_replication_context(ctx, vsn, fn conn ->
      tx_op_log = serialize_trans(%{"id" => "1", "num" => "433", "t2" => "hello"})
      MockClient.send_data(conn, tx_op_log)

      tx_op_log = serialize_trans(%{"id" => "2", "num" => nil, "t1" => nil, "t2" => ""})
      MockClient.send_data(conn, tx_op_log)

      tx_op_log = serialize_trans(%{"id" => "3", "num" => "-1", "t1" => "", "t2" => "..."})
      MockClient.send_data(conn, tx_op_log)

      # Wait long enough for the server to process our messages, thus confirming it has been accepted
      ping_server(conn)

      refute_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}
    end)
  end

  defp within_replication_context(ctx, vsn, expectation_fn) do
    with_connect(ctx.conn_opts, fn conn ->
      # Replication start ceremony
      assert_receive {^conn, %SatInStartReplicationReq{}}
      MockClient.send_data(conn, %SatInStartReplicationResp{})

      MockClient.send_data(conn, %SatInStartReplicationReq{})
      assert_receive {^conn, %SatInStartReplicationResp{}}

      # Confirm the server has sent the migration to the client
      assert_receive {^conn, %SatRelation{table_name: @table_name} = relation}

      assert_receive {^conn,
                      %SatOpLog{
                        ops: [
                          %SatTransOp{op: {:begin, %SatOpBegin{is_migration: true}}},
                          %SatTransOp{op: {:migrate, %{version: ^vsn}}},
                          %SatTransOp{op: {:commit, _}}
                        ]
                      }}

      # The client has to repeat the relation message to the server
      MockClient.send_data(conn, relation)

      expectation_fn.(conn)
    end)
  end

  defp serialize_trans(record) do
    {[op_log], _relations, _relation_mappings} =
      %Transaction{
        changes: [%NewRecord{relation: {"public", @table_name}, record: record, tags: []}],
        commit_timestamp: DateTime.utc_now()
      }
      |> Serialization.serialize_trans(1, %{})

    op_log
  end
end
