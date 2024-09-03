defmodule Electric.Postgres.Inspector.DirectInspector do
  @behaviour Electric.Postgres.Inspector

  @doc """
  Load table information (refs) from the database
  """
  def load_column_info({namespace, tbl}, conn) do
    query = """
    SELECT
      attname as name,
      (atttypid, atttypmod) as type_id,
      attndims as array_dimensions,
      atttypmod as type_mod,
      attnotnull as not_null,
      pg_type.typname as type,
      elem_pg_type.typname as array_type, -- type of the element inside the array or nil if it's not an array
      format_type(pg_attribute.atttypid, pg_attribute.atttypmod) AS formatted_type,
      array_position(indkey, attnum) as pk_position
    FROM pg_class
    JOIN pg_namespace ON relnamespace = pg_namespace.oid
    JOIN pg_attribute ON attrelid = pg_class.oid AND attnum >= 0
    JOIN pg_type ON atttypid = pg_type.oid
    LEFT JOIN pg_index ON indrelid = pg_class.oid AND indisprimary
    LEFT JOIN pg_type AS elem_pg_type ON pg_type.typelem = elem_pg_type.oid
    WHERE relname = $1 AND nspname = $2 AND relkind = 'r'
    ORDER BY pg_class.oid, attnum
    """

    result = Postgrex.query!(conn, query, [tbl, namespace])

    if Enum.empty?(result.rows) do
      :table_not_found
    else
      columns = Enum.map(result.columns, &String.to_atom/1)
      rows = Enum.map(result.rows, fn row -> Enum.zip(columns, row) |> Map.new() end)
      {:ok, rows}
    end
  end

  def clean_column_info(_, _), do: true
end
