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

  test "rejects records with invalid values", ctx do
    vsn = "2023072501"

    :ok =
      migrate(
        ctx.db,
        vsn,
        "public.foo",
        "CREATE TABLE public.foo (id TEXT PRIMARY KEY, num SMALLINT, t1 TEXT, t2 VARCHAR NOT NULL)"
      )

    records = [
      %{"id" => "1", "num" => "abc", "t2" => "hello"},
      %{"id" => "2", "num" => "32768", "t2" => ""},
      %{"id" => "3", "num" => "-32769", "t2" => ""}
    ]

    Enum.each(records, fn record ->
      within_replication_context(ctx, vsn, fn conn ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}
      end)
    end)
  end

  test "validates integer values", ctx do
    vsn = "2023072502"

    :ok =
      migrate(
        ctx.db,
        vsn,
        "public.foo",
        "CREATE TABLE public.foo (id TEXT PRIMARY KEY, i2_1 SMALLINT, i2_2 INT2, i4_1 INTEGER, i4_2 INT4, i8_1 BIGINT, i8_2 INT8)"
      )

    valid_records = [
      %{"id" => "1", "i2_1" => "1", "i2_2" => "-1"},
      %{"id" => "2", "i2_1" => "32767", "i2_2" => "-32768"},
      %{"id" => "3", "i4_1" => "+0", "i4_2" => "-0"},
      %{"id" => "4", "i4_1" => "2147483647", "i4_2" => "-2147483648"},
      %{"id" => "5", "i8_1" => "-9223372036854775808", "i8_2" => "+9223372036854775807"}
    ]

    within_replication_context(ctx, vsn, fn conn ->
      Enum.each(valid_records, fn record ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
      end)

      # Wait long enough for the server to process our messages, thus confirming it has been accepted
      ping_server(conn)

      refute_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}
    end)

    invalid_records = [
      %{"id" => "10", "i2_1" => ""},
      %{"id" => "11", "i2_2" => "five"},
      %{"id" => "12", "i4_1" => "."},
      %{"id" => "13", "i4_2" => "-"},
      %{"id" => "14", "i8_1" => "+"},
      %{"id" => "15", "i8_2" => "0.0"},
      %{"id" => "16", "i8_1" => "1_000"},
      %{"id" => "17", "i4_2" => "-1+5"},
      %{"id" => "18", "i4_1" => "0x33"},
      %{"id" => "19", "i2_2" => "0b101011"},
      %{"id" => "20", "i2_1" => "0o373"}
    ]

    Enum.each(invalid_records, fn record ->
      within_replication_context(ctx, vsn, fn conn ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}
      end)
    end)
  end

  test "validates float values", ctx do
    vsn = "2023072503"

    :ok =
      migrate(
        ctx.db,
        vsn,
        "public.foo",
        "CREATE TABLE public.foo (id TEXT PRIMARY KEY, f8 DOUBLE PRECISION)"
      )

    valid_records = [
      %{"id" => "1", "f8" => "+0.0"},
      %{"id" => "2", "f8" => "+0.1"},
      %{"id" => "3", "f8" => "7.3e-4"},
      %{"id" => "4", "f8" => "-0.0"},
      %{"id" => "5", "f8" => "-1.0"},
      %{"id" => "6", "f8" => "-1.0e10"}
    ]

    within_replication_context(ctx, vsn, fn conn ->
      Enum.each(valid_records, fn record ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
      end)

      # Wait long enough for the server to process our messages, thus confirming it has been accepted
      ping_server(conn)

      refute_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}
    end)

    invalid_records = [
      %{"id" => "10", "f8" => ""},
      %{"id" => "11", "f8" => "five"},
      %{"id" => "12", "f8" => "."},
      %{"id" => "13", "f8" => "-"},
      %{"id" => "14", "f8" => "+"},
      %{"id" => "15", "f8" => "0"},
      %{"id" => "16", "f8" => "1"},
      %{"id" => "17", "f8" => "20_30"},
      %{"id" => "18", "f8" => "0x33"},
      %{"id" => "19", "f8" => "0b101011"},
      %{"id" => "20", "f8" => "0o373"}
    ]

    Enum.each(invalid_records, fn record ->
      within_replication_context(ctx, vsn, fn conn ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}
      end)
    end)
  end

  test "validates uuid values", ctx do
    vsn = "2023072504"
    :ok = migrate(ctx.db, vsn, "public.foo", "CREATE TABLE public.foo (id UUID PRIMARY KEY)")

    valid_records = [
      %{"id" => "00000000-0000-0000-0000-000000000000"},
      %{"id" => "ffffffff-ffff-ffff-ffff-ffffffffffff"},
      %{"id" => Electric.Utils.uuid4()}
    ]

    within_replication_context(ctx, vsn, fn conn ->
      Enum.each(valid_records, fn record ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
      end)

      # Wait long enough for the server to process our messages, thus confirming it has been accepted
      ping_server(conn)

      refute_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}
    end)

    invalid_records = [
      %{"id" => ""},
      %{"id" => "1"},
      %{"id" => "two"},
      %{"id" => "00000000000000000000000000000000"},
      %{"id" => "abcdefgh-ijkl-mnop-qrst-uvwxyz012345"}
    ]

    Enum.each(invalid_records, fn record ->
      within_replication_context(ctx, vsn, fn conn ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}
      end)
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
