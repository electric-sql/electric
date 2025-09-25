defmodule Electric.Postgres.LockBreakerConnection do
  @moduledoc """
  A Postgres connection that is used to break an abandoned lock.
  """
  alias Electric.Connection

  require Logger

  @behaviour Postgrex.SimpleConnection

  @type option ::
          {:connection_opts, Keyword.t()}
          | {:stack_id, String.t()}

  @type options :: [option]

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @spec start_link(options()) :: {:ok, pid()} | {:error, Postgrex.Error.t() | term()}
  def start_link(opts) do
    {connection_opts, init_opts} = Keyword.pop(opts, :connection_opts)

    connection_opts = Electric.Utils.deobfuscate_password(connection_opts)

    stack_id = Keyword.fetch!(opts, :stack_id)

    Postgrex.SimpleConnection.start_link(
      __MODULE__,
      init_opts |> Keyword.put(:database, connection_opts[:database]),
      [
        auto_reconnect: false,
        sync_connect: true,
        name: name(stack_id)
      ] ++
        connection_opts
    )
  end

  def stop_backends_and_close(server, lock_name, lock_connection_backend_pid \\ nil) do
    send(server, {:stop_backends_and_close, lock_name, lock_connection_backend_pid})
  end

  @impl true
  def init(opts) do
    opts = Map.new(opts)

    Process.set_label({:lock_breaker_connection, opts.stack_id})

    metadata = [
      # flag used for error filtering
      is_connection_process?: true,
      stack_id: opts.stack_id
    ]

    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    {:ok, opts}
  end

  @impl true
  def handle_connect(state) do
    {:noreply, state}
  end

  @impl true
  def handle_info(
        {:stop_backends_and_close, lock_name, lock_connection_backend_pid},
        state
      ) do
    {:query, lock_breaker_query(lock_name, lock_connection_backend_pid, state.database),
     Map.put(state, :lock_name, lock_name)}
  end

  @impl true
  def handle_result([%Postgrex.Result{columns: ["pg_terminate_backend"]} = result], state) do
    if result.num_rows == 0 do
      Logger.debug("No stuck backends found")
    else
      Logger.notice(
        "Terminated a stuck backend to free the lock #{state.lock_name} because slot with same name was inactive"
      )
    end

    exit(:shutdown)
  end

  def handle_result(%Postgrex.Error{} = error, _) do
    raise error
  end

  defp lock_breaker_query(lock_name, lock_connection_backend_pid, database) do
    """
    WITH inactive_slots AS (
        select slot_name
        from pg_replication_slots
        where active = false and database = '#{database}' and slot_name = '#{lock_name}'
    ),
    stuck_backends AS (
        select pid
        from pg_locks, inactive_slots
        where
          hashtext(slot_name) = (classid::bigint << 32) | objid::bigint
          and locktype = 'advisory'
          and objsubid = 1
          and database = (select oid from pg_database where datname = '#{database}')
          and granted
          and pid != #{lock_connection_backend_pid || 0}
    )
    SELECT pg_terminate_backend(pid) FROM stuck_backends;
    """
  end
end
