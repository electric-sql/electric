defmodule Electric.Satellite.WsServerTest do
  alias Electric.Replication.Vaxine.LogConsumer
  alias Electric.Replication.Vaxine.LogProducer
  alias Electric.Replication.Vaxine

  alias Electric.Test.SatelliteWsClient, as: MockClient
  use Electric.Satellite.Protobuf

  alias Electric.Replication.Changes

  alias Electric.Replication.Changes.{
    NewRecord,
    Transaction
  }

  alias Electric.Postgres.SchemaRegistry

  require Logger

  use ExUnit.Case, async: false

  @default_wait 5_000

  @test_publication "fake_sqlite"
  @test_schema "fake_schema"
  @test_table "sqlite_server_test"
  @test_oid 100_004

  import Mock

  setup_all _ do
    columns = [{"id", :uuid}, {"electric_user_id", :varchar}, {"content", :varchar}]

    Electric.Test.SchemaRegistryHelper.initialize_registry(
      @test_publication,
      {@test_schema, @test_table},
      columns
    )

    port = 55133

    auth_provider =
      {Electric.Satellite.Auth.JWT,
       issuer: "electric-sql.com",
       secret_key: Base.decode64!("BdvUDsCk5QbwkxI0fpEFmM/LNtFvwPZeMfHxvcOoS7s=")}

    _sup_pid =
      Electric.Satellite.WsServer.start_link(
        name: :ws_test,
        port: port,
        auth_provider: auth_provider
      )

    server_id = Electric.regional_id()

    on_exit(fn ->
      SchemaRegistry.clear_replicated_tables(@test_publication)
      :cowboy.stop_listener(:ws_test)
    end)

    {:ok, auth_provider: auth_provider, port: port, server_id: server_id}
  end

  setup_with_mocks([
    {LogProducer, [:passthrough],
     [
       start_link: fn a, b -> DownstreamProducerMock.start_link(a, b) end,
       start_replication: fn a, b -> DownstreamProducerMock.start_replication(a, b) end
     ]},
    # [:passthrough],
    {Vaxine, [],
     [
       transaction_to_vaxine: fn _tx, _pub, _origin -> :ok end
     ]}
  ]) do
    {:ok, %{}}
  end

  # make sure server is cleaning up connections
  setup(cxt) do
    on_exit(fn -> clean_connections() end)

    user_id = "a5408365-7bf4-48b1-afe2-cb8171631d7c"
    client_id = "device-id-0000"
    headers = build_headers(PB.get_long_proto_vsn())

    {:ok, token} = Electric.Satellite.Auth.generate_token(user_id, cxt.auth_provider)

    {:ok, user_id: user_id, client_id: client_id, token: token, headers: headers}
  end

  describe "resource related check" do
    test "Check that resources are create and removed accordingly", cxt do
      with_connect(
        [auth: cxt, port: cxt.port],
        fn _conn ->
          [{Electric.Replication.SatelliteConnector, _pid}] = connectors()
        end
      )

      drain_active_resources(connectors())
      assert [] = connectors()
    end
  end

  describe "decode/encode" do
    test "sanity check" do
      with_connect([], fn conn ->
        assert true == MockClient.is_alive(conn)
      end)
    end

    test "Server will respond to auth request", cxt do
      with_connect(
        [port: cxt.port],
        fn conn ->
          MockClient.send_data(conn, %SatAuthReq{
            id: cxt.client_id,
            token: cxt.token,
            headers: cxt.headers
          })

          server_id = cxt.server_id
          assert_receive {^conn, %SatAuthResp{id: ^server_id}}, @default_wait
        end
      )
    end

    test "Server will respond with error to auth request without headers", cxt do
      with_connect(
        [port: cxt.port],
        fn conn ->
          MockClient.send_data(conn, %SatAuthReq{id: cxt.client_id, token: cxt.token})
          assert_receive {^conn, %SatErrorResp{error_type: :INVALID_REQUEST}}, @default_wait
        end
      )
    end

    test "Server with error to auth request with wrong headers headers", cxt do
      with_connect(
        [port: cxt.port],
        fn conn ->
          MockClient.send_data(
            conn,
            %SatAuthReq{
              id: cxt.client_id,
              token: cxt.token,
              headers: build_headers("not_a_version_9_3")
            }
          )

          assert_receive {^conn, %SatErrorResp{error_type: :PROTO_VSN_MISSMATCH}}, @default_wait
        end
      )
    end

    test "Server will handle bad requests", _cxt do
      with_connect([], fn conn ->
        MockClient.send_bin_data(conn, <<"rubbish">>)
        assert_receive {^conn, %SatErrorResp{}}, @default_wait
      end)
    end

    test "Server will handle bad requests after auth", cxt do
      with_connect([port: cxt.port, auth: cxt], fn conn ->
        MockClient.send_bin_data(conn, <<"rubbish">>)
        assert_receive {^conn, %SatErrorResp{}}, @default_wait
      end)
    end

    test "Server will respond with error on attempt to skip auth", cxt do
      with_connect([port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatPingReq{})
        assert_receive {^conn, %SatErrorResp{error_type: :AUTH_REQUIRED}}, @default_wait
      end)

      with_connect([port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatAuthReq{
          id: cxt.client_id,
          token: cxt.token,
          headers: cxt.headers
        })

        server_id = cxt.server_id
        assert_receive {^conn, %SatAuthResp{id: ^server_id}}, @default_wait

        MockClient.send_data(conn, %SatPingReq{})
        assert_receive {^conn, %SatPingResp{lsn: ""}}, @default_wait
      end)
    end

    test "Auth is handled", cxt do
      server_id = cxt.server_id

      with_connect([port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatPingReq{})
        assert_receive {^conn, %SatErrorResp{error_type: :AUTH_REQUIRED}}, @default_wait
      end)

      with_connect([port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatAuthReq{
          id: cxt.client_id,
          token: cxt.token,
          headers: cxt.headers
        })

        assert_receive {^conn, %SatAuthResp{id: ^server_id}}, @default_wait
      end)

      with_connect([port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatAuthReq{
          id: cxt.client_id,
          token: "invalid_token",
          headers: cxt.headers
        })

        assert_receive {^conn, %SatErrorResp{error_type: :AUTH_REQUIRED}}, @default_wait
      end)

      past = System.os_time(:second) - 24 * 3600

      assert {:ok, expired_token} =
               Electric.Satellite.Auth.generate_token(cxt.user_id, cxt.auth_provider, expiry: past)

      with_connect([port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatAuthReq{
          id: cxt.client_id,
          token: expired_token,
          headers: cxt.headers
        })

        assert_receive {^conn, %SatErrorResp{error_type: :AUTH_REQUIRED}}, @default_wait
      end)

      with_connect([port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatAuthReq{
          id: cxt.client_id,
          token: cxt.token,
          headers: cxt.headers
        })

        assert_receive {^conn, %SatAuthResp{id: ^server_id}}, @default_wait
      end)
    end

    test "cluster/app id mismatch is detected", cxt do
      {_module, config} = cxt.auth_provider
      key = Keyword.fetch!(config, :secret_key)

      assert {:ok, invalid_token} =
               Electric.Satellite.Auth.JWT.Token.create(cxt.user_id, key, "some-other-cluster-id")

      with_connect([port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatAuthReq{
          id: "client_id",
          token: invalid_token,
          headers: cxt.headers
        })

        assert_receive {^conn, %SatErrorResp{error_type: :AUTH_REQUIRED}}, @default_wait
      end)
    end

    test "Server will forbid two connections that use same id", cxt do
      with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn _conn ->
        {:ok, pid} = MockClient.connect_and_spawn(auto_register: false, port: cxt.port)

        MockClient.send_data(pid, %SatAuthReq{
          id: cxt.client_id,
          token: cxt.token,
          headers: cxt.headers
        })

        assert_receive {^pid, %SatErrorResp{}}, @default_wait
        :ok = MockClient.disconnect(pid)
      end)
    end
  end

  describe "Outgoing replication (Vaxine -> Satellite)" do
    test "common replication", cxt do
      with_connect([port: cxt.port, auth: cxt, id: cxt.client_id], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{lsn: "eof"})

        assert_receive {^conn, %SatInStartReplicationResp{}}, @default_wait

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = LogProducer.get_name(client_name)

        :ok =
          DownstreamProducerMock.produce(
            mocked_producer,
            simple_transes(cxt.user_id, 10)
          )

        Enum.map(0..10, fn n ->
          %SatOpLog{ops: ops} = receive_trans()
          [%SatTransOp{op: begin} | _] = ops
          {:begin, %SatOpBegin{lsn: lsn}} = begin
          assert :erlang.term_to_binary(n) == lsn
        end)
      end)
    end

    test "Start/stop replication", cxt do
      limit = 10

      with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{lsn: "eof"})

        assert_receive {^conn, %SatInStartReplicationResp{}}, @default_wait

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = LogProducer.get_name(client_name)

        :ok =
          DownstreamProducerMock.produce(
            mocked_producer,
            simple_transes(cxt.user_id, limit)
          )

        MockClient.send_data(conn, %SatInStopReplicationReq{})
        last_received_lsn = consume_till_stop(nil)
        assert last_received_lsn !== Kernel.inspect(limit)

        MockClient.send_data(conn, %SatInStartReplicationReq{lsn: last_received_lsn})
        num_lsn = :erlang.binary_to_term(last_received_lsn)

        :ok =
          DownstreamProducerMock.produce(
            mocked_producer,
            simple_transes(cxt.user_id, limit, num_lsn)
          )

        Enum.map(num_lsn..limit, fn n ->
          %SatOpLog{ops: ops} = receive_trans()
          [%SatTransOp{op: begin} | _] = ops
          {:begin, %SatOpBegin{lsn: lsn}} = begin
          assert :erlang.term_to_binary(n) == lsn
        end)
      end)
    end
  end

  describe "Incoming replication (Satellite -> Vaxine)" do
    test "common replication", cxt do
      self = self()

      with_mock Vaxine,
        transaction_to_vaxine: fn tx, pub, origin -> Process.send(self, {tx, pub, origin}, []) end do
        with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
          MockClient.send_data(conn, %SatInStartReplicationReq{lsn: "eof"})
          assert_receive {^conn, %SatInStartReplicationResp{}}, @default_wait

          assert_receive {^conn, %SatInStartReplicationReq{lsn: ""}}, @default_wait
          MockClient.send_data(conn, %SatInStartReplicationResp{})

          columns = [
            %SatRelationColumn{name: "satellite-column-1", type: "type1"},
            %SatRelationColumn{name: "satellite-column-2", type: "type2"}
          ]

          relation = %SatRelation{
            schema_name: @test_schema,
            table_type: :TABLE,
            table_name: @test_table,
            relation_id: @test_oid,
            columns: columns
          }

          serialize = fn [a, b] ->
            map = %{"satellite-column-1" => a, "satellite-column-2" => b}

            Electric.Satellite.Serialization.map_to_row(map, [
              "satellite-column-1",
              "satellite-column-2"
            ])
          end

          MockClient.send_data(conn, relation)

          dt = DateTime.truncate(DateTime.utc_now(), :millisecond)
          ct = DateTime.to_unix(dt, :millisecond)
          lsn = "some_long_internal_lsn"

          op_log1 =
            build_op_log([
              %SatOpBegin{commit_timestamp: ct, lsn: lsn},
              %SatOpInsert{relation_id: @test_oid, row_data: serialize.([<<"a">>, <<"b">>])}
            ])

          op_log2 =
            build_op_log([
              %SatOpInsert{relation_id: @test_oid, row_data: serialize.([<<"c">>, <<"d">>])},
              %SatOpCommit{}
            ])

          MockClient.send_data(conn, op_log1)
          MockClient.send_data(conn, op_log2)

          {tx, _pub, _origin} =
            receive do
              {%Transaction{} = tx, pub, origin} ->
                {tx, pub, origin}
            after
              @default_wait ->
                flunk("timeout")
            end

          assert tx.lsn == lsn
          assert tx.commit_timestamp == dt

          assert tx.changes == [
                   %NewRecord{
                     relation: {@test_schema, @test_table},
                     record: %{"satellite-column-1" => "a", "satellite-column-2" => "b"}
                   },
                   %NewRecord{
                     relation: {@test_schema, @test_table},
                     record: %{"satellite-column-1" => "c", "satellite-column-2" => "d"}
                   }
                 ]

          assert tx.origin !== ""
          assert_receive {^conn, %SatPingResp{lsn: ^lsn}}, @default_wait

          # After restart we still get same lsn
        end)

        with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
          lsn = "some_long_internal_lsn"

          MockClient.send_data(conn, %SatInStartReplicationReq{lsn: "eof"})
          assert_receive {^conn, %SatInStartReplicationResp{}}, @default_wait
          assert_receive {^conn, %SatInStartReplicationReq{lsn: ^lsn}}, @default_wait
        end)
      end
    end

    test "stop subscription when consumer is not available, and restart when it's back", cxt do
      self = self()

      with_mock Vaxine,
        transaction_to_vaxine: fn tx, pub, origin -> Process.send(self, {tx, pub, origin}, []) end do
        with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
          MockClient.send_data(conn, %SatInStartReplicationReq{lsn: "eof"})
          assert_receive {^conn, %SatInStartReplicationResp{}}, @default_wait

          assert_receive {^conn, %SatInStartReplicationReq{}}, @default_wait
          MockClient.send_data(conn, %SatInStartReplicationResp{})

          [{client_name, _client_pid}] = active_clients()
          {:via, :gproc, mocked_consumer} = LogConsumer.get_name(client_name)
          pid = :gproc.whereis_name(mocked_consumer)
          Process.monitor(pid)
          Process.exit(pid, :terminate)
          assert_receive {:DOWN, _, :process, ^pid, _}

          assert_receive {^conn, %SatInStopReplicationReq{}}
          assert_receive {^conn, %SatInStartReplicationReq{}}
        end)
      end
    end
  end

  # -------------------------------------------------------------------------------

  defp with_connect(opts, fun) do
    case MockClient.connect_and_spawn(opts) do
      {:ok, pid} when is_pid(pid) ->
        try do
          fun.(pid)
        after
          assert :ok = MockClient.disconnect(pid)
        end

      error ->
        error
    end
  end

  def clean_connections() do
    MockClient.disconnect()

    :ok = drain_pids(active_clients())
    :ok = drain_active_resources(connectors())
  end

  defp connectors() do
    for {mod, pid} <- Electric.Replication.Connectors.status(:raw),
        mod !== Electric.Replication.PostgresConnectorSup,
        do: {mod, pid}
  end

  defp drain_active_resources([]) do
    :ok
  end

  defp drain_active_resources([{Electric.Replication.SatelliteConnector, _} | _] = list) do
    drain_pids(list)
  end

  defp drain_pids([]) do
    :ok
  end

  defp drain_pids([{_client_name, client_pid} | list]) do
    ref = Process.monitor(client_pid)

    receive do
      {:DOWN, ^ref, :process, ^client_pid, _} ->
        drain_pids(list)
    after
      1000 ->
        flunk("tcp client process didn't termivate")
    end
  end

  defp consume_till_stop(lsn) do
    receive do
      {_, %SatOpLog{} = op_log} ->
        lsn = get_lsn(op_log)
        # Logger.warn("consumed: #{inspect(lsn)}")
        consume_till_stop(lsn)

      {_, %SatInStopReplicationResp{}} ->
        lsn
    after
      @default_wait ->
        flunk("timeout")
    end
  end

  defp receive_trans() do
    receive do
      {_, %SatOpLog{} = op_log} -> op_log
    after
      @default_wait ->
        flunk("timeout")
    end
  end

  defp get_lsn(%SatOpLog{ops: ops}) do
    [%SatTransOp{op: begin} | _] = ops
    {:begin, %SatOpBegin{lsn: lsn}} = begin
    lsn
  end

  defp active_clients() do
    {:ok, clients} = Electric.Satellite.ClientManager.get_clients()

    Enum.reduce(clients, [], fn {client_name, client_pid}, acc ->
      case Process.alive?(client_pid) do
        true -> [{client_name, client_pid} | acc]
        false -> acc
      end
    end)
  end

  defp build_events(changes, lsn) do
    [
      {%Changes.Transaction{changes: List.wrap(changes), commit_timestamp: DateTime.utc_now()},
       lsn}
    ]
  end

  defp simple_transes(user_id, n, lim \\ 0) do
    simple_trans(user_id, n, lim, [])
  end

  defp simple_trans(user_id, n, lim, acc) when n >= lim do
    [trans] =
      %Changes.NewRecord{
        record: %{"content" => "a", "id" => "fakeid", "electric_user_id" => user_id},
        relation: {@test_schema, @test_table}
      }
      |> build_events(n)

    simple_trans(user_id, n - 1, lim, [trans | acc])
  end

  defp simple_trans(_user_id, _n, _lim, acc) do
    acc
  end

  def build_changes(%SatOpBegin{} = op), do: %SatTransOp{op: {:begin, op}}
  def build_changes(%SatOpInsert{} = op), do: %SatTransOp{op: {:insert, op}}
  def build_changes(%SatOpUpdate{} = op), do: %SatTransOp{op: {:update, op}}
  def build_changes(%SatOpDelete{} = op), do: %SatTransOp{op: {:delete, op}}
  def build_changes(%SatOpCommit{} = op), do: %SatTransOp{op: {:commit, op}}

  defp build_op_log(changes) do
    ops = Enum.map(changes, fn change -> build_changes(change) end)
    %SatOpLog{ops: ops}
  end

  defp build_headers(proto_version) do
    [%SatAuthHeaderPair{key: :PROTO_VERSION, value: proto_version}]
  end
end
