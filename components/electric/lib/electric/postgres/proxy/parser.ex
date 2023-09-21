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
  alias Electric.Postgres.Proxy.NameParser
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.Proxy.{QueryAnalyser, QueryAnalysis}

  import __MODULE__.Macros

  @default_schema "public"
  @wspc ~c"\t\n\r "

  def parse(sql) do
    with {:ok, ast} <- PgQuery.parse(sql) do
      {:ok, stmt(ast)}
    end
  end

  @spec table_name(binary() | struct(), Keyword.t()) ::
          {:table | :index, {String.t(), String.t()}} | {nil, nil} | no_return
  def table_name(query, opts \\ [])

  def table_name(query, opts) when is_binary(query) do
    with {:ok, ast} <- parse(query) do
      table_name(ast, opts)
    end
  end

  def table_name(%{relation: %{schemaname: s, relname: n}} = _stmt, opts) do
    {:table, {blank(s, opts), n}}
  end

  # TODO: drop table supports a list of table names, but let's not support that for the moment
  def table_name(%PgQuery.DropStmt{objects: [object]} = stmt, opts) do
    %{node: {:list, %{items: items}}} = object
    names = Enum.map(items, fn %{node: {:string, %{sval: n}}} -> n end)

    type =
      case stmt do
        %{remove_type: :OBJECT_TABLE} ->
          :table

        %{remove_type: :OBJECT_INDEX} ->
          :index
      end

    name =
      case names do
        [_tablespace, schema, table] ->
          {schema, table}

        [schema, table] ->
          {schema, table}

        [table] ->
          {blank(nil, opts), table}
      end

    {type, name}
  end

  def table_name(
        %PgQuery.CallStmt{funccall: %{funcname: [func_schema, func_name]} = funccall},
        opts
      ) do
    case {string_node_val(func_schema), string_node_val(func_name)} do
      {"electric", "electrify"} ->
        case Enum.map(funccall.args, &string_node_val/1) do
          [a1, a2] ->
            {:table, {a1, a2}}

          [a1] ->
            {:table, NameParser.parse!(a1, opts)}
        end

      _ ->
        {nil, nil}
    end
  end

  def table_name(_stmt, _opts) do
    {nil, nil}
  end

  def string_node_val(%PgQuery.Node{node: {:string, %PgQuery.String{sval: sval}}}), do: sval

  def string_node_val(%PgQuery.Node{node: {:a_const, %PgQuery.A_Const{val: {:sval, sval}}}}),
    do: string_node_val(sval)

  def string_node_val(%PgQuery.String{sval: sval}), do: sval

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
    case object(rest) do
      "table" ->
        {true, {:alter, "table"}}

      _other ->
        false
    end
  end

  defkeyword :capture?, "CREATE" do
    case object(rest) do
      "table" ->
        false

      "index" ->
        {true, {:create, "index"}}

      _other ->
        false
    end
  end

  defkeyword :capture?, "DROP" do
    case object(rest) do
      "index" ->
        {true, {:drop, "index"}}

      "table" ->
        {true, {:drop, "table"}}

      _other ->
        false
    end
  end

  defkeyword :capture?, "COMMIT", trailing: false do
    {true, :commit}
  end

  defkeyword :capture?, "ROLLBACK", trailing: false do
    {true, :rollback}
  end

  defkeyword :capture?, "ELECTRIC" do
    # we absorb the :error/:ok because errors return a %Command.Error{}
    {_, command} = ddlx(rest)
    {true, {:electric, command}}
  end

  defkeyword :capture?, "CALL" do
    {true, {:call, "electrify"}}
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
    "table"
  end

  defkeyword :object, "INDEX" do
    "index"
  end

  def electric_electrify(<<w::8, rest::binary>>) when w in @wspc do
    electric_electrify(rest)
  end

  def electric_electrify("electric.electrify(" <> _rest), do: true
  def electric_electrify(_), do: false

  @split_ws Enum.map(@wspc, &IO.iodata_to_binary([&1]))
  def object(other) do
    [type, _rest] = :binary.split(other, @split_ws)
    String.downcase(type)
  end

  def table_modifications(sql) when is_binary(sql) do
    sql
    |> Electric.Postgres.parse!()
    |> Enum.flat_map(&analyse_modifications_query/1)
  end

  defp analyse_modifications_query(%PgQuery.AlterTableStmt{} = stmt) do
    {:ok, {_schema, _name} = table} = table_name(stmt)

    Enum.map(stmt.cmds, fn %{node: {:alter_table_cmd, cmd}} ->
      Map.new([{:action, modification_action(cmd)}, {:table, table} | column_definition(cmd.def)])
    end)
  end

  # we're currently only interested in alter table statements
  defp analyse_modifications_query(_stmt) do
    []
  end

  defp modification_action(%{subtype: :AT_AddColumn}), do: :add
  defp modification_action(%{subtype: :AT_DropColumn}), do: :drop
  defp modification_action(_), do: :modify

  defp column_definition(%{node: {:column_def, def}}) do
    [column: def.colname, type: Electric.Postgres.Dialect.Postgresql.map_type(def.type_name)]
  end

  defp column_definition(nil) do
    []
  end

  @type analyse_options() :: [loader: SchemaLoader.t(), default_schema: String.t()]

  @doc """
  Given a SQL query (potentially containing > 1 SQL statements, separated by
  semicolons) returns an analysis of the statements indicating how they should
  be treated by the proxy.
  """
  @spec analyse(String.t(), analyse_options()) :: [QueryAnalysis.t()]
  def analyse(query, opts \\ []) when is_binary(query) do
    {:ok, loader} = Keyword.fetch(opts, :loader)

    case parse_and_split(query) do
      {:ok, stmts} ->
        Enum.map(stmts, &analyse_stmt(&1, loader, opts))

      {:error, error} ->
        case smuggle_electric_syntax(query, error, loader, opts) do
          {:ok, stmts} ->
            Enum.map(stmts, &analyse_stmt(&1, loader, opts))

          {:error, _error} ->
            [
              %QueryAnalysis{
                action: :invalid,
                table: nil,
                electrified?: false,
                allowed?: true,
                capture?: false,
                ast: nil,
                valid?: false,
                sql: query
              }
            ]
        end
    end
  end

  defp parse_and_split(query) do
    with {:ok, %PgQuery.ParseResult{stmts: stmts}} <- PgQuery.parse(query) do
      stmts =
        Enum.map(stmts, fn %PgQuery.RawStmt{
                             stmt: %PgQuery.Node{node: {_type, struct}},
                             stmt_location: loc,
                             stmt_len: len
                           } ->
          len = if len == 0, do: byte_size(query), else: len
          {struct, loc, len}
        end)

      stmts =
        Enum.map(stmts, fn {stmt, loc, len} ->
          {stmt,
           query
           |> binary_part(loc, len)
           |> String.trim()}
        end)

      {:ok, stmts}
    end
  end

  defp analyse_stmt({stmt, query}, loader, opts) do
    {type, name} = table_name(stmt, opts)

    analysis = %QueryAnalysis{
      table: name,
      electrified?: object_electrified?(type, name, loader),
      ast: stmt,
      sql: query
    }

    QueryAnalyser.analyse(stmt, analysis, opts)
  end

  defp object_electrified?(nil, nil, _loader) do
    false
  end

  defp object_electrified?(:table, table, loader) do
    {:ok, electrified?} = SchemaLoader.table_electrified?(loader, table)
    electrified?
  end

  defp object_electrified?(:index, index, loader) do
    {:ok, electrified?} = SchemaLoader.index_electrified?(loader, index)
    electrified?
  end

  @keyword_len byte_size("ELECTRIC")

  defp smuggle_electric_syntax(query, %{cursorpos: cursorpos} = error, loader, opts) do
    if byte_size(query) >= cursorpos + @keyword_len &&
         is_electric_keyword?(binary_part(query, cursorpos, @keyword_len)) do
      safe_query = do_smuggle_electric_syntax(query, cursorpos)

      case parse_and_split(safe_query) do
        {:ok, stmts} ->
          {:ok, stmts}

        {:error, error} ->
          smuggle_electric_syntax(safe_query, error, loader, opts)
      end
    else
      # this can't be an electrification command
      # so just return an "ignore me" analysis
      {:error, error}
    end
  end

  defp do_smuggle_electric_syntax(query, cursorpos) do
    leading = binary_part(query, 0, cursorpos)
    trailing = binary_part(query, cursorpos, byte_size(query) - cursorpos)

    start_pos = cursorpos - find_semicolon(String.reverse(leading), :reverse)
    end_pos = find_semicolon(trailing, :forward) + cursorpos

    command_sql =
      query
      |> binary_part(start_pos, end_pos - start_pos)
      |> String.trim()
      |> String.trim_trailing(";")

    pre = binary_part(query, 0, start_pos)
    post = binary_part(query, end_pos, byte_size(query) - end_pos)

    # the semicolon finding drops any whitespace between the previous
    # statement's `;` and the electric command sql, so add some in 
    join_query([pre, "\n\n", smuggle_call(command_sql), post])
  end

  defp join_query(parts) do
    parts
    |> Stream.reject(&(&1 == ""))
    |> Enum.join("")
  end

  defp smuggle_call(query) do
    IO.iodata_to_binary(["CALL electric.__smuggle__(", quote_query(query), ");"])
  end

  defp quote_query(query) do
    quote = random_quote()

    quote <> to_string(query) <> quote
  end

  defp random_quote do
    "$__" <> (:crypto.strong_rand_bytes(6) |> Base.encode16(case: :lower)) <> "__$"
  end

  defp find_semicolon(s, direction) do
    find_semicolon(s, %{sq: false, dq: false, p: 0, d: direction}, 0)
  end

  defp find_semicolon("", %{dq: false, sq: false}, pos) do
    pos
  end

  defp find_semicolon(";" <> _rest, %{dq: false, sq: false, d: direction}, pos) do
    case direction do
      :forward ->
        pos + 1

      :reverse ->
        pos
    end
  end

  defp find_semicolon("\"" <> rest, %{dq: false} = state, pos) do
    find_semicolon(rest, %{state | dq: true}, pos + 1)
  end

  defp find_semicolon("\"\"" <> rest, %{dq: true} = state, pos) do
    find_semicolon(rest, state, pos + 2)
  end

  defp find_semicolon("\"" <> rest, %{dq: true} = state, pos) do
    find_semicolon(rest, %{state | dq: false}, pos + 1)
  end

  defp find_semicolon("\'" <> rest, %{sq: false} = state, pos) do
    find_semicolon(rest, %{state | sq: true}, pos + 1)
  end

  defp find_semicolon("''" <> rest, %{sq: true} = state, pos) do
    find_semicolon(rest, state, pos + 2)
  end

  defp find_semicolon("'" <> rest, %{sq: true} = state, pos) do
    find_semicolon(rest, %{state | sq: false}, pos + 1)
  end

  defp find_semicolon(<<_::utf8, rest::binary>>, state, pos) do
    find_semicolon(rest, state, pos + 1)
  end

  # case ignoring match of "electric"
  defkeyword :is_electric_keyword?, "ELECTRIC", trailing: false do
    true
  end

  def is_electric_keyword?(_) do
    false
  end

  def electrified?(analysis) when is_list(analysis) do
    Enum.any?(analysis, & &1.electrified?)
  end

  def allowed?(analysis) when is_list(analysis) do
    Enum.all?(analysis, & &1.allowed?)
  end
end
