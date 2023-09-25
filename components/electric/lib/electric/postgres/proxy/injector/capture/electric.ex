defmodule Electric.Postgres.Proxy.Injector.Capture.Electric do
  defstruct [:capture]

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.{Capture.Command, Parser}
  alias Electric.Postgres.Proxy.Injector.{Capture, Send, State}
  alias __MODULE__

  defmodule BindExecuteMigration do
    defstruct [:commands, :framework]

    defimpl Capture do
      require Logger

      def recv_client(execute, msgs, state) do
        if Enum.any?(msgs, &is_struct(&1, M.Execute)) do
          {version_commands, state} = capture_version(msgs, execute, state)

          {
            nil,
            Enum.concat(
              [%Command.Transparent{msgs: msgs}],
              [%Command.Between{commands: execute.commands ++ version_commands}]
            ),
            state
          }
        else
          {execute, [%Command.Transparent{msgs: msgs}], state}
        end
      end

      defp capture_version(msgs, execute, state) do
        {:ok, version} =
          msgs
          |> Enum.find(&is_struct(&1, M.Bind))
          |> assign_version(execute.framework, state)

        case {State.tx?(state), State.electrified?(state)} do
          {_, false} ->
            {[], state}

          {true, true} ->
            {[%Command.AssignMigrationVersion{version: version}], state}

          {false, true} ->
            {[], State.assign_version_metadata(state, version)}
        end
      end

      defp assign_version(%M.Bind{} = msg, %{framework: :ecto, version: 1} = v, state) do
        <<version::integer-big-signed-64>> =
          Enum.at(msg.parameters, Map.fetch!(v.columns, "version"))

        Logger.debug("Assigning version #{version} to current migration")
        {:ok, to_string(version)}
      end
    end
  end

  defmodule BindExecute do
    defstruct [:commands]

    defimpl Capture do
      def recv_client(execute, msgs, state) do
        if Enum.any?(msgs, &is_struct(&1, M.Execute)) do
          {
            nil,
            [%Command.Transparent{msgs: msgs}, %Command.Between{commands: execute.commands}],
            state
          }
        else
          {execute, [%Command.Transparent{msgs: msgs}], state}
        end
      end
    end
  end

  defmodule BindExecuteElectric do
    defstruct [:commands, :electric]

    defimpl Capture do
      alias Elixir.Electric.DDLX

      def recv_client(execute, msgs, state) do
        if Enum.any?(msgs, &is_struct(&1, M.Execute)) do
          tag = DDLX.Command.tag(execute.electric)

          {nil, execute.commands ++ [%Command.FakeExecute{msgs: msgs, tag: tag}], state}
        else
          {execute, [], state}
        end
      end
    end
  end

  def command_from_analysis(analysis, state) do
    command_from_analysis(analysis.source, analysis, state)
  end

  def command_from_analysis(msg, %{allowed?: false} = analysis, _state) do
    [%Command.Disallowed{msg: msg, analysis: analysis}]
  end

  def command_from_analysis(msg, %{action: {:tx, :begin}}, _state) do
    [%Command.Begin{msg: msg}]
  end

  def command_from_analysis(msg, %{action: {:tx, :commit}}, state) do
    case {State.tx_version?(state), State.electrified?(state)} do
      {_, false} ->
        [%Command.Commit{msg: msg}]

      {true, true} ->
        [%Command.Commit{msg: msg}]

      {false, true} ->
        [%Command.AssignMigrationVersion{}, %Command.Commit{msg: msg}]
    end
  end

  def command_from_analysis(msg, %{action: {:tx, :rollback}}, _state) do
    [%Command.Rollback{msg: msg}]
  end

  def command_from_analysis(msgs, %{action: {:electric, command}} = analysis, _state) do
    [
      %Command.Electric{
        analysis: analysis,
        command: command,
        mode: analysis.mode,
        initial_query: msgs
      }
    ]
  end

  def command_from_analysis(msg, %{action: {:alter, "table"}, capture?: true} = analysis, state) do
    shadow_modifications =
      analysis
      |> shadow_modifications(state)
      |> Enum.map(&%Command.AlterShadow{analysis: analysis, modification: &1})

    [
      %Command.Wait{msgs: List.wrap(msg)},
      %Command.Capture{msg: msg, analysis: analysis} | shadow_modifications
    ]
  end

  def command_from_analysis(msg, %{electrified?: true} = analysis, _state) do
    [%Command.Wait{msgs: List.wrap(msg)}, %Command.Capture{msg: msg, analysis: analysis}]
  end

  def command_from_analysis(msg, _analysis, _state) do
    [%Command.Wait{msgs: List.wrap(msg)}]
  end

  defp shadow_modifications(%{ast: %PgQuery.AlterTableStmt{} = ast}, state) do
    analyse_modifications_query(ast, state)
  end

  defp shadow_modifications(_analysis, _state) do
    []
  end

  defp analyse_modifications_query(%PgQuery.AlterTableStmt{} = stmt, state) do
    {:table, {_schema, _name} = table} = Parser.table_name(stmt, state)

    Enum.map(stmt.cmds, fn %{node: {:alter_table_cmd, cmd}} ->
      Map.new([{:action, modification_action(cmd)}, {:table, table} | column_definition(cmd.def)])
    end)
  end

  defp modification_action(%{subtype: :AT_AddColumn}), do: :add
  defp modification_action(%{subtype: :AT_DropColumn}), do: :drop
  defp modification_action(_), do: :modify

  defp column_definition(%{node: {:column_def, def}}) do
    [
      column: def.colname,
      type: Elixir.Electric.Postgres.Dialect.Postgresql.map_type(def.type_name)
    ]
  end

  defp column_definition(nil) do
    []
  end

  # split messages into groups that will result in a terminating readyforquery msg from the server
  def group_messages(msgs) do
    {current, final} =
      Enum.reduce(msgs, {[], []}, fn
        %M.Query{} = msg, {[], f} -> {[], [{:simple, [msg]} | f]}
        %M.Query{} = msg, {c, f} -> {[], [{:simple, [msg]}, {:extended, Enum.reverse(c)} | f]}
        %M.Sync{} = msg, {c, f} -> {[], [{:extended, Enum.reverse([msg | c])} | f]}
        m, {c, f} -> {[m | c], f}
      end)

    case {current, final} do
      {[], final} ->
        Enum.reverse(final)

      {current, final} ->
        Enum.reverse([{:extended, Enum.reverse(current)} | final])
    end
  end

  defimpl Capture do
    def recv_frontend(m, msg, state, send) do
      {m, state, Send.back(send, msg)}
    end

    def recv_backend(m, msg, state, send) do
      {m, state, Send.front(send, msg)}
    end

    def recv_client(%{capture: nil} = electric, msgs, state) do
      chunks = Electric.group_messages(msgs)

      {commands, {electric, state}} =
        Enum.flat_map_reduce(chunks, {electric, state}, &command_for_msgs/2)

      {electric, commands, state}
    end

    def recv_client(%{capture: capture} = electric, msgs, state) do
      {capture, commands, state} = Capture.recv_client(capture, msgs, state)

      {%{electric | capture: capture}, commands, state}
    end

    defp command_for_msgs({:simple, [%M.Query{} = msg]}, {electric, state}) do
      case Parser.parse(msg) do
        {:ok, stmts} ->
          analysis = Parser.analyse(stmts, state)

          case validate_query(analysis) do
            {:ok, analysis} ->
              {[%Command.Simple{stmts: analysis}], {electric, state}}

            {:error, analysis} ->
              {[%Command.SyntaxError{error: analysis}], {electric, state}}
          end

        {:error, error} ->
          {[%Command.SyntaxError{error: error}], {electric, state}}
      end
    end

    defp command_for_msgs({:extended, msgs}, {electric, state}) do
      signal =
        case List.last(msgs) do
          %M.Sync{} -> M.ReadyForQuery
          %M.Flush{} -> M.NoData
        end

      case Enum.find(msgs, &is_struct(&1, M.Parse)) do
        %M.Parse{} = parse ->
          case Parser.parse(parse) do
            {:ok, [stmt]} ->
              case Parser.analyse(stmt, state) do
                %{allowed?: false} = analysis ->
                  {Electric.command_from_analysis([], analysis, state), {electric, state}}

                %{action: {:electric, cmd}} = analysis ->
                  capture =
                    %BindExecuteElectric{
                      commands: Electric.command_from_analysis([], analysis, state),
                      electric: cmd
                    }

                  {[%Command.FakeBind{msgs: msgs}], {%{electric | capture: capture}, state}}

                %{action: {:migration_version, framework}} = analysis ->
                  capture = %BindExecuteMigration{
                    commands: Electric.command_from_analysis([], analysis, state),
                    framework: framework
                  }

                  {[%Command.Wait{msgs: msgs, signal: signal}],
                   {%{electric | capture: capture}, state}}

                analysis ->
                  capture = %BindExecute{
                    commands: Electric.command_from_analysis([], analysis, state)
                  }

                  {[%Command.Wait{msgs: msgs, signal: signal}],
                   {%{electric | capture: capture}, state}}
              end

            {:error, error} ->
              {[%Command.SyntaxError{error: error}], {electric, state}}
          end

        nil ->
          {[%Command.Wait{msgs: msgs}], {electric, state}}
      end
    end

    defp validate_query(analysis) do
      case Enum.split_with(analysis, &(!&1.allowed?)) do
        {[], allowed} -> {:ok, allowed}
        {[invalid | _rest], _allowed} -> {:error, invalid}
      end
    end
  end
end
