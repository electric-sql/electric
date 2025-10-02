defmodule Electric.Postgres.Configuration do
  @moduledoc """
  Module for functions that configure Postgres in some way using
  a provided connection.
  """
  require Logger
  alias Electric.Utils
  alias Electric.Replication.PublicationManager

  @type relation_filters :: PublicationManager.relation_filters()
  @type relations_configured :: %{
          Electric.oid_relation() => :ok | {:error, :relation_invalidated | term()}
        }
  @type relations_checked :: %{
          Electric.oid_relation() =>
            :ok
            | {:error,
               :relation_invalidated
               | :relation_missing_from_publication
               | :misconfigured_replica_identity}
        }

  @typep changed_relation ::
           {
             Electric.relation_id(),
             Electric.relation(),
             Electric.relation_id() | nil,
             Electric.relation() | nil
           }

  @typep publication_relation :: {Electric.relation_id(), Electric.relation(), <<_::8>>}

  @doc """
  Check whether the state of the publication relations in the database matches the sets of
  filters passed into the function.

  For any of the relations in the filters that is missing from the publication or doesn't have its
  replica identity set to full, an error is returned.

  If some of the relations included in the publication have been modified (e.g. the table name
  has changed), those will be returned as a list of invalidated relations from this function to
  allow for the cleanup of their corresponding shapes.
  """
  @spec validate_publication_configuration!(Postgrex.conn(), relation_filters(), String.t()) ::
          {:ok, relations_configured()}
  def validate_publication_configuration!(conn, expected_rels, publication_name) do
    %{
      valid: valid,
      to_add: to_add,
      to_fix_replica_identity: to_fix,
      to_invalidate: to_invalidate
    } =
      determine_publication_relation_actions!(conn, publication_name, expected_rels)

    configuration_result =
      [
        Enum.map(valid, &{&1, :ok}),
        Enum.map(to_add, &{&1, {:error, :relation_missing_from_publicatio}}),
        Enum.map(to_fix, &{&1, {:error, :misconfigured_replica_identity}}),
        Enum.map(to_invalidate, &{&1, {:error, :relation_invalidated}})
      ]
      |> List.flatten()
      |> Map.new()

    if MapSet.size(to_add) == 0 and MapSet.size(to_fix) == 0 do
      Logger.info(fn ->
        tables = for {_, rel} <- valid, do: Utils.relation_to_sql(rel)

        "Verified publication #{publication_name} to include #{inspect(tables)} tables with REPLICA IDENTITY FULL"
      end)
    end

    {:ok, configuration_result}
  end

  @doc """
  Configure the publication to include all relevant tables, also setting table identity to `FULL`
  if necessary. Return a map of relations and whether they were successfully configured.

  Any tables that were previously configured but were either renamed or dropped will *not* be automatically
  re-added to the publication. Mentioned tables that have been renamed or dropped will be returned as a list.

  Important: this function should not be ran in a transaction, because it starts multiple
  internal transactions that are sometimes expected to fail.
  """
  @spec configure_publication!(Postgrex.conn(), String.t(), relation_filters()) ::
          relations_configured()
  def configure_publication!(conn, publication_name, new_relations) do
    Postgrex.transaction(conn, &do_configure_publication!(&1, publication_name, new_relations))
    |> case do
      {:ok, relations_configured} ->
        relations_configured

      {:error, reason} ->
        raise reason
    end
  end

  @spec do_configure_publication!(Postgrex.conn(), String.t(), relation_filters()) ::
          relations_configured()
  defp do_configure_publication!(conn, publication_name, new_publication_rels) do
    %{
      valid: valid,
      to_add: to_add,
      to_drop: to_drop,
      to_fix_replica_identity: to_fix,
      to_invalidate: to_invalidate
    } =
      determine_publication_relation_actions!(conn, publication_name, new_publication_rels)

    to_add = MapSet.union(to_add, to_fix) |> MapSet.to_list()
    to_drop = MapSet.to_list(to_drop)
    to_invalidate = MapSet.to_list(to_invalidate)

    if to_drop != [] or to_add != [] do
      Logger.info(
        "Configuring publication #{publication_name} to " <>
          "drop #{inspect(to_drop)} tables, and " <>
          "add #{inspect(to_add)} tables " <>
          "- skipping altered tables #{inspect(to_invalidate)}",
        publication_alter_drop_tables: to_drop,
        publication_alter_add_tables: to_add,
        publication_alter_invalid_tables: to_invalidate
      )
    end

    configuration_result =
      Enum.concat(
        Enum.map(to_drop, &{&1, drop_table_from_publication(conn, publication_name, &1)}),
        Enum.map(to_add, &{&1, add_table_to_publication(conn, publication_name, &1)})
      )
      |> Enum.concat(Enum.map(valid, &{&1, :ok}))
      |> Enum.concat(Enum.map(to_invalidate, &{&1, {:error, :relation_invalidated}}))
      |> Map.new()

    configuration_result
  end

  @spec add_table_to_publication(Postgrex.conn(), String.t(), Electric.oid_relation()) ::
          :ok | {:error, term()}
  defp add_table_to_publication(conn, publication_name, oid_relation) do
    {_oid, relation} = oid_relation
    table = Utils.relation_to_sql(relation)

    with :ok <- exec_alter_publication_for_table(conn, publication_name, :add, table),
         :ok <- exec_set_replica_identity_full(conn, table) do
      Logger.debug(
        "Added #{table} to publication #{publication_name} and " <>
          "set its replica identity to FULL"
      )

      :ok
    end
  end

  @spec drop_table_from_publication(Postgrex.conn(), String.t(), Electric.oid_relation()) ::
          :ok | {:error, term()}
  defp drop_table_from_publication(conn, publication_name, oid_relation) do
    {_oid, relation} = oid_relation
    table = Utils.relation_to_sql(relation)
    exec_alter_publication_for_table(conn, publication_name, :drop, table)
  end

  @spec exec_alter_publication_for_table(Postgrex.conn(), String.t(), :add | :drop, String.t()) ::
          :ok | {:error, term()}
  defp exec_alter_publication_for_table(conn, publication_name, op, table) do
    op =
      case op do
        :add -> "ADD"
        :drop -> "DROP"
      end

    publication_query =
      "ALTER PUBLICATION #{Utils.quote_name(publication_name)} #{op} TABLE #{table}"

    Postgrex.query!(conn, "SAVEPOINT before_publication", [])

    case Postgrex.query(conn, publication_query, []) do
      {:ok, _} ->
        Postgrex.query!(conn, "RELEASE SAVEPOINT before_publication", [])
        :ok

      {:error, reason} ->
        Postgrex.query!(conn, "ROLLBACK TO SAVEPOINT before_publication", [])
        Postgrex.query!(conn, "RELEASE SAVEPOINT before_publication", [])

        case reason do
          # Duplicate object error is raised if we're trying to add a table
          # to the publication when it's already there.
          %{postgres: %{code: :undefined_table}} -> :ok
          _ -> {:error, reason}
        end
    end
  end

  @spec exec_set_replica_identity_full(Postgrex.conn(), String.t()) :: :ok | {:error, term()}
  defp exec_set_replica_identity_full(conn, table) do
    Postgrex.query!(conn, "SAVEPOINT before_replica", [])

    case Postgrex.query(conn, "ALTER TABLE #{table} REPLICA IDENTITY FULL", []) do
      {:ok, _} ->
        Postgrex.query!(conn, "RELEASE SAVEPOINT before_replica", [])
        :ok

      {:error, reason} ->
        Postgrex.query!(conn, "ROLLBACK TO SAVEPOINT before_replica", [])
        Postgrex.query!(conn, "RELEASE SAVEPOINT before_replica", [])
        {:error, reason}
    end
  end

  @spec determine_publication_relation_actions!(Postgrex.conn(), String.t(), relation_filters()) ::
          %{
            valid: relation_filters(),
            to_add: relation_filters(),
            to_drop: relation_filters(),
            to_fix_replica_identity: relation_filters(),
            to_invalidate: relation_filters()
          }
  defp determine_publication_relation_actions!(conn, publication_name, expected_rels) do
    # New relations were configured using a schema read in a different transaction
    # (if at all, might have been from cache) so we need to check if any of
    # the relations were dropped/renamed since then
    to_invalidate =
      list_changed_relations!(conn, expected_rels)
      |> Enum.map(&trim_changed_relation/1)
      |> MapSet.new()

    # Compare with current relations in the publication to determine what needs dropping/adding,
    # as well as reconfiguring because of misconfigured replica identity
    {prev_valid_publication_rels, prev_misconfigured_publication_rels} =
      get_publication_tables!(conn, publication_name)
      |> Enum.split_with(fn {_oid, _rel, replident} -> replident == "f" end)

    valid = MapSet.new(prev_valid_publication_rels, &trim_publication_relation/1)

    to_fix_replica_identity =
      MapSet.new(prev_misconfigured_publication_rels, &trim_publication_relation/1)

    valid_expected = MapSet.difference(expected_rels, to_invalidate)
    to_drop = MapSet.difference(valid, valid_expected)
    to_add = MapSet.difference(valid_expected, valid)

    %{
      valid: valid,
      to_add: to_add,
      to_drop: to_drop,
      to_fix_replica_identity: to_fix_replica_identity,
      to_invalidate: to_invalidate
    }
  end

  @spec get_publication_tables!(Postgrex.conn(), String.t()) :: list(publication_relation())
  def get_publication_tables!(conn, publication) do
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

  @spec list_changed_relations!(Postgrex.conn(), relation_filters()) :: list(changed_relation())
  defp list_changed_relations!(conn, known_relations) do
    # We're checking whether the table has been renamed (same oid, different name) or
    # dropped (maybe same name exists, but different oid). If either is true, we need to update
    # the new filters and maybe notify existing shapes.
    {oids, relations} = Enum.unzip(known_relations)
    {schemas, tables} = Enum.unzip(relations)

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

  @spec trim_changed_relation(changed_relation()) :: Electric.oid_relation()
  defp trim_changed_relation({oid, relation, _new_oid, _renamed_relation}), do: {oid, relation}

  @spec trim_publication_relation(publication_relation()) :: Electric.oid_relation()
  defp trim_publication_relation({oid, relation, _replident}), do: {oid, relation}
end
