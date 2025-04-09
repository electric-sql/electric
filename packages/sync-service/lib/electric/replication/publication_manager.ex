defmodule Electric.Replication.PublicationManager do
  @moduledoc false
  require Logger
  use GenServer

  alias Electric.Postgres.Configuration
  alias Electric.Replication.Eval.Expr
  alias Electric.Shapes.Shape

  @callback name(binary() | Keyword.t()) :: atom()
  @callback recover_shape(Shape.t(), Keyword.t()) :: :ok
  @callback add_shape(Shape.t(), Keyword.t()) :: :ok
  @callback remove_shape(Shape.t(), Keyword.t()) :: :ok
  @callback refresh_publication(Keyword.t()) :: :ok

  defstruct [
    :relation_filter_counters,
    :prepared_relation_filters,
    :committed_relation_filters,
    :row_filtering_enabled,
    :update_debounce_timeout,
    :scheduled_updated_ref,
    :retries,
    :waiters,
    :publication_name,
    :db_pool,
    :pg_version,
    :configure_tables_for_replication_fn,
    :shape_cache,
    next_update_forced?: false
  ]

  @typep oid_rel() :: {non_neg_integer(), Electric.relation()}

  @typep state() :: %__MODULE__{
           relation_filter_counters: %{oid_rel() => map()},
           prepared_relation_filters: %{oid_rel() => __MODULE__.RelationFilter.t()},
           committed_relation_filters: %{oid_rel() => __MODULE__.RelationFilter.t()},
           row_filtering_enabled: boolean(),
           update_debounce_timeout: timeout(),
           scheduled_updated_ref: nil | reference(),
           waiters: list(GenServer.from()),
           publication_name: String.t(),
           db_pool: term(),
           pg_version: non_neg_integer(),
           configure_tables_for_replication_fn: fun(),
           shape_cache: {module(), term()},
           next_update_forced?: boolean()
         }
  @typep filter_operation :: :add | :remove

  defmodule RelationFilter do
    defstruct [:relation, :where_clauses, :selected_columns]

    def relation_only(%__MODULE__{relation: relation} = _filter),
      do: %__MODULE__{relation: relation}

    @type t :: %__MODULE__{
            relation: Electric.relation(),
            where_clauses: [Electric.Replication.Eval.Expr.t()] | nil,
            selected_columns: [String.t()] | nil
          }
  end

  @retry_timeout 300
  @max_retries 3

  # The default debounce timeout is 0, which means that the publication update
  # will be scheduled immediately to run at the end of the current process
  # mailbox, but we are leaving this configurable in case we want larger
  # windows to aggregate shape filter updates
  @default_debounce_timeout 0

  @relation_counter :relation_counter
  @relation_where :relation_where
  @relation_column :relation_column

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  @schema NimbleOptions.new!(
            name: [type: @genserver_name_schema, required: false],
            stack_id: [type: :string, required: true],
            publication_name: [type: :string, required: true],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}],
            shape_cache: [type: :mod_arg, required: false],
            pg_version: [type: {:or, [:integer, :atom]}, required: false, default: nil],
            update_debounce_timeout: [type: :timeout, default: @default_debounce_timeout],
            configure_tables_for_replication_fn: [
              type: {:fun, 5},
              required: false,
              default: &Configuration.configure_publication!/5
            ],
            server: [type: :any, required: false]
          )

  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    name(stack_id)
  end

  @spec add_shape(Shape.t(), Keyword.t()) :: :ok
  def add_shape(shape, opts \\ []) do
    server = Access.get(opts, :server, name(opts))

    case GenServer.call(server, {:add_shape, shape}) do
      :ok -> :ok
      {:error, err} -> raise err
    end
  end

  @spec recover_shape(Shape.t(), Keyword.t()) :: :ok
  def recover_shape(shape, opts \\ []) do
    server = Access.get(opts, :server, name(opts))
    GenServer.call(server, {:recover_shape, shape})
  end

  @spec remove_shape(Shape.t(), Keyword.t()) :: :ok
  def remove_shape(shape, opts \\ []) do
    server = Access.get(opts, :server, name(opts))

    case GenServer.call(server, {:remove_shape, shape}) do
      :ok -> :ok
      {:error, err} -> raise err
    end
  end

  @spec refresh_publication(Keyword.t()) :: :ok
  def refresh_publication(opts \\ []) do
    server = Access.get(opts, :server, name(opts))
    timeout = Access.get(opts, :timeout, 10_000)

    case GenServer.call(
           server,
           {:refresh_publication, Access.get(opts, :forced?, false)},
           timeout
         ) do
      :ok -> :ok
      {:error, err} -> raise err
    end
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      stack_id = Keyword.fetch!(opts, :stack_id)

      name = Keyword.get(opts, :name, name(stack_id))
      db_pool = Keyword.get(opts, :db_pool, Electric.Connection.Manager.pool_name(stack_id))

      GenServer.start_link(__MODULE__, [name: name, db_pool: db_pool] ++ opts, name: name)
    end
  end

  # --- Private API ---

  @impl true
  def init(opts) do
    opts = Map.new(opts)

    Logger.metadata(stack_id: opts.stack_id)
    Process.set_label({:publication_manager, opts.stack_id})

    state = %__MODULE__{
      relation_filter_counters: %{},
      prepared_relation_filters: %{},
      committed_relation_filters: %{},
      row_filtering_enabled: true,
      scheduled_updated_ref: nil,
      retries: 0,
      waiters: [],
      update_debounce_timeout: Map.get(opts, :update_debounce_timeout, @default_debounce_timeout),
      publication_name: opts.publication_name,
      db_pool: opts.db_pool,
      pg_version: opts.pg_version,
      shape_cache: Map.get(opts, :shape_cache, {Electric.ShapeCache, [stack_id: opts.stack_id]}),
      configure_tables_for_replication_fn: opts.configure_tables_for_replication_fn
    }

    {:ok, state, {:continue, :get_pg_version}}
  end

  @impl true
  def handle_continue(:get_pg_version, state) do
    state = get_pg_version(state)
    {:noreply, state}
  end

  @impl true
  def handle_call({:add_shape, shape}, from, state) do
    state = update_relation_filters_for_shape(shape, :add, state)
    state = add_waiter(from, state)
    state = schedule_update_publication(state.update_debounce_timeout, state)
    {:noreply, state}
  end

  def handle_call({:remove_shape, shape}, from, state) do
    state = update_relation_filters_for_shape(shape, :remove, state)
    state = add_waiter(from, state)
    state = schedule_update_publication(state.update_debounce_timeout, state)
    {:noreply, state}
  end

  def handle_call({:refresh_publication, forced?}, from, state) do
    state = add_waiter(from, state)
    state = schedule_update_publication(state.update_debounce_timeout, forced?, state)
    {:noreply, state}
  end

  def handle_call({:recover_shape, shape}, _from, state) do
    state = update_relation_filters_for_shape(shape, :add, state)
    {:reply, :ok, state}
  end

  defguardp is_fatal(err)
            when is_exception(err, Postgrex.Error) and
                   err.postgres.code in ~w|undefined_function undefined_table|a

  @impl true
  def handle_info(
        :update_publication,
        %__MODULE__{prepared_relation_filters: relation_filters, retries: retries} = state
      ) do
    state = %{state | scheduled_updated_ref: nil, retries: 0}

    case update_publication(state) do
      {:ok, state, missing_relations} ->
        if missing_relations != [] do
          Logger.info(
            "Relations dropped/renamed since last publication update: #{inspect(missing_relations)}"
          )

          {mod, args} = state.shape_cache
          mod.clean_all_shapes_for_relations(missing_relations, args)
        end

        state = reply_to_waiters(:ok, state)
        committed_filters = Map.drop(relation_filters, missing_relations)

        {:noreply,
         %{
           state
           | committed_relation_filters: committed_filters,
             next_update_forced?: false,
             prepared_relation_filters: relation_filters
         }}

      {:error, err} when retries < @max_retries and not is_fatal(err) ->
        Logger.warning("Failed to configure publication, retrying: #{inspect(err)}")
        state = schedule_update_publication(@retry_timeout, %{state | retries: retries + 1})
        {:noreply, state}

      {:error, err} ->
        Logger.error("Failed to configure publication: #{inspect(err)}")
        state = reply_to_waiters({:error, err}, state)
        {:noreply, %{state | next_update_forced?: false}}
    end
  end

  @spec schedule_update_publication(timeout(), boolean(), state()) :: state()
  defp schedule_update_publication(timeout, forced? \\ false, state)

  defp schedule_update_publication(
         timeout,
         forced?,
         %__MODULE__{scheduled_updated_ref: nil} = state
       ) do
    ref = Process.send_after(self(), :update_publication, timeout)
    %{state | scheduled_updated_ref: ref, next_update_forced?: forced?}
  end

  defp schedule_update_publication(
         _timeout,
         forced?,
         %__MODULE__{scheduled_updated_ref: _} = state
       ),
       do: %{state | next_update_forced?: forced? or state.next_update_forced?}

  @spec update_publication(state()) ::
          {:ok, state(), [Electric.oid_relation()]} | {:error, term()}
  defp update_publication(
         %__MODULE__{
           committed_relation_filters: committed_filters,
           prepared_relation_filters: current_filters,
           next_update_forced?: forced?
         } = state
       )
       when current_filters == committed_filters and not forced?,
       do: {:ok, state, []}

  defp update_publication(
         %__MODULE__{
           committed_relation_filters: committed_filters,
           prepared_relation_filters: current_filters,
           row_filtering_enabled: false,
           publication_name: publication_name,
           db_pool: db_pool,
           pg_version: pg_version,
           configure_tables_for_replication_fn: configure_tables_for_replication_fn,
           next_update_forced?: forced?
         } = state
       ) do
    # If row filtering is disabled, we only care about changes in actual relations
    # included in the publication
    if not forced? and Map.keys(current_filters) == Map.keys(committed_filters) do
      {:ok, state, []}
    else
      try do
        missing_relations =
          configure_tables_for_replication_fn.(
            db_pool,
            Map.keys(committed_filters),
            Map.new(current_filters, fn {rel, filter} ->
              {rel, RelationFilter.relation_only(filter)}
            end),
            pg_version,
            publication_name
          )

        {:ok, state, missing_relations}
      rescue
        err -> {:error, err}
      end
    end
  end

  defp update_publication(
         %__MODULE__{
           committed_relation_filters: committed_filters,
           prepared_relation_filters: relation_filters,
           row_filtering_enabled: true,
           publication_name: publication_name,
           db_pool: db_pool,
           pg_version: pg_version,
           configure_tables_for_replication_fn: configure_tables_for_replication_fn
         } = state
       ) do
    missing_relations =
      configure_tables_for_replication_fn.(
        db_pool,
        Map.keys(committed_filters),
        relation_filters,
        pg_version,
        publication_name
      )

    {:ok, state, missing_relations}
  rescue
    # if we are unable to do row filtering for whatever reason, fall back to doing only
    # relation-based filtering - this is a fallback for unsupported where clauses that we
    # do not detect when composing relation filters
    err ->
      case err do
        %Postgrex.Error{postgres: %{code: :feature_not_supported}} ->
          Logger.warning(
            "Row filtering is not supported, falling back to relation-based filtering"
          )

          update_publication(%__MODULE__{
            state
            | # disable row filtering and reset committed filters
              row_filtering_enabled: false,
              committed_relation_filters: %{}
          })

        _ ->
          {:error, err}
      end
  end

  defp get_pg_version(%{pg_version: pg_version} = state) when not is_nil(pg_version), do: state

  defp get_pg_version(%{pg_version: nil, db_pool: db_pool} = state) do
    case Configuration.get_pg_version(db_pool) do
      {:ok, pg_version} ->
        %{state | pg_version: pg_version}

      {:error, err} ->
        err_msg = "Failed to get PG version, retrying after timeout: #{inspect(err)}"

        if %DBConnection.ConnectionError{reason: :queue_timeout} == err,
          do: Logger.warning(err_msg),
          else: Logger.error(err_msg)

        Process.sleep(@retry_timeout)
        get_pg_version(state)
    end
  end

  @spec update_relation_filters_for_shape(Shape.t(), filter_operation(), state()) :: state()
  defp update_relation_filters_for_shape(
         %Shape{root_table: relation, root_table_id: oid} = shape,
         operation,
         %__MODULE__{prepared_relation_filters: prepared_relation_filters} = state
       ) do
    state = update_relation_filter_counters(shape, operation, state)
    new_relation_filter = get_relation_filter({oid, relation}, state)

    new_relation_filters =
      if new_relation_filter == nil,
        do: Map.delete(prepared_relation_filters, {oid, relation}),
        else: Map.put(prepared_relation_filters, {oid, relation}, new_relation_filter)

    %{state | prepared_relation_filters: new_relation_filters}
  end

  @spec get_relation_filter(Electric.relation(), state()) :: RelationFilter.t() | nil
  defp get_relation_filter(
         {_oid, relation} = oid_rel,
         %__MODULE__{relation_filter_counters: relation_filter_counters} = _state
       ) do
    case Map.get(relation_filter_counters, oid_rel) do
      nil ->
        nil

      filter_counters ->
        Enum.reduce(
          Map.keys(filter_counters),
          %RelationFilter{relation: relation, where_clauses: [], selected_columns: []},
          fn
            @relation_counter, acc ->
              acc

            {@relation_column, nil}, acc ->
              %RelationFilter{acc | selected_columns: nil}

            {@relation_column, _col}, %{selected_columns: nil} = acc ->
              acc

            {@relation_column, col}, %{selected_columns: cols} = acc ->
              %RelationFilter{acc | selected_columns: [col | cols]}

            {@relation_where, nil}, acc ->
              %RelationFilter{acc | where_clauses: nil}

            {@relation_where, _where}, %{where_clauses: nil} = acc ->
              acc

            {@relation_where, where}, %{where_clauses: wheres} = acc ->
              %RelationFilter{acc | where_clauses: [where | wheres]}
          end
        )
    end
  end

  @spec update_relation_filter_counters(Shape.t(), filter_operation(), state()) :: state()
  defp update_relation_filter_counters(
         %Shape{root_table: table, root_table_id: oid} = shape,
         operation,
         %__MODULE__{relation_filter_counters: relation_filter_counters} = state
       ) do
    oid_rel_key = {oid, table}

    increment = if operation == :add, do: 1, else: -1
    filter_counters = Map.get(relation_filter_counters, oid_rel_key, %{})

    {relation_ctr, filter_counters} =
      update_map_counter(filter_counters, @relation_counter, increment)

    if relation_ctr > 0 do
      filter_counters =
        Enum.concat(
          get_selected_columns_for_shape(shape) |> Enum.map(&{@relation_column, &1}),
          get_where_clauses_for_shape(shape) |> Enum.map(&{@relation_where, &1})
        )
        |> Enum.reduce(filter_counters, fn col, filter ->
          {_, filter} = update_map_counter(filter, col, increment)
          filter
        end)

      %{
        state
        | relation_filter_counters:
            Map.put(relation_filter_counters, oid_rel_key, filter_counters)
      }
    else
      %{state | relation_filter_counters: Map.delete(relation_filter_counters, oid_rel_key)}
    end
  end

  @spec update_map_counter(map(), any(), integer()) :: {any(), map()}
  defp update_map_counter(map, key, inc) do
    Map.get_and_update(map, key, fn
      nil when inc < 0 -> {nil, nil}
      ctr when ctr + inc < 0 -> :pop
      nil -> {inc, inc}
      ctr -> {ctr + inc, ctr + inc}
    end)
  end

  @spec get_selected_columns_for_shape(Shape.t()) :: MapSet.t(String.t() | nil)
  defp get_selected_columns_for_shape(%Shape{where: _, flags: %{selects_all_columns: true}}),
    do: MapSet.new([nil])

  defp get_selected_columns_for_shape(%Shape{where: nil, selected_columns: columns}),
    do: MapSet.new(columns)

  defp get_selected_columns_for_shape(%Shape{where: where, selected_columns: columns}) do
    # If columns are selected, include columns used in the where clause
    where_cols = where |> Expr.unqualified_refs() |> MapSet.new()
    MapSet.union(MapSet.new(columns), where_cols)
  end

  @spec get_where_clauses_for_shape(Shape.t()) ::
          MapSet.t(Electric.Replication.Eval.Expr.t() | nil)
  defp get_where_clauses_for_shape(%Shape{where: nil}), do: MapSet.new([nil])
  # TODO: flatten where clauses by splitting top level ANDs
  defp get_where_clauses_for_shape(%Shape{where: where, flags: flags}) do
    if Map.get(flags, :non_primitive_columns_in_where, false) do
      MapSet.new([nil])
    else
      MapSet.new([where])
    end
  end

  @spec add_waiter(GenServer.from(), state()) :: state()
  defp add_waiter(from, %__MODULE__{waiters: waiters} = state),
    do: %{state | waiters: [from | waiters]}

  @spec reply_to_waiters(any(), state()) :: state()
  defp reply_to_waiters(reply, %__MODULE__{waiters: waiters} = state) do
    for from <- waiters, do: GenServer.reply(from, reply)
    %{state | waiters: []}
  end
end
