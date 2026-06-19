defmodule Electric.Postgres.Inspector.EtsInspector do
  @moduledoc """
  This serves as a write-through cache for caching the namespace and tablename as they occur in PG.

  Note that if users create shapes for the same table but spelled differently,
  e.g. `~s|public.users|`, `~s|users|`, `~s|Users|`, and `~s|USERS|`
  then there will be 4 entries in the cache each of which maps to `{~s|public|, ~s|users|}`.
  If they create a shape for a different table `~s|"Users"|`, then there will be another entry
  in ETS for `~s|"Users"|` that maps to `{~s|public|, ~s|"Users"|}`.
  """
  use GenServer

  import Electric, only: :macros
  require Logger

  # Inspector lookups run on the shared metadata pool, which holds at most 4
  # connections (see `Electric.Connection.Manager.pool_sizes/1`). With request
  # coalescing a single in-flight key holds one of those connections for the
  # whole lookup, so a handful of distinct cold-cache keys hitting a degraded
  # Postgres can pin the entire metadata pool — starving the connection
  # manager's own admin queries that share it. Cap each lookup well below
  # Postgrex's inherited 15s default so a slow connection is returned to the
  # pool promptly and the failure gets negative-cached instead of held open.
  # Healthy catalog reads are milliseconds, so 5s is ample headroom; this is
  # deliberately a pool-protection bound, not the caller's request budget (a
  # shape request tolerates its full long-poll timeout, 20-60s).
  @fetch_db_timeout 5_000

  # How long terminal negative results (table-not-found, connection errors) are
  # cached so a burst against a failing key drains the mailbox instead of
  # refilling it at the same rate. Short, because a connection error may clear.
  @default_negative_cache_ttl_ms 1_000

  # How often expired negative-cache entries are physically reclaimed from the
  # table. They are bounded by this interval rather than living forever, even
  # though the negative key space is client-controlled (distinct table names).
  @negative_cache_sweep_interval_ms 60_000

  alias Electric.Postgres.Inspector
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.PersistentKV
  alias Electric.Postgres.Inspector.DirectInspector

  @behaviour Electric.Postgres.Inspector

  ## Public API
  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  @doc """
  Name of the `Task.Supervisor` that runs the inspector's DB-lookup workers.

  Declared as a sibling child of the inspector in `Electric.StackSupervisor`
  rather than started ad-hoc from `init/1`, so the process hierarchy stays
  visible in the supervision tree.
  """
  def task_supervisor_name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__.TaskSupervisor)
  end

  def start_link(opts) do
    {:ok, pid} =
      GenServer.start_link(
        __MODULE__,
        Map.new(opts)
        |> Map.put_new(:pg_inspector_table, inspector_table(opts)),
        name: name(opts)
      )

    {:ok, pid}
  end

  ## Inspector API

  @impl Inspector
  @spec load_relation_oid(Electric.relation(), opts :: term()) ::
          {:ok, Electric.oid_relation()} | :table_not_found | {:error, term()}
  def load_relation_oid(relation, opts) when is_relation(relation) do
    with :not_in_cache <- fetch_normalized_relation_from_ets(relation, opts),
         :not_in_cache <- fetch_negative_cache({:rel, relation}, opts) do
      GenServer.call(opts[:server], {:load, {:rel, relation}, :relation_oid}, :infinity)
    end
  end

  @impl Inspector
  @spec load_relation_info(Electric.relation_id(), opts :: term()) ::
          {:ok, Inspector.relation_info()} | :table_not_found | {:error, term()}
  def load_relation_info(oid, opts) when is_relation_id(oid) do
    with :not_in_cache <- fetch_relation_info_from_ets(oid, opts),
         :not_in_cache <- fetch_negative_cache({:oid, oid}, opts) do
      GenServer.call(opts[:server], {:load, {:oid, oid}, :relation_info}, :infinity)
    end
  end

  @impl Inspector
  @spec load_column_info(Electric.relation_id(), opts :: term()) ::
          {:ok, [Inspector.column_info()]} | :table_not_found | {:error, term()}
  def load_column_info(oid, opts) when is_relation_id(oid) do
    with :not_in_cache <- fetch_column_info_from_ets(oid, opts),
         :not_in_cache <- fetch_negative_cache({:oid, oid}, opts) do
      GenServer.call(opts[:server], {:load, {:oid, oid}, :column_info}, :infinity)
    end
  end

  @impl Inspector
  @spec load_supported_features(opts :: term()) ::
          {:ok, Map.t()} | {:error, String.t() | :connection_not_available}
  def load_supported_features(opts) do
    with :not_in_cache <- fetch_supported_features_from_ets(opts),
         :not_in_cache <- fetch_negative_cache(:supported_features, opts) do
      GenServer.call(opts[:server], {:load, :supported_features, :supported_features}, :infinity)
    end
  end

  @impl Inspector
  @spec clean(Electric.relation_id(), opts :: term()) :: :ok
  def clean(relation_id, opts) when is_relation_id(relation_id) do
    GenServer.call(opts[:server], {:clean, relation_id}, :infinity)
  end

  @impl Inspector
  @spec list_relations_with_stale_cache(opts :: term()) ::
          {:ok, [Electric.relation_id()]} | {:error, term()}
  def list_relations_with_stale_cache(opts) do
    GenServer.call(opts[:server], :list_relations_with_stale_cache, :infinity)
  end

  ## Internal API

  @impl GenServer
  def init(opts) do
    # Trap exits such that `terminate/2` is called
    # when the parent process sends an exit signal
    Process.flag(:trap_exit, true)

    Process.set_label({:ets_inspector, opts.stack_id})
    Logger.metadata(stack_id: opts.stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts.stack_id)

    # Name needs to be an atom but we don't want to dynamically create atoms.
    # Instead, we will use the reference to the table that is returned by `:ets.new`
    pg_inspector_table =
      :ets.new(opts.pg_inspector_table, [
        :named_table,
        :protected,
        :ordered_set,
        read_concurrency: true
      ])

    persistence_key = "#{opts.stack_id}:ets_inspector_state"

    state =
      %{
        stack_id: opts.stack_id,
        pg_inspector_table: pg_inspector_table,
        pg_pool: opts.pool,
        persistent_kv: opts.persistent_kv,
        persistence_key: persistence_key,
        task_sup: task_supervisor_name(opts.stack_id),
        in_flight: %{},
        in_flight_refs: %{},
        negative_cache_ttl_ms:
          Map.get(opts, :negative_cache_ttl_ms, @default_negative_cache_ttl_ms)
      }
      |> restore_persistent_state()

    schedule_negative_cache_sweep()

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:load, key, reader}, from, state) do
    case read_cached(key, reader, state) do
      :not_in_cache -> {:noreply, enqueue_waiter(state, key, {from, reader})}
      response -> {:reply, response, state}
    end
  end

  def handle_call({:clean, oid}, _from, state) do
    {:reply, :ok, delete_relation_info(state, oid)}
  end

  def handle_call(:list_relations_with_stale_cache, _from, state) do
    known_schema = known_schema(state)
    known_schema_oids = known_schema |> Enum.map(& &1.relation_id)

    {:ok, diverged_relations} =
      Postgrex.transaction(
        state.pg_pool,
        fn conn ->
          {:ok, found_relations} =
            DirectInspector.load_relations_by_oids(known_schema_oids, conn)

          found_relation_identities =
            MapSet.new(found_relations, fn %{relation: rel, relation_id: oid} -> {oid, rel} end)

          {present_relations, missing_relations} =
            Enum.split_with(known_schema, fn %{relation_id: oid, relation: rel} ->
              MapSet.member?(found_relation_identities, {oid, rel})
            end)

          found_relations_columns =
            present_relations
            |> Enum.map(& &1.relation_id)
            |> Electric.Postgres.Inspector.DirectInspector.load_column_info_by_oids!(conn)

          diverged_relations =
            present_relations
            |> Enum.filter(fn %{relation_id: oid, columns: known_columns} ->
              found_relations_columns[oid] != known_columns
            end)

          (diverged_relations ++ missing_relations)
          |> Enum.map(fn %{relation: rel, relation_id: oid} -> {oid, rel} end)
        end,
        timeout: 5_000
      )

    {:reply, {:ok, diverged_relations}, state}
  catch
    kind, err ->
      Logger.warning(
        "Could not load diverged relations: #{Exception.format(kind, err, __STACKTRACE__)}"
      )

      {:reply, :error, state}
  end

  @impl GenServer
  def handle_info({ref, result}, state) when is_reference(ref) do
    Process.demonitor(ref, [:flush])

    case pop_in_flight_by_ref(state, ref) do
      {nil, state} ->
        {:noreply, state}

      {{key, entry}, state} ->
        state = apply_fill_result(state, key, result)
        reply_waiters(state, key, result, entry.waiters)
        {:noreply, state}
    end
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    case pop_in_flight_by_ref(state, ref) do
      {nil, state} ->
        {:noreply, state}

      {{key, entry}, state} ->
        Logger.warning(
          "EtsInspector fill worker for #{inspect(key)} exited before replying: #{inspect(reason)}"
        )

        for {from, _reader} <- entry.waiters do
          GenServer.reply(from, {:error, :connection_not_available})
        end

        {:noreply, state}
    end
  end

  def handle_info(:sweep_negative_cache, state) do
    # Negative entries are logically ignored once expired, but the table is
    # `:protected` so only we can physically reclaim them. Without this sweep a
    # client requesting many distinct non-existent tables would grow the table
    # unboundedly. Reschedule unconditionally so the timer keeps running.
    now = System.monotonic_time(:millisecond)

    :ets.select_delete(inspector_table(state), [
      {{{:negative, :_}, :_, :"$1"}, [{:<, :"$1", now}], [true]}
    ])

    schedule_negative_cache_sweep()
    {:noreply, state}
  end

  def handle_info({:EXIT, _, reason}, state) do
    {:stop, reason, state}
  end

  defp schedule_negative_cache_sweep do
    Process.send_after(self(), :sweep_negative_cache, @negative_cache_sweep_interval_ms)
  end

  # Coalesce concurrent loads of the same key: the first waiter spawns one
  # supervised worker to do the DB lookup; later waiters for the same key just
  # park their `from` and are all answered when the worker reports back. This
  # keeps the inspector's mailbox population proportional to unique in-flight
  # keys rather than to in-flight requests, and avoids head-of-line blocking on
  # a single slow lookup. `in_flight_refs` maps the worker's monitor ref back to
  # its key so completion/crash handling is O(1).
  defp enqueue_waiter(state, key, waiter) do
    case Map.fetch(state.in_flight, key) do
      {:ok, entry} ->
        entry = %{entry | waiters: [waiter | entry.waiters]}
        %{state | in_flight: Map.put(state.in_flight, key, entry)}

      :error ->
        %{ref: ref} =
          Task.Supervisor.async_nolink(state.task_sup, fn ->
            fetch_for_key(key, state.pg_pool, state.stack_id)
          end)

        entry = %{waiters: [waiter], ref: ref}

        %{
          state
          | in_flight: Map.put(state.in_flight, key, entry),
            in_flight_refs: Map.put(state.in_flight_refs, ref, key)
        }
    end
  end

  defp pop_in_flight_by_ref(state, ref) do
    case Map.pop(state.in_flight_refs, ref) do
      {nil, _refs} ->
        {nil, state}

      {key, in_flight_refs} ->
        {entry, in_flight} = Map.pop(state.in_flight, key)
        {{key, entry}, %{state | in_flight: in_flight, in_flight_refs: in_flight_refs}}
    end
  end

  # A cache miss runs the DB lookup in a detached worker, so it's outside the
  # request's trace; and one lookup serves every coalesced waiter, so it can't
  # belong to a single request anyway. Record it as a standalone span to expose
  # catalog-query latency and outcome in prod (there is no other signal isolating
  # these queries).
  defp fetch_for_key(key, pool, stack_id) do
    OpenTelemetry.with_span(
      "inspector.fetch_db",
      [{"inspector.key_type", key_type(key)}],
      stack_id,
      fn ->
        result = do_fetch_for_key(key, pool)
        OpenTelemetry.add_span_attributes(%{"inspector.result" => fetch_outcome(result)})
        result
      end
    )
  end

  defp do_fetch_for_key({:rel, rel}, pool), do: fetch_from_db(rel, pool)
  defp do_fetch_for_key({:oid, oid}, pool), do: fetch_from_db(oid, pool)

  defp do_fetch_for_key(:supported_features, pool) do
    wrap_in_db_errors(fn -> DirectInspector.load_supported_features(pool) end)
  end

  defp key_type({:rel, _}), do: "relation"
  defp key_type({:oid, _}), do: "oid"
  defp key_type(:supported_features), do: "supported_features"

  defp fetch_outcome({:ok, :table_not_found}), do: "table_not_found"
  defp fetch_outcome({:ok, _}), do: "ok"
  defp fetch_outcome({:error, _}), do: "error"

  defp apply_fill_result(state, :supported_features, {:ok, features}) do
    state |> store_supported_features(features) |> persist_data()
    state
  end

  defp apply_fill_result(state, _key, {:ok, {rel, cols}}) do
    state |> store_relation_info(rel, cols) |> persist_data()
    state
  end

  # Terminal negative results (table-not-found / DB error) are cached for a short
  # TTL so a burst against a failing key drains the mailbox instead of refilling
  # it; the client reads this cache and short-circuits before messaging us again.
  defp apply_fill_result(state, key, {:ok, :table_not_found}),
    do: put_negative_cache(state, key, :table_not_found)

  defp apply_fill_result(state, key, {:error, reason}),
    do: put_negative_cache(state, key, {:error, reason})

  defp reply_waiters(state, key, result, waiters) do
    for {from, reader} <- waiters do
      GenServer.reply(from, waiter_response(state, key, reader, result))
    end

    :ok
  end

  defp waiter_response(_state, _key, _reader, {:ok, :table_not_found}), do: :table_not_found
  defp waiter_response(_state, _key, _reader, {:error, reason}), do: {:error, reason}
  defp waiter_response(state, key, reader, {:ok, _payload}), do: read_from_ets(key, reader, state)

  defp read_from_ets({:rel, rel}, :relation_oid, state),
    do: fetch_normalized_relation_from_ets(rel, state)

  defp read_from_ets({:oid, oid}, :relation_info, state),
    do: fetch_relation_info_from_ets(oid, state)

  defp read_from_ets({:oid, oid}, :column_info, state),
    do: fetch_column_info_from_ets(oid, state)

  defp read_from_ets(:supported_features, :supported_features, state),
    do: fetch_supported_features_from_ets(state)

  defp read_cached(key, reader, state) do
    case read_from_ets(key, reader, state) do
      :not_in_cache -> fetch_negative_cache(key, state)
      response -> response
    end
  end

  defp fetch_from_db(rel_or_oid, pool)
       when is_relation(rel_or_oid) or is_relation_id(rel_or_oid) do
    wrap_in_db_errors(fn ->
      Postgrex.transaction(
        pool,
        fn conn ->
          loader_fn =
            if is_relation(rel_or_oid),
              do: &DirectInspector.normalize_and_load_relation_info/2,
              else: &DirectInspector.load_relation_info/2

          with {:ok, rel} <- loader_fn.(rel_or_oid, conn),
               {:ok, cols} <- DirectInspector.load_column_info(rel.relation_id, conn) do
            {rel, cols}
          else
            {:error, err} -> Postgrex.rollback(conn, err)
            :table_not_found -> :table_not_found
          end
        end,
        timeout: @fetch_db_timeout
      )
    end)
  end

  @spec wrap_in_db_errors((-> any())) :: {:error, :connection_not_available} | any()
  defp wrap_in_db_errors(func) do
    func.()
  rescue
    e in DBConnection.ConnectionError ->
      cond do
        e.message =~ "connection not available and request was dropped from queue" ->
          {:error, :connection_not_available}

        e.message =~ "the connection was closed by the pool" ->
          {:error, :connection_not_available}

        Electric.DbConnectionError.from_error(e).type != :unknown ->
          {:error, :connection_not_available}

        true ->
          reraise e, __STACKTRACE__
      end
  catch
    :exit, {_, {DBConnection.Holder, :checkout, _}} ->
      {:error, :connection_not_available}
  end

  @spec persist_data(map()) :: :ok
  defp persist_data(state) do
    # Negative-cache entries are transient and their `expires_at` is a monotonic
    # timestamp that is meaningless across restarts, so they are never persisted.
    inspector_data =
      state.pg_inspector_table
      |> :ets.tab2list()
      |> Enum.reject(&match?({{:negative, _}, _, _}, &1))

    PersistentKV.set(state.persistent_kv, state.persistence_key, version: 1, data: inspector_data)
  end

  defp negative_cache_key(key), do: {:negative, key}

  defp put_negative_cache(state, key, result) do
    expires_at = System.monotonic_time(:millisecond) + state.negative_cache_ttl_ms
    :ets.insert(inspector_table(state), {negative_cache_key(key), result, expires_at})
    state
  end

  @spec fetch_negative_cache(term(), opts :: term()) ::
          :table_not_found | {:error, term()} | :not_in_cache
  defp fetch_negative_cache(key, opts) do
    case :ets.lookup(inspector_table(opts), negative_cache_key(key)) do
      [{_key, result, expires_at}] ->
        if System.monotonic_time(:millisecond) < expires_at, do: result, else: :not_in_cache

      [] ->
        :not_in_cache
    end
  rescue
    ArgumentError -> :not_in_cache
  end

  @spec restore_persistent_state(map()) :: map()
  defp restore_persistent_state(state) do
    case PersistentKV.get(state.persistent_kv, state.persistence_key) do
      {:ok, [version: 1, data: data]} ->
        :ets.insert(state.pg_inspector_table, data)
        state

      {:ok, {_info, _relations}} ->
        # This is the old storage format. We had an issue which led to inconsistent state
        # exactly after this storage format was introduced. Because of that, we're dropping
        # this cache (cost here is that customers may need to manually invalidate shapes
        # after a restart if no writes occur for these shapes).
        state

      {:error, :not_found} ->
        state
    end
  end

  ## ETS access

  # ETS structure
  # @typep ets_value_1 :: {{:relation_to_oid, Electric.relation()}, Electric.relation_id()}
  # @typep ets_value_2 ::
  #          {{:oid_info, Electric.relation_id()}, Inspector.relation_info(),
  #           Inspector.column_info()}
  # @typep ets_value_3 :: {:supported_features, supported_features()}
  # @typep ets_value :: ets_value_1 | ets_value_2 | ets_value_3

  @doc false
  def inspector_table(%{pg_inspector_table: ets_table}), do: ets_table

  def inspector_table(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    :"EtsInspector:#{stack_id}"
  end

  defp relation_to_oid_key(rel), do: {:relation_to_oid, rel}
  defp oid_to_info_key(oid), do: {:oid_info, oid}
  @supported_features_key :supported_features

  @spec store_relation_info(map(), Inspector.relation_info(), [Inspector.column_info()]) :: map()
  defp store_relation_info(state, %{relation: rel, relation_id: oid} = info, cols) do
    :ets.insert(inspector_table(state), [
      {relation_to_oid_key(rel), oid},
      {oid_to_info_key(oid), info, cols}
    ])

    state
  end

  @spec store_supported_features(map(), Inspector.supported_features()) :: map()
  defp store_supported_features(state, supported_features) do
    :ets.insert(inspector_table(state), {@supported_features_key, supported_features})
    state
  end

  @spec delete_relation_info(map(), Electric.relation_id()) :: map()
  defp delete_relation_info(state, oid) when is_relation_id(oid) do
    # `clean` is the cache-invalidation primitive the schema reconciler calls when
    # a relation diverges, so it must also drop any cached negative result for the
    # oid — otherwise the next lookup would short-circuit on a stale `:table_not_found`
    # / error for up to the negative-cache TTL. (Only the oid-keyed negative entry is
    # addressable here; a relation-keyed one expires on its own short TTL.)
    :ets.delete(inspector_table(state), negative_cache_key({:oid, oid}))

    case fetch_relation_info_from_ets(oid, state) do
      :not_in_cache ->
        state

      {:ok, %{relation: rel}} ->
        :ets.select_delete(inspector_table(state), [
          {{relation_to_oid_key(rel), :_}, [], [true]},
          {{oid_to_info_key(oid), :_, :_}, [], [true]}
        ])

        state
    end
  end

  @spec fetch_normalized_relation_from_ets(Electric.relation(), opts :: term()) ::
          {:ok, Electric.oid_relation()} | :not_in_cache
  defp fetch_normalized_relation_from_ets(relation, opts) do
    key = relation_to_oid_key(relation)

    case :ets.lookup_element(inspector_table(opts), key, 2, :not_in_cache) do
      :not_in_cache -> :not_in_cache
      oid -> {:ok, {oid, relation}}
    end
  rescue
    ArgumentError -> :not_in_cache
  end

  @spec fetch_relation_info_from_ets(Electric.relation_id(), opts :: term()) ::
          {:ok, Inspector.relation_info()} | :not_in_cache
  defp fetch_relation_info_from_ets(oid, opts) do
    key = oid_to_info_key(oid)

    case :ets.lookup_element(inspector_table(opts), key, 2, :not_in_cache) do
      :not_in_cache -> :not_in_cache
      relation -> {:ok, relation}
    end
  rescue
    ArgumentError -> :not_in_cache
  end

  @spec fetch_column_info_from_ets(Electric.relation_id(), opts :: term()) ::
          {:ok, [Inspector.column_info()]} | :not_in_cache
  defp fetch_column_info_from_ets(oid, opts) do
    key = oid_to_info_key(oid)

    case :ets.lookup_element(inspector_table(opts), key, 3, :not_in_cache) do
      :not_in_cache -> :not_in_cache
      column_list -> {:ok, column_list}
    end
  rescue
    ArgumentError -> :not_in_cache
  end

  @spec fetch_supported_features_from_ets(opts :: term()) ::
          {:ok, Inspector.supported_features()} | :not_in_cache
  defp fetch_supported_features_from_ets(opts) do
    case :ets.lookup_element(inspector_table(opts), @supported_features_key, 2, :not_in_cache) do
      :not_in_cache -> :not_in_cache
      features -> {:ok, features}
    end
  rescue
    ArgumentError -> :not_in_cache
  end

  @spec known_schema(opts :: term()) :: [
          %{
            relation: Electric.relation(),
            relation_id: Electric.relation_id(),
            columns: [Inspector.column_info()]
          }
        ]
  defp known_schema(opts) do
    :ets.match(inspector_table(opts), {oid_to_info_key(:_), :"$1", :"$2"})
    |> Enum.map(fn [%{relation: rel, relation_id: oid}, cols] ->
      %{relation: rel, relation_id: oid, columns: cols}
    end)
  end
end
