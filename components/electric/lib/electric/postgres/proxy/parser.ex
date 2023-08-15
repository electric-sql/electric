defmodule Electric.Postgres.Proxy.Parser.Macros do
  defmacro defkeyword(function, keyword, opts \\ [], do: block) do
    chars =
      keyword
      |> String.codepoints()
      |> Enum.map(fn char -> [String.downcase(char), String.upcase(char)] end)
      |> Enum.map(fn [<<l::8>>, <<u::8>>] -> [l, u] end)

    whitespace = if Keyword.get(opts, :trailing, true), do: [~c"\t\n\r "], else: []
    chars = Enum.with_index(chars ++ whitespace)
    pattern = build_match(chars)
    guards = build_guards(chars)

    quote do
      def unquote(function)(unquote(pattern) = var!(stmt)) when unquote(guards) do
        _ = var!(rest)
        _ = var!(stmt)
        unquote(block)
      end
    end
  end

  defp build_match(chars) do
    {:<<>>, [],
     Enum.map(chars, fn {_c, i} -> {:"::", [], [{:"c#{i}", [], Elixir}, 8]} end) ++
       [{:"::", [], [{:var!, [], [{:rest, [], Elixir}]}, {:binary, [], Elixir}]}]}
  end

  defp build_guards([{c, i}]) do
    {:in, [], [{:"c#{i}", [], Elixir}, c]}
  end

  defp build_guards([{c, i} | rest]) do
    {:and, [], [{:in, [], [{:"c#{i}", [], Elixir}, c]}, build_guards(rest)]}
  end
end

