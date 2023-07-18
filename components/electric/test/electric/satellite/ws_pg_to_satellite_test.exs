defmodule Electric.Satellite.WsPgToSatelliteTest do
  use ExUnit.Case, async: false

  use Electric.Satellite.Protobuf

  import Electric.Postgres.TestConnection
  import ElectricTest.SatelliteHelpers

  alias Electric.Test.SatelliteWsClient, as: MockClient
  alias Electric.Satellite.Auth

  @ws_listener_name :ws_pg_to_satellite_test

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

  test "no migrations are delivered as part of initial sync if PG has no electrified tables",
       ctx do
    :ok = migrate(ctx.db, "2023071701", "CREATE TABLE public.foo (id TEXT PRIMARY KEY)")
    :ok = migrate(ctx.db, "2023071702", "CREATE TABLE public.bar (id TEXT PRIMARY KEY)")

    with_connect(ctx.conn_opts, fn conn ->
      assert_receive {^conn, %SatInStartReplicationReq{}}

      MockClient.send_data(conn, %SatInStartReplicationReq{options: [:FIRST_LSN]})
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
      send(server_pid(), {:pause_during_initial_sync, ref, self()})

      assert_receive {^conn, %SatInStartReplicationReq{}}

      MockClient.send_data(conn, %SatInStartReplicationReq{options: [:FIRST_LSN]})
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

  defp with_connect(opts, fun), do: MockClient.with_connect(opts, fun)

  defp server_pid do
    [pid] = :ranch.procs(@ws_listener_name, :connections)
    pid
  end

  defp migrate(conn, version, table \\ nil, sql) do
    results =
      :epgsql.squery(conn, """
      BEGIN;
      SELECT electric.migration_version('#{version}');
      #{sql};
      #{if table, do: "CALL electric.electrify('#{table}');"}
      COMMIT;
      """)

    Enum.each(results, fn result ->
      assert {:ok, _, _} = result
    end)

    :ok
  end
end
