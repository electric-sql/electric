defmodule Electric.Replication.Shapes.ShapeRequest do
  @moduledoc """
  The validated and structured shape request that came from the client.

  Shape requests are part of a subscription that the client establishes. They are used
  in two general areas: first, when the subscription is requested, we need to fetch
  data from PG according to the shape request, and second, when the subscription is
  established, we're using the shape requests to filter the replication stream.

  > #### TODO: Missing features {: .info}
  >
  > This module currently implements a very basic understanding of the shape requests.
  > Each public function in this module will need to be updated, as the functionality is added
  > to the `satellite.proto` file.
  """
  require Logger
  alias Electric.Replication.Changes.Ownership
  alias Electric.Postgres.ShadowTableTransformation
  alias Electric.Postgres.Schema
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Replication.Changes
  use Electric.Satellite.Protobuf

  defstruct [:id, :included_tables]

  @type t() :: %__MODULE__{
          id: String.t(),
          included_tables: [String.t(), ...]
        }

  @doc """
  Check if the given change belongs to this shape.
  """
  @spec change_belongs_to_shape?(t(), Changes.change()) :: boolean()
  def change_belongs_to_shape?(%__MODULE__{} = shape, change) do
    change.relation in shape.included_tables
  end

  @doc """
  Build a struct from the Protobuf representation of the shape request
  """
  @spec from_satellite_request(%SatShapeReq{}) :: t()
  def from_satellite_request(%SatShapeReq{request_id: id, shape_definition: shape}) do
    included_tables = Enum.map(shape.selects, &{"public", &1.tablename})

    %__MODULE__{
      id: id,
      included_tables: included_tables
    }
  end

  @doc """
  Get the names of tables included in this shape request.

  If the name is in this list, it doesn't necessarily mean any data from
  that table will actually fall into the shape, but it will likely be queried.
  """
  @spec included_tables(t()) :: [String.t(), ...]
  def included_tables(%__MODULE__{included_tables: tables}) do
    tables
  end

  @doc """
  Get the hash of the entire shape request, bar the id.
  """
  @spec hash(t()) :: binary()
  def hash(%__MODULE__{} = req) do
    %{req | id: ""}
    |> :erlang.term_to_iovec([:deterministic])
    |> then(&:crypto.hash(:sha, &1))
  end

  @doc """
  Query PostgreSQL for initial data which corresponds to this shape request.

  Each shape request requires a different initial dataset, so this function
  encapsulates that. The arguments, apart from the shape request itself, are:
  - `conn` - the `:epgsql` connection to use for queries.
  - `schema` - the `%Electric.Postgres.Schema.Proto.Schema{}` struct, used to get
    columns and other information required to build queries
  - `origin` - PG origin that's used to convert PG tags to Satellite tags.
    See `Electric.Postgres.ShadowTableTransformation.convert_tag_list_pg_to_satellite/2`
    for details.
  - `filtering_context` - additional information that needs to be taken into consideration
    when building a query, like permissions or rows that need to be ignored

  ## Transaction requirements

  Stability and validity of the results depends on running in the correct transaction.
  This function may execute multiple queries separately and expects the data to be stable,
  so the connection needs to be in a transaction with `ISOLATION LEVEL REPEATABLE READ`
  set (see [PG documentation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-REPEATABLE-READ)
  for details.)
  """
  @spec query_initial_data(t(), :epgsql.connection(), SchemaLoader.Version.t(), String.t(), map()) ::
          {:ok, non_neg_integer, [Changes.NewRecord.t()]} | {:error, term()}
  # TODO: `filtering_context` is underdefined by design. It's a stand-in for a more complex solution while we need to enable basic functionality.
  def query_initial_data(
        %__MODULE__{} = request,
        conn,
        schema_version,
        origin,
        filtering_context \\ %{}
      ) do
    Enum.reduce_while(request.included_tables, {:ok, 0, []}, fn table, {:ok, num_records, acc} ->
      case query_full_table(conn, table, schema_version, origin, filtering_context) do
        {:ok, count, results} ->
          {:cont, {:ok, num_records + count, acc ++ results}}

        {:error, error} ->
          Logger.error("""
          Error while trying to fulfill the subscription data:
          #{String.replace(inspect(error, pretty: true), ~r/^/m, "  ")}"
          """)

          {:halt, {:error, error}}
      end
    end)
  end

  defp query_full_table(
         conn,
         {schema_name, name} = rel,
         schema_version,
         origin,
         filtering_context
       ) do
    if filtering_context[:sent_tables] && MapSet.member?(filtering_context[:sent_tables], rel) do
      {:ok, 0, []}
    else
      {:ok, table} = SchemaLoader.Version.table(schema_version, rel)
      columns = Enum.map_join(table.columns, ", ", &~s|main."#{&1.name}"|)
      {:ok, pks} = SchemaLoader.Version.primary_keys(schema_version, rel)
      pk_clause = Enum.map_join(pks, " AND ", &~s|main."#{&1}" = shadow."#{&1}"|)

      ownership_column = Ownership.id_column_name()

      where_clause =
        if filtering_context[:user_id] && Enum.any?(table.columns, &(&1.name == ownership_column)) do
          escaped = String.replace(filtering_context[:user_id], "'", "''")

          # We're using explicit interpolation here instead of extended query, because we need all columns regardless of type to be returned as binaries
          "WHERE #{ownership_column} = '#{escaped}'"
        else
          ""
        end

      query = """
      SELECT shadow."_tags", #{columns}
        FROM #{Schema.name(schema_name)}.#{Schema.name(name)} as main
        JOIN electric."shadow__#{schema_name}__#{name}" as shadow
          ON #{pk_clause}
        #{where_clause}
      """

      case :epgsql.squery(conn, query) do
        {:ok, _, rows} ->
          {records, count} =
            rows_to_records_with_tags(rows, Enum.map(table.columns, & &1.name), rel, origin)

          {:ok, count, records}

        {:error, _} = error ->
          error
      end
    end
  end

  @spec rows_to_records_with_tags([tuple()], [String.t(), ...], term(), String.t()) ::
          {[Changes.NewRecord.t()], non_neg_integer()}
  defp rows_to_records_with_tags(rows, col_names, relation, origin) when is_list(rows) do
    Enum.map_reduce(rows, 0, fn row_tuple, count ->
      [tags | values] = Tuple.to_list(row_tuple)

      row =
        Enum.zip(col_names, values)
        |> Map.new()

      record = %Changes.NewRecord{
        relation: relation,
        record: row,
        tags: ShadowTableTransformation.convert_tag_list_pg_to_satellite(tags, origin)
      }

      {record, count + 1}
    end)
  end
end
