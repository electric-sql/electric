defmodule Electric.Postgres.Inspector.EtsInspector do
  alias Electric.Postgres.Inspector.DirectInspector
  use GenServer
  @behaviour Electric.Postgres.Inspector

  @default_pg_info_table :pg_info_table

  ## Public API

  def start_link(opts),
    do:
      GenServer.start_link(
        __MODULE__,
        Map.new(opts) |> Map.put_new(:pg_info_table, @default_pg_info_table),
        name: Access.get(opts, :name, __MODULE__)
      )

  @impl Electric.Postgres.Inspector
  def load_column_info({_namespace, _table_name} = table, opts) do
    case column_info_from_ets(table, opts) do
      :not_found ->
        case GenServer.call(opts[:server], {:load_column_info, table}) do
          {:error, err, stacktrace} -> reraise err, stacktrace
          result -> result
        end

      found ->
        {:ok, found}
    end
  end

  @impl Electric.Postgres.Inspector
  def clean_column_info(table, opts_or_state) do
    ets_table = Access.get(opts_or_state, :pg_info_table, @default_pg_info_table)

    :ets.delete(ets_table, {table, :columns})
  end

  @impl Electric.Postgres.Inspector
  def get_namespace_and_tablename(table, opts) do
    GenServer.call(opts[:server], {:get_namespace_and_tablename, table})
  end

  ## Internal API

  @impl GenServer
  def init(opts) do
    pg_info_table = :ets.new(opts.pg_info_table, [:named_table, :public, :set])

    state = %{
      pg_info_table: pg_info_table,
      pg_pool: opts.pool
    }

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:load_column_info, table}, _from, state) do
    case column_info_from_ets(table, state) do
      :not_found ->
        case DirectInspector.load_column_info(table, state.pg_pool) do
          :table_not_found ->
            {:reply, :table_not_found, state}

          {:ok, info} ->
            # store
            :ets.insert(state.pg_info_table, {{table, :columns}, info})
            {:reply, {:ok, info}, state}
        end

      found ->
        {:reply, {:ok, found}, state}
    end
  rescue
    e -> {:reply, {:error, e, __STACKTRACE__}, state}
  end

  def handle_call({:get_namespace_and_tablename, table}, _from, state) do
    {:reply, DirectInspector.get_namespace_and_tablename(table, state.pg_pool), state}
  end

  @column_info_position 2
  defp column_info_from_ets(table, opts_or_state) do
    ets_table = Access.get(opts_or_state, :pg_info_table, @default_pg_info_table)

    :ets.lookup_element(ets_table, {table, :columns}, @column_info_position, :not_found)
  end
end
