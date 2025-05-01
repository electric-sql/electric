defmodule Electric.Postgres.LockConnection do
  @moduledoc """
  A Postgres connection that ensures an advisory lock is held for its entire duration,
  useful for ensuring only a single sync service instance can be using a single
  replication slot at any given time.

  The connection attempts to grab the lock and waits on it until it acquires it.
  When it does, it fires off an :exclusive_connection_lock_acquired message to the specified
  `Electric.Connection.Manager` such that the required setup can acquired now that
  the service is sure to be the only one operating on this replication stream.
  """
  alias Electric.Connection

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
      :backoff,
      :stack_id
    ]
  end

  @spec start_link(options()) :: {:ok, pid()} | {:error, Postgrex.Error.t() | term()}
  def start_link(opts) do
    {connection_opts, init_opts} = Keyword.pop(opts, :connection_opts)

    Postgrex.SimpleConnection.start_link(
      __MODULE__,
      init_opts,
      [timeout: :infinity, auto_reconnect: false, sync_connect: false] ++
        Electric.Utils.deobfuscate_password(connection_opts)
    )
  end

  @impl true
  def init(opts) do
    opts = Map.new(opts)

    Process.set_label({:lock_connection, opts.stack_id})

    metadata = [
      lock_name: opts.lock_name,
      stack_id: opts.stack_id
    ]

    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    state = %State{
      connection_manager: opts.connection_manager,
      lock_name: opts.lock_name,
      lock_acquired: false,
      backoff: {:backoff.init(1000, 10_000), nil}
    }

    {:ok, state}
  end

  @impl true
  def handle_connect(state) do
    notify_connection_opened(state)
    send(self(), :acquire_lock)
    {:noreply, state}
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
  def handle_result([%Postgrex.Result{columns: ["pg_advisory_lock"]}], state) do
    Logger.info("Lock acquired from postgres with name #{state.lock_name}")
    notify_lock_acquired(state)
    {:noreply, %{state | lock_acquired: true}}
  end

  def handle_result(%Postgrex.Error{} = error, %State{backoff: {backoff, _}} = state) do
    {time, backoff} = :backoff.fail(backoff)
    tref = :erlang.start_timer(time, self(), :acquire_lock)

    Logger.error(
      "Failed to acquire lock #{state.lock_name} with reason #{inspect(error)} - retrying in #{inspect(time)}ms."
    )

    notify_lock_acquisition_error(error, state)

    {:noreply, %{state | lock_acquired: false, backoff: {backoff, tref}}}
  end

  defp notify_connection_opened(%State{connection_manager: manager}) do
    Connection.Manager.lock_connection_started(manager)
  end

  defp notify_lock_acquisition_error(error, %State{connection_manager: manager}) do
    Connection.Manager.exclusive_connection_lock_acquisition_failed(manager, error)
  end

  defp notify_lock_acquired(%State{connection_manager: manager}) do
    Connection.Manager.exclusive_connection_lock_acquired(manager)
  end

  defp lock_query(%State{lock_name: name} = _state) do
    "SELECT pg_advisory_lock(hashtext('#{name}'))"
  end

  @impl true
  def notify(_channel, _payload, _state) do
    :ok
  end
end
