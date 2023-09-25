defmodule Electric.Postgres.Proxy.QueryAnalysis do
  defstruct [
    :action,
    :table,
    :ast,
    :sql,
    electrified?: false,
    allowed?: true,
    capture?: false,
    valid?: true,
    errors: []
  ]

  @type t() :: %__MODULE__{
          action: atom() | {atom(), binary()} | {:electric, Electric.DDLX.Command.t()},
          table: nil | {String.t(), String.t()},
          ast: Electric.DDLX.Command.t() | struct(),
          sql: String.t(),
          electrified?: boolean,
          allowed?: boolean,
          capture?: boolean,
          valid?: boolean,
          errors: [{atom(), String.t()}]
        }
end

defmodule Electric.Postgres.Proxy.QueryAnalyser.Impl do
  alias Electric.Postgres.Extension.SchemaLoader

  def unwrap_node(%PgQuery.Node{node: {_type, node}}), do: node

  def is_electrified?(nil, _loader) do
    false
  end

  def is_electrified?({_sname, _tname} = table, loader) do
    {:ok, electrified?} = SchemaLoader.table_electrified?(loader, table)
    electrified?
  end

  @valid_types for t <- Electric.Postgres.supported_types(), do: to_string(t)

  def check_column_type(%PgQuery.ColumnDef{} = coldef) do
    %{name: type} = Electric.Postgres.Schema.AST.map(coldef.type_name)

    if type in @valid_types do
      :ok
    else
      {:error, {:invalid_column_type, type}}
    end
  end
end

defprotocol Electric.Postgres.Proxy.QueryAnalyser do
  alias Electric.Postgres.Proxy.QueryAnalysis

  @fallback_to_any true
  @type options() :: Electric.Postgres.Proxy.Parser.analyse_options()

  @spec analyse(t(), QueryAnalysis.t(), options()) :: QueryAnalysis.t()
  def analyse(stmt, analysis, opts)
end

alias Electric.Postgres.Proxy.{QueryAnalyser, QueryAnalysis}

defimpl QueryAnalyser, for: Any do
  def analyse(_stmt, %QueryAnalysis{} = analysis, _opts) do
    %{analysis | action: :passthrough}
  end
end

defimpl QueryAnalyser, for: PgQuery.AlterTableStmt do
  import QueryAnalyser.Impl

  def analyse(stmt, %QueryAnalysis{} = analysis, opts) do
    stmt.cmds
    |> Enum.map(&unwrap_node/1)
    |> Enum.reduce_while(
      %{analysis | action: {:alter, "table"}},
      &analyse_alter_table_cmd(&1, &2, opts)
    )
  end

  defp analyse_alter_table_cmd(_cmd, %QueryAnalysis{electrified?: false} = analysis, _opts) do
    {:halt, analysis}
  end

  defp analyse_alter_table_cmd(%{subtype: :AT_AddColumn} = cmd, analysis, _opts) do
    column_def = unwrap_node(cmd.def)

    case check_column_type(column_def) do
      :ok ->
        {:cont, %{analysis | capture?: true}}

      {:error, reason} ->
        {:halt, %{analysis | allowed?: false, errors: [reason | analysis.errors]}}
    end
  end

  defp analyse_alter_table_cmd(%{subtype: :AT_DropColumn} = cmd, analysis, _opts) do
    {:halt, %{analysis | allowed?: false, errors: [{:drop_column, cmd.name} | analysis.errors]}}
  end

  defp analyse_alter_table_cmd(cmd, analysis, _opts) do
    {:halt, %{analysis | allowed?: false, errors: error_for(cmd, analysis)}}
  end

  defp error_for(%{subtype: :AT_AlterColumnType, name: name}, analysis) do
    [{:alter_column, name} | analysis.errors]
  end

  defp error_for(%{name: name}, analysis) do
    [{:alter_column, name} | analysis.errors]
  end
end

defimpl QueryAnalyser, for: PgQuery.TransactionStmt do
  def analyse(stmt, analysis, _opts) do
    kind =
      case stmt.kind do
        :TRANS_STMT_BEGIN -> :begin
        :TRANS_STMT_COMMIT -> :commit
        :TRANS_STMT_ROLLBACK -> :rollback
      end

    %{analysis | action: {:tx, kind}}
  end
