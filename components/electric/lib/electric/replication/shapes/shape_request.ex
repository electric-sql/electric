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
  alias Electric.Postgres.ShadowTableTransformation
  alias Electric.Postgres.Schema
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
  Query PostgreSQL for initial data which corresponds to this shape request.

  Each shape request requires a different initial dataset, so this function
  encapsulates that. The arguments, apart from the shape request itself, are:
  - `conn` - the `:epgsql` connection to use for queries.
  - `schema` - the `%Electric.Postgres.Schema.Proto.Schema{}` struct, used to get
    columns and other information required to build queries
  - `origin` - PG origin that's used to convert PG tags to Satellite tags.
    See `Electric.Postgres.ShadowTableTransformation.convert_tag_list_pg_to_satellite/2`
    for details.

  ## Transaction requirements

  Stability and validity of the results depends on running in the correct transaction.
  This function may execute multiple queries separately and expects the data to be stable,
  so the connection needs to be in a transaction with `ISOLATION LEVEL REPEATABLE READ`
  set (see [PG documentation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-REPEATABLE-READ)
  for details.)
  """
  @spec query_initial_data(t(), :epgsql.connection(), Schema.t(), String.t()) ::
          {:ok, [Changes.NewRecord.t()]} | {:error, term()}
  def query_initial_data(%__MODULE__{} = request, conn, schema, origin) do
    Enum.reduce_while(request.included_tables, {:ok, []}, fn table, {:ok, acc} ->
      case query_full_table(conn, table, schema, origin) do
        {:ok, results} ->
          {:cont, {:ok, acc ++ results}}

        {:error, error} ->
          Logger.error("""
          Error while trying to fulfill the subscription data:
          #{String.replace(inspect(error, pretty: true), ~r/^/m, "  ")}"
          """)

          {:halt, {:error, error}}
      end
    end)
  end

  defp query_full_table(conn, {schema_name, name} = rel, %Schema.Proto.Schema{} = schema, origin) do
    table = Enum.find(schema.tables, &(&1.name.schema == schema_name && &1.name.name == name))
    columns = Enum.map_join(table.columns, ", ", &~s|main."#{&1.name}"|)
    {:ok, pks} = Schema.primary_keys(table)
    pk_clause = Enum.map_join(pks, " AND ", &~s|main."#{&1}" = shadow."#{&1}"|)

    query = """
    SELECT shadow."_tags", #{columns}
      FROM #{Schema.name(schema_name)}.#{Schema.name(name)} as main
      JOIN electric."shadow__#{schema_name}__#{name}" as shadow
        ON #{pk_clause}
    """

    case :epgsql.squery(conn, query) do
      {:ok, _, rows} ->
        {:ok, rows_to_records_with_tags(rows, Enum.map(table.columns, & &1.name), rel, origin)}

      {:error, _} = error ->
        error
    end
  end

  @spec rows_to_records_with_tags([tuple()], [String.t(), ...], term(), String.t()) :: [
          Changes.NewRecord.t()
        ]
  defp rows_to_records_with_tags(rows, col_names, relation, origin) when is_list(rows) do
    for row_tuple <- rows do
      [tags | values] =
        row_tuple
        |> Tuple.to_list()
        |> Enum.map(fn
          :null -> nil
          other -> other
        end)

      row =
        Enum.zip(col_names, values)
        |> Map.new()

      %Changes.NewRecord{
        relation: relation,
        record: row,
        tags: ShadowTableTransformation.convert_tag_list_pg_to_satellite(tags, origin)
      }
    end
  end
end
