defmodule Electric.Postgres.Configuration do
  @moduledoc """
  Module for functions that configure Postgres in some way using
  a provided connection.
  """
  require Logger
  alias Electric.Utils
  alias Electric.Replication.PublicationManager

  @type relation_filters :: PublicationManager.RelationTracker.relation_filters()

  @type publication_status :: %{
          can_alter_publication?: boolean(),
          publishes_all_operations?: boolean(),
          publishes_generated_columns?: boolean()
        }

  @type relation_actions :: %{
          to_preserve: relation_filters(),
          to_add: relation_filters(),
          to_drop: relation_filters(),
          to_configure_replica_identity: relation_filters(),
          to_invalidate: relation_filters()
        }

  @typep changed_relation ::
           {
             Electric.relation_id(),
             Electric.relation(),
             Electric.relation_id() | nil,
             Electric.relation() | nil
           }

  @typep relation_with_replica :: {Electric.relation_id(), Electric.relation(), <<_::8>>}

  @default_action_timeout 5_000

  @doc """
  Check whether the publication with the given name exists, and return its status.

  The status includes whether the publication is owned, whether it publishes all operations,
  and whether it publishes generated columns (if supported by the Postgres version).
  """
  @spec check_publication_status!(Postgrex.conn(), String.t()) ::
          publication_status() | :not_found
  def check_publication_status!(conn, publication_name) do
    # note: we could do a separate query to get the PG version, unsure which is more efficient
    # but avoiding having to know the PG version in advance keeps things contained and simple
    query =
      """
      SELECT
        pg_get_userbyid(p.pubowner) = current_role as can_alter_publication,
        pubinsert AND pubupdate AND pubdelete AND pubtruncate as publishes_all_operations,
        CASE WHEN current_setting('server_version_num')::int >= 180000
            THEN (to_jsonb(p) ->> 'pubgencols') = 's'
            ELSE FALSE
        END AS publishes_generated_columns
      FROM pg_publication as p WHERE pubname = $1;
      """

    Postgrex.query!(conn, query, [publication_name])
    |> case do
      %Postgrex.Result{
        rows: [[can_alter_publication, publishes_all_operations, publishes_generated_columns]]
      } ->
        %{
          can_alter_publication?: can_alter_publication,
          publishes_all_operations?: publishes_all_operations,
          publishes_generated_columns?: publishes_generated_columns
        }

      %Postgrex.Result{num_rows: 0} ->
        :not_found
    end
  end

  @spec add_table_to_publication(Postgrex.conn(), String.t(), Electric.oid_relation(), timeout()) ::
          :ok | {:error, term()}
  def add_table_to_publication(
        conn,
        publication_name,
        oid_relation,
        timeout \\ @default_action_timeout
      ) do
    {_oid, relation} = oid_relation
    table = Utils.relation_to_sql(relation)

    Logger.debug("Adding #{table} to publication #{publication_name}")

    run_in_transaction(
      conn,
      &exec_alter_publication_for_table(&1, publication_name, :add, table),
      timeout
    )
  end

  @spec set_table_replica_identity_full(Postgrex.conn(), Electric.oid_relation(), timeout()) ::
          :ok | {:error, term()}
  def set_table_replica_identity_full(conn, oid_relation, timeout \\ @default_action_timeout) do
    {_oid, relation} = oid_relation
    table = Utils.relation_to_sql(relation)
    Logger.debug("Setting #{table} replica identity to FULL")
    run_in_transaction(conn, &exec_set_replica_identity_full(&1, table), timeout)
  end

  @spec configure_table_for_replication(
          Postgrex.conn(),
          String.t(),
          Electric.oid_relation(),
          timeout()
        ) ::
          :ok | {:error, term()}
  def configure_table_for_replication(
        conn,
        publication_name,
        oid_relation,
        timeout \\ @default_action_timeout
      ) do
    run_in_transaction(
      conn,
      fn conn ->
        with :ok <- add_table_to_publication(conn, publication_name, oid_relation),
             :ok <- set_table_replica_identity_full(conn, oid_relation) do
          :ok
        end
      end,
      timeout
    )
  end

  @spec drop_table_from_publication(
          Postgrex.conn(),
          String.t(),
          Electric.oid_relation(),
          timeout()
        ) ::
          :ok | {:error, term()}
  def drop_table_from_publication(
        conn,
        publication_name,
        oid_relation,
        timeout \\ @default_action_timeout
      ) do
    {_oid, relation} = oid_relation
    table = Utils.relation_to_sql(relation)
    Logger.debug("Removing #{table} from publication #{publication_name}")

    run_in_transaction(
      conn,
      &exec_alter_publication_for_table(&1, publication_name, :drop, table),
      timeout
    )
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
          # undefined object can happen when removing a table that was already removed
          %{postgres: %{code: :undefined_object, message: "relation" <> _}} when op_atom == :drop ->
            :ok

          # duplicate object can happen when adding a table that was already added
          %{postgres: %{code: :duplicate_object}} when op_atom == :add ->
            :ok

          _ ->
            {:error, reason}
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
          relation_actions()
  def determine_publication_relation_actions!(conn, publication_name, expected_rels) do
    # New relations were configured using a schema read in a different transaction
    # (if at all, might have been from cache) so we need to check if any of
    # the relations were dropped/renamed since then
    to_invalidate =
      list_changed_relations!(conn, expected_rels |> Enum.to_list())
      |> Enum.map(&trim_changed_relation/1)
      |> MapSet.new()

    # Compare with current relations in the publication to determine what needs dropping/adding,
    # as well as reconfiguring because of misconfigured replica identity
    pub_tables = get_publication_tables!(conn, publication_name)
    publication_rels = MapSet.new(pub_tables, &trim_relation_with_replica/1)

    misconfigured_publication_rels =
      pub_tables
      |> Enum.filter(fn {_oid, _rel, replident} -> replident != "f" end)
      |> MapSet.new(&trim_relation_with_replica/1)

    correctly_configured_publication_rels =
      MapSet.difference(publication_rels, misconfigured_publication_rels)

    valid_expected = MapSet.difference(expected_rels, to_invalidate)

    to_preserve = MapSet.intersection(correctly_configured_publication_rels, valid_expected)

    to_reconfigure_replica_identity =
      MapSet.intersection(misconfigured_publication_rels, valid_expected)

    to_drop = MapSet.difference(publication_rels, valid_expected)
    to_add = MapSet.difference(valid_expected, publication_rels)

    to_configure_replica_identity =
      MapSet.union(
        to_reconfigure_replica_identity,
        get_replica_identities!(conn, to_add |> Enum.to_list())
        |> Enum.filter(fn {_oid, _rel, replident} -> replident != "f" end)
        |> Enum.map(&trim_relation_with_replica/1)
        |> MapSet.new()
      )

    %{
      to_preserve: to_preserve,
      to_add: to_add,
      to_drop: to_drop,
      to_configure_replica_identity: to_configure_replica_identity,
      to_invalidate: to_invalidate
    }
  end

  @spec get_publication_tables!(Postgrex.conn(), String.t()) :: list(relation_with_replica())
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

  @spec get_replica_identities!(Postgrex.conn(), list(Electric.oid_relation())) ::
          list(relation_with_replica())
  defp get_replica_identities!(_conn, []), do: []

  defp get_replica_identities!(conn, oid_relations) do
    oid_to_rel = Map.new(oid_relations, fn {oid, rel} -> {oid, {oid, rel}} end)
    oids = Map.keys(oid_to_rel)

    %Postgrex.Result{rows: rows} =
      Postgrex.query!(
        conn,
        """
        SELECT
          pc.oid, pc.relreplident
        FROM
          pg_class pc
        WHERE
          pc.oid = ANY($1::oid[])
        """,
        [oids]
      )

    Enum.map(rows, fn [oid, replident] ->
      {_, rel} = Map.fetch!(oid_to_rel, oid)
      {oid, rel, replident}
    end)
  end

  @spec list_changed_relations!(Postgrex.conn(), list(Electric.oid_relation())) ::
          list(changed_relation())
  defp list_changed_relations!(_conn, []), do: []

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

  defp run_in_transaction(db_pool, fun, timeout) do
    run_handling_db_connection_errors(fn ->
      case Postgrex.transaction(db_pool, fun, timeout: timeout) do
        {:ok, result} ->
          result

        {:error, :rollback} ->
          {:error, %RuntimeError{message: "Transaction unexpectedly rolled back"}}

        {:error, err} ->
          {:error, err}
      end
    end)
  end

  def run_handling_db_connection_errors(fun) do
    fun.()
  rescue
    err -> {:error, err}
  catch
    :exit, {_, {DBConnection.Holder, :checkout, _}} ->
      {:error, %DBConnection.ConnectionError{message: "Database connection not available"}}
  end

  @spec trim_changed_relation(changed_relation()) :: Electric.oid_relation()
  defp trim_changed_relation({oid, relation, _new_oid, _renamed_relation}), do: {oid, relation}

  @spec trim_relation_with_replica(relation_with_replica()) :: Electric.oid_relation()
  defp trim_relation_with_replica({oid, relation, _replident}), do: {oid, relation}
end
