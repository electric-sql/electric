defmodule Electric.Postgres.InspectorBehaviour do
  @type relation :: {String.t(), String.t()}

  @type column_info :: %{
          name: String.t(),
          type: String.t(),
          formatted_type: String.t(),
          pk_position: non_neg_integer() | nil,
          type_id: {typid :: non_neg_integer(), typmod :: integer()}
        }

  @callback load_table_info(relation(), opts :: term()) :: [column_info()]
end

defmodule Electric.Postgres.Inspector do
  @behaviour Electric.Postgres.InspectorBehaviour

  @doc """
  Load table information (refs) from the database
  """
  def load_table_info({namespace, tbl}, conn) do
    query = """
    SELECT
      attname as name,
      (atttypid, atttypmod) as type_id,
      typname as type,
      format_type(pg_attribute.atttypid, pg_attribute.atttypmod) AS formatted_type,
      array_position(indkey, attnum) as pk_position
    FROM pg_class
    JOIN pg_namespace ON relnamespace = pg_namespace.oid
    JOIN pg_attribute ON attrelid = pg_class.oid AND attnum >= 0
    JOIN pg_type ON atttypid = pg_type.oid
    JOIN pg_index ON indrelid = pg_class.oid AND indisprimary
    WHERE relname = $1 AND nspname = $2
    ORDER BY pg_class.oid, attnum
    """

    result = Postgrex.query!(conn, query, [tbl, namespace])

    columns = Enum.map(result.columns, &String.to_atom/1)
    Enum.map(result.rows, fn row -> Enum.zip(columns, row) |> Map.new() end)
  end
end
