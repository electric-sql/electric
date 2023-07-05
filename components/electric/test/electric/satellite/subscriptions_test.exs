defmodule Electric.Satellite.SubscriptionsTest do
  use ExUnit.Case, async: false

  use Electric.Satellite.Protobuf
  import Electric.Postgres.TestConnection
  import Electric.Utils, only: [uuid4: 0]
  alias Electric.Test.SatelliteWsClient, as: MockClient
  alias Electric.Postgres.CachedWal

  describe "Handling of real subscriptions" do
    setup :setup_replicated_db

    setup(ctx) do
      user_id = "a5408365-7bf4-48b1-afe2-cb8171631d7c"
      client_id = "device-id-0000"
      port = 55133
      auth_provider = Electric.Satellite.Auth.provider()

      Electric.Satellite.WsServer.start_link(
        name: :ws_test,
        port: port,
        auth_provider: auth_provider,
        pg_connector_opts: ctx.pg_connector_opts
      )

      token = Electric.Satellite.Auth.JWT.create_token(user_id)

      on_exit(fn ->
        drain_pids(active_clients())
        :cowboy.stop_listener(:ws_test)
      end)

      {:ok, user_id: user_id, client_id: client_id, token: token, port: port}
    end

    setup :create_electrified_tables

    test "The client can connect and immediately gets migrations", ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{options: [:FIRST_LSN]})

        assert_receive {^conn, %SatInStartReplicationResp{}}

        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            _begin,
                            %SatTransOp{op: {:migrate, _}},
                            %SatTransOp{op: {:migrate, _}},
                            %SatTransOp{op: {:migrate, _}},
                            _commit
                          ]
                        }},
                       300
      end)
    end

    test "The client can connect and immediately gets migrations but gets no data",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{options: [:FIRST_LSN]})

        assert_receive {^conn, %SatInStartReplicationResp{}}

        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            _begin,
                            %SatTransOp{op: {:migrate, _}},
                            %SatTransOp{op: {:migrate, _}},
                            %SatTransOp{op: {:migrate, _}},
                            _commit
                          ]
                        }},
                       300

        position = CachedWal.Api.get_current_position()
        {:ok, ref} = CachedWal.Api.request_notification(position)

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.users (id, name) VALUES ($1, $2)", [
            uuid4(),
            "John"
          ])

        assert_receive {:cached_wal_notification, ^ref, :new_segments_available}, 1_000
        refute_receive {^conn, %SatOpLog{}}
      end)
    end

    test "The client can connect and subscribe, and that works with multiple shape requests",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{options: [:FIRST_LSN]})

        assert_receive {^conn, %SatInStartReplicationResp{}}
        assert_receive {^conn, %SatInStartReplicationReq{}}
        for _ <- 1..3, do: assert_receive({^conn, %SatRelation{}})

        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            _begin,
                            %SatTransOp{op: {:migrate, _}},
                            %SatTransOp{op: {:migrate, _}},
                            %SatTransOp{op: {:migrate, _}},
                            _commit
                          ]
                        }},
                       300

        position = CachedWal.Api.get_current_position()
        {:ok, ref} = CachedWal.Api.request_notification(position)

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.users (id, name) VALUES ($1, $2)", [
            uuid4(),
            "John"
          ])

        assert_receive {:cached_wal_notification, ^ref, :new_segments_available}, 1_000
        refute_receive {^conn, %SatOpLog{}}

        request_id1 = uuid4()
        request_id2 = uuid4()

        MockClient.send_data(conn, %SatSubsReq{
          shape_requests: [
            %SatShapeReq{
              request_id: request_id1,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "users"}]
              }
            },
            %SatShapeReq{
              request_id: request_id2,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "my_entries"}]
              }
            }
          ]
        })

        assert_receive {^conn, %SatSubsResp{subscription_id: sub_id}}
        assert_receive {^conn, %SatSubsDataBegin{subscription_id: ^sub_id}}, 1000
        assert_receive {^conn, %SatShapeDataBegin{request_id: ^request_id2}}
        assert_receive {^conn, %SatShapeDataEnd{}}

        assert_receive {^conn, %SatShapeDataBegin{request_id: ^request_id1}}

        assert_receive {^conn,
                        %SatOpLog{ops: [%SatTransOp{op: {:insert, %SatOpInsert{row_data: data}}}]}}

        assert %SatOpRow{values: [_, "John"]} = data

        assert_receive {^conn, %SatShapeDataEnd{}}
        assert_receive {^conn, %SatSubsDataEnd{}}

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.my_entries (content) VALUES ($1)", [
            "Correct"
          ])

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.users (id, name) VALUES ($1, $2)", [
            uuid4(),
            "Garry"
          ])

        # We get the message of insertion for a table we have a subscription for
        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            %{op: {:begin, _}},
                            %{op: {:insert, %{row_data: %{values: [_, "Garry"]}}}},
                            %{op: {:commit, _}}
                          ]
                        }},
                       1000

        assert_received {^conn,
                         %SatOpLog{
                           ops: [
                             %{op: {:begin, _}},
                             %{op: {:insert, %{row_data: %{values: [_, "Correct", _]}}}},
                             %{op: {:commit, _}}
                           ]
                         }}
      end)
    end

    test "The client can connect and subscribe, and he gets data upon subscription and thereafter",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        MockClient.send_data(conn, %SatInStartReplicationReq{options: [:FIRST_LSN]})

        assert_receive {^conn, %SatInStartReplicationResp{}}
        assert_receive {^conn, %SatInStartReplicationReq{}}
        for _ <- 1..3, do: assert_receive({^conn, %SatRelation{}})

        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            _begin,
                            %SatTransOp{op: {:migrate, _}},
                            %SatTransOp{op: {:migrate, _}},
                            %SatTransOp{op: {:migrate, _}},
                            _commit
                          ]
                        }},
                       300

        position = CachedWal.Api.get_current_position()
        {:ok, ref} = CachedWal.Api.request_notification(position)

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.users (id, name) VALUES ($1, $2)", [
            uuid4(),
            "John"
          ])

        assert_receive {:cached_wal_notification, ^ref, :new_segments_available}, 1_000
        refute_receive {^conn, %SatOpLog{}}

        request_id = uuid4()

        MockClient.send_data(conn, %SatSubsReq{
          shape_requests: [
            %SatShapeReq{
              request_id: request_id,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "users"}]
              }
            }
          ]
        })

        assert_receive {^conn, %SatSubsResp{subscription_id: sub_id}}
        assert_receive {^conn, %SatSubsDataBegin{subscription_id: ^sub_id}}, 1000
        assert_receive {^conn, %SatShapeDataBegin{request_id: ^request_id}}

        assert_receive {^conn,
                        %SatOpLog{ops: [%SatTransOp{op: {:insert, %SatOpInsert{row_data: data}}}]}}

        assert_receive {^conn, %SatShapeDataEnd{}}
        assert_receive {^conn, %SatSubsDataEnd{}}

        assert %SatOpRow{values: [_, "John"]} = data

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.my_entries (content) VALUES ($1)", ["WRONG"])

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.users (id, name) VALUES ($1, $2)", [
            uuid4(),
            "Garry"
          ])

        # We get the message of insertion for a table we have a subscription for
        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            %{op: {:begin, _}},
                            %{op: {:insert, %{row_data: %{values: [_, "Garry"]}}}},
                            %{op: {:commit, _}}
                          ]
                        }},
                       1000

        # But not for the one we don't have included in the subscription
        refute_received {^conn,
                         %SatOpLog{
                           ops: [
                             %{op: {:begin, _}},
                             %{op: {:insert, %{row_data: %{values: [_, "WRONG", _]}}}},
                             %{op: {:commit, _}}
                           ]
                         }}
      end)
    end
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
end
