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

  @default_timeout 30_000

  defmodule State do
    defstruct [
      :connection_manager,
      :lock_acquired,
      :lock_name,
      :backoff,
      :stack_id
    ]
  end

  def child_spec(opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [opts]},
      type: :worker,
      restart: :temporary
    }
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @spec start_link(options()) :: {:ok, pid()} | {:error, Postgrex.Error.t() | term()}
  def start_link(opts) do
    {connection_opts, init_opts} = Keyword.pop(opts, :connection_opts)

    # Start the lock connection in logical replication mode to side-step any connection pooler
    # that may be sitting between us and the Postgres server.
    #
    # We cannot get desired semantics of session-level advisory locks when connecting to
    # Postgres through a pooler that runs in transaction mode (such as PGBouncer running in
    # front of Neon). Starting a connection in replication mode ensures that it will be a
    # direct connection to the database, so it can take a session-level advisory lock whose
    # lifetime will be tied to the connection's lifetime.
    connection_opts =
      connection_opts
      |> Electric.Utils.deobfuscate_password()
      |> connection_opts_with_logical_replication()

    stack_id = Keyword.fetch!(opts, :stack_id)

    Postgrex.SimpleConnection.start_link(
      __MODULE__,
      init_opts,
      [
        timeout: Access.get(opts, :timeout, @default_timeout),
        auto_reconnect: false,
        sync_connect: false,
        name: name(stack_id)
      ] ++
        connection_opts
    )
  end

  @impl true
  def init(opts) do
    opts = Map.new(opts)

    Process.set_label({:lock_connection, opts.stack_id})

    metadata = [
      lock_name: opts.lock_name,
      # flag used for error filtering
      is_connection_process?: true,
      stack_id: opts.stack_id
    ]

    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    Logger.debug("Opening lock connection")

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

    # Verify that the connection has been opened in replication mode.
    #
    # If there's a pooler running in front of the Postgres server, it may have simply ignored
    # the replication=database connection parameter, defeating the purpose of us requesting the
    # replication mode in the first place which is to get the desired session-level locking
    # semantics.
    #
    # Issuing a statement that would cause a syntax error on a regular connection is a surefire
    # way to ensure the connection is running in the correct mode.
    send(self(), :identify_system)

    {:noreply, state}
  end

  @impl true
  def handle_info(:identify_system, state) do
    {:query, "IDENTIFY_SYSTEM", state}
  end

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
  def handle_result([%Postgrex.Result{command: :identify} = result], state) do
    # [db] postgres:postgres=> IDENTIFY_SYSTEM;
    #       systemid       │ timeline │  xlogpos  │  dbname
    # ─────────────────────┼──────────┼───────────┼──────────
    #  7506979529870965272 │        1 │ 0/220AE10 │ postgres
    # (1 row)
    [[systemid, timeline, xlogpos, _dbname]] = result.rows

    notify_system_identified(state, %{
      system_identifier: systemid,
      timeline_id: timeline,
      current_wal_flush_lsn: xlogpos
    })

    {:query, "SELECT pg_backend_pid()", state}
  end

  def handle_result(%Postgrex.Error{postgres: %{code: :syntax_error}} = error, _state) do
    # Postgrex.SimpleConnection does not support {:stop, ...} or {:shutdown, ...} return values
    # from callback functions, so we raise here and let the connection manager handle the error.
    raise error
  end

  def handle_result([%Postgrex.Result{columns: ["pg_backend_pid"], rows: [[pid]]}], state) do
    notify_backend_pid_obtained(state, pid)

    # Now proceed to the actual lock acquisition.
    send(self(), :acquire_lock)

    {:noreply, state}
  end

  def handle_result([%Postgrex.Result{columns: ["pg_advisory_lock"]}], state) do
    Logger.info("Lock acquired from postgres with name #{state.lock_name}")
    notify_lock_acquired(state)
    {:noreply, %{state | lock_acquired: true}}
  end

  def handle_result(%Postgrex.Error{} = error, %State{backoff: {backoff, _}} = state) do
    {time, backoff} = :backoff.fail(backoff)
    tref = :erlang.start_timer(time, self(), :acquire_lock)

    if not is_expected_error?(error),
      do:
        Logger.error(
          "Failed to acquire lock #{state.lock_name} with reason #{inspect(error)} - retrying in #{inspect(time)}ms."
        )

    notify_lock_acquisition_error(error, state)

    {:noreply, %{state | lock_acquired: false, backoff: {backoff, tref}}}
  end

  defp notify_connection_opened(%State{connection_manager: manager}) do
    Connection.Manager.lock_connection_started(manager)
  end

  defp notify_system_identified(%State{connection_manager: manager}, info) do
    Connection.Manager.pg_system_identified(manager, info)
  end

  defp notify_lock_acquisition_error(error, %State{connection_manager: manager}) do
    Connection.Manager.exclusive_connection_lock_acquisition_failed(manager, error)
  end

  defp notify_lock_acquired(%State{connection_manager: manager}) do
    Connection.Manager.exclusive_connection_lock_acquired(manager)
  end

  defp notify_backend_pid_obtained(%State{connection_manager: manager}, pid) do
    Connection.Manager.lock_connection_pid_obtained(manager, pid)
  end

  defp lock_query(%State{lock_name: name} = _state) do
    "SELECT pg_advisory_lock(hashtext('#{name}'))"
  end

  @impl true
  def notify(_channel, _payload, _state) do
    :ok
  end

  defp is_expected_error?(%Postgrex.Error{
         postgres: %{
           code: :query_canceled,
           pg_code: "57014",
           message: "canceling statement due to statement timeout"
         }
       }),
       do: true

  defp is_expected_error?(_), do: false

  defp connection_opts_with_logical_replication(connection_opts) do
    update_in(
      connection_opts,
      [:parameters],
      fn params -> params |> List.wrap() |> Keyword.put(:replication, "database") end
    )
  end
end
