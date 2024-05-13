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
          {Changes.Migration.ops(), [Electric.Postgres.relation()]}
  def to_ops(stmts, schema_version) do
    ops = {Changes.Migration.empty_ops(), MapSet.new()}

    stmts
    |> Enum.reduce(ops, fn stmt, {ops, relations} ->
      Changes.Migration.dialects()
      |> Enum.reduce({ops, relations}, fn dialect, {ops, relations} ->
        {:ok, new_ops, new_relations} = to_op(stmt, schema_version, dialect)

        {Map.update!(ops, dialect, &(&1 ++ new_ops)), Enum.into(new_relations, relations)}
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
    ast = Electric.Postgres.parse_with_locations!(stmt)

    case propagatable_stmt?(ast) do
      [] ->
        {:ok, [], []}

      propagate_ast ->
        {msg, relations} = build_replication_msg(propagate_ast, stmt, schema_version, dialect)

        {:ok, [msg], relations}
    end
  end

  def stmt_type({%{} = ast, _loc, _len}) do
    stmt_type(ast)
  end

  def stmt_type(%Pg.CreateStmt{}) do
    :CREATE_TABLE
  end

  def stmt_type(%Pg.IndexStmt{}) do
    :CREATE_INDEX
  end

  def stmt_type(%Pg.CreateEnumStmt{}) do
    :CREATE_ENUM_TYPE
  end

  def stmt_type(%Pg.AlterTableStmt{cmds: [cmd]}) do
    case cmd do
      %{node: {:alter_table_cmd, %Pg.AlterTableCmd{subtype: :AT_AddColumn}}} ->
        :ALTER_ADD_COLUMN
    end
  end

  # TODO: this slicing of statments is wrong. see [VAX-1828]
  defp to_sql({_ast, loc, len}, stmt, Dialect.Postgresql) do
    stmt
    |> String.slice(loc, len)
    |> String.trim()
  end

  defp to_sql({ast, _loc, _len}, _stmt, dialect), do: Dialect.to_sql(ast, dialect)

  def affected_tables(stmts, dialect \\ @default_dialect) when is_list(stmts) do
    stmts
    |> Enum.flat_map(&get_affected_table/1)
    |> Enum.uniq_by(&Dialect.table_name(&1, dialect))
  end

  defp get_affected_table({%{} = ast, _loc, _len}) do
    get_affected_table(ast)
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

  defp build_replication_msg(ast, stmt, schema_version, dialect) do
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
      ast
      |> Enum.reject(&(dialect == Dialect.SQLite and match?({%Pg.CreateEnumStmt{}, _, _}, &1)))
      |> Enum.map(
        &%SatOpMigrate.Stmt{
          type: stmt_type(&1),
          sql: to_sql(&1, stmt, dialect)
        }
      )

    enum_type =
      ast
      |> Enum.filter(&match?({%Pg.CreateEnumStmt{}, _, _}, &1))
      |> Enum.map(fn {enum_ast, _loc, _len} ->
        name = AST.map(enum_ast.type_name)
        values = AST.map(enum_ast.vals)
        %SatOpMigrate.EnumType{name: Dialect.table_name(name, dialect), values: values}
      end)
      |> case do
        [] -> nil
        [enum] -> enum
      end

    affected_entity =
      case {table, enum_type} do
        {%SatOpMigrate.Table{}, nil} -> {:table, table}
        {nil, %SatOpMigrate.EnumType{}} -> {:enum_type, enum_type}
        {nil, nil} -> nil
      end

    {%SatOpMigrate{
       version: SchemaLoader.Version.version(schema_version),
       affected_entity: affected_entity,
       stmts: stmts
     }, relations}
  end

  defp propagatable_stmt?(ast) do
    Enum.filter(ast, fn
      {%Pg.CreateStmt{}, _loc, _len} ->
        true

      {%Pg.IndexStmt{}, _loc, _len} ->
        true

      {%Pg.AlterTableStmt{
         cmds: [%{node: {:alter_table_cmd, %Pg.AlterTableCmd{subtype: :AT_AddColumn}}}]
       }, _loc, _len} ->
        true

      {%Pg.CreateEnumStmt{}, _loc, _len} ->
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

  defp replication_msg_table_col(%Proto.Column{} = column, _dialect) do
    %SatOpMigrate.Column{
      name: column.name,
      pg_type: replication_msg_table_col_type(column.type),
      sqlite_type: Dialect.type_name(column.type, Dialect.SQLite)
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
