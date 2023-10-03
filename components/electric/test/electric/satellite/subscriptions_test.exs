defmodule Electric.Satellite.SubscriptionsTest do
  use ExUnit.Case, async: false

  use Electric.Satellite.Protobuf
  import Electric.Postgres.TestConnection
  import Electric.Utils, only: [uuid4: 0]
  import ElectricTest.SetupHelpers
  import ElectricTest.SatelliteHelpers
  alias Satellite.TestWsClient, as: MockClient
  alias Electric.Postgres.CachedWal

  describe "Handling of real subscriptions" do
    setup :setup_replicated_db

    setup(ctx) do
      user_id = "a5408365-7bf4-48b1-afe2-cb8171631d7c"
      client_id = "device-id-0000"
      port = 55133

      plug =
        {Electric.Plug.SatelliteWebsocketPlug,
         auth_provider: Electric.Satellite.Auth.provider(), connector_config: ctx.connector_config}

      start_link_supervised!({Bandit, port: port, plug: plug})

      token = Electric.Satellite.Auth.Secure.create_token(user_id)

      on_exit(fn ->
        drain_pids(active_clients())
      end)

      {:ok, user_id: user_id, client_id: client_id, token: token, port: port}
    end

    setup :setup_electrified_tables
    setup :setup_with_sql_execute

    test "The client can connect and immediately gets migrations", ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        assert {:ok, _} =
                 MockClient.make_rpc_call(conn, "startReplication", %SatInStartReplicationReq{})

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

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{uuid4()}', 'Garry');
         """
    test "The client can connect and immediately gets migrations but gets neither already inserted data, nor new inserts",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        assert {:ok, _} =
                 MockClient.make_rpc_call(conn, "startReplication", %SatInStartReplicationReq{})

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

        refute_receive {^conn, %SatOpLog{}}

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

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{uuid4()}', 'John');
         """
    test "The client can connect and subscribe, and he gets data upon subscription and thereafter",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        start_replication_and_assert_response(conn, 3)

        request_id = uuid4()
        sub_id = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id,
          shape_requests: [
            %SatShapeReq{
              request_id: request_id,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "users"}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        received = receive_subscription_data(conn, sub_id)
        assert Map.keys(received) == [request_id]
        assert [%SatOpInsert{row_data: %{values: [_, "John"]}}] = received[request_id]

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.my_entries (id, content) VALUES ($1, $2)", [
            uuid4(),
            "WRONG"
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

    test "The client can connect and subscribe, and that works with multiple shape requests",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        start_replication_and_assert_response(conn, 3)

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.users (id, name) VALUES ($1, $2)", [
            uuid4(),
            "John"
          ])

        sub_id = uuid4()
        request_id1 = uuid4()
        request_id2 = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id,
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
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        received = receive_subscription_data(conn, sub_id)
        assert Map.keys(received) -- [request_id1, request_id2] == []
        assert [%SatOpInsert{row_data: %{values: [_, "John"]}}] = received[request_id1]
        assert [] = received[request_id2]

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.my_entries (id, content) VALUES ($1, $2)", [
            uuid4(),
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

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES (gen_random_uuid(), 'John');
         INSERT INTO public.my_entries (id, content) VALUES (gen_random_uuid(), 'Old');
         """
    test "The client can connect and subscribe, and that works with multiple subscriptions",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        start_replication_and_assert_response(conn, 3)

        sub_id = uuid4()
        request_id1 = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id,
          shape_requests: [
            %SatShapeReq{
              request_id: request_id1,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "users"}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        received = receive_subscription_data(conn, sub_id)
        assert Map.keys(received) == [request_id1]
        assert [%SatOpInsert{row_data: %{values: [_, "John"]}}] = received[request_id1]

        sub_id2 = uuid4()
        request_id2 = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id2,
          shape_requests: [
            %SatShapeReq{
              request_id: request_id2,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "my_entries"}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        received = receive_subscription_data(conn, sub_id2)
        assert Map.keys(received) == [request_id2]
        assert [%SatOpInsert{row_data: %{values: [_, "Old", _]}}] = received[request_id2]

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.my_entries (id, content) VALUES ($1, $2)", [
            uuid4(),
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
                            _begin,
                            %{op: {:insert, %{row_data: %{values: [_, "Garry"]}}}},
                            _commit
                          ]
                        }},
                       1000

        assert_received {^conn,
                         %SatOpLog{
                           ops: [
                             _begin,
                             %{op: {:insert, %{row_data: %{values: [_, "Correct", _]}}}},
                             _commit
                           ]
                         }}
      end)
    end

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{uuid4()}', 'John');
         """
    test "Second subscription for the same table yields no data",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        start_replication_and_assert_response(conn, 3)

        sub_id1 = uuid4()
        request_id1 = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id1,
          shape_requests: [
            %SatShapeReq{
              request_id: request_id1,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "users"}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        received = receive_subscription_data(conn, sub_id1)
        assert Map.keys(received) == [request_id1]
        assert [%SatOpInsert{row_data: %{values: [_, "John"]}}] = received[request_id1]

        sub_id2 = uuid4()
        request_id2 = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id2,
          shape_requests: [
            %SatShapeReq{
              request_id: request_id2,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "users"}]
              }
            }
          ]
        }

        # Since we already got the data for this table, we shouldn't receive it again
        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        received = receive_subscription_data(conn, sub_id2)
        assert Map.keys(received) == [request_id2]
        assert [] == received[request_id2]

        # But an unsubscribe from one of those still keeps messages coming for the mentioned table
        assert {:ok, _} =
                 MockClient.send_rpc(conn, "unsubscribe", %SatUnsubsReq{
                   subscription_ids: [sub_id1]
                 })

        # We still get the message because the other subscription is active
        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.users (id, name) VALUES ($1, $2)", [
            uuid4(),
            "Garry"
          ])

        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            _begin,
                            %{op: {:insert, %{row_data: %{values: [_, "Garry"]}}}},
                            _commit
                          ]
                        }},
                       1000
      end)
    end

    test "The client can connect and subscribe, and then unsubscribe, and gets no data after unsubscribing",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        start_replication_and_assert_response(conn, 3)

        request_id = uuid4()
        sub_id = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id,
          shape_requests: [
            %SatShapeReq{
              request_id: request_id,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "users"}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert %{request_id => []} == receive_subscription_data(conn, sub_id)

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

        assert {:ok, _} =
                 MockClient.send_rpc(conn, "unsubscribe", %SatUnsubsReq{
                   subscription_ids: [sub_id]
                 })

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.users (id, name) VALUES ($1, $2)", [
            uuid4(),
            "Garry"
          ])

        # But not for the one we don't have included in the subscription
        refute_receive {^conn, %SatOpLog{}}
      end)
    end

    test "The client can connect and subscribe, and reconnect with the same subscription ID",
         %{conn: pg_conn} = ctx do
      sub_id = uuid4()

      last_lsn =
        MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
          start_replication_and_assert_response(conn, 3)

          request_id = uuid4()

          request = %SatSubsReq{
            subscription_id: sub_id,
            shape_requests: [
              %SatShapeReq{
                request_id: request_id,
                shape_definition: %SatShapeDef{
                  selects: [%SatShapeDef.Select{tablename: "users"}]
                }
              }
            ]
          }

          assert {:ok, %SatSubsResp{err: nil}} =
                   MockClient.make_rpc_call(conn, "subscribe", request)

          assert %{request_id => []} == receive_subscription_data(conn, sub_id)

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
                              %{op: {:commit, %{lsn: lsn}}}
                            ]
                          }},
                         1000

          # and then disconnect, returning the lsn
          lsn
        end)

      # Insert a row while client is disconnected
      {:ok, 1} =
        :epgsql.equery(pg_conn, "INSERT INTO public.users (id, name) VALUES ($1, $2)", [
          uuid4(),
          "Bobby"
        ])

      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        assert {:ok, _} =
                 MockClient.make_rpc_call(conn, "startReplication", %SatInStartReplicationReq{
                   lsn: last_lsn,
                   subscription_ids: [sub_id]
                 })

        # Assert that we immediately receive the data that falls into the continued subscription
        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            %{op: {:begin, _}},
                            %{op: {:insert, %{row_data: %{values: [_, "Bobby"]}}}},
                            %{op: {:commit, _}}
                          ]
                        }},
                       100
      end)
    end

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{uuid4()}', 'John Doe');
         INSERT INTO public.users (id, name) VALUES ('#{uuid4()}', 'John Nobody');
         """
    test "The client can connect and subscribe with where clauses on shapes",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        start_replication_and_assert_response(conn, 3)

        request_id = uuid4()
        sub_id = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id,
          shape_requests: [
            %SatShapeReq{
              request_id: request_id,
              shape_definition: %SatShapeDef{
                selects: [
                  %SatShapeDef.Select{tablename: "users", where: "this.name ILIKE '% doe'"}
                ]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        received = receive_subscription_data(conn, sub_id)
        assert Map.keys(received) == [request_id]
        assert [%SatOpInsert{row_data: %{values: [_, "John Doe"]}}] = received[request_id]

        jane_nobody_uuid = uuid4()

        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.my_entries (id, content) VALUES ($1, $2)", [
            uuid4(),
            "WRONG"
          ])

        {:ok, 2} =
          :epgsql.equery(
            pg_conn,
            "INSERT INTO public.users (id, name) VALUES ($1, $2), ($3, $4)",
            [
              uuid4(),
              "Jane Doe",
              jane_nobody_uuid,
              "Jane Nobody"
            ]
          )

        # We get the message of insertion for a table we have a subscription for, filtered on where clause
        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            %{op: {:begin, _}},
                            %{op: {:insert, %{row_data: %{values: [_, "Jane Doe"]}}}},
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

        # Update to the row is converted to insert if it moves into shape
        {:ok, 1} =
          :epgsql.equery(pg_conn, "UPDATE public.users SET name = $2 WHERE id = $1", [
            jane_nobody_uuid,
            "Jane New Doe"
          ])

        # We get the message of insertion for a table we have a subscription for, filtered on where clause
        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            %{op: {:begin, _}},
                            %{op: {:insert, %{row_data: %{values: [_, "Jane New Doe"]}}}},
                            %{op: {:commit, _}}
                          ]
                        }},
                       1000

        # Update to the row is converted to delete if it moves out of shape
        {:ok, 1} =
          :epgsql.equery(pg_conn, "UPDATE public.users SET name = $2 WHERE id = $1", [
            jane_nobody_uuid,
            "Jane New"
          ])

        # We get the message of insertion for a table we have a subscription for, filtered on where clause
        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            %{op: {:begin, _}},
                            %{op: {:delete, %{old_row_data: %{values: [_, "Jane New Doe"]}}}},
                            %{op: {:commit, _}}
                          ]
                        }},
                       1000
      end)
    end

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{uuid4()}', 'John Doe');
         """
    test "Second subscription with where clause doesn't duplicate data",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        start_replication_and_assert_response(conn, 3)

        sub_id1 = uuid4()
        request_id1 = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id1,
          shape_requests: [
            %SatShapeReq{
              request_id: request_id1,
              shape_definition: %SatShapeDef{
                selects: [
                  %SatShapeDef.Select{tablename: "users", where: "this.name ILIKE 'john%'"}
                ]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        received = receive_subscription_data(conn, sub_id1)
        assert Map.keys(received) == [request_id1]
        assert [%SatOpInsert{row_data: %{values: [_, "John Doe"]}}] = received[request_id1]

        sub_id2 = uuid4()
        request_id2 = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id2,
          shape_requests: [
            %SatShapeReq{
              request_id: request_id2,
              shape_definition: %SatShapeDef{
                selects: [
                  %SatShapeDef.Select{tablename: "users", where: "this.name ILIKE '%doe'"}
                ]
              }
            }
          ]
        }

        # Since all existing rows that satisfy new where clause have already been sent, we shouldn't receive it again
        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        received = receive_subscription_data(conn, sub_id2)
        assert Map.keys(received) == [request_id2]
        assert [] == received[request_id2]

        # But an unsubscribe from one of those still keeps messages coming for the mentioned table
        assert {:ok, _} =
                 MockClient.send_rpc(conn, "unsubscribe", %SatUnsubsReq{
                   subscription_ids: [sub_id1]
                 })

        # We still get the message because the other subscription is active
        {:ok, 1} =
          :epgsql.equery(pg_conn, "INSERT INTO public.users (id, name) VALUES ($1, $2)", [
            uuid4(),
            "Jane doe"
          ])

        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            _begin,
                            %{op: {:insert, %{row_data: %{values: [_, "Jane doe"]}}}},
                            _commit
                          ]
                        }},
                       1000
      end)
    end
  end

  defp active_clients() do
    Electric.Satellite.ClientManager.get_clients()
    |> Enum.flat_map(fn {client_name, client_pid} ->
      if Process.alive?(client_pid) do
        [{client_name, client_pid}]
      else
        []
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
