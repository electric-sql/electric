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

  ## Options

  - `:router_opts` - Options to pass to the router
  - `:finch_pool_size` - Size of the Finch connection pool (default: 100)
  """
  def with_electric_client(ctx, opts \\ []) do
    :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 2000)

    router_opts = build_router_opts(ctx, Keyword.get(opts, :router_opts, []))

    {:ok, server_pid} =
      ExUnit.Callbacks.start_supervised(
        {Bandit,
         plug: {Electric.Plug.Router, router_opts},
         port: 0,
         ip: :loopback,
         thousand_island_options: [num_acceptors: 1]}
      )

    {:ok, {_ip, port}} = ThousandIsland.listener_info(server_pid)
    base_url = "http://localhost:#{port}"

    # Start a dedicated Finch pool for tests with configurable size
    # For high-concurrency tests (like 1000 shapes), we need a much larger pool
    pool_size = Keyword.get(opts, :finch_pool_size, 500)
    pool_count = Keyword.get(opts, :finch_pool_count, 10)
    finch_name = :"TestFinch_#{System.unique_integer([:positive])}"

    {:ok, _finch_pid} =
      ExUnit.Callbacks.start_supervised(
        {Finch,
         name: finch_name,
         pools: %{
           base_url => [
             size: pool_size,
             count: pool_count,
             conn_opts: [transport_opts: [timeout: 60_000]]
           ]
         }}
      )

    {:ok, client} =
      Electric.Client.new(
        base_url: base_url,
        fetch: {Electric.Client.Fetch.HTTP, request: [finch: finch_name, receive_timeout: 120_000]}
      )

    Map.merge(ctx, %{
      client: client,
      base_url: base_url,
      server_pid: server_pid,
      port: port
    })
  end
end
