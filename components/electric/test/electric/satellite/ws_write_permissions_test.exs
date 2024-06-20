defmodule Electric.Satellite.WsWritePermissionsTest do
  use ExUnit.Case, async: false
  use Electric.Satellite.Protobuf
  use Electric.Postgres.MockSchemaLoader
  use ElectricTest.Satellite.WsServerHelpers

  alias Electric.Postgres.CachedWal.Producer

  alias Electric.Replication.Changes.{
    NewRecord,
    Transaction
  }

  alias Electric.Satellite.Auth

  alias Satellite.TestWsClient, as: MockClient

  import ElectricTest.SetupHelpers
  import ElectricTest.SatelliteHelpers
  import Electric.Postgres.TestConnection

  require Logger

  @user_table "users"
  @user_oid 100_005

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

    ddlx = ElectricTest.PermissionsHelpers.Perms.to_rules(ctx.ddlx)

    loader_spec = MockSchemaLoader.backend_spec(migrations: ctx.migrations, rules: ddlx)

    plug =
      {Electric.Plug.SatelliteWebsocketPlug,
       auth_provider: Auth.provider(),
       connector_config: connector_config,
       subscription_data_fun: ctx.subscription_data_fun,
       move_in_data_fun: ctx.move_in_data_fun,
       allowed_unacked_txs: ctx.allowed_unacked_txs,
       schema_loader: loader_spec}

    start_link_supervised!({Bandit, port: port, plug: plug})

    server_id = Electric.instance_id()

    start_link_supervised!({Electric.Satellite.ClientReconnectionInfo, connector_config})

    %{port: port, server_id: server_id, origin: origin}
  end

  setup [
    :setup_with_ddlx
  ]

  @migrations [
    {"20230815",
     [
       ~s'CREATE TABLE #{@test_schema}.#{@user_table} (id text PRIMARY KEY, role text)',
       ~s'CREATE TABLE #{@test_schema}.#{@test_table} (id text PRIMARY KEY, "satellite-column-1" TEXT, "satellite-column-2" VARCHAR, user_id uuid)'
     ]}
  ]
  @ddlx [
    "GRANT READ ON #{@test_schema}.#{@test_table} TO AUTHENTICATED",
    "GRANT WRITE ON #{@test_schema}.#{@test_table} TO AUTHENTICATED WHERE (user_id = auth.user_id)"
  ]

  describe "Incoming replication (Satellite -> PG)" do
    @tag migrations: @migrations, ddlx: @ddlx
    test "permissions allow valid writes", ctx do
      self = self()
      client_lsn = <<0, 1, 2, 3>>

      with_mock Electric.DummyConsumer, [:passthrough],
        notify: fn _, ws_pid, events -> send(self, {:dummy_consumer, ws_pid, events}) end do
        with_connect([auth: ctx, id: ctx.client_id, port: ctx.port, auto_in_sub: true], fn conn ->
          start_replication_and_assert_response(conn, 0)
          send_relation(conn, {@test_schema, @test_table})

          dt = DateTime.truncate(DateTime.utc_now(), :millisecond)
          ct = DateTime.to_unix(dt, :millisecond)

          op_log1 =
            build_op_log([
              %SatOpBegin{commit_timestamp: ct, lsn: client_lsn},
              %SatOpInsert{
                relation_id: @test_oid,
                row_data: serialize(["1", "a", "b", ctx.user_id])
              }
            ])

          op_log2 =
            build_op_log([
              %SatOpInsert{
                relation_id: @test_oid,
                row_data: serialize(["2", "c", "d", ctx.user_id])
              },
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
                       "satellite-column-2" => "b",
                       "user_id" => ctx.user_id
                     }
                   },
                   %NewRecord{
                     relation: {@test_schema, @test_table},
                     record: %{
                       "id" => "2",
                       "satellite-column-1" => "c",
                       "satellite-column-2" => "d",
                       "user_id" => ctx.user_id
                     }
                   }
                 ]

          assert tx.origin !== ""
        end)
      end
    end

    @tag migrations: @migrations, ddlx: @ddlx
    test "permissions reject invalid writes", ctx do
      self = self()
      client_lsn = <<0, 1, 2, 3>>
      other_user_id = "a9aa6991-a18e-4da9-888e-0412d37c4460"

      with_mock Electric.DummyConsumer, [:passthrough],
        notify: fn _, ws_pid, events -> send(self, {:dummy_consumer, ws_pid, events}) end do
        with_connect([auth: ctx, id: ctx.client_id, port: ctx.port, auto_in_sub: true], fn conn ->
          start_replication_and_assert_response(conn, 0)

          send_relation(conn, {@test_schema, @test_table})

          dt = DateTime.truncate(DateTime.utc_now(), :millisecond)
          ct = DateTime.to_unix(dt, :millisecond)

          op_log1 =
            build_op_log([
              %SatOpBegin{commit_timestamp: ct, lsn: client_lsn},
              %SatOpInsert{
                relation_id: @test_oid,
                row_data: serialize(["1", "a", "b", other_user_id])
              },
              %SatOpCommit{}
            ])

          MockClient.send_data(conn, op_log1)

          refute_receive {:dummy_consumer, _, [%Transaction{}]}
        end)
      end
    end

    @tag migrations: @migrations,
         ddlx: [
           "GRANT WRITE ON #{@test_schema}.#{@user_table} TO AUTHENTICATED",
           "ASSIGN users.role TO users.id",
           "GRANT READ ON #{@test_schema}.#{@test_table} TO AUTHENTICATED",
           "GRANT WRITE ON #{@test_schema}.#{@test_table} TO 'admin'"
         ]
    test "dynamic role assignment is accepted", ctx do
      self = self()
      client_lsn = <<0, 1, 2, 3>>

      with_mock Electric.DummyConsumer, [:passthrough],
        notify: fn _, ws_pid, events -> send(self, {:dummy_consumer, ws_pid, events}) end do
        with_connect([auth: ctx, id: ctx.client_id, port: ctx.port, auto_in_sub: true], fn conn ->
          start_replication_and_assert_response(conn, 0)

          send_relation(conn, {@test_schema, @test_table})
          send_relation(conn, {@test_schema, @user_table})

          dt = DateTime.truncate(DateTime.utc_now(), :millisecond)
          ct = DateTime.to_unix(dt, :millisecond)

          op_log1 =
            build_op_log([
              %SatOpBegin{commit_timestamp: ct, lsn: client_lsn},
              %SatOpInsert{
                relation_id: @test_oid,
                row_data: serialize(["1", "a", "b", @user_id])
              },
              %SatOpCommit{}
            ])

          MockClient.send_data(conn, op_log1)

          refute_receive {:dummy_consumer, _, [%Transaction{} = _tx]}
        end)
      end

      with_mock Electric.DummyConsumer, [:passthrough],
        notify: fn _, ws_pid, events -> send(self, {:dummy_consumer, ws_pid, events}) end do
        with_connect([auth: ctx, id: ctx.client_id, port: ctx.port, auto_in_sub: true], fn conn ->
          start_replication_and_assert_response(conn, 0)

          send_relation(conn, {@test_schema, @test_table})
          send_relation(conn, {@test_schema, @user_table})

          dt = DateTime.truncate(DateTime.utc_now(), :millisecond)
          ct = DateTime.to_unix(dt, :millisecond)

          op_log1 =
            build_op_log([
              %SatOpBegin{commit_timestamp: ct, lsn: client_lsn},
              %SatOpInsert{
                relation_id: @user_oid,
                row_data: serialize([@user_id, "admin"])
              },
              %SatOpInsert{
                relation_id: @test_oid,
                row_data: serialize(["1", "a", "b", @user_id])
              },
              %SatOpCommit{}
            ])

          MockClient.send_data(conn, op_log1)

          assert_receive {:dummy_consumer, _, [%Transaction{} = tx]}

          assert tx.lsn == client_lsn
          assert tx.commit_timestamp == dt

          assert tx.changes == [
                   %NewRecord{
                     relation: {@test_schema, @user_table},
                     record: %{
                       "id" => @user_id,
                       "role" => "admin"
                     }
                   },
                   %NewRecord{
                     relation: {@test_schema, @test_table},
                     record: %{
                       "id" => "1",
                       "satellite-column-1" => "a",
                       "satellite-column-2" => "b",
                       "user_id" => @user_id
                     }
                   }
                 ]
        end)
      end
    end
  end

  def send_relation(conn, {@test_schema, @test_table}) do
    columns = [
      %SatRelationColumn{name: "id", type: "text"},
      %SatRelationColumn{name: "satellite-column-1", type: "text"},
      %SatRelationColumn{name: "satellite-column-2", type: "varchar"},
      %SatRelationColumn{name: "user_id", type: "uuid"}
    ]

    relation = %SatRelation{
      schema_name: @test_schema,
      table_type: :TABLE,
      table_name: @test_table,
      relation_id: @test_oid,
      columns: columns
    }

    MockClient.send_data(conn, relation)
  end

  def send_relation(conn, {@test_schema, @user_table}) do
    columns = [
      %SatRelationColumn{name: "id", type: "text"},
      %SatRelationColumn{name: "role", type: "text"}
    ]

    relation = %SatRelation{
      schema_name: @test_schema,
      table_type: :TABLE,
      table_name: @user_table,
      relation_id: @user_oid,
      columns: columns
    }

    MockClient.send_data(conn, relation)
  end

  def serialize([id, role]) do
    map = %{"id" => id, "role" => role}

    Electric.Satellite.Serialization.map_to_row(map, [
      %{name: "id", type: :text},
      %{name: "role", type: :text}
    ])
  end

  def serialize([id, a, b, c]) do
    map = %{"id" => id, "satellite-column-1" => a, "satellite-column-2" => b, "user_id" => c}

    Electric.Satellite.Serialization.map_to_row(map, [
      %{name: "id", type: :text},
      %{name: "satellite-column-1", type: :text},
      %{name: "satellite-column-2", type: :text},
      %{name: "user_id", type: :uuid}
    ])
  end
end
