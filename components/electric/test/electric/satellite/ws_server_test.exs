defmodule Electric.Satellite.WsServerTest do
  use ExUnit.Case, async: false

  use Electric.Satellite.Protobuf

  import ElectricTest.SetupHelpers
  import ElectricTest.SatelliteHelpers

  alias Electric.Replication.SatelliteConnector
  alias Electric.Postgres.CachedWal.Producer

  alias Electric.Test.SatelliteWsClient, as: MockClient

  alias Electric.Replication.Changes

  alias Electric.Replication.Changes.{
    NewRecord,
    Transaction
  }

  alias Electric.Satellite.Auth

  require Logger

  @default_wait 5_000

  @test_schema "public"
  @test_table "sqlite_server_test"
  @test_oid 100_004
  @test_migration {"20230101",
                   "CREATE TABLE #{@test_schema}.#{@test_table} (id uuid PRIMARY KEY, electric_user_id VARCHAR(64), content VARCHAR(64))"}

  @current_wal_pos 1

  import Mock

  setup ctx do
    ctx =
      Map.update(
        ctx,
        :subscription_data_fun,
        &mock_data_function/2,
        fn {name, opts} -> &apply(__MODULE__, name, [&1, &2, opts]) end
      )

    port = 55133

    _sup_pid =
      Electric.Satellite.WsServer.start_link(
        name: :ws_test,
        port: port,
        auth_provider: Auth.provider(),
        pg_connector_opts: [origin: "fake_origin", replication: []],
        subscription_data_fun: ctx.subscription_data_fun
      )

    server_id = Electric.instance_id()

    on_exit(fn ->
      :cowboy.stop_listener(:ws_test)
      Process.sleep(100)
    end)

    {:ok, port: port, server_id: server_id}
  end

  setup_with_mocks([
    {SatelliteConnector, [:passthrough],
     [
       start_link: fn %{name: name, producer: producer} ->
         Supervisor.start_link(
           [
             {Electric.DummyConsumer,
              subscribe_to: [{producer, []}],
              run_on_each_event: & &1.ack_fn.(),
              name: :dummy_consumer},
             {DownstreamProducerMock, Producer.name(name)}
           ],
           strategy: :one_for_one
         )
       end
     ]},
    {
      Electric.Postgres.CachedWal.Api,
      [:passthrough],
      get_current_position: fn -> @current_wal_pos end,
      lsn_in_cached_window?: fn num when is_integer(num) -> num > @current_wal_pos end
    }
  ]) do
    {:ok, %{}}
  end

  # make sure server is cleaning up connections
  setup _cxt do
    on_exit(fn -> clean_connections() end)

    user_id = "a5408365-7bf4-48b1-afe2-cb8171631d7c"
    client_id = "device-id-0000"
    headers = build_headers(PB.get_long_proto_vsn())
    token = Auth.Secure.create_token(user_id)

    {:ok, user_id: user_id, client_id: client_id, token: token, headers: headers}
  end

  setup ctx do
    start_schema_cache(ctx[:with_migrations] || [])
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

          assert_receive {^conn, %SatErrorResp{error_type: :PROTO_VSN_MISMATCH}}, @default_wait
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

        ping_server(conn)
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
      expired_token = Auth.Secure.create_token(cxt.user_id, expiry: past)

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
      invalid_token = Auth.Secure.create_token(cxt.user_id, issuer: "some-other-cluster-id")

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

  describe "Outgoing replication (PG -> Satellite)" do
    @tag with_migrations: [@test_migration]
    test "common replication", cxt do
      with_connect([port: cxt.port, auth: cxt, id: cxt.client_id], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{})
        assert_initial_replication_response(conn, 1)

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        MockClient.send_data(conn, %SatSubsReq{
          subscription_id: "00000000-0000-0000-0000-000000000000",
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        })

        assert_receive {^conn, %SatSubsResp{subscription_id: sub_id, err: nil}}
        # The real data function would have made a magic write which we're emulating here
        DownstreamProducerMock.produce(mocked_producer, build_events([], 1))
        assert %{"fake_id" => []} = receive_subscription_data(conn, sub_id)

        :ok =
          DownstreamProducerMock.produce(
            mocked_producer,
            simple_transes(cxt.user_id, 10)
          )

        Enum.map(0..10, fn n ->
          %SatOpLog{ops: ops} = receive_trans()
          [%SatTransOp{op: begin} | _] = ops
          {:begin, %SatOpBegin{lsn: lsn}} = begin
          assert to_string(n) == lsn
        end)
      end)
    end

    @tag with_migrations: [@test_migration]
    test "Start/stop replication", cxt do
      limit = 10

      with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        # Skip initial sync
        lsn = to_string(@current_wal_pos + 1)
        MockClient.send_data(conn, %SatInStartReplicationReq{lsn: lsn})

        assert_receive {^conn, %SatInStartReplicationResp{}}, @default_wait
        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        MockClient.send_data(conn, %SatSubsReq{
          subscription_id: "00000000-0000-0000-0000-000000000000",
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        })

        assert_receive {^conn, %SatSubsResp{subscription_id: sub_id, err: nil}}
        # The real data function would have made a magic write which we're emulating here
        DownstreamProducerMock.produce(mocked_producer, build_events([], 1))
        assert %{"fake_id" => []} = receive_subscription_data(conn, sub_id)

        :ok =
          DownstreamProducerMock.produce(
            mocked_producer,
            simple_transes(cxt.user_id, limit)
          )

        MockClient.send_data(conn, %SatInStopReplicationReq{})
        last_received_lsn = consume_till_stop(nil)
        assert last_received_lsn
        assert last_received_lsn !== Kernel.inspect(limit)

        MockClient.send_data(conn, %SatInStartReplicationReq{lsn: last_received_lsn})
        num_lsn = last_received_lsn |> String.to_integer()

        :ok =
          DownstreamProducerMock.produce(
            mocked_producer,
            simple_transes(cxt.user_id, limit, num_lsn)
          )

        for n <- num_lsn..limit do
          %SatOpLog{ops: ops} = receive_trans()
          assert [%SatTransOp{op: begin} | _] = ops
          assert {:begin, %SatOpBegin{lsn: lsn}} = begin
          assert to_string(n) == lsn
        end
      end)
    end

    @tag with_migrations: [@test_migration]
    test "The client cannot establish two subscriptions with the same ID", ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{})
        assert_initial_replication_response(conn, 1)

        sub_id = "00000000-0000-0000-0000-000000000000"

        MockClient.send_data(conn, %SatSubsReq{
          subscription_id: sub_id,
          shape_requests: [
            %SatShapeReq{
              request_id: "request_id1",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        })

        MockClient.send_data(conn, %SatSubsReq{
          subscription_id: sub_id,
          shape_requests: [
            %SatShapeReq{
              request_id: "request_id1",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        })

        assert_receive {^conn, %SatSubsResp{subscription_id: ^sub_id, err: nil}}

        assert_receive {^conn,
                        %SatSubsResp{
                          subscription_id: ^sub_id,
                          err: %{
                            message:
                              "Cannot establish multiple subscriptions with the same ID" <> _
                          }
                        }}
      end)
    end

    @tag subscription_data_fun: {:mock_data_function, data_delay_ms: 500}
    @tag with_migrations: [@test_migration]
    test "replication stream is paused until the data is sent to client", ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{})
        assert_initial_replication_response(conn, 1)

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        MockClient.send_data(conn, %SatSubsReq{
          subscription_id: "00000000-0000-0000-0000-000000000000",
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        })

        assert_receive {^conn, %SatSubsResp{subscription_id: sub_id, err: nil}}

        DownstreamProducerMock.produce(mocked_producer, simple_transes(ctx.user_id, 1))
        refute_receive {^conn, %SatOpLog{}}
        assert %{"fake_id" => []} = receive_subscription_data(conn, sub_id, expecting_lsn: "1")
        assert_receive {^conn, %SatOpLog{ops: [_, %{op: {:insert, insert}}, _]}}
        assert %SatOpInsert{row_data: %{values: ["fakeid", user_id, "a"]}} = insert
        assert user_id == ctx.user_id
      end)
    end

    @tag subscription_data_fun: {:mock_data_function, insertion_point: 4}
    @tag with_migrations: [@test_migration]
    test "changes before the insertion point of a subscription are not sent if no prior subscriptions exist",
         ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        # Skip initial sync
        lsn = to_string(@current_wal_pos + 1)
        MockClient.send_data(conn, %SatInStartReplicationReq{lsn: lsn})

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        MockClient.send_data(conn, %SatSubsReq{
          subscription_id: "00000000-0000-0000-0000-000000000000",
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        })

        assert_receive {^conn, %SatSubsResp{subscription_id: sub_id, err: nil}}
        DownstreamProducerMock.produce(mocked_producer, simple_transes(ctx.user_id, 10))

        # Expected LSN is the one BEFORE the insertion point
        assert %{"fake_id" => []} = receive_subscription_data(conn, sub_id, expecting_lsn: "3")

        for _ <- 4..10, do: assert_receive({^conn, %SatOpLog{}})
        refute_receive {^conn, %SatOpLog{}}
      end)
    end

    @tag subscription_data_fun: {:mock_data_function, insertion_point: 4}
    @tag with_migrations: [@test_migration]
    test "unsubscribing works even on not-yet-fulfilled subscriptions",
         ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        # Skip initial sync
        lsn = to_string(@current_wal_pos + 1)
        MockClient.send_data(conn, %SatInStartReplicationReq{lsn: lsn})

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)
        subscription_id = "00000000-0000-0000-0000-000000000000"

        MockClient.send_data(conn, %SatSubsReq{
          subscription_id: subscription_id,
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        })

        assert_receive {^conn, %SatSubsResp{subscription_id: sub_id, err: nil}}
        MockClient.send_data(conn, %SatUnsubsReq{subscription_ids: [sub_id]})
        assert_receive {^conn, %SatUnsubsResp{}}

        DownstreamProducerMock.produce(mocked_producer, simple_transes(ctx.user_id, 10))
        refute_receive {^conn, %SatSubsDataBegin{}}
        refute_receive {^conn, %SatOpLog{}}
      end)
    end
  end

  describe "Incoming replication (Satellite -> PG)" do
    test "common replication", cxt do
      self = self()

      with_mock Electric.DummyConsumer, [:passthrough],
        notify: fn _, ws_pid, events -> send(self, {:dummy_consumer, ws_pid, events}) end do
        with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
          MockClient.send_data(conn, %SatInStartReplicationReq{})
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

          assert_receive {:dummy_consumer, _, [%Transaction{} = tx]}

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

          MockClient.send_data(conn, %SatInStartReplicationReq{})
          assert_receive {^conn, %SatInStartReplicationResp{}}, @default_wait
          assert_receive {^conn, %SatInStartReplicationReq{lsn: ^lsn}}, @default_wait
        end)
      end
    end

    test "stop subscription when consumer is not available, and restart when it's back", cxt do
      with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{})
        assert_receive {^conn, %SatInStartReplicationResp{}}, @default_wait

        assert_receive {^conn, %SatInStartReplicationReq{}}, @default_wait
        MockClient.send_data(conn, %SatInStartReplicationResp{})

        pid = Process.whereis(:dummy_consumer)
        Process.monitor(pid)
        Process.exit(pid, :terminate)
        assert_receive {:DOWN, _, :process, ^pid, _}

        assert_receive {^conn, %SatInStopReplicationReq{}}
        assert_receive {^conn, %SatInStartReplicationReq{}}
      end)
    end

    test "results in an error response when the client is outside of the cached WAL window",
         cxt do
      with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{lsn: "1"})
        assert_receive {^conn, %SatInStartReplicationResp{err: error}}, @default_wait
        assert %SatInStartReplicationResp.ReplicationError{code: :BEHIND_WINDOW} = error
      end)
    end
  end

  # -------------------------------------------------------------------------------
  def mock_data_function(
        {id, requests, _context},
        [reply_to: {ref, pid}, connection: _],
        opts \\ []
      ) do
    insertion_point = Keyword.get(opts, :insertion_point, 0)
    data_delay_ms = Keyword.get(opts, :data_delay_ms, 0)
    send(pid, {:subscription_insertion_point, ref, insertion_point})

    Process.send_after(
      pid,
      {:subscription_data, id, Enum.map(requests, &{&1.id, []})},
      data_delay_ms
    )
  end

  defp with_connect(opts, fun), do: MockClient.with_connect(opts, fun)

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
        # Logger.warning("consumed: #{inspect(lsn)}")
        consume_till_stop(lsn)

      {_, %SatInStopReplicationResp{}} ->
        lsn
    after
      @default_wait ->
        flunk("Timeout while waiting for SatInStopReplicationResp")
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
    assert [%SatTransOp{op: begin} | _] = ops
    assert {:begin, %SatOpBegin{lsn: lsn}} = begin
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
      {%Changes.Transaction{
         changes: List.wrap(changes),
         commit_timestamp: DateTime.utc_now(),
         # The LSN here is faked and a number, so we're using the same monotonically growing value as xid to emulate PG
         xid: lsn
       }, lsn}
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
