defmodule Electric.Postgres.Inspector.EtsInspector do
  alias Electric.Postgres.Inspector.DirectInspector
  use GenServer
  @behaviour Electric.Postgres.Inspector

  @default_pg_info_table :pg_info_table
  @default_pg_relation_table :pg_relation_table

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
        Map.new(opts)
        |> Map.put_new(:pg_info_table, @default_pg_info_table)
        |> Map.put_new(:pg_relation_table, @default_pg_relation_table)
        |> Map.put_new_lazy(:tenant_tables_name, fn ->
          Application.fetch_env!(:electric, :tenant_tables_name)
        end),
        name: Keyword.get_lazy(opts, :name, fn -> name(opts) end)
      )

    {:ok, pid}
  end

  @impl Electric.Postgres.Inspector
  def load_relation(table, opts) do
    case relation_from_ets(table, opts) do
      :not_found ->
        GenServer.call(opts[:server], {:load_relation, table})

      rel ->
        {:ok, rel}
    end
  end

  defp clean_relation(rel, opts_or_state) do
    pg_relation_ets_table = get_relation_table(opts_or_state)
    pg_info_ets_table = get_column_info_table(opts_or_state)

    # Delete all tables that are associated with the relation
    tables_from_ets(rel, opts_or_state)
    |> Enum.each(fn table -> :ets.delete(pg_info_ets_table, {table, :table_to_relation}) end)

    # Delete the relation itself
    :ets.delete(pg_relation_ets_table, {rel, :relation_to_table})
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

  defp clean_column_info(table, opts_or_state) do
    ets_table = get_column_info_table(opts_or_state)

    :ets.delete(ets_table, {table, :columns})
  end

  @impl Electric.Postgres.Inspector
  def clean(relation, opts_or_state) do
    clean_column_info(relation, opts_or_state)
    clean_relation(relation, opts_or_state)
  end

  ## Internal API

  @impl GenServer
  def init(opts) do
    # Each tenant creates its own ETS table.
    # Name needs to be an atom but we don't want to dynamically create atoms.
    # Instead, we will use the reference to the table that is returned by `:ets.new`
    pg_info_table = :ets.new(opts.pg_info_table, [:public, :set])
    pg_relation_table = :ets.new(opts.pg_relation_table, [:public, :bag])

    # Store both references in a global ETS table so that we can retrieve them later
    tenant_id = Access.fetch!(opts, :tenant_id)
    tenant_tables_name = Access.fetch!(opts, :tenant_tables_name)

    :ets.insert(tenant_tables_name, {{tenant_id, :pg_info_table}, pg_info_table})
    :ets.insert(tenant_tables_name, {{tenant_id, :pg_relation_table}, pg_relation_table})

    state = %{
      pg_info_table: pg_info_table,
      pg_relation_table: pg_relation_table,
      pg_pool: opts.pool
    }

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:load_relation, table}, _from, state) do
    # This serves as a write-through cache for caching
    # the namespace and tablename as they occur in PG.
    # Note that if users create shapes for the same table but spelled differently,
    # e.g. `~s|public.users|`, `~s|users|`, `~s|Users|`, and `~s|USERS|`
    # then there will be 4 entries in the cache each of which maps to `{~s|public|, ~s|users|}`.
    # If they create a shape for a different table `~s|"Users"|`, then there will be another entry
    # in ETS for `~s|"Users"|` that maps to `{~s|public|, ~s|"Users"|}`.
    case relation_from_ets(table, state) do
      :not_found ->
        case DirectInspector.load_relation(table, state.pg_pool) do
          {:error, err} ->
            {:reply, {:error, err}, state}

          {:ok, relation} ->
            # We keep the mapping in both directions:
            # - Forward: user-provided table name -> PG relation (many-to-one)
            #     e.g. `~s|users|` -> `{"public", "users"}`
            #          `~s|USERS|` -> `{"public", "users"}`
            # - Backward: and PG relation -> user-provided table names (one-to-many)
            #     e.g. `{"public", "users"}` -> `[~s|users|, ~s|USERS|]`
            #
            # The forward direction allows for efficient lookup (based on user-provided table name)
            # the backward direction allows for efficient cleanup (based on PG relation)
            :ets.insert(state.pg_info_table, {{table, :table_to_relation}, relation})
            :ets.insert(state.pg_relation_table, {{relation, :relation_to_table}, table})
            {:reply, {:ok, relation}, state}
        end

      relation ->
        {:reply, {:ok, relation}, state}
    end
  end

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

  @pg_rel_position 2
  defp relation_from_ets(table, opts_or_state) do
    ets_table = get_column_info_table(opts_or_state)

    :ets.lookup_element(ets_table, {table, :table_to_relation}, @pg_rel_position, :not_found)
  end

  @pg_table_idx 1
  defp tables_from_ets(relation, opts_or_state) do
    ets_table = get_relation_table(opts_or_state)

    :ets.lookup(ets_table, {relation, :relation_to_table})
    |> Enum.map(&elem(&1, @pg_table_idx))
  end

  @column_info_position 2
  defp column_info_from_ets(table, opts_or_state) do
    ets_table = get_column_info_table(opts_or_state)

    :ets.lookup_element(ets_table, {table, :columns}, @column_info_position, :not_found)
  end

  # When called from within the GenServer it is passed the state
  # which contains the reference to the ETS table.
  # When called from outside the GenServer it is passed the opts keyword list
  @pg_info_table_ref_position 2
  def get_column_info_table(%{pg_info_table: ets_table}), do: ets_table

  def get_column_info_table(opts) do
    tenant_id = Access.fetch!(opts, :tenant_id)
    tenant_tables_name = fetch_tenant_tables_name(opts)

    :ets.lookup_element(
      tenant_tables_name,
      {tenant_id, :pg_info_table},
      @pg_info_table_ref_position
    )
  end

  @pg_relation_table_ref_position 2
  def get_relation_table(%{pg_relation_table: ets_table}), do: ets_table

  def get_relation_table(opts) do
    tenant_id = Access.fetch!(opts, :tenant_id)
    tenant_tables_name = fetch_tenant_tables_name(opts)

    :ets.lookup_element(
      tenant_tables_name,
      {tenant_id, :pg_relation_table},
      @pg_relation_table_ref_position
    )
  end

  def fetch_tenant_tables_name(opts) do
    case Access.fetch(opts, :tenant_tables_name) do
      :error -> Application.fetch_env!(:electric, :tenant_tables_name)
      {:ok, tenant_tables_name} -> tenant_tables_name
    end
  end
end
