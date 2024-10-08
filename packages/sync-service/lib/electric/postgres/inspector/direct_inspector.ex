defmodule Electric.Postgres.Inspector.DirectInspector do
  @behaviour Electric.Postgres.Inspector

  @doc """
  Returns the PG relation from the table name.
  """
  def load_relation(table, conn) do
    # The extra cast from $1 to text is needed because of Postgrex' OID type encoding
    # see: https://github.com/elixir-ecto/postgrex#oid-type-encoding
    query = """
    SELECT nspname, relname
    FROM pg_class
    JOIN pg_namespace ON relnamespace = pg_namespace.oid
    WHERE
      relkind = 'r' AND
      pg_class.oid = $1::text::regclass
    """

    case Postgrex.query(conn, query, [table]) do
      {:ok, result} ->
        # We expect exactly one row because the query didn't fail
        # so the relation exists since we could cast it to a regclass
        [[schema, table]] = result.rows
        {:ok, {schema, table}}

      {:error, err} ->
        {:error, Exception.message(err)}
    end
  end

  def clean_relation(_, _), do: true

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
      # Fixme: this is not necessarily true. The table might exist but have no columns.
      :table_not_found
    else
      columns = Enum.map(result.columns, &String.to_atom/1)
      rows = Enum.map(result.rows, fn row -> Enum.zip(columns, row) |> Map.new() end)
      {:ok, rows}
    end
  end

  def clean_column_info(_, _), do: true

  def clean(_, _), do: true
end
