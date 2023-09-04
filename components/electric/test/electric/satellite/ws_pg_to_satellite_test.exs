defmodule Electric.Satellite.WsPgToSatelliteTest do
  use ExUnit.Case, async: false

  use Electric.Satellite.Protobuf

  import Electric.Postgres.TestConnection
  import ElectricTest.SatelliteHelpers

  alias Electric.Test.SatelliteWsClient, as: MockClient
  alias Electric.Satellite.Auth

  setup :setup_replicated_db

  setup ctx do
    port = 55133

    plug =
      {Electric.Plug.SatelliteWebsocketPlug,
       auth_provider: Electric.Satellite.Auth.provider(), pg_connector_opts: ctx.pg_connector_opts}

    pid = start_link_supervised!({Bandit, port: port, plug: plug})

    client_id = "ws_pg_to_satellite_client"
    auth = %{token: Auth.Secure.create_token(Electric.Utils.uuid4())}

    %{db: ctx.conn, conn_opts: [port: port, auth: auth, id: client_id], server_pid: pid}
  end

  test "no migrations are delivered as part of initial sync if PG has no electrified tables",
       ctx do
    :ok = migrate(ctx.db, "2023071701", "CREATE TABLE public.foo (id TEXT PRIMARY KEY)")
    :ok = migrate(ctx.db, "2023071702", "CREATE TABLE public.bar (id TEXT PRIMARY KEY)")

    with_connect(ctx.conn_opts, fn conn ->
      assert_receive {^conn, %SatInStartReplicationReq{}}

      MockClient.send_data(conn, %SatInStartReplicationReq{})
      assert_receive {^conn, %SatInStartReplicationResp{}}

      ping_server(conn)
      refute_receive {^conn, _}
    end)
  end

  test "the server does not send a repeat migration after initial sync", ctx do
    vsn1 = "2023071701"
    vsn2 = "2023071702"
    vsn3 = "2023071703"

    :ok = migrate(ctx.db, vsn1, "public.foo", "CREATE TABLE public.foo (id TEXT PRIMARY KEY)")

    with_connect(ctx.conn_opts, fn conn ->
      ref = make_ref()
      send(current_connection_pid(ctx.server_pid), {:pause_during_initial_sync, ref, self()})

      assert_receive {^conn, %SatInStartReplicationReq{}}

      MockClient.send_data(conn, %SatInStartReplicationReq{})
      assert_receive {^conn, %SatInStartReplicationResp{}}

      assert_receive {^ref, :server_paused}

      :ok = migrate(ctx.db, vsn2, "public.bar", "CREATE TABLE public.bar (id TEXT PRIMARY KEY)")

      assert_receive_migration(conn, vsn1, "foo")
      assert_receive_migration(conn, vsn2, "bar")

      ping_server(conn)
      refute_receive {^conn, _}

      # Make sure the server keeps streaming migrations to the client after the initial sync is done.
      :ok = migrate(ctx.db, vsn3, "ALTER TABLE foo ADD COLUMN bar TEXT DEFAULT 'quux'")
      assert_receive_migration(conn, vsn3, "foo")

      ping_server(conn)
      refute_receive {^conn, _}
    end)
  end

  test "only migrations that have newer version than the client's schema version are delivered",
       ctx do
    vsn1 = "2023071901"
    vsn2 = "2023071902"
    :ok = migrate(ctx.db, vsn1, "public.foo", "CREATE TABLE public.foo (id TEXT PRIMARY KEY)")
    :ok = migrate(ctx.db, vsn2, "public.bar", "CREATE TABLE public.bar (id TEXT PRIMARY KEY)")

    # First, verify that the client receives all migrations when it doesn't provide its schema version
    with_connect(ctx.conn_opts, fn conn ->
      assert_receive {^conn, %SatInStartReplicationReq{}}

      MockClient.send_data(conn, %SatInStartReplicationReq{})
      assert_receive {^conn, %SatInStartReplicationResp{}}

      assert_receive_migration(conn, vsn1, "foo")
      assert_receive_migration(conn, vsn2, "bar")

      ping_server(conn)
      refute_receive {^conn, _}
    end)

    # Now, verify that the client receives only the second migration when it provides its schema version
    with_connect(ctx.conn_opts, fn conn ->
      assert_receive {^conn, %SatInStartReplicationReq{}}

      req = %SatInStartReplicationReq{schema_version: vsn1}
      MockClient.send_data(conn, req)
      assert_receive {^conn, %SatInStartReplicationResp{}}

      assert_receive_migration(conn, vsn2, "bar")

      ping_server(conn)
      refute_receive {^conn, _}
    end)
  end

  defp current_connection_pid(server_pid) do
    {:ok, [pid]} = ThousandIsland.connection_pids(server_pid)
    pid
  end
end
