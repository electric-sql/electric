defmodule Electric.Postgres.LockBreakerConnection do
  @moduledoc """
  A Postgres connection that is used to break an abandoned lock.

  Electric takes out a session-level advisory lock on a separate connection to better manage the
  ownership of the replication slot. Unfortunately, we have seen instances (especially on Neon),
  where the Electric disconnects, but the lock is not auto-released.

  For these cases, this breaker exists - it'll connect to the database, and check that for
  a given lock name, if that lock is taken, there also exists an active replication slot with the
  same name. If not, it'll terminate the backend that is holding the lock, under the assumption
  that it's one of the abandoned locks.
  """
  require Logger

  import Electric.Utils, only: [quote_string: 1]

  @behaviour Postgrex.SimpleConnection

  @type option ::
          {:connection_opts, Keyword.t()}
          | {:stack_id, String.t()}

  @type options :: [option]

  @spec start(options()) :: {:ok, pid()} | {:error, Postgrex.Error.t() | term()}
  def start(opts) do
    {connection_opts, init_opts} = Keyword.pop(opts, :connection_opts)

    connection_opts = Electric.Utils.deobfuscate_password(connection_opts)

    with {:ok, pid} <-
           Postgrex.SimpleConnection.start_link(
             __MODULE__,
             init_opts |> Keyword.put(:database, connection_opts[:database]),
             [
               auto_reconnect: false,
               sync_connect: true
             ] ++
               connection_opts
           ) do
      # unlink the lock breaker so that if it crashes it does not affect the caller,
      # since it is a one shot fix attempt anyway
      Process.unlink(pid)
      {:ok, pid}
    end
  end

  def stop_backends_and_close(server, lock_name, lock_connection_pg_backend_pid \\ nil) do
    send(server, {:stop_backends_and_close, lock_name, lock_connection_pg_backend_pid})
  end

  @impl true
  def init(opts) do
    opts = Map.new(opts)

    Process.set_label({:lock_breaker_connection, opts.stack_id})

    metadata = [
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
        {:stop_backends_and_close, lock_name, lock_connection_pg_backend_pid},
        state
      ) do
    {:query, lock_breaker_query(lock_name, lock_connection_pg_backend_pid, state.database),
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

  @impl true
  def notify(_, _, _), do: :ok

  defp lock_breaker_query(lock_name, lock_connection_pg_backend_pid, database)
       when is_integer(lock_connection_pg_backend_pid) or is_nil(lock_connection_pg_backend_pid) do
    # We're using a `WITH` clause to execute all this in one statement
    # - See if there are existing but inactive replication slots with the given name
    # - Find all backends that are holding locks with the same name
    # - Terminate those backends
    #
    # It's generally impossible for this to return more than one row

    """
    WITH inactive_slots AS (
        select slot_name
        from pg_replication_slots
        where active = false and database = #{quote_string(database)} and slot_name = #{quote_string(lock_name)}
    ),
    stuck_backends AS (
        select pid
        from pg_locks, inactive_slots
        where
          hashtext(slot_name) = (classid::bigint << 32) | objid::bigint
          and locktype = 'advisory'
          and objsubid = 1
          and database = (select oid from pg_database where datname = #{quote_string(database)})
          and granted
          and pid != #{lock_connection_pg_backend_pid || 0}
    )
    SELECT pg_terminate_backend(pid) FROM stuck_backends;
    """
  end
end
