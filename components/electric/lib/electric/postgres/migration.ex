defmodule Electric.Postgres.Migration do
  use Electric.Satellite.Protobuf

  alias PgQuery, as: Pg

  alias Electric.Postgres.{
    CachedWal,
    Dialect,
    Extension,
    Extension.SchemaLoader,
    Schema.AST,
    Schema.Proto
  }

  alias Electric.Replication.Changes
  alias Electric.Replication.Connectors

  @default_dialect Dialect.SQLite

  @doc """
  Convert migration history entries to a list of migration transactions.
  """
  @spec to_transactions([Extension.Migration.t()], Connectors.origin(), CachedWal.Api.wal_pos()) ::
          [Changes.Transaction.t()]
  def to_transactions(migrations, origin, lsn) do
    publication = Extension.publication_name()

    Enum.map(migrations, fn %Extension.Migration{} = migration ->
      schema_version = SchemaLoader.Version.new(migration.version, migration.schema)
      {ops, relations} = to_ops(migration.stmts, schema_version)

      %Changes.Transaction{
        xid: migration.txid,
        changes: [
          %Changes.Migration{
            version: migration.version,
            schema: schema_version,
            ddl: migration.stmts,
            ops: ops,
            relations: relations
          }
        ],
        commit_timestamp: migration.timestamp,
        origin: origin,
        publication: publication,
        lsn: lsn
      }
    end)
  end

  @doc false
  @spec to_ops([String.t()], SchemaLoader.Version.t()) ::
          {Changes.Migration.Ops.t(), [Electric.Postgres.relation()]}
  def to_ops(stmts, schema_version) do
    stmts
    |> Enum.reduce({%Changes.Migration.Ops{}, MapSet.new()}, fn stmt, {ops, relations} ->
      Changes.Migration.dialects()
      |> Enum.reduce(ops, fn {key, dialect}, ops ->
        {:ok, new_ops, new_relations} = to_op(stmt, schema_version, dialect)

        {Map.update!(ops, key, &(&1 ++ new_ops)), Enum.into(new_relations, relations)}
      end)
    end)
    |> then(fn {ops, relations} -> {ops, MapSet.to_list(relations)} end)
  end

  # We get a list of sql statements and a schema:
  #
  # 1. generate the sqlite sql from the ast
  # 2. get the list of tables involved in the migration
  # 3. use the updated schema to get column, fk and pk information for the affected tables
  #
  # - creation of indexes doesn't affect any tables so that list should be empty
  @spec to_op(String.t(), SchemaLoader.Version.t(), Electric.Postgres.Dialect.t()) ::
          {:ok, [%SatOpMigrate{}], [Electric.Postgres.relation()]}
  def to_op(stmt, schema_version, dialect \\ @default_dialect) do
    ast = Electric.Postgres.parse!(stmt)

    case propagatable_stmt?(ast) do
      [] ->
        {:ok, [], []}

      propagate_ast ->
        {msg, relations} = build_replication_msg(propagate_ast, schema_version, dialect)

        {:ok, [msg], relations}
    end
  end

  def stmt_type(%Pg.CreateStmt{}) do
    :CREATE_TABLE
  end

  def stmt_type(%Pg.IndexStmt{}) do
    :CREATE_INDEX
  end

  def stmt_type(%Pg.AlterTableStmt{cmds: [cmd]}) do
    case cmd do
      %{node: {:alter_table_cmd, %Pg.AlterTableCmd{subtype: :AT_AddColumn}}} ->
        :ALTER_ADD_COLUMN
    end
  end

  def affected_tables(stmts, dialect \\ @default_dialect) when is_list(stmts) do
    stmts
    |> Enum.flat_map(&get_affected_table/1)
    |> Enum.uniq_by(&Dialect.table_name(&1, dialect))
  end

  defp get_affected_table(%Pg.CreateStmt{relation: relation}) do
    [AST.map(relation)]
  end

  defp get_affected_table(%Pg.AlterTableStmt{relation: relation}) do
    [AST.map(relation)]
  end

  defp get_affected_table(%Pg.IndexStmt{}) do
    []
  end

  defp get_affected_table(_stmt) do
    []
  end

  defp build_replication_msg(ast, schema_version, dialect) do
    affected_tables = affected_tables(ast, dialect)

    relations = Enum.map(affected_tables, &{&1.schema, &1.name})

    tables =
      affected_tables
      |> Enum.map(&SchemaLoader.Version.table!(schema_version, &1))
      |> Enum.map(&replication_msg_table(&1, dialect))

    table =
      case tables do
        [] -> nil
        [table] -> table
      end

    stmts =
      Enum.map(
        ast,
        &%SatOpMigrate.Stmt{
          type: stmt_type(&1),
          sql: Dialect.to_sql(&1, dialect)
        }
      )

    {%SatOpMigrate{
       version: SchemaLoader.Version.version(schema_version),
       table: table,
       stmts: stmts
     }, relations}
  end

  defp propagatable_stmt?(ast) do
    Enum.filter(ast, fn
      %Pg.CreateStmt{} ->
        true

      %Pg.IndexStmt{} ->
        true

      %Pg.AlterTableStmt{
        cmds: [%{node: {:alter_table_cmd, %Pg.AlterTableCmd{subtype: :AT_AddColumn}}}]
      } ->
        true

      _else ->
        false
    end)
  end

  defp replication_msg_table(%Proto.Table{} = table, dialect) do
    %SatOpMigrate.Table{
      name: Dialect.table_name(table.name, dialect),
      columns: Enum.map(table.columns, &replication_msg_table_col(&1, dialect)),
      fks: Enum.flat_map(table.constraints, &replication_msg_table_fk(&1, dialect)),
      pks: Enum.flat_map(table.constraints, &replication_msg_table_pk(&1, dialect))
    }
  end

  defp replication_msg_table_col(%Proto.Column{} = column, dialect) do
    %SatOpMigrate.Column{
      name: column.name,
      pg_type: replication_msg_table_col_type(column.type),
      sqlite_type: Dialect.type_name(column.type, dialect)
    }
  end

  defp replication_msg_table_col_type(%Proto.Column.Type{} = type) do
    %SatOpMigrate.PgColumnType{
      name: type.name,
      array: type.array,
      size: type.size
    }
  end

  defp replication_msg_table_pk(%Proto.Constraint{constraint: {:primary, pk}}, _dialect) do
    pk.keys
  end

  defp replication_msg_table_pk(_constraint, _dialect) do
    []
  end

  defp replication_msg_table_fk(%Proto.Constraint{constraint: {:foreign, fk}}, dialect) do
    [
      %SatOpMigrate.ForeignKey{
        fk_cols: fk.fk_cols,
        pk_cols: fk.pk_cols,
        pk_table: Dialect.table_name(fk.pk_table, dialect)
      }
    ]
  end

  defp replication_msg_table_fk(_constraint, _dialect) do
    []
  end
end
