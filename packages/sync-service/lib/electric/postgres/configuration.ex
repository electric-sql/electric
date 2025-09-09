defmodule Electric.Postgres.Configuration do
  @moduledoc """
  Module for functions that configure Postgres in some way using
  a provided connection.
  """
  require Logger
  alias Electric.Utils

  @type relation_filters :: MapSet.t(Electric.oid_relation())

  @doc """
  Check whether the state of the publication relations in the database matches the sets of
  filters passed into the function.

  If any of the relations in the filters are missing from the publication or don't have their
  replica identity set to full, an error is returned.

  If some of the relations included in the publication have been modified (e.g. the table name
  has changed), those will be returned as a list of modified relations from this function to
  allow for the cleanup of their corresponding shapes.
  """
  @spec check_publication_relations_and_identity(
          Postgrex.conn(),
          relation_filters(),
          relation_filters(),
          String.t()
        ) ::
          :ok
          | {:error,
             {:misconfigured_replica_identity, relation_filters()}
             | {:table_missing_from_publication, relation_filters()}}
  def check_publication_relations_and_identity(
        conn,
        previous_relations,
        new_relations,
        publication_name
      ) do
    known_relations = known_relations(previous_relations, new_relations)
    changed_relations = list_changed_relations(conn, known_relations)
    published_relations = get_publication_tables(conn, publication_name)

    with :ok <-
           check_relations_in_publication(
             published_relations,
             MapSet.union(previous_relations, new_relations),
             changed_relations
           ),
         :ok <- check_replica_identity(published_relations) do
      tables = for {_, relation, _} <- published_relations, do: Utils.relation_to_sql(relation)

      Logger.info(
        "Verified publication #{publication_name} to include #{inspect(tables)} tables with REPLICA IDENTITY FULL"
      )

      {:ok, Enum.map(changed_relations, &trim_changed_relation/1) |> MapSet.new()}
    end
  end

  defp check_relations_in_publication(published_relations, known_relations, changed_relations) do
    published_relations_set =
      MapSet.new(published_relations, fn {oid, relation, _replica_identity} -> {oid, relation} end)

    diff_set = MapSet.difference(known_relations, published_relations_set)

    if MapSet.size(diff_set) == 0 do
      :ok
    else
      # Some of the known relations are not published. It's okay if they have been dropped or
      # renamed, their corresponding shapes will get cleaned up by the publication manager.
      missing_relations =
        Enum.filter(diff_set, fn {oid, relation} ->
          case List.keyfind(changed_relations, oid, 0) do
            {^oid, ^relation, nil, _} ->
              # Dropped relation, so it physically can no longer be included in the publication.
              false

            {^oid, ^relation, ^oid, renamed_relation} when relation != renamed_relation ->
              # Renamed relation. Its shape will be cleaned up and the validation performed on
              # the next add_shape() request will succeed since the new relation is already
              # included in the publication under the new name.
              false

            nil ->
              # The relation is not included in the publication and hasn't been changed, so it
              # is indeed an error which must be corrected by the database admin.
              true
          end
        end)
        |> MapSet.new()

      if MapSet.size(missing_relations) == 0 do
        :ok
      else
        {:error, {:tables_missing_from_publication, missing_relations}}
      end
    end
  end

  defp check_replica_identity(relations) do
    bad_relations =
      Enum.reject(relations, fn {_oid, _relation, replica_identity} -> replica_identity == "f" end)

    if bad_relations == [] do
      :ok
    else
      {:error,
       {:misconfigured_replica_identity,
        Enum.map(bad_relations, fn {oid, relation, _ident} -> {oid, relation} end) |> MapSet.new()}}
    end
  end

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
          prev_relations :: relation_filters(),
          new_relations :: relation_filters(),
          String.t()
        ) ::
          relations_failed_to_configure
        when relations_failed_to_configure: relation_filters()
  def configure_publication!(conn, previous_relations, new_relations, publication_name) do
    Postgrex.transaction(conn, fn conn ->
      # "New filters" were configured using a schema read in a different transaction (if at all, might have been from cache)
      # so we need to check if any of the relations were dropped/renamed since then
      changed_relations =
        conn
        |> list_changed_relations(known_relations(previous_relations, new_relations))
        |> Enum.map(&trim_changed_relation/1)
        |> MapSet.new()

      used_relations = MapSet.difference(new_relations, changed_relations)

      if MapSet.size(changed_relations) == 0,
        do:
          Logger.info(
            "Configuring publication #{publication_name} to include #{map_size(used_relations)} tables - " <>
              "skipping altered tables #{inspect(MapSet.to_list(changed_relations))}"
          )

      alter_publication!(conn, publication_name, used_relations)

      # `ALTER TABLE` should be after the publication altering, because it takes out an exclusive lock over this table,
      # but the publication altering takes out a shared lock on all mentioned tables, so a concurrent transaction will
      # deadlock if the order is reversed.
      set_replica_identity!(conn, used_relations)

      changed_relations
    end)
    |> case do
      {:ok, missing_relations} ->
        missing_relations

      {:error, reason} ->
        raise reason
    end
  end

  defp known_relations(previous_relations, new_relations) do
    known_relations = MapSet.union(previous_relations, new_relations)
    {oids, relations} = Enum.unzip(known_relations)
    {schemas, tables} = Enum.unzip(relations)
    {oids, schemas, tables}
  end

  defp list_changed_relations(conn, known_relations) do
    # We're checking whether the table has been renamed (same oid, different name) or
    # dropped (maybe same name exists, but different oid). If either is true, we need to update
    # the new filters and maybe notify existing shapes.

    {oids, schemas, tables} = known_relations

    %Postgrex.Result{rows: rows} =
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
          ir.oid, (ir.input_nspname, ir.input_relname) as input_relation, pc.oid, (pn.nspname, pc.relname)
        FROM input_relations ir
        LEFT JOIN pg_class pc ON pc.oid = ir.oid
        LEFT JOIN pg_namespace pn ON pc.relnamespace = pn.oid
        WHERE pc.oid IS NULL OR (pc.relname != input_relname OR pn.nspname != input_nspname)
        """,
        [oids, schemas, tables]
      )

    Enum.map(rows, &List.to_tuple/1)
  end

  defp alter_publication!(conn, publication_name, relation_filters) do
    publication = Utils.quote_name(publication_name)

    prev_published_tables =
      get_publication_tables(conn, publication_name)
      |> Enum.map(fn {_oid, relation, _replident} -> Utils.relation_to_sql(relation) end)
      |> MapSet.new()

    new_published_tables =
      relation_filters
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

  defp set_replica_identity!(conn, relation_filters) do
    query_for_relations_without_full_identity = """
    SELECT nspname, relname
    FROM pg_class pc
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    WHERE relreplident != 'f' AND pc.oid = ANY($1)
    """

    oids = Enum.map(relation_filters, &elem(&1, 0))

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

  @spec get_publication_tables(Postgrex.conn(), String.t()) ::
          list({Electric.relation_id(), Electric.relation(), String.t()})
  def get_publication_tables(conn, publication) do
    # `pg_publication_tables` is too clever for us -- if you add a partitioned
    # table to the publication `pg_publication_tables` lists all the partitions
    # as members, not the actual partitioned table. `pg_publication_rel`
    # doesn't do this, it returns a direct list of the tables that were added
    # using `ALTER PUBLICATION` and doesn't expand a partitioned table into its
    # partitions.
    %Postgrex.Result{rows: rows} =
      Postgrex.query!(
        conn,
        """
        SELECT
          pc.oid, (pn.nspname, pc.relname), pc.relreplident
        FROM
          pg_publication_rel ppr
        JOIN
          pg_publication pp ON ppr.prpubid = pp.oid
        JOIN
          pg_class pc ON pc.oid = ppr.prrelid
        JOIN
          pg_namespace pn ON pc.relnamespace = pn.oid
        WHERE
          pp.pubname = $1
        ORDER BY
          pn.nspname, pc.relname
        """,
        [publication]
      )

    Enum.map(rows, &List.to_tuple/1)
  end

  defp trim_changed_relation({oid, relation, _new_oid, _renamed_relation}), do: {oid, relation}
end
