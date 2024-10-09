defmodule Electric.Postgres.Inspector.EtsInspector do
  alias Electric.Postgres.Inspector.DirectInspector
  use GenServer
  @behaviour Electric.Postgres.Inspector

  # TODO: we should either use a table per tenant,
  #       or, use one table for all tenants and make the keys unique
  #       by including the tenant_id in the key
  #       --> we will need to pass the tenant_id to the functions of the public API
  @default_pg_info_table :pg_info_table

  ## Public API

  def name(electric_instance_id, tenant_id) do
    Electric.Application.process_name(electric_instance_id, tenant_id, __MODULE__)
  end

  def name(opts) do
    electric_instance_id = Keyword.fetch!(opts, :electric_instance_id)
    tenant_id = Keyword.fetch!(opts, :tenant_id)
    name(electric_instance_id, tenant_id)
  end

  def start_link(opts) do
    {:ok, pid} =
      GenServer.start_link(
        __MODULE__,
        Map.new(opts) |> Map.put_new(:pg_info_table, @default_pg_info_table),
        name: Keyword.get_lazy(opts, :name, fn -> name(opts) end)
      )

    {:ok, pid}
  end

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

  ## Internal API

  @impl GenServer
  def init(opts) do
    pg_info_table = :ets.new(opts.pg_info_table, [:named_table, :public, :set])

    Process.flag(:trap_exit, true)

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

  @column_info_position 2
  defp column_info_from_ets(table, opts_or_state) do
    ets_table = Access.get(opts_or_state, :pg_info_table, @default_pg_info_table)

    :ets.lookup_element(ets_table, {table, :columns}, @column_info_position, :not_found)
  end
end
