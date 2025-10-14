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
          Electric.oid_relation() =>
            {:ok, :validated | :added | :dropped} | {:error, :schema_changed | term()}
        }
  @type relations_checked :: %{
          Electric.oid_relation() =>
            :ok
            | {:error,
               :schema_changed
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
  Check whether the publication with the given name exists, is configured to
  publish all required operations, and is owned by the current user.
  """
  @spec check_publication_status!(Postgrex.conn(), String.t()) :: :ok
  def check_publication_status!(conn, publication_name) do
    query =
      """
      SELECT
        pubinsert AND pubupdate AND pubdelete AND pubtruncate as all_operations,
        pg_get_userbyid(p.pubowner) = current_role as is_owned
      FROM pg_publication as p WHERE pubname = $1
      """

    Postgrex.query!(conn, query, [publication_name])
    |> one_or_nil()
    |> case do
      %{"all_operations" => true, "is_owned" => true} ->
        :ok

      %{"is_owned" => false} ->
        raise Electric.DbConfigurationError.publication_not_owned(publication_name)

      %{"all_operations" => false} ->
        raise Electric.DbConfigurationError.publication_missing_operations(publication_name)

      _ ->
        raise Electric.DbConfigurationError.publication_missing(publication_name)
    end
  end

  defp one_or_nil(%Postgrex.Result{rows: [row], columns: cols}),
    do: Enum.zip(cols, row) |> Map.new()

  defp one_or_nil(_), do: nil

  @doc """
  Check whether the state of the publication relations in the database matches the sets of
  filters passed into the function.

  For any of the relations in the filters that is missing from the publication or doesn't have its
  replica identity set to full, an error is returned.

  If some of the relations included in the publication have been modified (e.g. the table name
  has changed), those will be returned as a list of invalidated relations from this function to
  allow for the cleanup of their corresponding shapes.
  """
  @spec validate_publication_configuration!(Postgrex.conn(), String.t(), relation_filters()) ::
          relations_configured()
  def validate_publication_configuration!(conn, publication_name, expected_rels) do
    %{
      to_preserve: to_preserve,
      to_add: to_add,
      to_reconfigure: to_reconfigure,
      to_invalidate: to_invalidate
    } =
      determine_publication_relation_actions!(conn, publication_name, expected_rels)

    configuration_result =
      [
        Enum.map(to_preserve, &{&1, {:ok, :validated}}),
        Enum.map(to_add, &{&1, {:error, :relation_missing_from_publication}}),
        Enum.map(to_reconfigure, &{&1, {:error, :misconfigured_replica_identity}}),
        Enum.map(to_invalidate, &{&1, {:error, :schema_changed}})
      ]
      |> Stream.concat()
      |> Map.new()

    if MapSet.size(to_add) == 0 and MapSet.size(to_reconfigure) == 0 do
      Logger.info(fn ->
        tables = for {_, rel} <- to_preserve, do: Utils.relation_to_sql(rel)

        "Verified publication #{publication_name} to include #{inspect(tables)} tables with REPLICA IDENTITY FULL"
      end)
    end

    configuration_result
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
        Logger.debug(
          "Publication configuration committed - result: #{inspect(relations_configured)}"
        )

        relations_configured

      {:error, reason} ->
        raise reason
    end
  end

  @spec do_configure_publication!(Postgrex.conn(), String.t(), relation_filters()) ::
          relations_configured()
  defp do_configure_publication!(conn, publication_name, new_publication_rels) do
    %{
      to_preserve: to_preserve,
      to_add: to_add,
      to_drop: to_drop,
      to_reconfigure: to_reconfigure,
      to_invalidate: to_invalidate
    } =
      determine_publication_relation_actions!(conn, publication_name, new_publication_rels)

    # Re-add tables that need fixing
    to_add = MapSet.union(to_add, to_reconfigure)

    if MapSet.size(to_add) > 0 or MapSet.size(to_drop) > 0 do
      to_add_list = for {_, rel} <- to_add, do: Utils.relation_to_sql(rel)
      to_drop_list = for {_, rel} <- to_drop, do: Utils.relation_to_sql(rel)
      to_invalidate_list = for {_, rel} <- to_invalidate, do: Utils.relation_to_sql(rel)

      Logger.info(
        "Configuring publication #{publication_name} to " <>
          "drop #{inspect(to_drop_list)} tables, and " <>
          "add #{inspect(to_add_list)} tables " <>
          "- skipping altered tables #{inspect(to_invalidate_list)}",
        publication_alter_drop_tables: to_drop_list,
        publication_alter_add_tables: to_add_list,
        publication_alter_invalid_tables: to_invalidate_list
      )
    end

    # Notes on avoiding deadlocks
    # - `ALTER TABLE` should be after the publication altering, because it takes out an exclusive lock over this table,
    #   but the publication altering takes out a shared lock on all mentioned tables, so a concurrent transaction will
    #   deadlock if the order is reversed, and we've seen this happen even within the context of a single process perhaps
    #   across multiple calls from separate deployments or timing issues.
    # - It is important for all table operations to also occur in the same order to avoid deadlocks due to
    #   lock ordering issues, so despite splitting drop and add operations we sort them and process them together
    #   in a sorted single pass
    results =
      Enum.concat(
        Enum.map(to_drop, &{&1, :drop}),
        Enum.map(to_add, &{&1, :add})
      )
      |> Enum.sort(&(elem(&1, 0) <= elem(&2, 0)))
      |> Enum.map(fn
        {rel, :drop} -> {rel, drop_table_from_publication(conn, publication_name, rel)}
        {rel, :add} -> {rel, add_table_to_publication(conn, publication_name, rel)}
      end)
      |> Enum.map(fn
        {rel, {:ok, :added}} ->
          with {:ok, :configured} <- set_table_replica_identity_full(conn, rel) do
            {rel, {:ok, :added}}
          end

        res ->
          res
      end)

    configuration_result =
      results
      |> Enum.concat(Enum.map(to_preserve, &{&1, {:ok, :validated}}))
      |> Enum.concat(Enum.map(to_invalidate, &{&1, {:error, :schema_changed}}))
      |> Map.new()

    configuration_result
  end

  @spec add_table_to_publication(Postgrex.conn(), String.t(), Electric.oid_relation()) ::
          {:ok, :added} | {:error, term()}
  defp add_table_to_publication(conn, publication_name, oid_relation) do
    {_oid, relation} = oid_relation
    table = Utils.relation_to_sql(relation)

    Logger.debug("Adding #{table} to publication #{publication_name}")

    with :ok <- exec_alter_publication_for_table(conn, publication_name, :add, table) do
      {:ok, :added}
    end
  end

  @spec set_table_replica_identity_full(Postgrex.conn(), Electric.oid_relation()) ::
          {:ok, :configured} | {:error, term()}
  defp set_table_replica_identity_full(conn, oid_relation) do
    {_oid, relation} = oid_relation
    {schema, name} = relation
    table = Utils.relation_to_sql(relation)

    case Postgrex.query(
           conn,
           """
           SELECT c.relreplident
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND c.relname = $2
           """,
           [schema, name]
         ) do
      {:ok, %Postgrex.Result{rows: [[<<"f">>]]}} ->
        Logger.debug("Replica identity already FULL for #{table}, skipping")
        {:ok, :configured}

      {:ok, _} ->
        Logger.debug("Setting #{table} replica identity to FULL")

        with :ok <- exec_set_replica_identity_full(conn, table) do
          {:ok, :configured}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @spec drop_table_from_publication(Postgrex.conn(), String.t(), Electric.oid_relation()) ::
          {:ok, :dropped} | {:error, term()}
  defp drop_table_from_publication(conn, publication_name, oid_relation) do
    {_oid, relation} = oid_relation
    table = Utils.relation_to_sql(relation)
    Logger.debug("Removing #{table} from publication #{publication_name}")

    with :ok <- exec_alter_publication_for_table(conn, publication_name, :drop, table) do
      {:ok, :dropped}
    end
  end

  @spec exec_alter_publication_for_table(Postgrex.conn(), String.t(), :add | :drop, String.t()) ::
          :ok | {:error, term()}
  defp exec_alter_publication_for_table(conn, publication_name, op_atom, table) do
    op =
      case op_atom do
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
          # undefined table can happen when removing a table that was already removed
          %{postgres: %{code: :undefined_object}} when op_atom == :drop -> :ok
          # duplicate object can happen when adding a table that was already added
          %{postgres: %{code: :duplicate_object}} when op_atom == :add -> :ok
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
            to_preserve: relation_filters(),
            to_add: relation_filters(),
            to_drop: relation_filters(),
            to_reconfigure: relation_filters(),
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

    invalid = MapSet.new(prev_misconfigured_publication_rels, &trim_publication_relation/1)

    valid_expected = MapSet.difference(expected_rels, to_invalidate)
    to_preserve = MapSet.intersection(valid, valid_expected)
    to_reconfigure = MapSet.intersection(invalid, valid_expected)
    to_drop = MapSet.difference(MapSet.union(invalid, valid), valid_expected)
    to_add = MapSet.difference(valid_expected, valid)

    %{
      to_preserve: to_preserve,
      to_add: to_add,
      to_drop: to_drop,
      to_reconfigure: to_reconfigure,
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
