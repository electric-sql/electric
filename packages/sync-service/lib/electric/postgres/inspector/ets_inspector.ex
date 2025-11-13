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

  alias Electric.Postgres.Inspector
  alias Electric.PersistentKV
  alias Electric.Postgres.Inspector.DirectInspector

  @behaviour Electric.Postgres.Inspector

  ## Public API
  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
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
    with :not_in_cache <- fetch_normalized_relation_from_ets(relation, opts) do
      GenServer.call(opts[:server], {:load_relation_oid, relation}, :infinity)
    end
  end

  @impl Inspector
  @spec load_relation_info(Electric.relation_id(), opts :: term()) ::
          {:ok, Inspector.relation_info()} | :table_not_found | {:error, term()}
  def load_relation_info(oid, opts) when is_relation_id(oid) do
    with :not_in_cache <- fetch_relation_info_from_ets(oid, opts) do
      GenServer.call(opts[:server], {:load_relation_info, oid}, :infinity)
    end
  end

  @impl Inspector
  @spec load_column_info(Electric.relation_id(), opts :: term()) ::
          {:ok, [Inspector.column_info()]} | :table_not_found | {:error, term()}
  def load_column_info(oid, opts) when is_relation_id(oid) do
    with :not_in_cache <- fetch_column_info_from_ets(oid, opts) do
      GenServer.call(opts[:server], {:load_column_info, oid}, :infinity)
    end
  end

  @impl Inspector
  @spec load_supported_features(opts :: term()) ::
          {:ok, Map.t()} | {:error, String.t() | :connection_not_available}
  def load_supported_features(opts) do
    GenServer.call(opts[:server], :load_supported_features, :infinity)
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
      :ets.new(opts.pg_inspector_table, [:named_table, :protected, :ordered_set])

    persistence_key = "#{opts.stack_id}:ets_inspector_state"

    state =
      %{
        pg_inspector_table: pg_inspector_table,
        pg_pool: opts.pool,
        persistent_kv: opts.persistent_kv,
        persistence_key: persistence_key
      }
      |> restore_persistent_state()

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:load_relation_oid, rel}, _from, state) do
    response =
      with :not_in_cache <- fetch_normalized_relation_from_ets(rel, state),
           :ok <- fill_cache(rel, state) do
        fetch_normalized_relation_from_ets(rel, state)
      end

    {:reply, response, state}
  end

  def handle_call({:load_relation_info, oid}, _from, state) do
    response =
      with :not_in_cache <- fetch_relation_info_from_ets(oid, state),
           :ok <- fill_cache(oid, state) do
        fetch_relation_info_from_ets(oid, state)
      end

    {:reply, response, state}
  end

  def handle_call({:load_column_info, oid}, _from, state) do
    response =
      with :not_in_cache <- fetch_column_info_from_ets(oid, state),
           :ok <- fill_cache(oid, state) do
        fetch_column_info_from_ets(oid, state)
      end

    {:reply, response, state}
  end

  def handle_call(:load_supported_features, _from, state) do
    response =
      with :not_in_cache <- fetch_supported_features_from_ets(state),
           {:ok, features} <-
             wrap_in_db_errors(fn -> DirectInspector.load_supported_features(state.pg_pool) end) do
        store_supported_features(state, features)
        {:ok, features}
      end

    {:reply, response, state}
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
  def handle_info({:EXIT, _, reason}, state) do
    {:stop, reason, state}
  end

  defp fill_cache(rel_or_oid, state) when is_relation(rel_or_oid) or is_relation_id(rel_or_oid) do
    case fetch_from_db(rel_or_oid, state) do
      {:ok, {rel, cols}} ->
        state
        |> store_relation_info(rel, cols)
        |> persist_data()

      {:ok, :table_not_found} ->
        :table_not_found

      {:error, err} ->
        {:error, err}
    end
  end

  defp fetch_from_db(rel_or_oid, state)
       when is_relation(rel_or_oid) or is_relation_id(rel_or_oid) do
    wrap_in_db_errors(fn ->
      Postgrex.transaction(state.pg_pool, fn conn ->
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
      end)
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
    inspector_data = :ets.tab2list(state.pg_inspector_table)
    PersistentKV.set(state.persistent_kv, state.persistence_key, version: 1, data: inspector_data)
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
