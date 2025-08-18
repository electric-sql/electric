defmodule Electric.Connection.Manager.Pool do
  @moduledoc """
  A connection pool for managing multiple connections to a PostgreSQL database.
  """

  use GenServer, shutdown: :infinity
  require Logger
  alias Electric.DbConnectionError

  @type pool_status :: :starting | :ready | :repopulating

  @type connection_status :: :starting | :connected | :disconnected

  @type t :: %__MODULE__{
          stack_id: Electric.stack_id(),
          pool_ref: reference(),
          pool_pid: pid(),
          pool_size: non_neg_integer(),
          connection_manager: GenServer.server(),
          status: pool_status(),
          connection_pids: %{pid() => connection_status()},
          last_connection_error: DbConnectionError.t() | nil
        }

  defstruct [
    :stack_id,
    :pool_ref,
    :pool_pid,
    :pool_size,
    :connection_manager,
    pool_mod: Postgrex,
    status: :starting,
    connection_pids: %{},
    last_connection_error: nil
  ]

  # NimbleOptions schema (keep style consistent with other modules)
  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            # GenServer.server() — allow pid or a registered name
            connection_manager: [type: {:or, [:pid, :atom, @name_schema_tuple]}, required: true],
            # Pool implementation module (e.g. Postgrex)
            pool_mod: [type: :atom, default: Postgrex],
            # Forwarded to the pool implementation
            pool_opts: [type: :keyword_list, required: true],
            # Forwarded DB connection options (e.g. hostname, username, etc.)
            conn_opts: [type: :keyword_list, required: true]
          )

  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    name(Access.fetch!(opts, :stack_id))
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, opts, name: name(opts))
    end
  end

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    Process.set_label({:connection_pool, opts[:stack_id]})
    Logger.metadata(stack_id: opts[:stack_id])
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts[:stack_id])

    pool_mod = Access.fetch!(opts, :pool_mod)
    pool_opts = Access.fetch!(opts, :pool_opts)
    conn_opts = Access.fetch!(opts, :conn_opts)

    pool_ref = make_ref()

    pool_size = Keyword.get(pool_opts, :pool_size, 2)

    pool_config =
      [
        # Disable automatic reconnection for pooled connections making them terminate on
        # error. This lets us observe connection errors by configuring the current process
        # as a connection listener in the pool.
        # The value for `max_restarts` is based on the pool size so the pool supervisor
        # doesn't shutdown unless all pooled connections fall into a restart loop within
        # the 5 second grace interval.
        backoff_type: :stop,
        max_restarts: pool_size * 3,
        max_seconds: 5,
        configure: {__MODULE__, :configure_pool_conn, [self()]},
        connection_listeners: {[self()], pool_ref},
        # Assume the manager connection might be pooled, so use unnamed prepared
        # statements to avoid issues with the pooler
        #
        # See https://hexdocs.pm/postgrex/0.19.3/readme.html#pgbouncer
        prepare: :unnamed
      ]

    {:ok, pool_pid} =
      pool_mod.start_link(pool_config ++ pool_opts ++ conn_opts)

    state = %__MODULE__{
      stack_id: Access.fetch!(opts, :stack_id),
      pool_ref: pool_ref,
      pool_pid: pool_pid,
      pool_size: pool_size,
      connection_manager: Access.fetch!(opts, :connection_manager)
    }

    {:ok, state}
  end

  @impl true
  def handle_continue(:update_pool_status, state) do
    pool_is_ready = num_connected(state) >= state.pool_size

    case {state.status, pool_is_ready} do
      {:starting, true} ->
        Logger.info("Connection pool is ready with #{state.pool_size} connections")
        notify_connection_pool_ready(state)
        {:noreply, %{state | status: :ready, last_connection_error: nil}}

      {:repopulating, true} ->
        Logger.debug("Connection pool fully repopulated with #{state.pool_size} connections")
        {:noreply, %{state | status: :ready, last_connection_error: nil}}

      {:ready, false} ->
        Logger.debug("Connection pool no longer fully populated, waiting for more connections")
        {:noreply, %{state | status: :repopulating}}

      _ ->
        {:noreply, state}
    end
  end

  @impl true
  def handle_info({:pool_conn_started, pid}, state) do
    # The connection pool has started a new connection, so we need to remember it.
    Logger.debug("Pooled connection #{inspect(pid)} started")

    {
      :noreply,
      %{state | connection_pids: Map.put(state.connection_pids, pid, :starting)}
    }
  end

  # The following two messages are sent by the DBConnection library because we've configured
  # the connection manager process as connection listener for the DB connection pool.
  def handle_info({:connected, pid, ref}, %{pool_ref: ref} = state) do
    Logger.debug("Pooled connection #{inspect(pid)} connected")

    {
      :noreply,
      %{state | connection_pids: Map.put(state.connection_pids, pid, :connected)},
      {:continue, :update_pool_status}
    }
  end

  def handle_info({:disconnected, pid, ref}, %{pool_ref: ref} = state) do
    Logger.debug("Pooled connection #{inspect(pid)} disconnected")

    {
      :noreply,
      %{state | connection_pids: Map.put(state.connection_pids, pid, :disconnected)},
      {:continue, :update_pool_status}
    }
  end

  # Special-case the explicit shutdown of the supervision tree.
  def handle_info({:EXIT, _, :shutdown}, state), do: {:noreply, state}

  # Special-case the :killed exit of the pool process, which would occur if the pool connection
  # supervisor reaches its max restarts within the grace period, indicating that the pool could
  # not set up the specified number of connections.
  def handle_info({:EXIT, pid, :killed}, %{pool_pid: pid, status: status} = state)
      when status in [:starting, :repopulating] do
    error =
      if is_nil(state.last_connection_error) do
        %DbConnectionError{
          message: "Connection pool was unable to fill up with healthy connections.",
          type: :connection_pool_failed_to_populate,
          original_error: :killed,
          retry_may_fix?: true
        }
      else
        state.last_connection_error
      end

    {:stop, error, state}
  end

  def handle_info({:EXIT, pid, reason}, %{pool_pid: pid} = state) do
    {:stop, reason, state}
  end

  def handle_info({:EXIT, pid, reason}, state) when is_map_key(state.connection_pids, pid) do
    Logger.debug("Pooled connection #{inspect(pid)} exited with reason: #{inspect(reason)}")

    # Keep track of the most recent pooled connection error seen so we can use it as the
    # reason for the pool failing as a whole if it does not manage to recover.
    state =
      case reason do
        :killed -> state
        :shutdown -> state
        {:shutdown, exit_reason} -> %{state | last_connection_error: exit_reason}
        reason -> %{state | last_connection_error: reason}
      end

    if not is_nil(state.last_connection_error) do
      Logger.warning(
        "Pooled database connection encountered an error: #{inspect(state.last_connection_error, pretty: true)}"
      )
    end

    {
      :noreply,
      %{state | connection_pids: Map.delete(state.connection_pids, pid)},
      {:continue, :update_pool_status}
    }
  end

  @impl true
  def terminate(_reason, %{pool_pid: pool_pid}) do
    # ensure pool is terminated along with pool manager
    ref = Process.monitor(pool_pid)
    Process.exit(pool_pid, :shutdown)

    receive do
      {:DOWN, ^ref, :process, ^pool_pid, _reason} -> :ok
    after
      5000 ->
        Process.exit(pool_pid, :kill)

        receive do
          {:DOWN, ^ref, :process, ^pool_pid, _reason} -> :ok
        end
    end
  end

  # We call this before configuring pool connections in order to fully monitor them
  # and log any issues before and after the connection is established.
  def configure_pool_conn(opts, supervisor_pid) do
    send(supervisor_pid, {:pool_conn_started, self()})
    Process.link(supervisor_pid)
    opts
  end

  @spec num_connected(t()) :: non_neg_integer()
  defp num_connected(%__MODULE__{connection_pids: connection_pids}) do
    connection_pids
    |> Enum.count(fn {_pid, status} -> status == :connected end)
  end

  defp notify_connection_pool_ready(%__MODULE__{connection_manager: manager}) do
    Electric.Connection.Manager.connection_pool_ready(manager)
  end
end
