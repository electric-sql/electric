defmodule Electric.Satellite.WsValidationsTest do
  use ExUnit.Case, async: false

  use Electric.Satellite.Protobuf

  import Electric.Postgres.TestConnection
  import ElectricTest.SatelliteHelpers

  alias Satellite.TestWsClient, as: MockClient
  alias Electric.Satellite.Auth

  alias Electric.Satellite.Serialization

  @table_name "foo"
  @receive_timeout 500

  setup :setup_replicated_db

  setup ctx do
    port = 55133

    plug =
      {Electric.Plug.SatelliteWebsocketPlug,
       auth_provider: Auth.provider(), pg_connector_opts: ctx.pg_connector_opts}

    start_link_supervised!({Bandit, port: port, plug: plug})

    client_id = "ws_pg_to_satellite_client"
    auth = %{token: Auth.Secure.create_token(Electric.Utils.uuid4())}

    %{db: ctx.conn, conn_opts: [port: port, auth: auth, id: client_id, auto_in_sub: true]}
  end

  test "accepts records with valid values", ctx do
    vsn = "2023072500"

    :ok =
      migrate(
        ctx.db,
        vsn,
        "CREATE TABLE public.foo (id TEXT PRIMARY KEY, num INTEGER, t1 TEXT, t2 VARCHAR NOT NULL)",
        electrify: "public.foo"
      )

    within_replication_context(ctx, vsn, fn conn ->
      tx_op_log = serialize_trans(%{"id" => "1", "num" => "433", "t2" => "hello"})
      MockClient.send_data(conn, tx_op_log)

      tx_op_log = serialize_trans(%{"id" => "2", "num" => nil, "t1" => nil, "t2" => ""})
      MockClient.send_data(conn, tx_op_log)

      tx_op_log = serialize_trans(%{"id" => "3", "num" => "-1", "t1" => "", "t2" => "..."})
      MockClient.send_data(conn, tx_op_log)

      refute_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
    end)
  end

  test "rejects records with invalid values", ctx do
    vsn = "2023072501"

    :ok =
      migrate(
        ctx.db,
        vsn,
        "CREATE TABLE public.foo (id TEXT PRIMARY KEY, num SMALLINT, t1 TEXT, t2 VARCHAR NOT NULL)",
        electrify: "public.foo"
      )

    records = [
      %{"id" => "1", "num" => "abc", "t2" => "hello"},
      %{"id" => "2", "num" => "32768", "t2" => ""},
      %{"id" => "3", "num" => "-32769", "t2" => ""},
      %{"id" => "4", "t2" => nil},
      %{"id" => nil, "t2" => "..."}
    ]

    Enum.each(records, fn record ->
      within_replication_context(ctx, vsn, fn conn ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
      end)
    end)
  end

  test "validates boolean values", ctx do
    vsn = "2023072502"

    :ok =
      migrate(
        ctx.db,
        vsn,
        "public.foo",
        "CREATE TABLE public.foo (id TEXT PRIMARY KEY, b BOOLEAN)"
      )

    valid_records = [
      %{"id" => "1", "b" => "t"},
      %{"id" => "2", "b" => "f"},
      %{"id" => "3", "b" => ""}
    ]

    within_replication_context(ctx, vsn, fn conn ->
      Enum.each(valid_records, fn record ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
      end)

      refute_received {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}
    end)

    invalid_records = [
      %{"id" => "10", "b" => "1"},
      %{"id" => "11", "b" => "0"},
      %{"id" => "12", "b" => "True"},
      %{"id" => "13", "b" => "false"},
      %{"id" => "14", "b" => "+"},
      %{"id" => "15", "b" => "-"},
      %{"id" => "16", "b" => "yes"},
      %{"id" => "17", "b" => "no"}
    ]

    Enum.each(invalid_records, fn record ->
      within_replication_context(ctx, vsn, fn conn ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
      end)
    end)
  end

  test "validates integer values", ctx do
    vsn = "2023072502"

    :ok =
      migrate(
        ctx.db,
        vsn,
        "CREATE TABLE public.foo (id TEXT PRIMARY KEY, i2_1 SMALLINT, i2_2 INT2, i4_1 INTEGER, i4_2 INT4)",
        # "CREATE TABLE public.foo (id TEXT PRIMARY KEY, i2_1 SMALLINT, i2_2 INT2, i4_1 INTEGER, i4_2 INT4, i8_1 BIGINT, i8_2 INT8)"
        electrify: "public.foo"
      )

    valid_records = [
      %{"id" => "1", "i2_1" => "1", "i2_2" => "-1"},
      %{"id" => "2", "i2_1" => "32767", "i2_2" => "-32768"},
      %{"id" => "3", "i4_1" => "+0", "i4_2" => "-0"},
      %{"id" => "4", "i4_1" => "2147483647", "i4_2" => "-2147483648"}
      # %{"id" => "5", "i8_1" => "-9223372036854775808", "i8_2" => "+9223372036854775807"}
    ]

    within_replication_context(ctx, vsn, fn conn ->
      Enum.each(valid_records, fn record ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
      end)

      refute_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
    end)

    invalid_records = [
      %{"id" => "10", "i2_1" => ""},
      %{"id" => "11", "i2_2" => "five"},
      %{"id" => "12", "i4_1" => "."},
      %{"id" => "13", "i4_2" => "-"},
      # %{"id" => "14", "i8_1" => "+"},
      # %{"id" => "15", "i8_2" => "0.0"},
      # %{"id" => "16", "i8_1" => "1_000"},
      %{"id" => "17", "i4_2" => "-1+5"},
      %{"id" => "18", "i4_1" => "0x33"},
      %{"id" => "19", "i2_2" => "0b101011"},
      %{"id" => "20", "i2_1" => "0o373"}
    ]

    Enum.each(invalid_records, fn record ->
      within_replication_context(ctx, vsn, fn conn ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
      end)
    end)
  end

  test "validates float values", ctx do
    vsn = "2023072503"

    :ok =
      migrate(
        ctx.db,
        vsn,
        "CREATE TABLE public.foo (id TEXT PRIMARY KEY, f8 DOUBLE PRECISION)",
        electrify: "public.foo"
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

      refute_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
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
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
      end)
    end)
  end

  test "validates uuid values", ctx do
    vsn = "2023072504"

    :ok =
      migrate(ctx.db, vsn, "CREATE TABLE public.foo (id UUID PRIMARY KEY)",
        electrify: "public.foo"
      )

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

      refute_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
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
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
      end)
    end)
  end

  test "validates date values", ctx do
    vsn = "2023082201"

    :ok =
      migrate(ctx.db, vsn, "public.foo", "CREATE TABLE public.foo (id TEXT PRIMARY KEY, d date)")

    valid_records = [
      %{"id" => "1", "d" => "2023-08-07"},
      %{"id" => "2", "d" => "5697-02-28"},
      %{"id" => "3", "d" => "6000-02-29"},
      %{"id" => "4", "d" => "0001-01-01"}
    ]

    within_replication_context(ctx, vsn, fn conn ->
      Enum.each(valid_records, fn record ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
      end)
    end)

    refute_receive {_, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout

    invalid_records = [
      %{"id" => "10", "d" => "now"},
      %{"id" => "11", "d" => "today"},
      %{"id" => "12", "d" => "20230822"},
      %{"id" => "13", "d" => "22-08-2023"},
      %{"id" => "14", "d" => "2023-22-08"},
      %{"id" => "15", "d" => "-1999-01-01"},
      %{"id" => "16", "d" => "001-01-01"},
      %{"id" => "17", "d" => "2000-13-13"},
      %{"id" => "18", "d" => "5697-02-29"}
    ]

    Enum.each(invalid_records, fn record ->
      within_replication_context(ctx, vsn, fn conn ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
      end)
    end)
  end

  test "validates time values", ctx do
    vsn = "2023091101"

    :ok =
      migrate(ctx.db, vsn, "public.foo", "CREATE TABLE public.foo (id TEXT PRIMARY KEY, t time)")

    valid_records = [
      %{"id" => "1", "t" => "00:00:00"},
      %{"id" => "2", "t" => "23:59:59"},
      %{"id" => "3", "t" => "00:00:00.332211"},
      %{"id" => "4", "t" => "11:11:11.11"}
    ]

    within_replication_context(ctx, vsn, fn conn ->
      Enum.each(valid_records, fn record ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
      end)
    end)

    refute_receive {_, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout

    invalid_records = [
      %{"id" => "10", "t" => "now"},
      %{"id" => "11", "t" => "::"},
      %{"id" => "12", "t" => "20:12"},
      %{"id" => "13", "t" => "T18:00"},
      %{"id" => "14", "t" => "l2:o6:t0"},
      %{"id" => "15", "t" => "1:20:23"},
      %{"id" => "16", "t" => "02:02:03-08:00"},
      %{"id" => "17", "t" => "01:00:00+0"},
      %{"id" => "18", "t" => "99:99:99"},
      %{"id" => "19", "t" => "12:1:0"},
      %{"id" => "20", "t" => ""}
    ]

    Enum.each(invalid_records, fn record ->
      within_replication_context(ctx, vsn, fn conn ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
      end)
    end)
  end

  test "validates timestamp values", ctx do
    vsn = "2023072505"

    :ok =
      migrate(
        ctx.db,
        vsn,
        "public.foo",
        "CREATE TABLE public.foo (id TEXT PRIMARY KEY, t1 timestamp, t2 timestamptz)"
      )

    valid_records = [
      %{"id" => "1", "t1" => "2023-08-07 21:28:35.111", "t2" => "2023-08-07 21:28:35.421Z"},
      %{"id" => "2", "t2" => "2023-08-07 00:00:00Z"}
    ]

    within_replication_context(ctx, vsn, fn conn ->
      Enum.each(valid_records, fn record ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
      end)

      refute_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
    end)

    invalid_records = [
      %{"id" => "10", "t1" => "now"},
      %{"id" => "11", "t1" => "12345678901234567890"},
      %{"id" => "12", "t1" => "20230832T000000"},
      %{"id" => "13", "t1" => "2023-08-07 21:28:35+03:00"},
      %{"id" => "13", "t2" => "2023-08-07 21:28:35+03:00"},
      %{"id" => "14", "t2" => ""},
      %{"id" => "15", "t2" => "+"},
      %{"id" => "16", "t2" => "2023-08-07 24:28:35"},
      %{"id" => "16", "t2" => "2023-08-07 24:28:35+00"}
    ]

    Enum.each(invalid_records, fn record ->
      within_replication_context(ctx, vsn, fn conn ->
        tx_op_log = serialize_trans(record)
        MockClient.send_data(conn, tx_op_log)
        assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @receive_timeout
      end)
    end)
  end

  defp within_replication_context(ctx, vsn, expectation_fn) do
    with_connect(ctx.conn_opts, fn conn ->
      # Replication start ceremony
      start_replication_and_assert_response(conn, 0)

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
    %{oid: relation_id, columns: columns} =
      Electric.Postgres.Extension.SchemaCache.Global.relation!({"public", @table_name})

    row_data = Serialization.map_to_row(record, columns, skip_value_encoding?: true)
    commit_timestamp = DateTime.to_unix(DateTime.utc_now(), :millisecond)

    op_log = %SatOpLog{
      ops: [
        %SatTransOp{op: {:begin, %SatOpBegin{lsn: "1", commit_timestamp: commit_timestamp}}},
        %SatTransOp{op: {:insert, %SatOpInsert{relation_id: relation_id, row_data: row_data}}},
        %SatTransOp{op: {:commit, %SatOpCommit{}}}
      ]
    }

    op_log
  end
end
