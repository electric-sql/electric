defmodule Electric.Postgres.Configuration do
  @moduledoc """
  Module for functions that configure Postgres in some way using
  a provided connection.
  """
  require Logger
  alias Electric.Replication.PublicationManager.RelationFilter
  alias Electric.Utils

  @type filters() :: %{Electric.oid_relation() => RelationFilter.t()}

  @pg_15 150_000

  @doc """
  Configure the publication to include all relevant tables, also setting table identity to `FULL`
  if necessary. Return a list of tables that could not be configured.

  Any tables that were previously configured but were either renamed or dropped will *not* be automatically
  re-added to the publication. Mentioned tables that have been renamed or dropped will be returned as a list.

  `previous_relations` argument is used to figure out renamed/dropped table based on table OIDs.

  Important: this function should not be ran in a transaction, because it starts multiple
  internal transactions that are sometimes expected to fail.

  Raises if it fails to configure all the tables in the expected way.
  """
  @spec configure_publication!(
          Postgrex.conn(),
          [Electric.oid_relation()],
          filters(),
          non_neg_integer(),
          String.t()
        ) :: relations_failed_to_configure
        when relations_failed_to_configure: [Electric.oid_relation()]
  def configure_publication!(
        conn,
        previous_relations,
        new_filters,
        pg_version,
        publication_name
      ) do
    Postgrex.transaction(conn, fn conn ->
      # "New filters" were configured using a schema read in a different transaction (if at all, might have been from cache)
      # so we need to check if any of the relations were dropped/renamed since then
      changed_relations =
        (previous_relations ++ Map.keys(new_filters))
        |> Enum.uniq()
        |> list_changed_relations(conn)

      used_filters = Map.drop(new_filters, changed_relations)

      if changed_relations != [],
        do:
          Logger.info(
            "Configuring publication #{publication_name} to include #{map_size(used_filters)} tables - skipping altered tables #{inspect(changed_relations)}"
          )

      if pg_version < @pg_15 do
        alter_pub_set_whole_tables!(conn, publication_name, used_filters)
      else
        alter_pub_set_filtered_tables!(conn, publication_name, used_filters)
      end

      # `ALTER TABLE` should be after the publication altering, because it takes out an exclusive lock over this table,
      # but the publication altering takes out a shared lock on all mentioned tables, so a concurrent transaction will
      # deadlock if the order is reversed.
      set_replica_identity!(conn, used_filters)

      changed_relations
    end)
    |> case do
      {:ok, missing_relations} ->
        missing_relations

      {:error, reason} ->
        raise reason
    end
  end

  defp list_changed_relations(known_relations, conn) do
    # We're checking whether the table has been renamed (same oid, different name) or
    # dropped (maybe same name exists, but different oid). If either is true, we need to update
    # the new filters and maybe notify existing shapes.

    {oids, relations} = Enum.unzip(known_relations)
    {schemas, tables} = Enum.unzip(relations)

    result =
      Postgrex.query!(
        conn,
        """
        WITH input_relations AS (
          SELECT
            UNNEST($1::oid[]) AS oid,
            UNNEST($2::text[]) AS input_nspname,
            UNNEST($3::text[]) AS input_relname
        )
        SELECT
          ir.oid, (ir.input_nspname, ir.input_relname) as input_relation
        FROM input_relations ir
        LEFT JOIN pg_class pc ON pc.oid = ir.oid
        LEFT JOIN pg_namespace pn ON pc.relnamespace = pn.oid
        WHERE pc.oid IS NULL OR (relname != input_relname OR nspname != input_nspname)
        """,
        [oids, schemas, tables]
      )

    for [input_oid, input_relation] <- result.rows do
      {input_oid, input_relation}
    end
  end

  @doc """
  Get Postgres server version
  """
  @spec get_pg_version(Postgrex.conn()) :: {:ok, non_neg_integer()} | {:error, term()}
  def get_pg_version(conn) do
    case Postgrex.query(
           conn,
           "SELECT current_setting('server_version_num') server_version_num",
           []
         ) do
      {:ok, result} when result.num_rows == 1 ->
        [[version_str]] = result.rows
        {:ok, String.to_integer(version_str)}

      {:error, err} ->
        {:error, err}
    end
  end

  defp alter_pub_set_whole_tables!(conn, publication_name, relation_filters) do
    publication = Utils.quote_name(publication_name)

    prev_published_tables =
      get_publication_tables(conn, publication_name)
      |> Enum.map(&Utils.relation_to_sql/1)
      |> MapSet.new()

    new_published_tables =
      relation_filters
      |> Map.keys()
      |> Enum.map(&elem(&1, 1))
      |> Enum.map(&Utils.relation_to_sql/1)
      |> MapSet.new()

    to_drop = MapSet.difference(prev_published_tables, new_published_tables)
    to_add = MapSet.difference(new_published_tables, prev_published_tables)

    Logger.info(
      "Configuring publication #{publication_name} to drop #{inspect(Enum.to_list(to_drop))} tables, and add #{inspect(Enum.to_list(to_add))} tables",
      publication_alter_drop_tables: Enum.to_list(to_drop),
      publication_alter_add_tables: Enum.to_list(to_add)
    )

    alter_ops =
      Enum.concat(Enum.map(to_add, &{&1, "ADD"}), Enum.map(to_drop, &{&1, "DROP"}))

    for {table, op} <- alter_ops do
      Postgrex.query!(conn, "SAVEPOINT before_publication", [])

      # PG 14 and below do not support filters on tables of publications
      case Postgrex.query(conn, "ALTER PUBLICATION #{publication} #{op} TABLE #{table}", []) do
        {:ok, _} ->
          Postgrex.query!(conn, "RELEASE SAVEPOINT before_publication", [])
          :ok

        # Duplicate object error is raised if we're trying to add a table to the publication when it's already there.
        {:error, %{postgres: %{code: :duplicate_object}}} ->
          Postgrex.query!(conn, "ROLLBACK TO SAVEPOINT before_publication", [])
          Postgrex.query!(conn, "RELEASE SAVEPOINT before_publication", [])
          :ok

        {:error, reason} ->
          raise reason
      end
    end
  end

  defp alter_pub_set_filtered_tables!(conn, publication_name, filters) do
    # Update the entire publication with the new filters
    Postgrex.query!(conn, make_alter_publication_query(publication_name, filters), [])
  end

  defp set_replica_identity!(conn, relation_filters) do
    query_for_relations_without_full_identity = """
    SELECT nspname, relname
    FROM pg_class pc
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    WHERE relreplident != 'f' AND pc.oid = ANY($1)
    """

    oids =
      relation_filters
      |> Map.keys()
      |> Enum.map(&elem(&1, 0))

    %Postgrex.Result{rows: rows} =
      Postgrex.query!(conn, query_for_relations_without_full_identity, [oids])

    tables = for [schema, table] <- rows, do: Utils.relation_to_sql({schema, table})

    if tables != [] do
      Logger.info("Altering identity of #{Enum.join(tables, ", ")} to FULL")

      queries = for table <- tables, do: "ALTER TABLE #{table} REPLICA IDENTITY FULL;"

      Postgrex.query!(
        conn,
        """
        DO $$
        BEGIN
        #{Enum.join(queries, "\n")}
        END $$;
        """,
        []
      )

      Logger.info("Altered identity of #{Enum.join(tables, ", ")} to FULL")
    end
  end

  @spec get_publication_tables(Postgrex.conn(), String.t()) :: list(Electric.relation())
  def get_publication_tables(conn, publication) do
    # `pg_publication_tables` is too clever for us -- if you add a partitioned
    # table to the publication `pg_publication_tables` lists all the partitions
    # as members, not the actual partitioned table. `pg_publication_rel`
    # doesn't do this, it returns a direct list of the tables that were added
    # using `ALTER PUBLICATION` and doesn't expand a partitioned table into its
    # partitions.
    Postgrex.query!(
      conn,
      """
      SELECT pn.nspname, pc.relname
        FROM pg_publication_rel ppr
        JOIN pg_publication pp
          ON ppr.prpubid = pp.oid
        JOIN pg_class pc
          ON pc.oid = ppr.prrelid
        JOIN pg_namespace pn
          ON pc.relnamespace = pn.oid
        WHERE pp.pubname = $1
        ORDER BY pn.nspname, pc.relname;
      """,
      [publication]
    )
    |> Map.fetch!(:rows)
    |> Enum.map(&(Enum.take(&1, 2) |> List.to_tuple()))
  end

  # Makes an SQL query that alters the given publication whith the given tables and filters.
  @spec make_alter_publication_query(String.t(), filters()) :: String.t()
  defp make_alter_publication_query(publication_name, filters) do
    case Map.values(filters) do
      [] ->
        Logger.info(
          "Configuring publication #{publication_name} to DROP ALL TABLES",
          publication_alter_set_tables: []
        )

        """
        DO $$
        DECLARE
            tables TEXT;
        BEGIN
            SELECT string_agg(format('%I.%I', pn.nspname, pc.relname), ', ') INTO tables
              FROM pg_publication_rel ppr
              JOIN pg_publication pp
                ON ppr.prpubid = pp.oid
              JOIN pg_class pc
                ON pc.oid = ppr.prrelid
              JOIN pg_namespace pn
                ON pc.relnamespace = pn.oid
              WHERE pp.pubname = '#{publication_name}';

            IF tables IS NOT NULL THEN
                EXECUTE format('ALTER PUBLICATION #{Utils.quote_name(publication_name)} DROP TABLE %s', tables);
            END IF;
        END $$;
        """

      filters ->
        base_sql = "ALTER PUBLICATION #{Utils.quote_name(publication_name)} SET TABLE "

        Logger.info(
          "Configuring publication #{publication_name} to SET tables #{inspect(Enum.map(filters, & &1.relation))}",
          publication_alter_set_tables: Enum.map(filters, &Utils.relation_to_sql(&1.relation))
        )

        tables =
          filters
          |> Enum.map(&make_table_clause/1)
          |> Enum.join(", ")

        base_sql <> tables
    end
  end

  @spec make_table_clause(RelationFilter.t()) :: String.t()
  defp make_table_clause(%RelationFilter{
         relation: relation,
         where_clauses: where_clauses
         #  selected_columns: cols
       }) do
    table = Utils.relation_to_sql(relation)

    # NOTE: cannot filter on columns with REPLICA IDENTITY FULL
    # cols = if cols == nil, do: "", else: " (#{Enum.join(cols, ", ")})"
    cols = ""

    where =
      if where_clauses == nil,
        do: "",
        else:
          " WHERE " <>
            "(#{where_clauses |> Enum.map(& &1.query) |> Enum.join(" OR ")})"

    table <> cols <> where
  end
end
