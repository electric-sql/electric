defmodule Electric.Postgres.SchemaRegistry do
  @moduledoc """
  Wrapper functions around a global storage containing info about current replicated schema

  A lot of replication function rely on the server knowing the exact data schema -- consistent UIDs, types.
  Since we expect our replicated cluster to have homogenous schema, it's reasonable to fetch it from the server
  upon startup and reuse afterwards.

  This is done under the assumption of unchanging DDL schema, however management of that is large enough task
  to invalidate this module anyway.
  """

  use Agent

  def start_link(_) do
    Agent.start_link(
      fn ->
        :ets.new(:postgres_schema_registry, [])
      end,
      name: __MODULE__
    )
  end

  def put_replicated_tables(agent \\ __MODULE__, publication, tables) do
    Agent.get(agent, fn ets_table ->
      tables
      |> Enum.map(&{{:table, {&1.schema, &1.name}, :info}, &1.oid, &1})
      |> then(&[{{:publication, publication, :tables}, tables} | &1])
      |> then(&:ets.insert(ets_table, &1))
    end)
  end

  def fetch_replicated_tables(agent \\ __MODULE__, publication) do
    Agent.get(agent, &(:ets.match(&1, {{:publication, publication, :tables}, :"$1"}) |> fetch))
  end

  @dialyzer {:no_match, fetch_table_info: 2}

  def fetch_table_info(agent \\ __MODULE__, table)

  def fetch_table_info(agent, table) when is_tuple(table) do
    Agent.get(agent, &(:ets.match(&1, {{:table, table, :info}, :_, :"$1"}) |> fetch))
  end

  def fetch_table_info(agent, oid) when is_integer(oid) do
    Agent.get(agent, &(:ets.match(&1, {{:table, :_, :info}, oid, :"$1"}) |> fetch))
  end

  def fetch_table_info!(agent \\ __MODULE__, table) do
    {:ok, value} = fetch_table_info(agent, table)
    value
  end

  def put_table_columns(agent \\ __MODULE__, table, columns) do
    Agent.get(agent, fn ets_table ->
      :ets.insert(ets_table, {{:table, table, :columns}, columns})
    end)
  end

  def fetch_table_columns(agent \\ __MODULE__, table)

  def fetch_table_columns(agent, table) when is_tuple(table) do
    Agent.get(agent, &(:ets.match(&1, {{:table, table, :columns}, :"$1"}) |> fetch))
  end

  def fetch_table_columns(agent, table_oid) when is_integer(table_oid) do
    with {:ok, %{schema: schema, name: name}} <- fetch_table_info(agent, table_oid) do
      fetch_table_columns(agent, {schema, name})
    end
  end

  def fetch_table_columns!(agent \\ __MODULE__, table) do
    {:ok, value} = fetch_table_columns(agent, table)
    value
  end

  defp fetch([[value]]), do: {:ok, value}
  defp fetch([]), do: :error
end
