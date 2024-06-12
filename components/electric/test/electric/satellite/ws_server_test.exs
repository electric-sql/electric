defmodule Electric.Satellite.WebsocketServerTest do
  use ExUnit.Case, async: false
  use Electric.Satellite.Protobuf
  use ElectricTest.Satellite.WsServerHelpers

  alias Electric.Postgres.CachedWal.Producer
  alias Electric.Replication.Changes

  alias Electric.Replication.Changes.{
    NewRecord,
    UpdatedRecord,
    ReferencedRecord,
    Transaction
  }

  alias Electric.Satellite.Auth

  alias Satellite.ProtocolHelpers
  alias Satellite.TestWsClient, as: MockClient

  import ElectricTest.SetupHelpers
  import ElectricTest.SatelliteHelpers

  require Logger

  @default_wait 5_000

  @test_schema "public"
  @test_table "sqlite_server_test"
  @test_oid 100_004
  @test_migration {"20230101",
                   "CREATE TABLE #{@test_schema}.#{@test_table} (id uuid PRIMARY KEY, electric_user_id VARCHAR(64), content VARCHAR(64))"}
  @test_fk_migration {"20230101",
                      [
                        "CREATE TABLE public.test1 (id TEXT PRIMARY KEY, electric_user_id VARCHAR(64), content VARCHAR(64))",
                        "CREATE TABLE public.test_child (id TEXT PRIMARY KEY, electric_user_id VARCHAR(64), parent_id TEXT REFERENCES test1 (id))"
                      ]}
  @test_shape_migration {"20230101",
                         [
                           "CREATE TABLE public.test1 (id TEXT PRIMARY KEY, content VARCHAR(64))",
                           "CREATE TABLE public.test_child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES test1 (id), some_flag BOOLEAN NOT NULL)"
                         ]}

  setup ctx do
    case Map.get(ctx, :with_features, []) do
      [] ->
        nil

      feature_overrides ->
        feature_state = Electric.Features.list()
        Electric.Features.enable(feature_overrides)

        on_exit(fn ->
          Electric.Features.enable(feature_state)
        end)
    end

    origin = "test-origin"
    connector_config = [origin: origin, connection: []]
    port = 55133

    plug =
      {Electric.Plug.SatelliteWebsocketPlug,
       auth_provider: Auth.provider(),
       connector_config: connector_config,
       subscription_data_fun: ctx.subscription_data_fun,
       move_in_data_fun: ctx.move_in_data_fun,
       allowed_unacked_txs: ctx.allowed_unacked_txs,
       schema_loader: grant_all_permissions_loader(origin)}

    start_link_supervised!({Bandit, port: port, plug: plug})

    server_id = Electric.instance_id()

    start_link_supervised!({Electric.Satellite.ClientReconnectionInfo, connector_config})

    %{port: port, server_id: server_id, origin: origin}
  end

  describe "resource related check" do
    test "Check that resources are create and removed accordingly", ctx do
      with_connect(
        [auth: ctx, port: ctx.port],
        fn _conn ->
          [{Electric.Replication.SatelliteConnector, _pid}] = connectors()
        end
      )

      drain_active_resources(connectors())
      assert [] = connectors()
    end
  end

  describe "decode/encode" do
    test "sanity check", ctx do
      with_connect([port: ctx.port], fn conn ->
        Process.sleep(1000)
        assert Process.alive?(conn)
      end)
    end

    test "Server will respond to auth request", ctx do
      with_connect(
        [port: ctx.port],
        fn conn ->
          server_id = ctx.server_id

          assert {:ok, %SatAuthResp{id: ^server_id}} =
                   MockClient.make_rpc_call(conn, "authenticate", %SatAuthReq{
                     id: ctx.client_id,
                     token: ctx.token
                   })
        end
      )
    end

    test "Server will handle bad requests", ctx do
      with_connect([port: ctx.port], fn conn ->
        MockClient.send_frames(conn, {:binary, "rubbish"})
        assert_receive {^conn, %SatErrorResp{}}, @default_wait
      end)
    end

    test "Server will handle bad requests after auth", ctx do
      with_connect([port: ctx.port, auth: ctx], fn conn ->
        MockClient.send_frames(conn, {:binary, "rubbish"})
        assert_receive {^conn, %SatErrorResp{}}, @default_wait
      end)
    end

    test "Server will respond with error on attempt to skip auth", ctx do
      with_connect([port: ctx.port], fn conn ->
        assert {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}} =
                 MockClient.make_rpc_call(conn, "startReplication", %SatInStartReplicationReq{})
      end)

      with_connect([port: ctx.port], fn conn ->
        server_id = ctx.server_id

        assert {:ok, %SatAuthResp{id: ^server_id}} =
                 MockClient.make_rpc_call(conn, "authenticate", %SatAuthReq{
                   id: ctx.client_id,
                   token: ctx.token
                 })
      end)
    end

    test "Auth is handled", ctx do
      server_id = ctx.server_id

      with_connect([port: ctx.port], fn conn ->
        assert {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}} =
                 MockClient.make_rpc_call(conn, "startReplication", %SatInStartReplicationReq{})
      end)

      with_connect([port: ctx.port], fn conn ->
        assert {:ok, %SatAuthResp{id: ^server_id}} =
                 MockClient.make_rpc_call(conn, "authenticate", %SatAuthReq{
                   id: ctx.client_id,
                   token: ctx.token
                 })
      end)

      with_connect([port: ctx.port], fn conn ->
        assert {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}} =
                 MockClient.make_rpc_call(conn, "authenticate", %SatAuthReq{
                   id: ctx.client_id,
                   token: "invalid_token"
                 })
      end)

      past = System.os_time(:second) - 24 * 3600
      expired_token = Auth.Secure.create_token(ctx.user_id, expiry: past)

      with_connect([port: ctx.port], fn conn ->
        assert {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}} =
                 MockClient.make_rpc_call(conn, "authenticate", %SatAuthReq{
                   id: ctx.client_id,
                   token: expired_token
                 })
      end)
    end

    # This test is disabled while the `Electric.Satellite.Protocol.schedule_auth_expiration()`
    # is also disabled.
    @tag :skip
    test "Socket is closed when JWT expires", ctx do
      server_id = ctx.server_id

      {:ok, pid} = MockClient.connect(port: ctx.port)

      # create a token that expires in 1 second from now
      exp = System.os_time(:second) + 1
      token = Auth.Secure.create_token(ctx.user_id, expiry: exp)

      # authenticate
      assert {:ok, %SatAuthResp{id: ^server_id}} =
               MockClient.make_rpc_call(pid, "authenticate", %SatAuthReq{
                 id: ctx.client_id,
                 token: token
               })

      # check that the socket is closed
      # specify a timeout of 1.5 seconds
      # which allows the JWT to expire
      assert_receive({^pid, :server_close, 4000, "JWT-expired"}, 1500)
    end

    # This test is disabled while the `Electric.Satellite.Protocol.schedule_auth_expiration()`
    # is also disabled.
    @tag :skip
    test "Auth can be renewed", ctx do
      server_id = ctx.server_id

      {:ok, pid} = MockClient.connect(port: ctx.port)

      # create a token that expires in 1 second from now
      exp = System.os_time(:second) + 1
      token = Auth.Secure.create_token(ctx.user_id, expiry: exp)

      # authenticate
      assert {:ok, %SatAuthResp{id: ^server_id}} =
               MockClient.make_rpc_call(pid, "authenticate", %SatAuthReq{
                 id: ctx.client_id,
                 token: token
               })

      # renew the token
      new_exp = System.os_time(:second) + 3
      renewed_token = Auth.Secure.create_token(ctx.user_id, expiry: new_exp)

      assert {:ok, %SatAuthResp{id: ^server_id}} =
               MockClient.make_rpc_call(pid, "authenticate", %SatAuthReq{
                 id: ctx.client_id,
                 token: renewed_token
               })

      # We will renew the token with an expiration in 3 seconds from now
      # so the JWT should not expire in the coming 3 seconds
      # (we use 2.9 seconds to account for the time elapse between the renewal and now)
      refute_receive({^pid, :server_close, 4000, "JWT-expired"}, 2900)

      # specify a timeout of 3.5 seconds
      # which allows the JWT to expire
      # and check that the socket is closed
      assert_receive({^pid, :server_close, 4000, "JWT-expired"}, 3500)
    end

    test "Auth can't be renewed with invalid client ID", ctx do
      server_id = ctx.server_id

      {:ok, pid} = MockClient.connect(port: ctx.port)

      # create a token that expires in 5 seconds from now
      exp = System.os_time(:second) + 5
      token = Auth.Secure.create_token(ctx.user_id, expiry: exp)

      # authenticate
      assert {:ok, %SatAuthResp{id: ^server_id}} =
               MockClient.make_rpc_call(pid, "authenticate", %SatAuthReq{
                 id: ctx.client_id,
                 token: token
               })

      # Renew the token with a different client ID
      new_exp = System.os_time(:second) + 8
      invalid_token = Auth.Secure.create_token(ctx.user_id, expiry: new_exp)

      # Check that renewal fails
      assert {:error, %SatErrorResp{error_type: :INVALID_REQUEST}} =
               MockClient.make_rpc_call(pid, "authenticate", %SatAuthReq{
                 id: "another" <> ctx.client_id,
                 token: invalid_token
               })
    end

    test "Auth can't be renewed with invalid user ID", ctx do
      server_id = ctx.server_id

      {:ok, pid} = MockClient.connect(port: ctx.port)

      # create a token that expires in 5 seconds from now
      exp = System.os_time(:second) + 5
      token = Auth.Secure.create_token(ctx.user_id, expiry: exp)

      # authenticate
      assert {:ok, %SatAuthResp{id: ^server_id}} =
               MockClient.make_rpc_call(pid, "authenticate", %SatAuthReq{
                 id: ctx.client_id,
                 token: token
               })

      # Renew the token with a different user ID
      new_exp = System.os_time(:second) + 8
      # must be different from ctx.user_id
      invalid_user_id = "a5408365-7bf4-48b1-afe2-cb8171631d9a"
      invalid_token = Auth.Secure.create_token(invalid_user_id, expiry: new_exp)

      # Check that renewal fails
      assert {:error, %SatErrorResp{error_type: :INVALID_REQUEST}} =
               MockClient.make_rpc_call(pid, "authenticate", %SatAuthReq{
                 id: ctx.client_id,
                 token: invalid_token
               })
    end

    test "cluster/app id mismatch is detected", ctx do
      invalid_token = Auth.Secure.create_token(ctx.user_id, issuer: "some-other-cluster-id")

      with_connect([port: ctx.port], fn conn ->
        assert {:error, %SatErrorResp{error_type: :AUTH_REQUIRED}} =
                 MockClient.make_rpc_call(conn, "authenticate", %SatAuthReq{
                   id: ctx.client_id,
                   token: invalid_token
                 })
      end)
    end

    test "Server will forbid two connections that use same id", ctx do
      with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn _conn ->
        {:ok, pid} = MockClient.connect(port: ctx.port)

        assert {:error, %SatErrorResp{}} =
                 MockClient.make_rpc_call(pid, "authenticate", %SatAuthReq{
                   id: ctx.client_id,
                   token: ctx.token
                 })

        :ok = MockClient.disconnect(pid)
      end)
    end
  end

  describe "Outgoing replication (PG -> Satellite)" do
    @tag with_migrations: [@test_migration]
    test "common replication", ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        start_replication_and_assert_response(conn, 1)

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        subscription = %SatSubsReq{
          subscription_id: "00000000-0000-0000-0000-000000000000",
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{subscription_id: sub_id, err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", subscription)

        # The real data function would have made a magic write which we're emulating here
        DownstreamProducerMock.produce(mocked_producer, build_events([], 1))
        assert {["fake_id"], []} = receive_subscription_data(conn, sub_id)

        :ok =
          DownstreamProducerMock.produce(
            mocked_producer,
            simple_transes(ctx.user_id, 10)
          )

        Enum.map(0..10, fn n ->
          %SatOpLog{ops: ops} = receive_trans()
          [%SatTransOp{op: begin} | _] = ops
          {:begin, %SatOpBegin{lsn: lsn}} = begin
          assert to_string(n) == lsn
        end)
      end)
    end

    @tag with_migrations: [@test_fk_migration],
         with_features: [permissions: false]
    test "compensations are filtered based on electric_user_id", ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        rel_map = start_replication_and_assert_response(conn, 2)

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        {sub_id, req_id, req} =
          ProtocolHelpers.simple_sub_request(test1: [include: [test_child: [over: "parent_id"]]])

        assert {:ok, %SatSubsResp{subscription_id: ^sub_id, err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", req)

        # The real data function would have made a magic write which we're emulating here
        DownstreamProducerMock.produce(mocked_producer, build_events([], 1))
        assert {[^req_id], []} = receive_subscription_data(conn, sub_id)

        :ok =
          DownstreamProducerMock.produce(
            mocked_producer,
            %Changes.Transaction{
              lsn: 2,
              xid: 2,
              commit_timestamp: DateTime.utc_now(),
              referenced_records: %{
                {"public", "test1"} => %{
                  ["1"] => %ReferencedRecord{
                    pk: ["1"],
                    record: %{"id" => "1", "electric_user_id" => "not you", "content" => "wow"},
                    relation: {"public", "test1"}
                  }
                }
              },
              changes: [
                %NewRecord{
                  relation: {"public", "test_child"},
                  record: %{
                    "id" => "child_1",
                    "electric_user_id" => "not you",
                    "parent_id" => "1"
                  }
                }
              ],
              origin: ctx.client_id
            }
            |> then(&[{&1, 2}])
          )

        assert [] = receive_txn_changes(conn, rel_map)
      end)
    end

    @tag with_migrations: [@test_migration]
    test "Start/stop replication", ctx do
      limit = 10

      with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        start_replication_and_assert_response(conn, 1)
        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        subscription = %SatSubsReq{
          subscription_id: "00000000-0000-0000-0000-000000000000",
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{subscription_id: sub_id, err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", subscription)

        # The real data function would have made a magic write which we're emulating here
        DownstreamProducerMock.produce(mocked_producer, build_events([], 1))
        assert {["fake_id"], []} = receive_subscription_data(conn, sub_id)

        :ok =
          DownstreamProducerMock.produce(
            mocked_producer,
            simple_transes(ctx.user_id, limit, 2)
          )

        assert {:ok, _} =
                 MockClient.send_rpc(conn, "stopReplication", %SatInStopReplicationReq{})

        last_received_lsn = consume_till_stop(nil)
        assert last_received_lsn
        assert last_received_lsn !== Kernel.inspect(limit)

        assert {:ok, _} =
                 MockClient.make_rpc_call(conn, "startReplication", %SatInStartReplicationReq{
                   lsn: last_received_lsn
                 })

        num_lsn = last_received_lsn |> String.to_integer()

        :ok =
          DownstreamProducerMock.produce(
            mocked_producer,
            simple_transes(ctx.user_id, limit, num_lsn)
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
        start_replication_and_assert_response(conn, 1)

        sub_id = "00000000-0000-0000-0000-000000000000"

        request = %SatSubsReq{
          subscription_id: sub_id,
          shape_requests: [
            %SatShapeReq{
              request_id: "request_id1",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        request = %SatSubsReq{
          subscription_id: sub_id,
          shape_requests: [
            %SatShapeReq{
              request_id: "request_id1",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        }

        assert {:ok,
                %SatSubsResp{
                  err: %{
                    message: "Cannot establish multiple subscriptions with the same ID" <> _
                  }
                }} =
                 MockClient.make_rpc_call(conn, "subscribe", request)
      end)
    end

    @tag subscription_data_fun: {:mock_data_function, data_delay_ms: 500}
    @tag with_migrations: [@test_migration]
    test "replication stream is paused until the data is sent to client", ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        start_replication_and_assert_response(conn, 1)

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        request = %SatSubsReq{
          subscription_id: "00000000-0000-0000-0000-000000000000",
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{subscription_id: sub_id, err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        DownstreamProducerMock.produce(mocked_producer, simple_transes(ctx.user_id, 1))
        refute_receive {^conn, %SatOpLog{}}
        assert {["fake_id"], []} = receive_subscription_data(conn, sub_id, expecting_lsn: "1")
        assert_receive {^conn, %SatOpLog{ops: [_, %{op: {:insert, insert}}, _]}}
        assert %SatOpInsert{row_data: %{values: ["fakeid", user_id, "a"]}} = insert
        assert user_id == ctx.user_id
      end)
    end

    @tag subscription_data_fun: {:mock_data_function, data_delay_ms: 500}
    @tag with_migrations: [@test_migration]
    test "empty transactions that came from this client are propagated back", ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        start_replication_and_assert_response(conn, 1)

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        request = %SatSubsReq{
          subscription_id: "00000000-0000-0000-0000-000000000000",
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{subscription_id: sub_id, err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        # No changes in the txn, but still should be sent
        DownstreamProducerMock.produce(mocked_producer, build_events([], 1, ctx.client_id))
        refute_receive {^conn, %SatOpLog{}}
        assert {["fake_id"], []} = receive_subscription_data(conn, sub_id, expecting_lsn: "1")
        assert_receive {^conn, %SatOpLog{ops: [_, _]}}
      end)
    end

    @tag subscription_data_fun: {:mock_data_function, insertion_point: 4}
    @tag with_migrations: [@test_migration]
    test "changes before the insertion point of a subscription are not sent if no prior subscriptions exist",
         ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        start_replication_and_assert_response(conn, 1)

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        request = %SatSubsReq{
          subscription_id: "00000000-0000-0000-0000-000000000000",
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{subscription_id: sub_id, err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        DownstreamProducerMock.produce(mocked_producer, simple_transes(ctx.user_id, 10))

        # Expected LSN is the one BEFORE the insertion point
        assert {["fake_id"], []} = receive_subscription_data(conn, sub_id, expecting_lsn: "3")

        for _ <- 4..10, do: assert_receive({^conn, %SatOpLog{}})
        refute_receive {^conn, %SatOpLog{}}
      end)
    end

    @tag subscription_data_fun: {:mock_data_function, insertion_point: 4}
    @tag with_migrations: [@test_migration]
    test "unsubscribing works even on not-yet-fulfilled subscriptions",
         ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        start_replication_and_assert_response(conn, 1)
        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)
        subscription_id = "00000000-0000-0000-0000-000000000000"

        request = %SatSubsReq{
          subscription_id: subscription_id,
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{subscription_id: sub_id, err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {:ok, %SatUnsubsResp{}} =
                 MockClient.make_rpc_call(conn, "unsubscribe", %SatUnsubsReq{
                   subscription_ids: [sub_id]
                 })

        DownstreamProducerMock.produce(mocked_producer, simple_transes(ctx.user_id, 10))
        refute_receive {^conn, %SatSubsDataBegin{}}
        refute_receive {^conn, %SatOpLog{}}
      end)
    end

    @tag with_migrations: [@test_migration]
    @tag allowed_unacked_txs: 2
    test "replication stream is suspended until the client acks transactions", ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        start_replication_and_assert_response(conn, 1)

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        request = %SatSubsReq{
          subscription_id: "00000000-0000-0000-0000-000000000000",
          shape_requests: [
            %SatShapeReq{
              request_id: "fake_id",
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: @test_table}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{subscription_id: sub_id, err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        # The real data function would have made a magic write which we're emulating here
        DownstreamProducerMock.produce(mocked_producer, build_events([], 1))
        assert {["fake_id"], []} = receive_subscription_data(conn, sub_id)

        :ok =
          DownstreamProducerMock.produce(mocked_producer, simple_transes(ctx.user_id, 12, 1))

        # We've received 2 transactions at this point: migration and the first produced
        # we shouldn't receive more until we ack
        assert_receive {^conn,
                        %SatOpLog{ops: [%{op: {:begin, %{lsn: lsn, transaction_id: id}}}, _, _]}}

        refute_receive {^conn, %SatOpLog{ops: [_, _, _]}}

        # After we ACK, we should get 2 more transactions
        MockClient.send_data(conn, %SatOpLogAck{lsn: lsn, transaction_id: id})

        assert_receive {^conn,
                        %SatOpLog{ops: [%{op: {:begin, %{lsn: lsn, transaction_id: id}}}, _, _]}}

        assert_receive {^conn, %SatOpLog{ops: [_, _, _]}}
        refute_receive {^conn, %SatOpLog{ops: [_, _, _]}}

        # If we ACK using a not-last transaction, we should receive just one more tx
        MockClient.send_data(conn, %SatOpLogAck{lsn: lsn, transaction_id: id})

        assert_receive {^conn, %SatOpLog{ops: [_, _, _]}}
        refute_receive {^conn, %SatOpLog{ops: [_, _, _]}}
      end)
    end

    @tag with_migrations: [@test_shape_migration]
    test "move-in after an unsubscribe should not contain rows for the subscription that's gone",
         ctx do
      with_connect([port: ctx.port, auth: ctx, id: ctx.client_id], fn conn ->
        rel_map = start_replication_and_assert_response(conn, 2)

        [{client_name, _client_pid}] = active_clients()
        mocked_producer = Producer.name(client_name)

        ## Establish 2 subscriptions that intersect on the root, but differ in children

        {sub_id1, req_id, req} =
          ProtocolHelpers.simple_sub_request(
            test1: [
              where: "this.content ILIKE 's%'",
              include: [test_child: [over: "parent_id", where: "this.some_flag"]]
            ]
          )

        assert {:ok, %SatSubsResp{subscription_id: ^sub_id1, err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", req)

        # The real data function would have made a magic write which we're emulating here
        DownstreamProducerMock.produce(mocked_producer, build_events([], 1))
        assert {[^req_id], []} = receive_subscription_data(conn, sub_id1)

        {sub_id2, req_id, req} =
          ProtocolHelpers.simple_sub_request(
            test1: [
              where: "this.content ILIKE 's%'",
              include: [test_child: [over: "parent_id", where: "not this.some_flag"]]
            ]
          )

        assert {:ok, %SatSubsResp{subscription_id: ^sub_id2, err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", req)

        # The real data function would have made a magic write which we're emulating here
        DownstreamProducerMock.produce(mocked_producer, build_events([], 2))
        assert {[^req_id], []} = receive_subscription_data(conn, sub_id2)

        ## A transaction that causes a move-in (client needs to see `test_child` rows)
        DownstreamProducerMock.produce(
          mocked_producer,
          %Changes.Transaction{
            lsn: 3,
            xid: 3,
            commit_timestamp: DateTime.utc_now(),
            changes: [
              %UpdatedRecord{
                relation: {"public", "test1"},
                record: %{
                  "id" => "parent_1",
                  "content" => "super",
                  "parent_id" => "1"
                },
                old_record: %{
                  "id" => "parent_1",
                  "content" => "repus",
                  "parent_id" => "1"
                }
              }
            ],
            origin: ctx.client_id
          }
          |> then(&[{&1, &1.lsn}])
        )

        # Intercept the move-in function to supply data
        assert_receive {:mock_move_in, {mock_pid, mock_ref}, 3, sq_map}

        child_layers = sq_map |> Map.keys() |> Enum.flat_map(& &1.next_layers)
        sub1_layer = Enum.find(child_layers, &(&1.where_target.query == "this.some_flag"))
        sub2_layer = Enum.find(child_layers, &(&1.where_target.query == "not this.some_flag"))

        xmin = 5

        graph =
          Graph.new()
          |> Graph.add_edge(
            {{"public", "test1"}, ["parent_1"]},
            {{"public", "test_child"}, ["child_1"]},
            label: sub1_layer.key
          )
          |> Graph.add_edge(
            {{"public", "test1"}, ["parent_1"]},
            {{"public", "test_child"}, ["child_2"]},
            label: sub2_layer.key
          )

        data = %{
          {{"public", "test_child"}, ["child_1"]} => {
            %NewRecord{
              relation: {"public", "test_child"},
              record: %{"id" => "child_1", "parent_id" => "parent_1", "some_flag" => "t"},
              tags: []
            },
            [sub1_layer.request_id]
          },
          {{"public", "test_child"}, ["child_2"]} => {
            %NewRecord{
              relation: {"public", "test_child"},
              record: %{"id" => "child_2", "parent_id" => "parent_1", "some_flag" => "f"},
              tags: []
            },
            [sub2_layer.request_id]
          }
        }

        send(mock_pid, {:mock_move_in_data, mock_ref, {xmin, graph, data}})

        assert %{additional_data_ref: ref, changes: [%NewRecord{record: %{"id" => "parent_1"}}]} =
                 receive_txn(conn, rel_map)

        ## Before the query is fulfilled, we unsubscribe from one of the shapes.
        assert {:ok, _} =
                 MockClient.make_rpc_call(conn, "unsubscribe", %SatUnsubsReq{
                   subscription_ids: [sub_id2]
                 })

        {[^sub_id2], _, []} = receive_unsub_gone_batch(conn, rel_map)

        ## And then the data arrives
        DownstreamProducerMock.produce(mocked_producer, build_events([], 6))
        send(mock_pid, {:mock_move_in_trigger, mock_ref})

        ## And we see only a row that's in the subscription that's still live
        {^ref, [%{record: %{"id" => "child_1", "some_flag" => "t"}}]} =
          receive_additional_changes(conn, rel_map)

        ## And further changes to the other child are not propagated
        DownstreamProducerMock.produce(
          mocked_producer,
          %Changes.Transaction{
            lsn: 7,
            xid: 7,
            commit_timestamp: DateTime.utc_now(),
            changes: [
              %UpdatedRecord{
                relation: {"public", "test_child"},
                old_record: %{
                  "id" => "child_1",
                  "parent_id" => "parent_1",
                  "some_flag" => "t"
                },
                record: %{
                  "id" => "child_1",
                  "parent_id" => "parent_1",
                  "some_flag" => "t"
                }
              },
              %UpdatedRecord{
                relation: {"public", "test_child"},
                old_record: %{
                  "id" => "child_2",
                  "parent_id" => "parent_1",
                  "some_flag" => "f"
                },
                record: %{
                  "id" => "child_2",
                  "parent_id" => "parent_1",
                  "some_flag" => "f"
                }
              }
            ],
            origin: ctx.client_id
          }
          |> then(&[{&1, &1.lsn}])
        )

        assert %{changes: [%UpdatedRecord{record: %{"id" => "child_1"}}]} =
                 receive_txn(conn, rel_map)
      end)
    end
  end

  describe "Incoming replication (Satellite -> PG)" do
    @tag with_migrations: [
           {"20230815",
            ~s'CREATE TABLE #{@test_schema}.#{@test_table} (id TEXT PRIMARY KEY, "satellite-column-1" TEXT, "satellite-column-2" VARCHAR)'}
         ]
    test "common replication", ctx do
      self = self()
      client_lsn = <<0, 1, 2, 3>>

      with_mock Electric.DummyConsumer, [:passthrough],
        notify: fn _, ws_pid, events -> send(self, {:dummy_consumer, ws_pid, events}) end do
        with_connect([auth: ctx, id: ctx.client_id, port: ctx.port, auto_in_sub: true], fn conn ->
          start_replication_and_assert_response(conn, 1)

          columns = [
            %SatRelationColumn{name: "id", type: "text"},
            %SatRelationColumn{name: "satellite-column-1", type: "text"},
            %SatRelationColumn{name: "satellite-column-2", type: "varchar"}
          ]

          relation = %SatRelation{
            schema_name: @test_schema,
            table_type: :TABLE,
            table_name: @test_table,
            relation_id: @test_oid,
            columns: columns
          }

          serialize = fn [a, b, c] ->
            map = %{"id" => a, "satellite-column-1" => b, "satellite-column-2" => c}

            Electric.Satellite.Serialization.map_to_row(map, [
              %{name: "id", type: :text},
              %{name: "satellite-column-1", type: :text},
              %{name: "satellite-column-2", type: :text}
            ])
          end

          MockClient.send_data(conn, relation)

          dt = DateTime.truncate(DateTime.utc_now(), :millisecond)
          ct = DateTime.to_unix(dt, :millisecond)

          op_log1 =
            build_op_log([
              %SatOpBegin{commit_timestamp: ct, lsn: client_lsn},
              %SatOpInsert{relation_id: @test_oid, row_data: serialize.(["1", "a", "b"])}
            ])

          op_log2 =
            build_op_log([
              %SatOpInsert{relation_id: @test_oid, row_data: serialize.(["2", "c", "d"])},
              %SatOpCommit{}
            ])

          MockClient.send_data(conn, op_log1)
          MockClient.send_data(conn, op_log2)

          assert_receive {:dummy_consumer, _, [%Transaction{} = tx]}

          assert tx.lsn == client_lsn
          assert tx.commit_timestamp == dt

          assert tx.changes == [
                   %NewRecord{
                     relation: {@test_schema, @test_table},
                     record: %{
                       "id" => "1",
                       "satellite-column-1" => "a",
                       "satellite-column-2" => "b"
                     }
                   },
                   %NewRecord{
                     relation: {@test_schema, @test_table},
                     record: %{
                       "id" => "2",
                       "satellite-column-1" => "c",
                       "satellite-column-2" => "d"
                     }
                   }
                 ]

          assert tx.origin !== ""
        end)
      end
    end

    test "stop subscription when consumer is not available, and restart when it's back", ctx do
      with_connect([auth: ctx, id: ctx.client_id, port: ctx.port, auto_in_sub: true], fn conn ->
        start_replication_and_assert_response(conn, 0)

        pid = Process.whereis(:dummy_consumer)
        Process.monitor(pid)
        Process.exit(pid, :terminate)
        assert_receive {:DOWN, _, :process, ^pid, _}

        assert_receive {^conn, %SatRpcRequest{method: "stopReplication"}}
        assert_receive {^conn, %SatRpcRequest{method: "startReplication"}}
      end)
    end

    test "results in an error response when the client is outside of the cached WAL window",
         ctx do
      with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        assert {:ok, %SatInStartReplicationResp{err: error}} =
                 MockClient.make_rpc_call(conn, "startReplication", %SatInStartReplicationReq{
                   lsn: "1"
                 })

        assert %SatInStartReplicationResp.ReplicationError{code: :BEHIND_WINDOW} = error
      end)
    end
  end
end
