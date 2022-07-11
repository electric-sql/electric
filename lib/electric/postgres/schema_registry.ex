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
          replica_identity: :all_columns | :default | :nothing | :index
        }

  @type registry() :: Agent.agent()

  use Agent

  def start_link(_) do
    Agent.start_link(
      fn ->
        :ets.new(:postgres_schema_registry, [])
      end,
      name: __MODULE__
    )
  end

  @doc """
  Store information about the tables which are replicated under a publication name.

  Stores data which is then accessible via two functions:
  `fetch_replicated_tables/2` yields a list of all tables within the publication,
  and `fetch_table_info/2` yields one of the tables saved here, either by name or oid.
  """
  @spec put_replicated_tables(registry(), String.t(), [replicated_table()]) :: true
  def put_replicated_tables(agent \\ __MODULE__, publication, tables) do
    Agent.get(agent, fn ets_table ->
      tables
      |> Enum.map(&{{:table, {&1.schema, &1.name}, :info}, &1.oid, &1})
      |> then(&[{{:publication, publication, :tables}, tables} | &1])
      |> then(&:ets.insert(ets_table, &1))
    end)
  end

  @doc """
  List information on tables which are replicated as part of the publication.
  """
  @spec fetch_replicated_tables(registry(), String.t()) :: {:ok, [replicated_table()]} | :error
  def fetch_replicated_tables(agent \\ __MODULE__, publication) do
    Agent.get(agent, &(:ets.match(&1, {{:publication, publication, :tables}, :"$1"}) |> fetch))
  end

  @doc """
  Fetch information about a single table.

  For now we're essentially using a global namespace for all tables, under the assumption that
  this registry is representative of one homogenous cluster, so any table under it's fully qualified
  name has the same info.

  Table can be identified either as a `{"schema_name", "table_name"}` tuple, or the table's OID.
  See note on OIDs in the module documentation.
  """
  @spec fetch_table_info(registry(), {String.t(), String.t()} | non_neg_integer()) ::
          {:ok, replicated_table()} | :error
  def fetch_table_info(agent \\ __MODULE__, table)

  def fetch_table_info(agent, table) when is_tuple(table) do
    Agent.get(agent, &(:ets.match(&1, {{:table, table, :info}, :_, :"$1"}) |> fetch))
  end

  def fetch_table_info(agent, oid) when is_integer(oid) do
    Agent.get(agent, &(:ets.match(&1, {{:table, :_, :info}, oid, :"$1"}) |> fetch))
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
    Agent.get(agent, fn ets_table ->
      :ets.insert(ets_table, {{:table, table, :columns}, columns})
    end)
  end

  @doc """
  Fetch information about columns of a table.

  Table can be identified either as a `{"schema_name", "table_name"}` tuple, or the table's OID.
  See note on OIDs in the module documentation.
  """
  @spec fetch_table_columns(registry(), table_name() | oid()) :: {:ok, [column()]} | :error
  def fetch_table_columns(agent \\ __MODULE__, table)

  def fetch_table_columns(agent, table) when is_tuple(table) do
    Agent.get(agent, &(:ets.match(&1, {{:table, table, :columns}, :"$1"}) |> fetch))
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

  defp fetch([[value]]), do: {:ok, value}
  defp fetch([]), do: :error
end
