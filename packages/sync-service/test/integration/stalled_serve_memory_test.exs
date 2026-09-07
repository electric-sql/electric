defmodule Electric.Integration.StalledServeMemoryTest do
  @moduledoc """
  A shape response served to a client that stops reading must not pin a full
  log chunk (~`chunk_bytes_threshold`, 10 MB by default) per connection for an
  unbounded time.

  Reproduces a production OOM (see #4708): a bulk write woke a fleet of live
  long-pollers into multi-chunk catch-up serves; connections whose clients
  stalled kept their entire in-flight chunk pinned — once in the handler
  process and once in the socket's driver queue — with nothing to reap them.
  ~400 such serves × ~10 MB ≈ 3.9 GB of reference-counted binary and the node
  ran out of memory. The pinned data is live-referenced, so no GC tuning can
  reclaim it; the server must either bound the in-flight write unit or reap
  serves that stop making progress.

  Full stack: real Postgres, real replication, real Bandit server, raw TCP
  clients that request a live shape and then never read the response.
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.IntegrationSetup

  alias Electric.Plug.Router

  @moduletag :tmp_dir

  # Stalled connections and the per-connection pinned-memory budget the server
  # must stay within regardless of the configured chunk size.
  @stalled_clients 10
  @per_connection_budget 2 * 1024 * 1024

  describe "stalled live clients" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag timeout: 120_000
    test "a stalled serve does not pin the full in-flight chunk indefinitely", ctx do
      %{stack_id: stack_id, db_conn: db_conn, port: port, server_pid: server_pid} = ctx
      opts = Router.init(build_router_opts(ctx))
      registry = Electric.StackSupervisor.registry_name(stack_id)

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

      # The trigger: one bulk transaction (~50 MB) that all parked waiters wake
      # to serve. Every response dwarfs the client's socket buffers, so every
      # serve stalls.
      Postgrex.query!(
        db_conn,
        "INSERT INTO items SELECT gen_random_uuid(), repeat('x', 50000) FROM generate_series(1, 1000)",
        []
      )

      # Give every handler ample time to wake, load its chunk, and wedge — and
      # the server ample time to notice serves that make no progress.
      Process.sleep(25_000)

      pinned = Enum.map(handlers, &pinned_bytes/1)
      total_pinned = Enum.sum(pinned)
      worst = Enum.max(pinned)
      alive = Enum.count(handlers, &Process.alive?/1)

      assert total_pinned <= @stalled_clients * @per_connection_budget,
             """
             #{alive}/#{@stalled_clients} stalled serves still alive, pinning \
             #{mb(total_pinned)} of response data (worst connection: #{mb(worst)}, \
             budget: #{mb(@per_connection_budget)}/connection).
             Each stalled connection pins its entire in-flight log chunk (handler \
             heap + socket driver queue) with nothing to bound or reap it — the \
             unbounded growth that OOMed production.
             """
    end
  end

  # Response bytes pinned by one stalled connection: refc binaries referenced
  # by the handler process (deduplicated by binary id) plus bytes queued in the
  # socket ports it owns. A dead (reaped) handler pins nothing.
  defp pinned_bytes(handler) do
    heap_bytes =
      case Process.info(handler, :binary) do
        {:binary, list} ->
          list
          |> Enum.reduce(%{}, fn {id, size, _refc}, acc -> Map.put(acc, id, size) end)
          |> Map.values()
          |> Enum.sum()

        nil ->
          0
      end

    port_bytes =
      case Process.info(handler, :links) do
        {:links, links} ->
          for p <- links, is_port(p), reduce: 0 do
            acc ->
              case :erlang.port_info(p, :queue_size) do
                {:queue_size, n} -> acc + n
                _ -> acc
              end
          end

        nil ->
          0
      end

    heap_bytes + port_bytes
  end

  defp wait_for_subscribers(registry, handle, n, tries \\ 400) do
    found = length(Registry.lookup(registry, handle))

    cond do
      found >= n -> :ok
      tries > 0 -> Process.sleep(25) && wait_for_subscribers(registry, handle, n, tries - 1)
      true -> flunk("only #{found}/#{n} live requests subscribed")
    end
  end

  defp mb(bytes), do: "#{Float.round(bytes / 1_048_576, 1)}MB"
end
