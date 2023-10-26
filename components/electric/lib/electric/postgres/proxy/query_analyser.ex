defmodule Electric.Postgres.Proxy.QueryAnalysis do
  @derive {Inspect, except: [:ast, :error]}
  defstruct [
    :action,
    :table,
    :type,
    :ast,
    :sql,
    :source,
    mode: :simple,
    electrified?: false,
    tx?: false,
    allowed?: true,
    capture?: false,
    valid?: true,
    error: nil
  ]

  @type t() :: %__MODULE__{
          action: atom() | {atom(), binary()} | {:electric, Electric.DDLX.Command.t()},
          table: nil | {String.t(), String.t()},
          type: :table | :index,
          ast: Electric.DDLX.Command.t() | struct(),
          sql: String.t(),
          mode: :simple | :extended,
          source: Electric.Postgres.PgQuery.t(),
          electrified?: boolean,
          tx?: boolean,
          allowed?: boolean,
          capture?: boolean,
          valid?: boolean,
          error: nil | %{message: String.t(), detail: String.t(), code: String.t()}
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
    |> Enum.reduce_while(
      %{analysis | tx?: true, action: {:alter, "table"}},
      &analyse_alter_table_cmd/2
    )
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
    %{analysis | action: {:create, "table"}, tx?: true}
  end

  def validate(_stmt) do
    :ok
  end
end

defimpl QueryAnalyser, for: PgQuery.IndexStmt do
  def analyse(_stmt, analysis, _state) do
    %{analysis | action: {:create, "index"}, tx?: true, capture?: analysis.electrified?}
  end

  def validate(_stmt) do
    :ok
  end
end

defimpl QueryAnalyser, for: PgQuery.RenameStmt do
  import QueryAnalyser.Impl

  def analyse(stmt, %QueryAnalysis{electrified?: false} = analysis, _state) do
    %{analysis | action: action(stmt), tx?: true}
  end

  def analyse(stmt, %QueryAnalysis{electrified?: true} = analysis, _state) do
    %{
      analysis
      | action: action(stmt),
        allowed?: false,
        tx?: true,
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
    %{analysis | action: action(stmt), tx?: tx?(stmt)}
  end

  def analyse(stmt, %QueryAnalysis{electrified?: true} = analysis, _state) do
    %{
      analysis
      | allowed?: allowed?(stmt),
        capture?: allowed?(stmt),
        tx?: true,
        action: action(stmt),
        error: error(stmt, analysis)
    }
  end

  def validate(_stmt) do
    :ok
  end

  defp action(%{remove_type: :OBJECT_TABLE}), do: {:drop, "table"}
  defp action(%{remove_type: :OBJECT_INDEX}), do: {:drop, "index"}

  defp action(%{remove_type: type}) do
    [_, t] =
      type
      |> to_string()
      |> String.downcase()
      |> String.split("_", parts: 2)

    {:drop, t}
  end

  defp allowed?(%{remove_type: :OBJECT_INDEX}), do: true
  defp allowed?(%{remove_type: :OBJECT_TABLE}), do: false

  # there are a lot of things you can drop, but we only care about tables and
  # indexes other things that we might want to capture, like dropping
  # constraints, are expressed as alter table statements.
  defp tx?(%{remove_type: :OBJECT_INDEX}), do: true
  defp tx?(%{remove_type: :OBJECT_TABLE}), do: true
  defp tx?(_stmt), do: false

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
            {:ok, columns} = column_map(stmt)

            %{
              analysis
              | action: {:migration_version, %{framework: {:ecto, 1}, columns: columns}},
                tx?: false
            }

          :simple ->
            {:ok, columns} = column_values_map(stmt)
            {:ok, version} = Map.fetch(columns, "version")

            %{
              analysis
              | action: {:migration_version, %{framework: {:ecto, 1}, version: version}},
                tx?: false
            }
        end

      other ->
        Logger.warning("Insert to schema_migrations with unrecognised columns #{inspect(other)}")
        %{analysis | action: :insert}
    end
  end

  def analyse(stmt, %{table: {"public", "_prisma_migrations"}} = analysis, _state) do
    case column_names(stmt) do
      ["checksum", "finished_at", "id", "logs", "migration_name", "started_at"] ->
        prisma_migration(stmt, analysis)

      ["checksum", "id", "migration_name", "started_at"] ->
        prisma_migration(stmt, analysis)

      other ->
        Logger.warning("Insert to _prisma_migrations with unrecognised columns #{inspect(other)}")
        %{analysis | action: :insert}
    end
  end

  def analyse(stmt, %{table: {"public", "atdatabases_migrations_applied"}} = analysis, _state) do
    case column_names(stmt) do
      ["applied_at", "ignored_error", "index", "name", "obsolete", "script"] ->
        case analysis.mode do
          :extended ->
            {:ok, columns} = column_map(stmt)

            %{
              analysis
              | action: {:migration_version, %{framework: {:atdatabases, 1}, columns: columns}},
                tx?: false
            }

          :simple ->
            {:ok, columns} = column_values_map(stmt)
            {:ok, version} = Map.fetch(columns, "migration_name")

            %{
              analysis
              | action: {:migration_version, %{framework: {:atdatabases, 1}, version: version}},
                tx?: false
            }
        end

      other ->
        Logger.warning("Insert to _prisma_migrations with unrecognised columns #{inspect(other)}")
        %{analysis | action: :insert}
    end
  end

  def analyse(_stmt, analysis, _state) do
    %{analysis | action: :insert}
  end

  defp prisma_migration(stmt, analysis) do
    case analysis.mode do
      :extended ->
        {:ok, columns} = column_map(stmt)

        %{
          analysis
          | action: {:migration_version, %{framework: {:prisma, 1}, columns: columns}},
            tx?: false
        }

      :simple ->
        {:ok, columns} = column_values_map(stmt)
        {:ok, version} = Map.fetch(columns, "migration_name")

        %{
          analysis
          | action: {:migration_version, %{framework: {:ecto, 1}, version: version}},
            tx?: false
        }
    end
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

defimpl QueryAnalyser, for: PgQuery.SelectStmt do
  def analyse(_stmt, analysis, _state) do
    %{analysis | action: :select}
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
  alias Electric.Postgres.NameParser
  alias Electric.Postgres.Proxy.Parser
  alias Electric.DDLX

  def analyse(stmt, analysis, state) do
    case extract_electric(stmt, analysis) do
      {:electric, command, analysis} ->
        {:ok, table} =
          parse_table_name(DDLX.Command.table_name(command), default_schema: state.default_schema)

        analysis = %{
          analysis
          | action: {:electric, command},
            table: table,
            ast: command,
            electrified?: true,
            tx?: true,
            capture?: true
        }

        if command_enabled?(command) do
          analysis
        else
          %{
            analysis
            | allowed?: false,
              error: %{
                message: "#{DDLX.Command.tag(command)} is currently unsupported",
                detail:
                  "We are working on implementing access controls -- when these features are completed then this command will work",
                query: analysis.sql,
                code: "EX900"
              }
          }
        end

      {:call, analysis} ->
        %{analysis | action: :call}
    end
  end

  def validate(stmt) do
    case extract_electric(stmt, %QueryAnalysis{}) do
      {:electric, %Electric.DDLX.Command.Error{} = error, _analysis} ->
        {:error, error}

      {:electric, _command, _analysis} ->
        :ok

      {:call, _analysis} ->
        :ok
    end
  end

  defp parse_table_name({_schema, _name} = table_name, _opts), do: {:ok, table_name}
  defp parse_table_name(name, opts) when is_binary(name), do: NameParser.parse(name, opts)

  defp extract_electric(stmt, analysis) do
    case function_name(stmt) do
      ["electric", "__smuggle__"] ->
        [command_sql] = function_args(stmt)

        # FIXME: [VAX-1220] fix the ddlx parser to cope with statements that don't end with a ;
        sql =
          case String.at(command_sql, -1) do
            ";" -> command_sql
            _ -> command_sql <> ";"
          end

        case Electric.DDLX.parse(sql) do
          {:ok, command} ->
            {:electric, command, %{analysis | sql: command_sql}}

          {:error, error} ->
            {:electric, error, %{analysis | allowed?: false}}
        end

      ["electric", "electrify"] ->
        {:table, table} = Parser.table_name(stmt)
        command = %DDLX.Command.Enable{table_name: table}
        {:electric, command, analysis}

      _ ->
        {:call, analysis}
    end
  end

  defp function_args(%{funccall: %{args: args}}) do
    Enum.map(args, &Parser.string_node_val/1)
  end

  defp function_name(%PgQuery.CallStmt{funccall: %{funcname: funcname}}) do
    Enum.map(funcname, &Parser.string_node_val/1)
  end

  # shortcut the enable command, which has to be enabled
  defp command_enabled?(%DDLX.Command.Enable{}), do: true

  defp command_enabled?(cmd) do
    cmd
    |> feature_flag()
    |> Electric.Features.enabled?()
  end

  @feature_flags %{
    DDLX.Command.Grant => :proxy_ddlx_grant,
    DDLX.Command.Revoke => :proxy_ddlx_revoke,
    DDLX.Command.Assign => :proxy_ddlx_assign,
    DDLX.Command.Unassign => :proxy_ddlx_unassign
  }

  # either we have a specific flag for the command or we fallback to the
  # default setting for the features module, which is `false`
  defp feature_flag(%cmd{}) do
    @feature_flags[cmd] || Electric.Features.default_key()
  end
end
