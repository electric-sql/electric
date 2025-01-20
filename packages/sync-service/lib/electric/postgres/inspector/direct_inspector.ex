defmodule Electric.Postgres.Inspector.DirectInspector do
  @behaviour Electric.Postgres.Inspector

  @doc """
  Returns the PG relation from the table name.
  """
  def load_relation(table, conn) when is_binary(table) do
    # The extra cast from $1 to text is needed because of Postgrex' OID type encoding
    # see: https://github.com/elixir-ecto/postgrex#oid-type-encoding
    query = load_relation_query("$1::text::regclass")
    do_load_relation(conn, query, [table])
  end

  def load_relation({schema, name}, conn) when is_binary(schema) and is_binary(name) do
    query = load_relation_query("format('%I.%I', $1::text, $2::text)::regclass")
    do_load_relation(conn, query, [schema, name])
  end

  defp do_load_relation(conn, query, params) do
    case Postgrex.query(conn, query, params) do
      {:ok, result} ->
        # We expect exactly one row because the query didn't fail
        # so the relation exists since we could cast it to a regclass
        [[schema, table, oid, kind, parent, children]] = result.rows

        {:ok,
         %{
           relation_id: oid,
           relation: {schema, table},
           kind: resolve_kind(kind),
           parent: map_relations(parent),
           children: map_relations(children)
         }}

      {:error, err} ->
        {:error, Exception.message(err)}
    end
  end

  defp load_relation_query(match) do
    # partitions can live in other namespaces from the parent/root table, so we
    # need to keep track of them
    [
      """
      SELECT pn.nspname, pc.relname, pc.oid, pc.relkind, pi_parent.parent, pi_children.children
        FROM pg_catalog.pg_class pc
        JOIN pg_catalog.pg_namespace pn ON pc.relnamespace = pn.oid
        LEFT OUTER JOIN ( -- get schema and name of parent table (if any)
          SELECT pi.inhrelid, ARRAY[pn.nspname, pc.relname] parent
            FROM pg_catalog.pg_inherits pi
            JOIN pg_catalog.pg_class pc ON pi.inhparent = pc.oid
            JOIN pg_catalog.pg_namespace pn ON pc.relnamespace = pn.oid
        ) pi_parent ON pc.oid = pi_parent.inhrelid
        LEFT OUTER JOIN ( -- get list of child partitions (if any)
          SELECT pi.inhparent, ARRAY_AGG(ARRAY[pn.nspname, pc.relname]) AS children
            FROM pg_catalog.pg_inherits pi
            JOIN pg_catalog.pg_class pc ON pi.inhrelid = pc.oid
            JOIN pg_catalog.pg_namespace pn ON pc.relnamespace = pn.oid
            GROUP BY pi.inhparent
        ) pi_children ON pc.oid = pi_children.inhparent
        WHERE
          pc.relkind IN ('r', 'p') AND
      """,
      "pc.oid = ",
      match
    ]
  end

  defp resolve_kind("r"), do: :ordinary_table
  defp resolve_kind("p"), do: :partitioned_table

  defp map_relations(nil), do: nil

  defp map_relations([schema, name]) when is_binary(schema) and is_binary(name),
    do: {schema, name}

  defp map_relations(relations) when is_list(relations),
    do: Enum.map(relations, &map_relations/1)

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
    WHERE relname = $1 AND nspname = $2 AND relkind IN ('r', 'p')
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

  def clean(_, _), do: true
end
