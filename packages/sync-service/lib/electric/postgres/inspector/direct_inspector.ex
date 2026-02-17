defmodule Electric.Postgres.Inspector.DirectInspector do
  @moduledoc false
  import Electric, only: :macros

  alias Electric.Postgres.Inspector
  @behaviour Electric.Postgres.Inspector

  @oid_from_schema_table_name_subquery "(SELECT pg_class.oid FROM pg_class JOIN pg_namespace ON relnamespace = pg_namespace.oid WHERE pg_namespace.nspname = $1::text AND pg_class.relname = $2::text)"

  @doc false
  @impl Electric.Postgres.Inspector
  def list_relations_with_stale_cache(_opts), do: :error

  @impl Electric.Postgres.Inspector
  @spec load_relation_oid(Electric.relation(), conn :: Postgrex.conn()) ::
          {:ok, Electric.oid_relation()} | :table_not_found | {:error, String.t()}
  def load_relation_oid({schema, table}, conn) do
    query = load_relation_query(@oid_from_schema_table_name_subquery)

    case do_load_relation(conn, query, [schema, table]) do
      {:ok, []} ->
        :table_not_found

      {:ok, [%{relation_id: oid, relation: {schema, table}}]} ->
        {:ok, {oid, {schema, table}}}

      {:error, err} ->
        {:error, err}
    end
  end

  @doc """
  Normalizes a relation and loads the relation info in one go.

  This is an internal function meant to be used by the wrapping caching inspector.
  """
  @spec normalize_and_load_relation_info(Electric.relation(), conn :: Postgrex.conn()) ::
          {:ok, Inspector.relation_info()}
          | :table_not_found
          | {:error, String.t() | :connection_not_available}
  def normalize_and_load_relation_info({schema, table}, conn) do
    query = load_relation_query(@oid_from_schema_table_name_subquery)

    case do_load_relation(conn, query, [schema, table]) do
      {:ok, []} ->
        :table_not_found

      {:ok, [relation_info]} ->
        {:ok, relation_info}

      {:error, err} ->
        {:error, err}
    end
  end

  @impl Electric.Postgres.Inspector
  @spec load_relation_info(Electric.relation_id(), conn :: Postgrex.conn()) ::
          {:ok, Inspector.relation_info()}
          | :table_not_found
          | {:error, String.t() | :connection_not_available}
  def load_relation_info(oid, conn) when is_relation_id(oid) do
    query = load_relation_query("$1::oid")

    case do_load_relation(conn, query, [oid]) do
      {:ok, []} ->
        :table_not_found

      {:ok, [relation_info]} ->
        {:ok, relation_info}

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
  @spec load_column_info(Electric.relation_id(), conn :: Postgrex.conn()) ::
          {:ok, [Inspector.column_info()]}
          | :table_not_found
          | {:error, String.t() | :connection_not_available}
  def load_column_info(relation_id, conn) when is_relation_id(relation_id) do
    query = """
    #{@column_info_query_base}
    WHERE pg_class.oid = $1::oid AND relkind IN ('r', 'p')
    ORDER BY pg_class.oid, attnum
    """

    case do_query_column_info(conn, query, [relation_id]) do
      {:ok, []} ->
        # There is an edge case where the table exists but has no columns.
        # We're choosing to not support this case, so for ease of use we return
        # :table_not_found
        :table_not_found

      {:ok, rows} ->
        {:ok, rows}

      {:error, err} ->
        {:error, err}
    end
  end

  def load_column_info_by_oids!(oids, conn) when is_list(oids) do
    query = """
    #{@column_info_query_base}
    WHERE pg_class.oid = ANY ($1::oid[])
    ORDER BY pg_class.oid, attnum
    """

    case do_query_column_info(conn, query, [oids]) do
      {:ok, rows} -> Enum.group_by(rows, & &1.relation_id)
      {:error, reason} -> raise reason
    end
  end

  defp do_query_column_info(conn, query, params) do
    with {:ok, %{rows: rows, columns: columns}} <- Postgrex.query(conn, query, params) do
      columns = Enum.map(columns, &String.to_atom/1)

      rows =
        Enum.map(rows, fn row ->
          Enum.zip_with(columns, row, fn
            :type_kind, val -> {:type_kind, parse_type_kind(val)}
            col, val -> {col, val}
          end)
          |> Map.new()
        end)

      {:ok, rows}
    end
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
  def load_supported_features(conn) do
    with {:ok, %{rows: [[pg_version]]}} <-
           Postgrex.query(conn, "SELECT current_setting('server_version_num')::int", []) do
      {:ok,
       %{
         supports_generated_column_replication: pg_version >= 180_000
       }}
    end
  end

  @impl Electric.Postgres.Inspector
  def purge_relation_info(_, _), do: :ok
end
