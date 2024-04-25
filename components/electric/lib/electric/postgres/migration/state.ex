defmodule Electric.Postgres.Migration.State do
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Migration
  alias Electric.Replication.Changes.NewRecord

  alias Electric.Postgres.{
    Extension,
    Extension.SchemaLoader,
    Schema
  }

  alias Electric.Telemetry.Metrics

  import Electric.Postgres.Extension,
    only: [
      is_ddl_relation: 1,
      is_migration_relation: 1
    ]

  require Logger

  @type apply_migration_opt() ::
          {:schema_change_handler, (SchemaLoader.Version.t(), SchemaLoader.Version.t() -> none())}
  @type apply_migration_opts() :: [apply_migration_opt()]
  @type data_changes() :: [Changes.data_change()]
  @type update_opt() :: apply_migration_opt() | {:skip_applied, boolean()}
  @type update_opts() :: [update_opt()]

  # useful for testing
  @doc false
  @spec convert(data_changes(), SchemaLoader.t()) :: [Changes.change()]
  def convert(changes, loader) do
    {changes, _loader} =
      chunk_convert(changes, loader, fn version, _stmts, loader ->
        {:ok, schema_version} = SchemaLoader.load(loader, version)
        {schema_version, loader}
      end)

    changes
  end

  @doc """
  Update Electric's migration state with a set of changes from the replication stream.
  """
  @spec update(data_changes(), SchemaLoader.t(), update_opts()) ::
          {[Changes.change()], SchemaLoader.t()}
  def update(changes, loader, opts \\ []) do
    chunk_convert(changes, loader, opts, fn version, stmts, loader ->
      {_schema_version, _loader} = perform_migration(version, stmts, loader, opts)
    end)
  end

  defp chunk_convert(changes, loader, opts \\ [], version_callback) do
    changes
    |> chunk_migrations()
    |> Enum.flat_map_reduce(loader, fn
      [%{relation: relation} | _] = changes, loader when is_migration_relation(relation) ->
        changes
        |> transaction_changes_to_migrations(loader)
        |> skip_applied_migrations(loader, opts[:skip_applied])
        |> Enum.map_reduce(loader, fn {version, stmts}, loader ->
          {schema_version, loader} = version_callback.(version, stmts, loader)

          {migration(version, schema_version, stmts), loader}
        end)

      changes, loader ->
        {changes, loader}
    end)
  end

  defp chunk_migrations(changes) do
    Enum.chunk_by(changes, fn
      %NewRecord{relation: relation} -> is_migration_relation(relation)
      _ -> false
    end)
  end

  defp migration(version, schema_version, stmts) do
    {ops, relations} = Electric.Postgres.Migration.to_ops(stmts, schema_version)

    %Migration{
      version: version,
      schema: schema_version,
      ddl: stmts,
      ops: ops,
      relations: relations
    }
  end

  defp skip_applied_migrations(migrations, loader, true) do
    {:ok, %{version: current_schema_version}} = SchemaLoader.load(loader)

    Enum.drop_while(migrations, fn {version, _stmts} -> version <= current_schema_version end)
  end

  defp skip_applied_migrations(changes, _loader, _false) do
    changes
  end

  defp transaction_changes_to_migrations(changes, loader) do
    changes
    |> Enum.filter(fn
      %NewRecord{relation: relation} -> is_ddl_relation(relation)
      _ -> false
    end)
    |> Enum.map_reduce(%{}, fn %{record: record}, version_cache ->
      {version, version_cache} = ddl_statement_version(record, version_cache, loader)
      {:ok, sql} = Extension.extract_ddl_sql(record)
      {{version, sql}, version_cache}
    end)
    |> elem(0)
    |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
  end

  defp ddl_statement_version(record, version_cache, loader) do
    {:ok, txid} = Extension.extract_ddl_txid(record)

    case Map.fetch(version_cache, txid) do
      {:ok, version} ->
        {version, version_cache}

      :error ->
        {:ok, version} = SchemaLoader.tx_version(loader, record)
        {version, Map.put(version_cache, txid, version)}
    end
  end

  defp perform_migration(version, stmts, loader, opts) do
    {:ok, loader, schema_version} = apply_migration(version, stmts, loader, opts)

    Metrics.non_span_event(
      [:postgres, :migration],
      %{electrified_tables: Schema.num_electrified_tables(schema_version.schema)},
      %{migration_version: version}
    )

    {schema_version, loader}
  end

  @doc """
  Apply a migration, composed of a version and a list of DDL statements, to a schema
  using the given implementation of SchemaLoader.
  """
  @spec apply_migration(String.t(), [String.t()], SchemaLoader.t(), apply_migration_opts()) ::
          {:ok, SchemaLoader.t(), SchemaLoader.Version.t()} | {:error, term()}
  def apply_migration(version, stmts, loader, opts \\ [])
      when is_binary(version) and is_list(stmts) do
    with {:ok, old_schema_version} <- SchemaLoader.load(loader) do
      Logger.info("Migrating version #{old_schema_version.version || "<nil>"} -> #{version}")

      oid_loader = &SchemaLoader.relation_oid(loader, &1, &2, &3)

      schema =
        stmts
        |> Enum.reduce(old_schema_version.schema, fn stmt, schema ->
          Logger.info("Applying migration #{version}: #{inspect(stmt)}")
          Schema.update(schema, stmt, oid_loader: oid_loader)
        end)
        |> Schema.add_shadow_tables(oid_loader: oid_loader)

      Logger.info("Saving schema version #{version}")

      with {:ok, loader, new_schema_version} <- SchemaLoader.save(loader, version, schema, stmts) do
        if change_handler = opts[:schema_change_handler],
          do: change_handler.(old_schema_version, new_schema_version)

        {:ok, loader, new_schema_version}
      end
    end
  end
end
