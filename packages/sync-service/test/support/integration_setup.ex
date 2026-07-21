defmodule Support.IntegrationSetup do
  @moduledoc """
  Helper functions for setting up integration tests that need an HTTP server.
  """

  import Support.ComponentSetup, only: [build_router_opts: 2]

  @doc """
  Starts a Bandit HTTP server and creates an Electric.Client.

  Returns a map with:
  - `client` - Electric.Client configured to connect to the server
  - `base_url` - The base URL of the server
  - `server_pid` - The Bandit server process
  - `port` - The port the server is listening on
  - `finch_name` - the shared Finch pool name (or nil), so later HTTP servers
    (e.g. a rolling deploy's replacement stack) can reuse it
  - `electric_client_opts` - the opts this was called with, so a replacement
    server can be built with the same router/client configuration
  """
  def with_electric_client(ctx, opts \\ []) do
    :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 2000)

    num_clients = Keyword.get(opts, :num_clients, 1)

    # Start a shared Finch pool once (when pooling is needed) so that a second
    # HTTP server started later in the test — e.g. the replacement stack in a
    # rolling deploy — can reuse it rather than starting a second Finch under
    # the same child id.
    finch_name =
      if num_clients > 1 do
        finch_name = :"Electric.Client.Finch.Test.#{System.unique_integer([:positive])}"

        {:ok, _} =
          ExUnit.Callbacks.start_supervised(
            {Finch, name: finch_name, pools: %{default: [size: num_clients]}}
          )

        finch_name
      end

    server =
      start_bandit_client(ctx,
        id: Bandit,
        router_opts: Keyword.get(opts, :router_opts, []),
        client_opts: finch_client_opts(finch_name)
      )

    ctx
    |> Map.merge(server)
    |> Map.merge(%{finch_name: finch_name, electric_client_opts: opts})
  end

  @doc """
  Starts a Bandit HTTP server bound to `ctx`'s stack and an `Electric.Client`
  pointed at it. Unlike `with_electric_client/2` this does NOT wait for the
  stack to be active (the caller manages readiness) and takes an explicit child
  `:id` so several servers can coexist in one test.

  Options:
    - `:id` - Bandit child id (default `Bandit`)
    - `:router_opts` - extra router opts merged into `build_router_opts/2`
    - `:client_opts` - extra opts passed to `Electric.Client.new/1`

  Returns `%{client:, base_url:, server_pid:, port:}`.
  """
  def start_bandit_client(ctx, opts \\ []) do
    id = Keyword.get(opts, :id, Bandit)
    router_opts = build_router_opts(ctx, Keyword.get(opts, :router_opts, []))
    client_opts = Keyword.get(opts, :client_opts, [])

    {:ok, server_pid} =
      ExUnit.Callbacks.start_supervised(
        {Bandit,
         plug: {Electric.Plug.Router, router_opts},
         port: 0,
         ip: :loopback,
         thousand_island_options: [num_acceptors: 1]},
        id: id
      )

    {:ok, {_ip, port}} = ThousandIsland.listener_info(server_pid)
    base_url = "http://localhost:#{port}"

    {:ok, client} = Electric.Client.new([base_url: base_url] ++ client_opts)

    %{client: client, base_url: base_url, server_pid: server_pid, port: port}
  end

  @doc """
  Builds the `Electric.Client` opts needed to route requests through a shared
  Finch pool, or `[]` when there is no pool.
  """
  def finch_client_opts(nil), do: []

  def finch_client_opts(finch_name),
    do: [fetch: {Electric.Client.Fetch.HTTP, [request: [finch: finch_name]]}]
end
