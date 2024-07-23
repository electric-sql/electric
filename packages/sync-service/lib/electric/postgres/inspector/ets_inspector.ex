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
  def load_column_info({namespace, tbl}, opts) do
    ets_table = Access.get(opts, :pg_info_table, @default_pg_info_table)

    case :ets.lookup_element(ets_table, {{namespace, tbl}, :columns}, 2, :not_found) do
      :not_found ->
        case GenServer.call(opts[:server], {:load_column_info, {namespace, tbl}}) do
          {:error, err, stacktrace} -> reraise err, stacktrace
          result -> result
        end

      found ->
        {:ok, found}
    end
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
  def handle_call({:load_column_info, {namespace, tbl}}, _from, state) do
    case :ets.lookup(state.pg_info_table, {{namespace, tbl}, :columns}) do
      [found] ->
        {:reply, {:ok, found}, state}

      [] ->
        case DirectInspector.load_column_info({namespace, tbl}, state.pg_pool) do
          :table_not_found ->
            {:reply, :table_not_found, state}

          {:ok, info} ->
            # store
            :ets.insert(state.pg_info_table, {{{namespace, tbl}, :columns}, info})
            {:reply, {:ok, info}, state}
        end
    end
  rescue
    e -> {:reply, {:error, e, __STACKTRACE__}, state}
  end
end
