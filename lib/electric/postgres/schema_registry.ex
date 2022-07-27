defmodule Electric.Postgres.SchemaRegistry do
  @moduledoc """
  Wrapper functions around a global storage containing info about current replicated schema.

  A lot of replication function rely on the server knowing the exact data schema -- consistent UIDs, types.
  Since we expect our replicated cluster to have homogenous schema, it's reasonable to fetch it from the server
  upon startup and reuse afterwards.

  This is done under the assumption of unchanging DDL schema, however management of that is large enough task
  to invalidate this module anyway.

  ## OIDs

  Please note that the table OIDs in this registry are intentionally different from table OIDs
  send by any of the Postgres instances. Each instance will use their own internal OIDs when sending
  the replication stream, which we convert to the name tuple; however, when acting as a replication
  subscriber, instances rely on server-sent OIDs. To save us the headache, we generate the OIDs before
  storing the information here and then send the data over with the newly generated OIDs.
  """
  require Logger

  @typedoc """
  Qualified name of the table - its schema (namespace) and its name.
  """
  @type table_name :: {String.t(), String.t()}

  @type oid :: non_neg_integer()

  @typedoc """
  Information about one column in the table.
  """
  @type column :: %{
          name: String.t(),
          type: atom(),
          type_modifier: integer(),
          part_of_identity?: boolean() | nil
        }

  @typedoc """
  Information about the replicated table.
  """
  @type replicated_table :: %{
          schema: String.t(),
          name: String.t(),
          oid: integer(),
          primary_keys: [String.t()],
          replica_identity: :all_columns | :default | :nothing | :index
        }

  @type registry() :: GenServer.server()

  use GenServer

  def start_link(_) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  @doc """
  Store information about the tables which are replicated under a publication name.

  Stores data which is then accessible via two functions:
  `fetch_replicated_tables/2` yields a list of all tables within the publication,
  and `fetch_table_info/2` yields one of the tables saved here, either by name or oid.
  """
  @spec put_replicated_tables(registry(), String.t(), [replicated_table()]) :: true
  def put_replicated_tables(agent \\ __MODULE__, publication, tables) do
    GenServer.call(agent, {:put_replicated_tables, publication, tables})
  end

  @doc """
  List information on tables which are replicated as part of the publication.
  """
  @spec fetch_replicated_tables(registry(), String.t()) :: {:ok, [replicated_table()]} | :error
  def fetch_replicated_tables(agent \\ __MODULE__, publication) do
    GenServer.call(agent, {:fetch_replicated_tables, publication})
  end

  @doc """
  Fetch information about a single table.

  For now we're essentially using a global namespace for all tables, under the assumption that
  this registry is representative of one homogenous cluster, so any table under it's fully qualified
  name has the same info.

  Table can be identified either as a `{"schema_name", "table_name"}` tuple, or the table's OID.
  See note on OIDs in the module documentation.
  """
  @spec fetch_table_info(registry(), table_name() | oid()) :: {:ok, replicated_table()} | :error
  def fetch_table_info(agent \\ __MODULE__, table) when is_tuple(table) or is_integer(table) do
    GenServer.call(agent, {:fetch_table_info, table})
  end

  @doc """
  Fetch information about a single table and raise if it wasn't found.

  See `fetch_table_info/2` for details.
  """
  @spec fetch_table_info!(registry(), table_name() | oid()) :: replicated_table()
  def fetch_table_info!(agent \\ __MODULE__, table) do
    {:ok, value} = fetch_table_info(agent, table)
    value
  end

  @doc """
  Save information about columns of a particular table.
  """
  @spec put_table_columns(registry(), table_name(), [column()]) :: true
  def put_table_columns(agent \\ __MODULE__, table, columns) do
    GenServer.call(agent, {:put_table_columns, table, columns})
  end

  @doc """
  Fetch information about columns of a table.

  Table can be identified either as a `{"schema_name", "table_name"}` tuple, or the table's OID.
  See note on OIDs in the module documentation.
  """
  @spec fetch_table_columns(registry(), table_name() | oid()) :: {:ok, [column()]} | :error
  def fetch_table_columns(agent \\ __MODULE__, table)

  def fetch_table_columns(agent, table) when is_tuple(table) do
    GenServer.call(agent, {:fetch_table_columns, table})
  end

  def fetch_table_columns(agent, table_oid) when is_integer(table_oid) do
    with {:ok, %{schema: schema, name: name}} <- fetch_table_info(agent, table_oid) do
      fetch_table_columns(agent, {schema, name})
    end
  end

  @doc """
  Fetch information about columns of a table and raise if it's not found.

  See `fetch_table_columns/2` for details
  """
  @spec fetch_table_columns!(registry(), table_name() | oid()) :: [column()]
  def fetch_table_columns!(agent \\ __MODULE__, table) do
    {:ok, value} = fetch_table_columns(agent, table)
    value
  end

  @impl true
  def init(_) do
    ets_table = :ets.new(:postgres_schema_registry, [])

    {:ok, %{ets_table: ets_table, pending: []}}
  end

  @impl true
  def handle_call({:put_replicated_tables, publication, tables}, _from, state) do
    tables
    |> Enum.map(&{{:table, {&1.schema, &1.name}, :info}, &1.oid, &1})
    |> then(&[{{:publication, publication, :tables}, tables} | &1])
    |> then(&:ets.insert(state.ets_table, &1))

    state = send_pending_calls(state, {:fetch_replicated_tables, publication}, tables)

    state =
      Enum.reduce(
        tables,
        state,
        &send_pending_calls(&2, {:fetch_table_info, {&1.schema, &1.name}}, &1)
      )

    state =
      Enum.reduce(
        tables,
        state,
        &send_pending_calls(&2, {:fetch_table_info, &1.oid}, &1)
      )

    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:put_table_columns, table, columns}, _from, state) do
    :ets.insert(state.ets_table, {{:table, table, :columns}, columns})

    state = send_pending_calls(state, {:fetch_table_columns, table}, columns)

    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:fetch_replicated_tables, publication} = key, from, state) do
    case :ets.match(state.ets_table, {{:publication, publication, :tables}, :"$1"}) do
      [] ->
        {:noreply, add_pending_call(state, key, from)}

      [[value]] ->
        {:reply, {:ok, value}, state}
    end
  end

  @impl true
  def handle_call({:fetch_table_info, {schema, name}} = key, from, state) do
    case :ets.match(state.ets_table, {{:table, {schema, name}, :info}, :_, :"$1"}) do
      [] ->
        {:noreply, add_pending_call(state, key, from)}

      [[value]] ->
        {:reply, {:ok, value}, state}
    end
  end

  @impl true
  def handle_call({:fetch_table_info, oid} = key, from, state) do
    case :ets.match(state.ets_table, {{:table, :_, :info}, oid, :"$1"}) do
      [] ->
        {:noreply, add_pending_call(state, key, from)}

      [[value]] ->
        {:reply, {:ok, value}, state}
    end
  end

  @impl true
  def handle_call({:fetch_table_columns, table} = key, from, state) do
    case :ets.match(state.ets_table, {{:table, table, :columns}, :"$1"}) do
      [] ->
        {:noreply, add_pending_call(state, key, from)}

      [[value]] ->
        {:reply, {:ok, value}, state}
    end
  end

  @impl true
  def handle_info({:timeout, {key, from}}, state) do
    state.pending
    |> Enum.find_index(&(&1 == {key, from}))
    |> case do
      nil ->
        {:noreply, state}

      i ->
        {_, pending} = List.pop_at(state.pending, i)
        GenServer.reply(from, :error)
        {:noreply, %{state | pending: pending}}
    end
  end

  defp add_pending_call(state, key, from, timeout \\ 3000) do
    Logger.debug("Waiting for postgres data: #{inspect(key)}")
    Process.send_after(self(), {:timeout, {key, from}}, timeout)
    Map.update!(state, :pending, &[{key, from} | &1])
  end

  defp send_pending_calls(state, key, data) do
    Logger.debug("Fulfilling postgres data: #{inspect(key)}")
    {relevant, pending} = Enum.split_with(state.pending, fn {k, _} -> k == key end)

    relevant
    |> Enum.map(&elem(&1, 1))
    |> Enum.each(&GenServer.reply(&1, {:ok, data}))

    %{state | pending: pending}
  end
end
