defmodule Electric.Integration.StalledServeReapingTest do
  @moduledoc """
  A shape response whose client stops accepting data must be terminated once
  it has made no progress for `:stalled_serve_timeout`, releasing the
  connection and everything the serve pins.

  Defense in depth for the 2026-07-01 production OOM: bounded write units
  (#4708) cap what each stalled serve pins, but nothing reaps the serves
  themselves — a population of stalled connections still accumulates memory
  and file descriptors proportional to connection count, invisibly (stalled
  serves never complete, so they emit no spans and increment no request
  counters). The TCP send timeout only catches a *fully blocked* write; a
  client draining at a trickle — or a proxy buffering for a vanished client —
  evades it indefinitely.

  The reaping deadline is distinct from a slow-but-healthy client: progress
  is a completed bounded socket write, so a client sustaining a modest
  throughput (roughly one OS send buffer per timeout window, worst case)
  keeps resetting the deadline. A serve whose client accepts nothing for the
  full window is terminated; the client can reconnect and resume from its
  offset.
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.IntegrationSetup

  alias Electric.Plug.Router

  @moduletag :tmp_dir

  @stalled_clients 3
  @stalled_serve_timeout 2_000
  # The reaper must fire within the configured timeout plus scheduling slack.
  @reap_deadline_ms 10_000

  describe "stalled live clients" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag timeout: 60_000
    test "a serve making no progress is terminated within the stall timeout", ctx do
      %{stack_id: stack_id, db_conn: db_conn, port: port, server_pid: server_pid} = ctx
      opts = Router.init(build_router_opts(ctx))
      registry = Electric.StackSupervisor.registry_name(stack_id)

      Electric.StackConfig.put(stack_id, :stalled_serve_timeout, @stalled_serve_timeout)

      # Create the shape and learn its handle.
      snapshot = Plug.Test.conn(:get, "/v1/shape?table=items&offset=-1") |> Router.call(opts)
      assert snapshot.status == 200
      [handle] = Plug.Conn.get_resp_header(snapshot, "electric-handle")

      # Park live long-pollers over raw sockets that will never be read from.
      socks =
        for _ <- 1..@stalled_clients do
          {:ok, s} =
            :gen_tcp.connect({127, 0, 0, 1}, port, [
              :binary,
              active: false,
              recbuf: 2048,
              buffer: 2048
            ])

          :ok =
            :gen_tcp.send(
              s,
              "GET /v1/shape?table=items&handle=#{handle}&offset=0_0&live=true HTTP/1.1\r\n" <>
                "Host: localhost\r\n\r\n"
            )

          s
        end

      on_exit(fn -> Enum.each(socks, &:gen_tcp.close/1) end)

      wait_for_subscribers(registry, handle, @stalled_clients)
      {:ok, handlers} = ThousandIsland.connection_pids(server_pid)
      assert length(handlers) == @stalled_clients

      monitors = Map.new(handlers, fn pid -> {Process.monitor(pid), pid} end)

      # A large transaction wakes every waiter into a response far bigger than
      # the client's socket buffers: every serve wedges after the initial
      # buffer fill and never makes progress again.
      Postgrex.query!(
        db_conn,
        "INSERT INTO items SELECT gen_random_uuid(), repeat('x', 50000) FROM generate_series(1, 400)",
        []
      )

      # Every stalled serve must be reaped within the configured stall timeout
      # (plus slack). Without reaping they live — and pin memory and a file
      # descriptor each — until the client goes away, which may be never.
      for {ref, pid} <- monitors do
        assert_receive {:DOWN, ^ref, :process, ^pid, _reason},
                       @reap_deadline_ms,
                       "stalled serve #{inspect(pid)} was not terminated within " <>
                         "#{@stalled_serve_timeout}ms stall timeout (+ slack): nothing reaps " <>
                         "serves whose clients stop accepting data"
      end
    end
  end

  describe "slow but draining client" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag timeout: 60_000
    test "a serve to a client draining at a trickle is never reaped", ctx do
      %{stack_id: stack_id, db_conn: db_conn, port: port, server_pid: server_pid} = ctx
      opts = Router.init(build_router_opts(ctx))
      registry = Electric.StackSupervisor.registry_name(stack_id)

      Electric.StackConfig.put(stack_id, :stalled_serve_timeout, @stalled_serve_timeout)

      snapshot = Plug.Test.conn(:get, "/v1/shape?table=items&offset=-1") |> Router.call(opts)
      assert snapshot.status == 200
      [handle] = Plug.Conn.get_resp_header(snapshot, "electric-handle")

      {:ok, sock} =
        :gen_tcp.connect({127, 0, 0, 1}, port, [
          :binary,
          active: false,
          recbuf: 65536,
          buffer: 65536
        ])

      on_exit(fn -> :gen_tcp.close(sock) end)

      :ok =
        :gen_tcp.send(
          sock,
          "GET /v1/shape?table=items&handle=#{handle}&offset=0_0&live=true HTTP/1.1\r\n" <>
            "Host: localhost\r\n\r\n"
        )

      wait_for_subscribers(registry, handle, 1)
      {:ok, [handler]} = ThousandIsland.connection_pids(server_pid)
      monitor = Process.monitor(handler)

      # A transaction whose serve, at our drain rate, spans many stall-timeout
      # windows. The client drains more than an OS send buffer per window, so
      # bounded writes keep completing and the serve must survive them all.
      Postgrex.query!(
        db_conn,
        "INSERT INTO items SELECT gen_random_uuid(), repeat('x', 10000) FROM generate_series(1, 2000)",
        []
      )

      # Drain slowly for up to ~6x the stall timeout: read a piece, pause. A
      # recv timeout means the (chunk-bounded) response completed under us.
      deadline = System.monotonic_time(:millisecond) + 6 * @stalled_serve_timeout
      drained = drain_slowly(sock, deadline, 0)

      # The serve must have spanned multiple stall-timeout windows.
      assert drained > 5_000_000

      refute_received {:DOWN, ^monitor, :process, ^handler, _reason}

      assert Process.alive?(handler),
             "healthy slow-draining serve was reaped by the stall watchdog"
    end
  end

  defp drain_slowly(sock, deadline, acc) do
    if System.monotonic_time(:millisecond) >= deadline do
      acc
    else
      case :gen_tcp.recv(sock, 0, 2_000) do
        {:ok, data} ->
          Process.sleep(50)
          drain_slowly(sock, deadline, acc + byte_size(data))

        # No more data: the response completed while we were draining.
        {:error, :timeout} ->
          acc

        {:error, reason} ->
          flunk("socket read failed after #{acc} bytes: #{inspect(reason)}")
      end
    end
  end

  defp wait_for_subscribers(registry, handle, n, tries \\ 400) do
    found = length(Registry.lookup(registry, handle))

    cond do
      found >= n -> :ok
      tries > 0 -> Process.sleep(25) && wait_for_subscribers(registry, handle, n, tries - 1)
      true -> flunk("only #{found}/#{n} live requests subscribed")
    end
  end
end
