defmodule Electric.Satellite.SubscriptionsTest do
  use ExUnit.Case, async: false

  alias Electric.Replication.Changes.UpdatedRecord
  alias Satellite.ProtocolHelpers
  alias Electric.Replication.Postgres.Client
  alias Electric.Replication.Changes.Gone
  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  use Electric.Satellite.Protobuf
  import Electric.Postgres.TestConnection
  import Electric.Utils, only: [uuid4: 0]
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

        assert_receive {^conn, %SatOpLog{ops: ops}}, 300
        assert [%SatTransOp{op: {:begin, _}} | ops] = ops

        ops =
          for _ <- 1..ctx.electrified_count, reduce: ops do
            ops ->
              assert [%SatTransOp{op: {:migrate, _}} | ops] = ops
              ops
          end

        assert [%SatTransOp{op: {:commit, _}}] = ops
      end)
    end

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{uuid4()}', 'Garry');
         """
    test "The client can connect and immediately gets migrations but gets neither already inserted data, nor new inserts",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        start_replication_and_assert_response(conn, ctx.electrified_count)

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
        start_replication_and_assert_response(conn, ctx.electrified_count)

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

        assert {[^request_id], data} = receive_subscription_data(conn, sub_id)
        assert [%SatOpInsert{row_data: %{values: [_, "John"]}}] = data

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
        start_replication_and_assert_response(conn, ctx.electrified_count)

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

        assert {[^request_id2, ^request_id1], data} = receive_subscription_data(conn, sub_id)
        assert [%SatOpInsert{row_data: %{values: [_, "John"]}}] = data

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
        start_replication_and_assert_response(conn, ctx.electrified_count)

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

        assert {[^request_id1], data} = receive_subscription_data(conn, sub_id1)
        assert [%SatOpInsert{row_data: %{values: [_, "John"]}}] = data

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

        assert {[^request_id2], data} = receive_subscription_data(conn, sub_id2)
        assert [%SatOpInsert{row_data: %{values: [_, "Old", _]}}] = data

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
        start_replication_and_assert_response(conn, ctx.electrified_count)

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

        assert {[^request_id1], data} = receive_subscription_data(conn, sub_id1)
        assert [%SatOpInsert{row_data: %{values: [_, "John"]}}] = data

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

        assert {[^request_id2], data} = receive_subscription_data(conn, sub_id2)
        assert [] == data

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
        start_replication_and_assert_response(conn, ctx.electrified_count)

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

        assert {[request_id], []} == receive_subscription_data(conn, sub_id)

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
          start_replication_and_assert_response(conn, ctx.electrified_count)

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

          assert {[request_id], []} == receive_subscription_data(conn, sub_id)

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
        start_replication_and_assert_response(conn, ctx.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(users: [where: "this.name LIKE '% Doe'"])

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], data} = receive_subscription_data(conn, sub_id)
        assert [%SatOpInsert{row_data: %{values: [_, "John Doe"]}}] = data

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
        start_replication_and_assert_response(conn, ctx.electrified_count)

        {sub_id1, request_id1, request} =
          ProtocolHelpers.simple_sub_request(users: [where: "this.name ILIKE 'john%'"])

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id1], data} = receive_subscription_data(conn, sub_id1)
        assert [%SatOpInsert{row_data: %{values: [_, "John Doe"]}}] = data

        {sub_id2, request_id2, request} =
          ProtocolHelpers.simple_sub_request(users: [where: "this.name ILIKE '%doe'"])

        # Since all existing rows that satisfy new where clause have already been sent, we shouldn't receive it again
        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id2], []} = receive_subscription_data(conn, sub_id2)

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

    @john_doe_id uuid4()
    @entry_id uuid4()

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{@john_doe_id}', 'John Doe');
         INSERT INTO public.users (id, name) VALUES ('#{uuid4()}', 'John Nobody');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES ('#{@entry_id}', '#{@john_doe_id}', 'Hello world');
         INSERT INTO public.comments (id, entry_id, content, author_id) VALUES ('#{uuid4()}', '#{@entry_id}', 'Comment 1', '#{@john_doe_id}');
         """
    test "The client can connect and subscribe with INCLUDE TREE on shapes",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        start_replication_and_assert_response(conn, ctx.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            users: [
              where: "this.name ILIKE '% doe'",
              include: [
                authored_entries: [over: "author_id"]
              ]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], data} = receive_subscription_data(conn, sub_id)

        assert [
                 %SatOpInsert{row_data: %{values: [@john_doe_id, "John Doe"]}},
                 %SatOpInsert{row_data: %{values: [@entry_id, "Hello world", @john_doe_id]}}
               ] = data

        {:ok, 1} =
          :epgsql.equery(
            pg_conn,
            "INSERT INTO public.authored_entries (id, author_id, content) VALUES ($1, $2, $3)",
            [
              uuid4(),
              @john_doe_id,
              "Second item"
            ]
          )

        assert_receive {^conn,
                        %SatOpLog{
                          ops: [
                            _begin,
                            %{
                              op:
                                {:insert,
                                 %{row_data: %{values: [_, "Second item", @john_doe_id]}}}
                            },
                            _commit
                          ]
                        }},
                       1000
      end)
    end

    @jane_doe_id uuid4()

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{@john_doe_id}', 'John Doe');
         INSERT INTO public.users (id, name) VALUES ('#{@jane_doe_id}', 'Jane Doe');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES ('#{@entry_id}', '#{@john_doe_id}', 'Hello world');
         INSERT INTO public.comments (id, entry_id, content, author_id) VALUES ('#{uuid4()}', '#{@entry_id}', 'Comment 1', '#{@john_doe_id}');
         INSERT INTO public.comments (id, entry_id, content, author_id) VALUES ('#{uuid4()}', '#{@entry_id}', 'Comment 2', '#{@jane_doe_id}');
         """
    test "Include trees work with move-outs & gone-s",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, ctx.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            authored_entries: [
              where: "this.author_id = '#{@john_doe_id}'",
              include: [
                users: [over: "author_id"],
                comments: [over: "entry_id", include: [users: [over: "author_id"]]]
              ]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], data} = receive_subscription_data(conn, sub_id)

        # There are no guarantees on consistent data ordering from the server
        assert [
                 %SatOpInsert{row_data: %{values: [@jane_doe_id, "Jane Doe"]}},
                 %SatOpInsert{row_data: %{values: [@john_doe_id, "John Doe"]}},
                 %SatOpInsert{row_data: %{values: [@entry_id, "Hello world", @john_doe_id]}},
                 %SatOpInsert{
                   row_data: %{values: [comment_1_id, "Comment 1", @entry_id, @john_doe_id]}
                 },
                 %SatOpInsert{
                   row_data: %{values: [comment_2_id, "Comment 2", @entry_id, @jane_doe_id]}
                 }
               ] = Enum.sort_by(data, &{&1.relation_id, Enum.at(&1.row_data.values, 1)})

        jane_entry_id = uuid4()
        second_entry_id = uuid4()

        # Adding a new entry by John Doe passes the filter, but not by Jane Doe
        {:ok, 2} =
          :epgsql.equery(
            pg_conn,
            "INSERT INTO public.authored_entries (id, author_id, content) VALUES ($1, $2, $3), ($4, $5, $6)",
            [
              second_entry_id,
              @john_doe_id,
              "Second item",
              jane_entry_id,
              @jane_doe_id,
              "Third item"
            ]
          )

        assert [%NewRecord{record: %{"author_id" => @john_doe_id}}] =
                 receive_txn_changes(conn, rel_map)

        # Comment changing parent to out-of-shape is propagated as deletion
        {:ok, 1} =
          :epgsql.equery(
            pg_conn,
            "UPDATE public.comments SET entry_id = $1 WHERE id = $2",
            [jane_entry_id, comment_1_id]
          )

        assert [%DeletedRecord{old_record: %{"id" => ^comment_1_id}}] =
                 receive_txn_changes(conn, rel_map)

        # One entry changing the author marks itself deleted, it's children GONE, but John Doe stays in the tree
        {:ok, 1} =
          :epgsql.equery(
            pg_conn,
            "UPDATE public.authored_entries SET author_id = $1 WHERE id = $2",
            [@jane_doe_id, @entry_id]
          )

        assert [
                 %DeletedRecord{old_record: %{"id" => @entry_id}},
                 %Gone{pk: [^comment_2_id]},
                 %Gone{pk: [@jane_doe_id]}
               ] =
                 receive_txn_changes(conn, rel_map)

        # Updates to GONE entries are not propagated
        {:ok, 1} =
          :epgsql.equery(
            pg_conn,
            "UPDATE public.comments SET content = $1 WHERE id = $2",
            ["New comment 2", comment_2_id]
          )

        refute_receive {^conn, %SatOpLog{}}, 100
      end)
    end

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{@john_doe_id}', 'John Doe');
         INSERT INTO public.users (id, name) VALUES ('#{@jane_doe_id}', 'Jane Doe');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES ('#{@entry_id}', '#{@john_doe_id}', 'Hello world');
         """
    test "Update to an entry in the same txn where it's getting GONE is not propagated",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, ctx.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            authored_entries: [
              where: "this.author_id = '#{@john_doe_id}'",
              include: [
                users: [over: "author_id"]
              ]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], [_, _]} = receive_subscription_data(conn, sub_id)

        # Update to an entry in the same txn where it's getting GONE is not propagated
        Client.with_transaction(pg_conn, fn tx_conn ->
          # Order here is important: update that comes before the GONE should be removed from the list
          {:ok, 1} =
            :epgsql.equery(tx_conn, "UPDATE public.users SET name = $1 WHERE id = $2", [
              "Johnny Doe",
              @john_doe_id
            ])

          {:ok, 1} =
            :epgsql.equery(
              tx_conn,
              "UPDATE public.authored_entries SET author_id = $1 WHERE id = $2",
              [@jane_doe_id, @entry_id]
            )
        end)

        assert [
                 %DeletedRecord{old_record: %{"id" => @entry_id}},
                 %Gone{pk: [@john_doe_id]}
               ] = receive_txn_changes(conn, rel_map)
      end)
    end

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{@john_doe_id}', 'John Doe');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES ('#{@entry_id}', '#{@john_doe_id}', 'Hello world');
         """
    test "Enough information in the transaction to immediately send unseen many-to-one relations",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, ctx.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            authored_entries: [
              where: "this.content ILIKE 'nice%'",
              include: [
                users: [over: "author_id"]
              ]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], []} = receive_subscription_data(conn, sub_id)

        {:ok, 1} =
          :epgsql.equery(
            pg_conn,
            "UPDATE public.authored_entries SET content = $1 WHERE id = $2",
            ["nice job", @entry_id]
          )

        assert [
                 %NewRecord{record: %{"id" => @entry_id}},
                 %NewRecord{record: %{"id" => @john_doe_id}}
               ] = receive_txn_changes(conn, rel_map)

        # Update to an author now comes through correctly
        {:ok, 1} =
          :epgsql.equery(pg_conn, "UPDATE public.users SET name = $1 WHERE id = $2", [
            "Johnny Doe",
            @john_doe_id
          ])

        assert [%UpdatedRecord{record: %{"id" => @john_doe_id}}] =
                 receive_txn_changes(conn, rel_map)
      end)
    end

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{@john_doe_id}', 'John Doe');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES ('#{@entry_id}', '#{@john_doe_id}', 'Hello world');
         """
    test "Changes which rely on unseen many-to-one relations are propagated correctly",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, ctx.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            authored_entries: [
              where: "this.content ILIKE 'nice%'",
              include: [
                users: [over: "author_id", include: [authored_entries: [over: "author_id"]]]
              ]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], []} = receive_subscription_data(conn, sub_id)

        second_entry = uuid4()

        # Update to an entry in the same txn where it's getting GONE is not propagated
        Client.with_transaction(pg_conn, fn tx_conn ->
          {:ok, 1} =
            :epgsql.equery(
              tx_conn,
              "INSERT INTO public.authored_entries (id, author_id, content) VALUES ($1, $2, $3)",
              [second_entry, @john_doe_id, "unrelated content"]
            )

          {:ok, 1} =
            :epgsql.equery(
              tx_conn,
              "UPDATE public.authored_entries SET content = $1 WHERE id = $2",
              ["nice job", @entry_id]
            )
        end)

        assert [
                 %NewRecord{record: %{"id" => ^second_entry}},
                 %NewRecord{record: %{"id" => @entry_id}},
                 %NewRecord{record: %{"id" => @john_doe_id}}
               ] = receive_txn_changes(conn, rel_map)
      end)
    end

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{@john_doe_id}', 'John Doe');
         INSERT INTO public.users (id, name) VALUES ('#{@jane_doe_id}', 'Jane Doe');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES ('#{@entry_id}', '#{@john_doe_id}', 'Hello world');
         INSERT INTO public.comments (id, entry_id, content, author_id) VALUES ('#{uuid4()}', '#{@entry_id}', 'Comment 1', '#{@john_doe_id}');
         """
    test "move-in causes a fetch of additional",
         %{conn: pg_conn} = ctx do
      MockClient.with_connect([auth: ctx, id: ctx.client_id, port: ctx.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, ctx.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            users: [
              where: "this.id = '#{@jane_doe_id}'",
              include: [
                authored_entries: [
                  over: "author_id",
                  include: [
                    # Note that we don't explicitly ask for the author of the comment,
                    # but FK auto-filling will make sure we get it anyway
                    comments: [over: "entry_id"]
                  ]
                ]
              ]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], [_]} =
                 receive_subscription_data(conn, sub_id)

        # Update an entry to move it in
        {:ok, 1} =
          :epgsql.equery(
            pg_conn,
            "UPDATE public.authored_entries SET author_id = $1 WHERE id = $2",
            [@jane_doe_id, @entry_id]
          )

        assert [
                 %NewRecord{record: %{"id" => @entry_id}}
               ] = receive_txn_changes(conn, rel_map)

        assert {1,
                [
                  %NewRecord{relation: {"public", "comments"}},
                  %NewRecord{record: %{"id" => @john_doe_id}}
                ]} = receive_additional_changes(conn, rel_map)

        # Update to a moved-in entry propagates
        {:ok, 1} =
          :epgsql.equery(pg_conn, "UPDATE public.users SET name = $1 WHERE id = $2", [
            "Johnny Doe",
            @john_doe_id
          ])

        assert [%UpdatedRecord{record: %{"id" => @john_doe_id}}] =
                 receive_txn_changes(conn, rel_map)
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
