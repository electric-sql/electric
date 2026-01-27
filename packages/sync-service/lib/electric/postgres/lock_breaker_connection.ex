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

  @doc """
  Attempts to terminate backends holding the advisory lock for the given lock name.

  By default, only terminates backends if the replication slot is inactive (safe mode).
  When `force: true` is passed, will terminate any backend holding the lock that has
  been connected for more than 30 seconds, regardless of slot status. This is useful
  during rolling deployments where the old instance may have died but the lock wasn't
  released properly.
  """
  def stop_backends_and_close(server, lock_name, lock_connection_pg_backend_pid \\ nil, opts \\ []) do
    force = Keyword.get(opts, :force, false)
    send(server, {:stop_backends_and_close, lock_name, lock_connection_pg_backend_pid, force})
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
        {:stop_backends_and_close, lock_name, lock_connection_pg_backend_pid, force},
        state
      ) do
    query = lock_breaker_query(lock_name, lock_connection_pg_backend_pid, state.database, force)
    {:query, query, state |> Map.put(:lock_name, lock_name) |> Map.put(:force, force)}
  end

  @impl true
  def handle_result([%Postgrex.Result{columns: ["pg_terminate_backend"]} = result], state) do
    if result.num_rows == 0 do
      Logger.debug("No stuck backends found")
    else
      reason =
        if state[:force],
          do: "lock was held for too long (force mode)",
          else: "slot with same name was inactive"

      Logger.notice(
        "Terminated a stuck backend to free the lock #{state.lock_name} because #{reason}"
      )
    end

    exit(:shutdown)
  end

  def handle_result(%Postgrex.Error{} = error, _) do
    raise error
  end

  @impl true
  def notify(_, _, _), do: :ok

  # Minimum time a backend must have been connected before we consider force-breaking its lock.
  # This prevents accidentally breaking a lock from a freshly started Electric instance.
  @force_break_min_backend_age_seconds 30

  defp lock_breaker_query(lock_name, lock_connection_pg_backend_pid, database, force)
       when is_integer(lock_connection_pg_backend_pid) or is_nil(lock_connection_pg_backend_pid) do
    if force do
      lock_breaker_query_force(lock_name, lock_connection_pg_backend_pid, database)
    else
      lock_breaker_query_safe(lock_name, lock_connection_pg_backend_pid, database)
    end
  end

  # Safe mode: only terminate backends if the replication slot is inactive.
  # This is the original behavior.
  defp lock_breaker_query_safe(lock_name, lock_connection_pg_backend_pid, database) do
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

  # Force mode: terminate any backend holding the lock that has been connected
  # for more than @force_break_min_backend_age_seconds, regardless of slot status.
  # This is useful during rolling deployments where the old instance may have died
  # but the lock wasn't released properly (common on platforms like Neon).
  defp lock_breaker_query_force(lock_name, lock_connection_pg_backend_pid, database) do
    """
    WITH stuck_backends AS (
        select l.pid
        from pg_locks l
        join pg_stat_activity a on l.pid = a.pid
        where
          hashtext(#{quote_string(lock_name)}) = (l.classid::bigint << 32) | l.objid::bigint
          and l.locktype = 'advisory'
          and l.objsubid = 1
          and l.database = (select oid from pg_database where datname = #{quote_string(database)})
          and l.granted
          and l.pid != #{lock_connection_pg_backend_pid || 0}
          -- Only break locks held by backends that have been connected for a while.
          -- This prevents accidentally breaking a lock from a freshly started instance.
          and a.backend_start < now() - interval '#{@force_break_min_backend_age_seconds} seconds'
    )
    SELECT pg_terminate_backend(pid) FROM stuck_backends;
    """
  end
end