defmodule Electric.Postgres.Proxy.Parser do
  import __MODULE__.Macros

  @default_schema "public"
  @wspc ~c"\t\n\r "

  def parse(sql) do
    with {:ok, ast} <- PgQuery.parse(sql) do
      {:ok, stmt(ast)}
    end
  end

  @spec table_name(binary() | struct(), Keyword.t()) ::
          {:ok, {String.t(), String.t()}} | {:error, term()}
  def table_name(query, opts \\ [])

  def table_name(query, opts) when is_binary(query) do
    with {:ok, ast} <- parse(query) do
      table_name(ast, opts)
    end
  end

  def table_name(%PgQuery.InsertStmt{} = stmt, opts) do
    %{schemaname: s, relname: n} = stmt.relation
    {:ok, {blank(s, opts), n}}
  end

  def table_name(%PgQuery.AlterTableStmt{} = stmt, opts) do
    %{schemaname: s, relname: n} = stmt.relation
    {:ok, {blank(s, opts), n}}
  end

  def table_name(%PgQuery.IndexStmt{} = stmt, opts) do
    %{schemaname: s, relname: n} = stmt.relation
    {:ok, {blank(s, opts), n}}
  end

  def table_name(%PgQuery.RenameStmt{} = stmt, opts) do
    %{schemaname: s, relname: n} = stmt.relation
    {:ok, {blank(s, opts), n}}
  end

  # TODO: drop table supports a list of table names, but let's not support that for the moment
  def table_name(%PgQuery.DropStmt{objects: [object]} = _stmt, opts) do
    %{node: {:list, %{items: items}}} = object
    names = Enum.map(items, fn %{node: {:string, %{sval: n}}} -> n end)

    name =
      case names do
        [_tablespace, schema, table] ->
          {schema, table}

        [schema, table] ->
          {schema, table}

        [table] ->
          {blank(nil, opts), table}
      end

    {:ok, name}
  end

  #   enum AlterTableType
  # {
  #   ALTER_TABLE_TYPE_UNDEFINED = 0;
  #   AT_AddColumn = 1;
  #   AT_AddColumnRecurse = 2;
  #   AT_AddColumnToView = 3;
  #   AT_ColumnDefault = 4;
  #   AT_CookedColumnDefault = 5;
  #   AT_DropNotNull = 6;
  #   AT_SetNotNull = 7;
  #   AT_DropExpression = 8;
  #   AT_CheckNotNull = 9;
  #   AT_SetStatistics = 10;
  #   AT_SetOptions = 11;
  #   AT_ResetOptions = 12;
  #   AT_SetStorage = 13;
  #   AT_SetCompression = 14;
  #   AT_DropColumn = 15;
  #   AT_DropColumnRecurse = 16;
  #   AT_AddIndex = 17;
  #   AT_ReAddIndex = 18;
  #   AT_AddConstraint = 19;
  #   AT_AddConstraintRecurse = 20;
  #   AT_ReAddConstraint = 21;
  #   AT_ReAddDomainConstraint = 22;
  #   AT_AlterConstraint = 23;
  #   AT_ValidateConstraint = 24;
  #   AT_ValidateConstraintRecurse = 25;
  #   AT_AddIndexConstraint = 26;
  #   AT_DropConstraint = 27;
  #   AT_DropConstraintRecurse = 28;
  #   AT_ReAddComment = 29;
  #   AT_AlterColumnType = 30;
  #   AT_AlterColumnGenericOptions = 31;
  #   AT_ChangeOwner = 32;
  #   AT_ClusterOn = 33;
  #   AT_DropCluster = 34;
  #   AT_SetLogged = 35;
  #   AT_SetUnLogged = 36;
  #   AT_DropOids = 37;
  #   AT_SetAccessMethod = 38;
  #   AT_SetTableSpace = 39;
  #   AT_SetRelOptions = 40;
  #   AT_ResetRelOptions = 41;
  #   AT_ReplaceRelOptions = 42;
  #   AT_EnableTrig = 43;
  #   AT_EnableAlwaysTrig = 44;
  #   AT_EnableReplicaTrig = 45;
  #   AT_DisableTrig = 46;
  #   AT_EnableTrigAll = 47;
  #   AT_DisableTrigAll = 48;
  #   AT_EnableTrigUser = 49;
  #   AT_DisableTrigUser = 50;
  #   AT_EnableRule = 51;
  #   AT_EnableAlwaysRule = 52;
  #   AT_EnableReplicaRule = 53;
  #   AT_DisableRule = 54;
  #   AT_AddInherit = 55;
  #   AT_DropInherit = 56;
  #   AT_AddOf = 57;
  #   AT_DropOf = 58;
  #   AT_ReplicaIdentity = 59;
  #   AT_EnableRowSecurity = 60;
  #   AT_DisableRowSecurity = 61;
  #   AT_ForceRowSecurity = 62;
  #   AT_NoForceRowSecurity = 63;
  #   AT_GenericOptions = 64;
  #   AT_AttachPartition = 65;
  #   AT_DetachPartition = 66;
  #   AT_DetachPartitionFinalize = 67;
  #   AT_AddIdentity = 68;
  #   AT_SetIdentity = 69;
  #   AT_DropIdentity = 70;
  #   AT_ReAddStatistics = 71;
  # }

  def is_additive_migration(query) when is_binary(query) do
    with {:ok, ast} <- parse(query) do
      case ast do
        %PgQuery.AlterTableStmt{} ->
          {:ok, Enum.all?(ast.cmds, &is_additive_migration_cmd/1)}

        %PgQuery.RenameStmt{} ->
          {:ok, false}

        _ ->
          {:error, "not an alter table statement #{inspect(query)}"}
      end
    end
  end

  # there are alter table commands that we support: add column
  # there are those we dont support, e.g. drop column
  # and those we couldn't care less about, e.g. AT_ReAddStatistics
  # for the moment the ignorable ones will raise an error because they're
  # fairly niche IMHO
  @additive_cmds [:AT_AddColumn, :AT_AddColumnRecurse]

  defp is_additive_migration_cmd(%{node: {:alter_table_cmd, cmd}}) do
    cmd.subtype in @additive_cmds
  end

  def column_map(sql) when is_binary(sql) do
    with {:ok, ast} <- parse(sql) do
      column_map(ast)
    end
  end

  def column_map(%PgQuery.InsertStmt{} = ast) do
    cols =
      ast.cols
      |> Enum.map(fn %{node: {:res_target, %{name: name}}} -> name end)
      |> Enum.with_index()
      |> Enum.into(%{})

    {:ok, cols}
  end

  def column_map(ast) do
    {:error, "Not an INSERT statement: #{inspect(ast)}"}
  end

  def column_values_map(%PgQuery.InsertStmt{} = ast) do
    {:ok, column_map} = column_map(ast)

    names =
      column_map
      |> Enum.sort_by(fn {_name, index} -> index end, :asc)
      |> Enum.map(&elem(&1, 0))

    %{select_stmt: %{node: {:select_stmt, select}}} = ast
    %{values_lists: [%{node: {:list, %{items: column_values}}}]} = select

    values = Enum.map(column_values, fn %{node: {:a_const, %{val: val}}} -> decode_val(val) end)

    {:ok, Map.new(Enum.zip(names, values))}
  end

  defp decode_val({:sval, %{sval: s}}), do: s
  defp decode_val({:fval, %{fval: s}}), do: String.to_integer(s)

  defp stmt(%PgQuery.ParseResult{version: _, stmts: [raw_stmt | _]}) do
    %PgQuery.RawStmt{stmt: %PgQuery.Node{node: {_tag, stmt}}} = raw_stmt

    stmt
  end

  defp blank(e, opts) when e in [nil, ""] do
    Keyword.get(opts, :default_schema, @default_schema)
  end

  defp blank(e, _), do: e

  def insert?(<<w::8, rest::binary>>) when w in @wspc and byte_size(rest) > 6 do
    insert?(rest)
  end

  defkeyword :insert?, "INSERT" do
    true
  end

  def insert?(_), do: false

  def capture?(<<w::8, rest::binary>>) when w in @wspc do
    capture?(rest)
  end

  defkeyword :capture?, "BEGIN", trailing: false do
    {true, :begin}
  end

  defkeyword :capture?, "ALTER" do
    {true, {:alter, object(rest)}}
  end

  defkeyword :capture?, "CREATE" do
    case object(rest) do
      :table ->
        false

      :index ->
        {true, {:create, :index}}
    end
  end

  defkeyword :capture?, "DROP" do
    {true, {:drop, object(rest)}}
  end

  defkeyword :capture?, "COMMIT", trailing: false do
    {true, :commit}
  end

  defkeyword :capture?, "ELECTRIC" do
    # we absorb the :error/:ok because errors return a %Command.Error{}
    {_, command} = ddlx(rest)
    {true, {:electric, command}}
  end

  def capture?(_stmt) do
    false
  end

  defp ddlx(stmt) do
    Electric.DDLX.Parse.Parser.parse("ELECTRIC " <> stmt)
  end

  def object(<<w::8, rest::binary>>) when w in @wspc do
    object(rest)
  end

  defkeyword :object, "TABLE" do
    :table
  end

  defkeyword :object, "INDEX" do
    :index
  end

  def object(unknown) do
    raise ArgumentError,
      message: "Unknown/unsupported target for DDL statement: #{inspect(unknown)}"
  end
end
