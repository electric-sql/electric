defmodule Electric.Postgres.Inspector.DirectInspector do
  @behaviour Electric.Postgres.Inspector

  @doc false
  @impl Electric.Postgres.Inspector
  def list_relations_with_stale_cache(_opts), do: :error

  @doc """
  Returns the PG relation from the table name.
  """
  @impl Electric.Postgres.Inspector
  def load_relation(table, conn) when is_binary(table) do
    # The extra cast from $1 to text is needed because of Postgrex' OID type encoding
    # see: https://github.com/elixir-ecto/postgrex#oid-type-encoding
    query = load_relation_query("$1::text::regclass")

    case do_load_relation(conn, query, [table]) do
      {:ok, []} ->
        {:error, "No relation found"}

      # We're matching for a unique regclass here, can't be more than one
      {:ok, [relation]} ->
        {:ok, relation}

      {:error, err} ->
        {:error, err}
    end
  end

  def load_relation({schema, name}, conn) when is_binary(schema) and is_binary(name) do
    query = load_relation_query("format('%I.%I', $1::text, $2::text)::regclass")

    case do_load_relation(conn, query, [schema, name]) do
      {:ok, []} ->
        {:error, "No relation found"}

      # We're matching for a unique regclass here, can't be more than one
      {:ok, [relation]} ->
        {:ok, relation}

      {:error, err} ->
        {:error, err}
    end
  end

  def load_relations_by_oids(oids, conn) when is_list(oids) do
    query = load_relation_query("ANY ($1::oid[])")
    do_load_relation(conn, query, [oids])
  end

  defp do_load_relation(conn, query, params) do
    case Postgrex.query(conn, query, params) do
      {:ok, %{rows: rows}} ->
        relations =
          Enum.map(rows, fn [schema, table, oid, kind, parent, children] ->
            %{
              relation_id: oid,
              relation: {schema, table},
              kind: resolve_kind(kind),
              parent: map_relations(parent),
              children: map_relations(children)
            }
          end)

        {:ok, relations}

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

  @column_info_query_base """
  SELECT
      pg_class.oid as relation_id,
      attname as name,
      (atttypid, atttypmod) as type_id,
      attndims as array_dimensions,
      atttypmod as type_mod,
      attnotnull as not_null,
      attgenerated != '' as is_generated,
      pg_type.typname as type,
      pg_type.typtype as type_kind, -- e.g. an enum is kind 'e'
      elem_pg_type.typname as array_type, -- type of the element inside the array or nil if it's not an array
      format_type(pg_attribute.atttypid, pg_attribute.atttypmod) AS formatted_type,
      array_position(indkey, attnum) as pk_position
    FROM pg_class
    JOIN pg_namespace ON relnamespace = pg_namespace.oid
    JOIN pg_attribute ON attrelid = pg_class.oid AND attnum >= 0
    JOIN pg_type ON atttypid = pg_type.oid
    LEFT JOIN pg_index ON indrelid = pg_class.oid AND indisprimary
    LEFT JOIN pg_type AS elem_pg_type ON pg_type.typelem = elem_pg_type.oid
  """

  @doc """
  Load table information (refs) from the database
  """
  @impl Electric.Postgres.Inspector
  def load_column_info({namespace, tbl}, conn) do
    query = """
    #{@column_info_query_base}
    WHERE relname = $1 AND nspname = $2 AND relkind IN ('r', 'p')
    ORDER BY pg_class.oid, attnum
    """

    case do_query_column_info!(conn, query, [tbl, namespace]) do
      [] ->
        # Fixme: this is not necessarily true. The table might exist but have no columns.
        :table_not_found

      rows ->
        {:ok, rows}
    end
  end

  def load_column_info_by_oids(oids, conn) do
    query = """
    #{@column_info_query_base}
    WHERE pg_class.oid = ANY ($1::oid[])
    ORDER BY pg_class.oid, attnum
    """

    do_query_column_info!(conn, query, [oids])
    |> Enum.group_by(& &1.relation_id)
  end

  defp do_query_column_info!(conn, query, params) do
    %{rows: rows, columns: columns} = Postgrex.query!(conn, query, params)

    columns = Enum.map(columns, &String.to_atom/1)

    rows =
      Enum.map(rows, fn row ->
        Enum.zip_with(columns, row, fn
          :type_kind, val -> {:type_kind, parse_type_kind(val)}
          col, val -> {col, val}
        end)
        |> Map.new()
      end)

    rows
  end

  @spec parse_type_kind(String.t()) :: Electric.Postgres.Inspector.type_kind()
  defp parse_type_kind("b"), do: :base
  defp parse_type_kind("c"), do: :composite
  defp parse_type_kind("d"), do: :domain
  defp parse_type_kind("e"), do: :enum
  defp parse_type_kind("p"), do: :pseudo
  defp parse_type_kind("r"), do: :range
  defp parse_type_kind("m"), do: :multirange

  @impl Electric.Postgres.Inspector
  def clean(_, _), do: true
end