end

defimpl QueryAnalyser, for: PgQuery.CreateStmt do
  def analyse(_stmt, analysis, _opts) do
    %{analysis | action: {:create, "table"}}
  end
end

defimpl QueryAnalyser, for: PgQuery.IndexStmt do
  def analyse(_stmt, analysis, _opts) do
    %{analysis | action: {:create, "index"}, capture?: analysis.electrified?}
  end
end

defimpl QueryAnalyser, for: PgQuery.RenameStmt do
  def analyse(stmt, %QueryAnalysis{electrified?: false} = analysis, _opts) do
    %{analysis | action: action(stmt)}
  end

  def analyse(stmt, %QueryAnalysis{electrified?: true} = analysis, _opts) do
    %{
      analysis
      | action: action(stmt),
        allowed?: false,
        errors: [{:rename, stmt.subname} | analysis.errors]
    }
  end

  defp action(%{rename_type: :OBJECT_COLUMN}) do
    {:rename, "column"}
  end

  defp action(%{rename_type: :OBJECT_TABCONSTRAINT}) do
    {:rename, "constraint"}
  end

  defp action(%{rename_type: :OBJECT_TABLE}) do
    {:rename, "table"}
  end

  defp action(_) do
    {:rename, "something"}
  end
end

defimpl QueryAnalyser, for: PgQuery.DropStmt do
  def analyse(stmt, %QueryAnalysis{electrified?: false} = analysis, _opts) do
    %{analysis | action: action(stmt)}
  end

  def analyse(stmt, %QueryAnalysis{electrified?: true} = analysis, _opts) do
    %{analysis | allowed?: allowed?(stmt), capture?: allowed?(stmt), action: action(stmt)}
  end

  defp action(%{remove_type: :OBJECT_TABLE}), do: {:drop, "table"}
  defp action(%{remove_type: :OBJECT_INDEX}), do: {:drop, "index"}

  defp allowed?(%{remove_type: :OBJECT_INDEX}), do: true
  defp allowed?(%{remove_type: :OBJECT_TABLE}), do: false
end

defimpl QueryAnalyser, for: PgQuery.InsertStmt do
  def analyse(_stmt, analysis, _opts) do
    %{analysis | action: :insert}
  end
end

defimpl QueryAnalyser, for: PgQuery.DeleteStmt do
  def analyse(_stmt, analysis, _opts) do
    %{analysis | action: :delete}
  end
end

defimpl QueryAnalyser, for: PgQuery.DoStmt do
  def analyse(_stmt, analysis, _opts) do
    %{
      analysis
      | action: :do,
        allowed?: false,
        errors: [{:unsupported_query, "DO ... END"} | analysis.errors]
    }
  end
end

defimpl QueryAnalyser, for: PgQuery.CallStmt do
  alias Electric.Postgres.Proxy.{NameParser, Parser}
  alias Electric.DDLX

  def analyse(stmt, analysis, opts) do
    case function_name(stmt, opts) do
      ["electric", "__smuggle__"] ->
        [command_sql] = function_args(stmt)
        analysis = %{analysis | sql: command_sql}

        case Electric.DDLX.Parse.Parser.parse(command_sql) do
          {:ok, [command]} ->
            {:ok, table} = NameParser.parse(DDLX.Command.table_name(command))

            %{
              analysis
              | action: {:electric, command},
                table: table,
                ast: command,
                electrified?: true,
                capture?: true
            }
        end

      ["electric", "electrify"] ->
        {:table, table} = Parser.table_name(stmt, opts)

        %{
          analysis
          | action: :call,
            table: table,
            ast: stmt,
            electrified?: true,
            capture?: false
        }

      _ ->
        %{analysis | action: :call}
    end
  end

  defp function_args(%{funccall: %{args: args}}) do
    Enum.map(args, &Parser.string_node_val/1)
  end

  defp function_name(%PgQuery.CallStmt{funccall: %{funcname: funcname}}, _opts) do
    Enum.map(funcname, &Parser.string_node_val/1)
  end
end
