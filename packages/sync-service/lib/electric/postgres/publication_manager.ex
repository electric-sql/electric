defmodule Electric.Postgres.PublicationManager do
  require Logger

  use GenServer

  alias Electric.Postgres.Configuration
  alias Electric.Replication.Eval.Expr
  alias Electric.Shapes.Shape

  defstruct [
    :relation_filter_counters,
    :prepared_relation_filters,
    :committed_relation_filters,
    :update_debounce_timeout,
    :scheduled_updated_ref,
    :waiters,
    :publication_name,
    :pool,
    :get_pg_version
  ]

  @type opts() :: %{
          required(:publication_name) => String.t(),
          required(:pool) => term(),
          required(:get_pg_version) => (-> String.t()),
          optional(:name) => atom(),
          optional(:update_debounce_timeout) => timeout(),
          optional(:server) => any()
        }

  @typep state() :: %__MODULE__{
           relation_filter_counters: %{Electric.relation() => map()},
           prepared_relation_filters: %{Electric.relation() => __MODULE__.RelationFilter.t()},
           committed_relation_filters: %{Electric.relation() => __MODULE__.RelationFilter.t()},
           update_debounce_timeout: timeout(),
           scheduled_updated_ref: nil | reference(),
           waiters: list(GenServer.from()),
           publication_name: String.t(),
           pool: term(),
           get_pg_version: (-> String.t())
         }
  @typep filter_operation :: :add | :remove

  defmodule RelationFilter do
    defstruct [:relation, :where_clauses, :selected_columns]

    @type t :: %__MODULE__{
            relation: Electric.relation(),
            where_clauses: [Electric.Replication.Eval.Expr.t()] | nil,
            selected_columns: [String.t()] | nil
          }
  end

  @retry_timeout 1_000
  @default_debounce_timeout 50

  @relation_counter :relation_counter
  @relation_where :relation_where
  @relation_column :relation_column

  @spec add_shape(Shape.t(), Keyword.t()) :: :ok
  def add_shape(shape, opts \\ []) do
    server = Access.get(opts, :server, __MODULE__)
    GenServer.call(server, {:add_shape, shape})
  end

  @spec remove_shape(Shape.t(), Keyword.t()) :: :ok
  def remove_shape(shape, opts \\ []) do
    server = Access.get(opts, :server, __MODULE__)
    GenServer.call(server, {:remove_shape, shape})
  end

  @spec start_link(opts()) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(Access.get(opts, :name, __MODULE__), opts)
  end

  @impl true
  def init(opts) do
    state = %__MODULE__{
      relation_filter_counters: %{},
      prepared_relation_filters: %{},
      committed_relation_filters: %{},
      scheduled_updated_ref: nil,
      update_debounce_timeout:
        Access.get(opts, :update_debounce_timeout, @default_debounce_timeout),
      publication_name: Access.fetch!(opts, :publication_name),
      pool: Access.fetch!(opts, :pool),
      get_pg_version: Access.fetch!(opts, :get_pg_version)
    }

    {:ok, state}
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

  @impl true
  def handle_info(
        :update_publication,
        %__MODULE__{prepared_relation_filters: relation_filters} = state
      ) do
    case update_publication(state) do
      :ok ->
        state = reply_to_waiters(:ok, state)
        {:noreply, %{state | committed_relation_filters: relation_filters}}

      {:error, err} ->
        Logger.error("Failed to configure publication for replication: #{inspect(err)}")
        state = schedule_update_publication(@retry_timeout, state)
        {:noreply, state}
    end
  end

  @spec schedule_update_publication(timeout(), state()) :: state()
  defp schedule_update_publication(timeout, %__MODULE__{scheduled_updated_ref: nil} = state) do
    ref = Process.send_after(self(), :update_publication, timeout)
    %{state | scheduled_updated_ref: ref}
  end

  @spec update_publication(state()) :: :ok | {:error, term()}
  defp update_publication(
         %__MODULE__{
           committed_relation_filters: committed_filters,
           prepared_relation_filters: current_filters
         } = _state
       )
       when current_filters == committed_filters,
       do: :ok

  defp update_publication(
         %__MODULE__{
           prepared_relation_filters: relation_filters,
           publication_name: publication_name,
           pool: pool,
           get_pg_version: get_pg_version
         } = _state
       ) do
    Configuration.configure_tables_for_replication!(
      pool,
      Map.values(relation_filters),
      get_pg_version,
      publication_name
    )

    :ok
  rescue
    err -> {:error, err}
  end

  @spec update_relation_filters_for_shape(Shape.t(), filter_operation(), state()) :: state()
  defp update_relation_filters_for_shape(
         %Shape{root_table: relation} = shape,
         operation,
         %__MODULE__{prepared_relation_filters: prepared_relation_filters} = state
       ) do
    state = update_relation_filter_counters(shape, operation, state)
    new_relation_filter = get_relation_filter(relation, state)

    new_relation_filters =
      if new_relation_filter == nil,
        do: Map.delete(prepared_relation_filters, relation),
        else: Map.put(prepared_relation_filters, relation, new_relation_filter)

    %{state | prepared_relation_filters: new_relation_filters}
  end

  @spec get_relation_filter(Electric.relation(), state()) :: RelationFilter.t() | nil
  defp get_relation_filter(
         relation,
         %__MODULE__{relation_filter_counters: relation_filter_counters} = _state
       ) do
    case Map.get(relation_filter_counters, relation) do
      nil ->
        nil

      filter_counters ->
        Enum.reduce(
          Map.keys(filter_counters),
          %RelationFilter{relation: relation, where_clauses: [], selected_columns: []},
          fn
            {@relation_counter, _}, acc ->
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
         %Shape{root_table: table} = shape,
         operation,
         %__MODULE__{relation_filter_counters: relation_filter_counters} = state
       ) do
    increment = if operation == :add, do: 1, else: -1
    filter_counters = Map.get(relation_filter_counters, table, %{})

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
        | prepared_relation_filters: Map.put(relation_filter_counters, table, filter_counters)
      }
    else
      %{state | prepared_relation_filters: Map.delete(relation_filter_counters, table)}
    end
  end

  @spec update_map_counter(map(), any(), integer()) :: {any(), map()}
  defp update_map_counter(map, key, inc) do
    Map.get_and_update(map, key, fn
      nil when inc < 0 -> :pop
      ctr when ctr + inc < 0 -> :pop
      nil -> {nil, inc}
      ctr -> {ctr, ctr + inc}
    end)
  end

  @spec get_selected_columns_for_shape(Shape.t()) :: MapSet.t(String.t() | nil)
  defp get_selected_columns_for_shape(%Shape{where: _, selected_columns: nil}),
    do: MapSet.new(nil)

  defp get_selected_columns_for_shape(%Shape{where: nil, selected_columns: columns}),
    do: MapSet.new(columns)

  defp get_selected_columns_for_shape(%Shape{where: where, selected_columns: columns}) do
    # If columns are selected, include columns used in the where clause
    where_cols = where |> Expr.current_table_refs() |> MapSet.new()
    MapSet.union(MapSet.new(columns), where_cols)
  end

  @spec get_where_clauses_for_shape(Shape.t()) ::
          MapSet.t(Electric.Replication.Eval.Expr.t() | nil)
  defp get_where_clauses_for_shape(%Shape{where: nil}), do: MapSet.new(nil)
  # TODO: flatten where clauses by splitting top level ANDs
  defp get_where_clauses_for_shape(%Shape{where: where}), do: MapSet.new(where)

  @spec add_waiter(GenServer.from(), state()) :: state()
  defp add_waiter(from, %__MODULE__{waiters: waiters} = state),
    do: %{state | waiters: [from | waiters]}

  @spec reply_to_waiters(any(), state()) :: state()
  defp reply_to_waiters(reply, %__MODULE__{waiters: waiters} = state) do
    for from <- waiters, do: GenServer.reply(from, reply)
    %{state | waiters: []}
  end
end
