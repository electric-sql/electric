defmodule Electric.Postgres.Proxy.QueryAnalysis do
  @derive {Inspect, except: [:ast]}
  defstruct [
    :action,
    :table,
    :type,
    :ast,
    :sql,
    :source,
    mode: :simple,
    electrified?: false,
    allowed?: true,
    capture?: false,
    valid?: true,
    error: nil
  ]

  @type error_code() ::
          :rename | :invalid_type | :drop | :rename | :alter

  @type t() :: %__MODULE__{
          action: atom() | {atom(), binary()} | {:electric, Electric.DDLX.Command.t()},
          table: nil | {String.t(), String.t()},
          type: :table | :index,
          ast: Electric.DDLX.Command.t() | struct(),
          sql: String.t(),
          mode: :simple | :extended,
          source: PgQuery.t(),
          electrified?: boolean,
          allowed?: boolean,
          capture?: boolean,
          valid?: boolean,
          error: nil | {error_code(), String.t() | {String.t(), String.t()}}
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
      {:error, {:invalid_type, type}}
    end
  end

  def sql_table(%{table: {schema, table}}) do
    ~s["#{schema}"."#{table}"]
  end
end

defprotocol Electric.Postgres.Proxy.QueryAnalyser do
  alias Electric.Postgres.Proxy.QueryAnalysis
  alias Electric.Postgres.Proxy.Injector.State

  @fallback_to_any true

  @spec analyse(t(), QueryAnalysis.t(), State.t()) :: QueryAnalysis.t()
  def analyse(stmt, analysis, state)

  @spec validate(t()) :: :ok | {:error, term()}
  def validate(stmt)
end

alias Electric.Postgres.Proxy.{QueryAnalyser, QueryAnalysis}

defimpl QueryAnalyser, for: Any do
  def analyse(_stmt, %QueryAnalysis{} = analysis, _state) do
    %{analysis | action: :passthrough}
  end

  def validate(_stmt) do
    :ok
  end
end

defimpl QueryAnalyser, for: PgQuery.AlterTableStmt do
  import QueryAnalyser.Impl

  def analyse(stmt, %QueryAnalysis{} = analysis, _state) do
    stmt.cmds
    |> Enum.map(&unwrap_node/1)
    |> Enum.reduce_while(%{analysis | action: {:alter, "table"}}, &analyse_alter_table_cmd/2)
  end

  def validate(_stmt) do
    :ok
  end

  defp analyse_alter_table_cmd(_cmd, %QueryAnalysis{electrified?: false} = analysis) do
    {:halt, analysis}
  end

  defp analyse_alter_table_cmd(%{subtype: :AT_AddColumn} = cmd, analysis) do
    column_def = unwrap_node(cmd.def)

    case check_column_type(column_def) do
      :ok ->
        {:cont, %{analysis | capture?: true}}

      {:error, {:invalid_type, type}} ->
        {:halt,
         %{
           analysis
           | allowed?: false,
             error: %{
               code: "EX001",
               message: ~s[Cannot electrify column of type #{inspect(type)}]
             }
         }}
    end
  end

  defp analyse_alter_table_cmd(%{subtype: :AT_DropColumn} = cmd, analysis) do
    {:halt,
     %{
       analysis
       | allowed?: false,
         error: %{
           code: "EX002",
           message:
             ~s[Cannot drop column "#{cmd.name}" of electrified table #{sql_table(analysis)}]
         }
     }}
  end

  defp analyse_alter_table_cmd(cmd, analysis) do
    {:halt, %{analysis | allowed?: false, error: error_for(cmd, analysis)}}
  end

  defp error_for(%{subtype: :AT_AlterColumnType, name: name}, analysis) do
    %{
      code: "EX003",
      message:
        ~s[Cannot change type of column "#{name}" of electrified table #{sql_table(analysis)}]
    }
  end

  defp error_for(%{name: name}, analysis) do
    %{
      code: "EX004",
      message: ~s[Cannot alter column "#{name}" of electrified table #{sql_table(analysis)}]
    }
  end
end

defimpl QueryAnalyser, for: PgQuery.TransactionStmt do
  def analyse(stmt, analysis, _state) do
    kind =
      case stmt.kind do
        :TRANS_STMT_BEGIN -> :begin
        :TRANS_STMT_COMMIT -> :commit
        :TRANS_STMT_ROLLBACK -> :rollback
      end

    %{analysis | action: {:tx, kind}}
  end

  def validate(_stmt) do
    :ok
  end
end

defimpl QueryAnalyser, for: PgQuery.CreateStmt do
  def analyse(_stmt, analysis, _state) do
    %{analysis | action: {:create, "table"}}
  end

  def validate(_stmt) do
    :ok
  end
end

defimpl QueryAnalyser, for: PgQuery.IndexStmt do
  def analyse(_stmt, analysis, _state) do
    %{analysis | action: {:create, "index"}, capture?: analysis.electrified?}
  end

  def validate(_stmt) do
    :ok
  end
end

defimpl QueryAnalyser, for: PgQuery.RenameStmt do
  import QueryAnalyser.Impl

  def analyse(stmt, %QueryAnalysis{electrified?: false} = analysis, _state) do
    %{analysis | action: action(stmt)}
  end

  def analyse(stmt, %QueryAnalysis{electrified?: true} = analysis, _state) do
    %{
      analysis
      | action: action(stmt),
        allowed?: false,
        error: error(stmt, analysis)
    }
  end

  def validate(_stmt) do
    :ok
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

  defp error(%{rename_type: :OBJECT_COLUMN} = stmt, analysis) do
    %{
      code: "EX005",
      message:
        ~s[Cannot rename column "#{stmt.subname}" of electrified table #{sql_table(analysis)}]
    }
  end

  defp error(%{rename_type: :OBJECT_TABCONSTRAINT} = stmt, analysis) do
    %{
      code: "EX006",
      message:
        ~s[Cannot rename constraint "#{stmt.subname}" of electrified table #{sql_table(analysis)}]
    }
  end

  defp error(%{rename_type: :OBJECT_TABLE}, analysis) do
    %{
      code: "EX006",
      message: ~s[Cannot rename electrified table #{sql_table(analysis)}]
    }
  end

  defp error(_stmt, analysis) do
    %{
      code: "EX007",
      message: ~s[Cannot rename property of electrified table #{sql_table(analysis)}]
    }
  end
end

defimpl QueryAnalyser, for: PgQuery.DropStmt do
  import QueryAnalyser.Impl

  def analyse(stmt, %QueryAnalysis{electrified?: false} = analysis, _state) do
    %{analysis | action: action(stmt)}
  end

  def analyse(stmt, %QueryAnalysis{electrified?: true} = analysis, _state) do
    %{
      analysis
      | allowed?: allowed?(stmt),
        capture?: allowed?(stmt),
        action: action(stmt),
        error: error(stmt, analysis)
    }
  end

  def validate(_stmt) do
    :ok
  end

  defp action(%{remove_type: :OBJECT_TABLE}), do: {:drop, "table"}
  defp action(%{remove_type: :OBJECT_INDEX}), do: {:drop, "index"}

  defp allowed?(%{remove_type: :OBJECT_INDEX}), do: true
  defp allowed?(%{remove_type: :OBJECT_TABLE}), do: false

  defp error(%{remove_type: :OBJECT_INDEX}, _analysis), do: nil

  defp error(%{remove_type: :OBJECT_TABLE}, analysis) do
    %{
      code: "EX008",
      message: ~s[Cannot drop electrified table #{sql_table(analysis)}]
    }
  end
end

defimpl QueryAnalyser, for: PgQuery.InsertStmt do
  import QueryAnalyser.Impl

  alias Electric.Postgres.Proxy.Parser

  require Logger

  def analyse(stmt, %{table: {"public", "schema_migrations"}} = analysis, _state) do
    case column_names(stmt) do
      ["inserted_at", "version"] ->
        case analysis.mode do
          :extended ->
            {:ok, columns} = Parser.column_map(stmt)

            %{
              analysis
              | action: {:migration_version, %{framework: {:ecto, 1}, columns: columns}}
            }

          :simple ->
            {:ok, columns} = Parser.column_values_map(stmt)
            {:ok, version} = Map.fetch(columns, "version")

            %{
              analysis
              | action: {:migration_version, %{framework: {:ecto, 1}, version: version}}
            }
        end

      other ->
        Logger.warning("Insert to schema_migrations with unrecognised columns #{inspect(other)}")
        %{analysis | action: :insert}
    end
  end

  def analyse(_stmt, analysis, _state) do
    %{analysis | action: :insert}
  end

  def validate(_stmt) do
    :ok
  end

  defp column_names(stmt) do
    stmt.cols
    |> Stream.map(&unwrap_node/1)
    |> Enum.map(& &1.name)
    |> Enum.sort()
  end
end

defimpl QueryAnalyser, for: PgQuery.DeleteStmt do
  def analyse(_stmt, analysis, _state) do
    %{analysis | action: :delete}
  end

  def validate(_stmt) do
    :ok
  end
end

defimpl QueryAnalyser, for: PgQuery.DoStmt do
  def analyse(_stmt, analysis, _state) do
    %{
      analysis
      | action: :do,
        allowed?: false
    }
  end

  def validate(_stmt) do
    {:error, "Unsupported DO...END block in migration"}
  end
end

defimpl QueryAnalyser, for: PgQuery.CallStmt do
  alias Electric.Postgres.Proxy.{NameParser, Parser}
  alias Electric.DDLX

  def analyse(stmt, analysis, state) do
    case extract_electric(stmt) do
      {:electric, command_sql} ->
        analysis = %{analysis | sql: command_sql}

        case Electric.DDLX.Parse.Parser.parse(command_sql) do
          {:ok, [command]} ->
            {:ok, table} =
              NameParser.parse(DDLX.Command.table_name(command),
                default_schema: state.default_schema
              )

            %{
              analysis
              | action: {:electric, command},
                table: table,
                ast: command,
                electrified?: true,
                capture?: true
            }
        end

      {:electrify, table} ->
        # convert a function call to electric.electrify() to the equivalent
        # command so that it goes through the same mechanisms as if you used
        # the `ALTER TABLE .. ENABLE ELECTRIC` syntax
        cmd = %DDLX.Command.Enable{table_name: table}

        %{
          analysis
          | action: {:electric, cmd},
            table: table,
            ast: cmd,
            electrified?: true,
            capture?: true
        }

      :call ->
        %{analysis | action: :call}
    end
  end

  def validate(stmt) do
    case extract_electric(stmt) do
      {:electric, command_sql} ->
        with {:ok, _} <- Electric.DDLX.Parse.Parser.parse(command_sql) do
          :ok
        end

      {:electrify, _table} ->
        :ok

      :call ->
        :ok
    end
  end

  defp extract_electric(stmt) do
    case function_name(stmt) do
      ["electric", "__smuggle__"] ->
        [command_sql] = function_args(stmt)
        {:electric, command_sql}

      ["electric", "electrify"] ->
        {:table, table} = Parser.table_name(stmt)
        {:electrify, table}

      _ ->
        :call
    end
  end

  defp function_args(%{funccall: %{args: args}}) do
    Enum.map(args, &Parser.string_node_val/1)
  end

  defp function_name(%PgQuery.CallStmt{funccall: %{funcname: funcname}}) do
    Enum.map(funcname, &Parser.string_node_val/1)
  end
end
