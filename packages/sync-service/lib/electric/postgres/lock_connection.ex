defmodule Electric.Postgres.LockConnection do
  @moduledoc """
  A Postgres connection that ensures an advisory lock is held for its entire duration,
  useful for ensuring only a single sync service instance can be using a single
  replication slot at any given time.

  The connection attempts to grab the lock and waits on it until it acquires it.
  When it does, it fires off a :lock_connection_acquired message to the specified
  `Electric.ConnectionManager` such that the required setup can acquired now that
  the service is sure to be the only one operating on this replication stream.
  """
  require Logger
  @behaviour Postgrex.SimpleConnection

  @type option ::
          {:connection_opts, Keyword.t()}
          | {:connection_manager, GenServer.server()}
          | {:lock_name, String.t()}

  @type options :: [option]

  defmodule State do
    defstruct [
      :connection_manager,
      :lock_acquired,
      :lock_name,
      :backoff
    ]
  end

  @spec start_link(options()) :: {:ok, pid()} | {:error, Postgrex.Error.t() | term()}
  def start_link(
        connection_opts: connection_opts,
        connection_manager: connection_manager,
        lock_name: lock_name
      ) do
    case Postgrex.SimpleConnection.start_link(
           __MODULE__,
           [connection_manager: connection_manager, lock_name: lock_name],
           connection_opts ++ [timeout: :infinity, auto_reconnect: false]
         ) do
      {:ok, pid} ->
        send(pid, :acquire_lock)
        {:ok, pid}

      {:error, error} ->
        {:error, error}
    end
  end

  @impl true
  def init(opts) do
    {:ok,
     %State{
       connection_manager: Keyword.fetch!(opts, :connection_manager),
       lock_name: Keyword.fetch!(opts, :lock_name),
       lock_acquired: false,
       backoff: {:backoff.init(1000, 10_000), nil}
     }}
  end

  @impl true
  def handle_info(:acquire_lock, state) do
    if state.lock_acquired do
      notify_lock_acquired(state)
      {:noreply, state}
    else
      Logger.info("Acquiring lock from postgres with name #{state.lock_name}")
      {:query, lock_query(state), state}
    end
  end

  def handle_info({:timeout, tref, msg}, %{backoff: {backoff, tref}} = state) do
    handle_info(msg, %{state | backoff: {backoff, nil}})
  end

  @impl true
  def handle_result([%Postgrex.Result{}] = _results, state) do
    Logger.info("Lock acquired from postgres with name #{state.lock_name}")
    notify_lock_acquired(state)
    {:noreply, %{state | lock_acquired: true}}
  end

  @impl true
  def handle_result(%Postgrex.Error{} = error, %State{backoff: {backoff, _}} = state) do
    {time, backoff} = :backoff.fail(backoff)
    tref = :erlang.start_timer(time, self(), :acquire_lock)

    Logger.error(
      "Failed to acquire lock #{state.lock_name} with reason #{inspect(error)} - retrying in #{inspect(time)}ms."
    )

    {:noreply, %{state | lock_acquired: false, backoff: {backoff, tref}}}
  end

  defp notify_lock_acquired(%State{connection_manager: connection_manager} = _state) do
    GenServer.cast(connection_manager, :lock_connection_acquired)
  end

  defp lock_query(%State{lock_name: name} = _state) do
    "SELECT pg_advisory_lock(hashtext('#{name}'))"
  end

  @impl true
  def notify(_channel, _payload, _state) do
    :ok
  end
end
