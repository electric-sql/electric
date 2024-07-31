defmodule Electric.ConnectionManager do
  @moduledoc """
  Custom initialisation and reconnection logic for database connections.

  This module is esentially a supervisor for database connections. But unlike an OTP process
  supervisor, it includes additional functionality:

    - adjusting connection options based on the response from the database
    - monitoring connections and initiating a reconnection procedure
    - custom reconnection logic with exponential backoff

  Your OTP application should start a singleton connection manager under its main supervision tree:

      children = [
        ...,
        {Electric.ConnectionManager,
         connection_opts: [...],
         replication_opts: [...],
         pool_opts: [...]},
        ...
      ]

      Supervisor.start_link(children, strategy: :one_for_one)
  """

  defmodule State do
    defstruct [
      # Database connection opts to be passed to Postgrex modules.
      :connection_opts,
      # Replication options specific to `Electric.Postgres.ReplicationClient`.
      :replication_opts,
      # Database connection pool options.
      :pool_opts,
      # PID of the replication client.
      :replication_client_pid,
      # PID of the database connection pool (a `Postgrex` process).
      :pool_pid,
      # Backoff term used for reconnection with exponential back-off.
      :backoff
    ]
  end

  use GenServer

  require Logger

  @type option ::
          {:connection_opts, Keyword.t()}
          | {:replication_opts, Keyword.t()}
          | {:pool_opts, Keyword.t()}

  @type options :: [option]

  @name __MODULE__

  @spec start_link(options) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: @name)
  end

  @impl true
  def init(opts) do
    # Because child processes are started via `start_link()` functions and due to how Postgrex
    # (mis)manages connection errors, we have to trap exists in the manager process to
    # implement our custom error handling logic.
    Process.flag(:trap_exit, true)

    connection_opts = Keyword.fetch!(opts, :connection_opts)

    replication_opts =
      opts
      |> Keyword.fetch!(:replication_opts)
      |> Keyword.put(:start_streaming?, false)

    pool_opts = Keyword.fetch!(opts, :pool_opts)

    state =
      %State{
        connection_opts: connection_opts,
        replication_opts: replication_opts,
        pool_opts: pool_opts,
        backoff: {:backoff.init(1000, 10_000), nil}
      }

    # We try to start the replication connection first because it requires additional
    # priveleges compared to regular "pooled" connections, so failure to open a replication
    # connection should be reported ASAP.
    {:ok, state, {:continue, :start_replication_client}}
  end

  @impl true
  def handle_continue(:start_replication_client, state) do
    case start_replication_client(state.connection_opts, state.replication_opts) do
      {:ok, pid, connection_opts} ->
        state = %{state | replication_client_pid: pid, connection_opts: connection_opts}
        {:noreply, state, {:continue, :start_connection_pool}}

      {:error, reason} ->
        handle_connection_error(reason, state)
    end
  end

  def handle_continue(:start_connection_pool, state) do
    case start_connection_pool(state.connection_opts, state.pool_opts) do
      {:ok, pid} ->
        # Now we have everything ready to start accepting and processing logical messages from
        # Postgres.
        Electric.Postgres.ReplicationClient.start_streaming(state.replication_client_pid)

        state = %{state | pool_pid: pid}
        {:noreply, state}

      {:error, reason} ->
        handle_connection_error(reason, state)
    end
  end

  @impl true
  def handle_info({:timeout, tref, step}, %{backoff: {backoff, tref}} = state) do
    state = %{state | backoff: {backoff, nil}}
    handle_continue(step, state)
  end

  # When either the replication client or the connection pool shuts down, let the OTP
  # supervisor restart the connection manager to initiate a new connection procedure from a clean
  # slate.
  def handle_info({:EXIT, pid, _reason} = message, state) do
    if known_pid?(pid, state) do
      reason =
        if pid == state.replication_client_pid do
          :replication_connection_closed
        else
          :database_connection_closed
        end

      {:stop, reason, state}
    else
      Logger.warning(
        "#{inspect(__MODULE__)} process received #{inspect(message)} for an unknown PID."
      )

      {:noreply, state}
    end
  end

  defp start_replication_client(connection_opts, replication_opts) do
    case do_start_replication_client(connection_opts, replication_opts) do
      {:ok, pid} ->
        {:ok, pid, connection_opts}

      other ->
        other
    end
  end

  defp do_start_replication_client(connection_opts, replication_opts) do
    # Disable the reconnection logic in Postgex.ReplicationConnection to force it to exit with
    # the connection error.
    connection_opts = [auto_reconnect: false] ++ connection_opts

    case Electric.Postgres.ReplicationClient.start_link(connection_opts, replication_opts) do
      {:ok, pid} ->
        {:ok, pid}

      # There is a bug in Postgrex: it returns a tuple `{:stop, <reason>, <state>}` from an
      # `init()` callback where `gen_statem` expects just `{:stop, <reason>}`. This is the origin
      # of the `:bad_return_from_init` error that wraps the root-cause error in the following example:
      #
      #     16:28:07.982 [error] :gen_statem #PID<0.282.0> terminating
      #     ** (stop) {:bad_return_from_init, {:stop, %Postgrex.Error{message: "ssl not available", postgres: nil, connection_id: nil, query: nil}, %Postgrex.ReplicationConnection{}}}
      #         (stdlib 6.0) gen_statem.erl:2748: :gen_statem.init_result/8
      #         (stdlib 6.0) proc_lib.erl:329: :proc_lib.init_p_do_apply/3
      #     Queue: []
      #     Postponed: []
      #     State: {:undefined, :undefined}
      #     Callback mode: :state_functions, state_enter: false
      #
      # You can reproduce the above failure by adding `?sslmode=prefer` or `?sslmode=require`
      # to the `DATABASE_URL` configuration.
      {:error, {:bad_return_from_init, {:stop, reason, _state}}} ->
        {:error, reason}

      other ->
        other
    end
  end

  defp start_connection_pool(connection_opts, pool_opts) do
    # Disable the reconnection logic in DBConnection to force it to exit with the connection
    # error.
    Postgrex.start_link([backoff_type: :stop, max_restarts: 0] ++ pool_opts ++ connection_opts)
  end

  defp handle_connection_error(error, state) do
    message =
      case error do
        %DBConnection.ConnectionError{message: message} ->
          message

        %Postgrex.Error{message: message} when not is_nil(message) ->
          message

        %Postgrex.Error{postgres: %{message: message, pg_code: code, routine: routine}} ->
          message <> " (PG code: #{code}, PG routine: #{routine})"
      end

    Logger.warning("Database connection failed: #{message}")

    step =
      cond do
        is_nil(state.replication_client_pid) -> :start_replication_client
        is_nil(state.pool_pid) -> :start_connection_pool
      end

    state = schedule_reconnection(step, state)
    {:noreply, state}
  end

  defp schedule_reconnection(step, %State{backoff: {backoff, _}} = state) do
    {time, backoff} = :backoff.fail(backoff)
    tref = :erlang.start_timer(time, self(), step)
    Logger.warning("Reconnecting in #{inspect(time)}ms")
    %State{state | backoff: {backoff, tref}}
  end

  defp known_pid?(pid, %{replication_client_pid: pid}), do: true
  defp known_pid?(pid, %{pool_pid: pid}), do: true

  # This is an edge case that's possible when we've starting the reconnection procedure already
  # but still receive an EXIT message from the remaining one of the two processes.
  defp known_pid?(_, %{replication_client_pid: nil, pool_pid: nil}), do: true

  defp known_pid?(_, _), do: false
end
