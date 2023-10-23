defmodule Electric.Postgres.Proxy.Injector.Electric do
  defstruct []

  @type t() :: %__MODULE__{}

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.{Parser, QueryAnalysis}
  alias Electric.Postgres.Proxy.Injector.{Operation, Send, State}
  alias __MODULE__

  def command_from_analysis(analysis, state) do
    command_from_analysis(analysis.source, analysis, state)
  end

  def command_from_analysis(msg, %{allowed?: false} = analysis, _state) do
    [%Operation.Disallowed{msg: msg, analysis: analysis}]
  end

  def command_from_analysis(_msg, %{action: {:tx, :begin}}, _state) do
    [%Operation.Begin{}]
  end

  def command_from_analysis(_msg, %{action: {:tx, :commit}}, state) do
    case {State.tx_version?(state), State.electrified?(state)} do
      {_, false} ->
        [%Operation.Commit{}]

      {true, true} ->
        [%Operation.Commit{}]

      {false, true} ->
        [%Operation.AssignMigrationVersion{}, %Operation.Commit{}]
    end
  end

  def command_from_analysis(_msg, %{action: {:tx, :rollback}}, _state) do
    [%Operation.Rollback{}]
  end

  def command_from_analysis(msgs, %{action: {:electric, command}} = analysis, _state) do
    [
      %Operation.Electric{
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
      |> Enum.map(&%Operation.AlterShadow{analysis: analysis, modification: &1})

    [
      Operation.Wait.new(List.wrap(msg), state),
      %Operation.Capture{msg: msg, analysis: analysis} | shadow_modifications
    ]
  end

  # never capture create table commands (has to come before the electrified?:
  # true test below because in tests we need to migrate the schema loader
  # before running the queries and so the table we're creating registers as
  # electrified already at the point of creation...)
  def command_from_analysis(msg, %{action: {:create, "table"}}, state) do
    [Operation.Wait.new(msg, state)]
  end

  def command_from_analysis(msg, %{capture?: true} = analysis, state) do
    [Operation.Wait.new(msg, state), %Operation.Capture{msg: msg, analysis: analysis}]
  end

  def command_from_analysis(msg, _analysis, state) do
    [Operation.Wait.new(msg, state)]
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

  def requires_tx?(analysis) when is_list(analysis) do
    Enum.any?(analysis, &requires_tx?/1)
  end

  def requires_tx?(%QueryAnalysis{tx?: tx?}) do
    tx?
  end

  defimpl Operation do
    def activate(electric, state, send) do
      {electric, state, send}
    end

    def recv_client(electric, msgs, state) do
      chunks = Electric.group_messages(msgs)

      {commands, {electric, state}} =
        Enum.flat_map_reduce(chunks, {electric, state}, &command_for_msgs/2)

      {Enum.concat(commands, [electric]), state}
    end

    # override the default implementations because we never want to pop ourselves off
    # the operation stack
    def recv_server(electric, msg, state, send) do
      {electric, state, Send.client(send, msg)}
    end

    def send_client(electric, state, send) do
      {electric, state, send}
    end

    def recv_error(electric, _msgs, state, send) do
      {electric, state, send}
    end

    def send_error(electric, state, send) do
      {electric, state, send}
    end

    defp command_for_msgs({:simple, [%M.Query{} = msg]}, {electric, state}) do
      case Parser.parse(msg) do
        {:ok, stmts} ->
          analysis = Parser.analyse(stmts, state)

          case validate_query(analysis) do
            {:ok, analysis} ->
              {[%Operation.Simple{stmts: analysis, tx?: Electric.requires_tx?(analysis)}],
               {electric, state}}

            {:error, analysis} ->
              {[%Operation.SyntaxError{error: analysis, msg: msg}], {electric, state}}
          end

        {:error, error} ->
          {[%Operation.SyntaxError{error: error, msg: msg}], {electric, state}}
      end
    end

    defp command_for_msgs({:extended, msgs}, {electric, state}) do
      case Enum.find(msgs, &is_struct(&1, M.Parse)) do
        %M.Parse{} = msg ->
          handle_parse(msg, msgs, electric, state)

        nil ->
          {[Operation.Pass.server(msgs)], {electric, state}}
      end
    end

    defp validate_query(analysis) do
      case Enum.split_with(analysis, &(!&1.allowed?)) do
        {[], allowed} -> {:ok, allowed}
        {[invalid | _rest], _allowed} -> {:error, invalid}
      end
    end

    defp handle_parse(msg, msgs, electric, state) do
      signal =
        case List.last(msgs) do
          %M.Sync{} -> M.ReadyForQuery
          %M.Flush{} -> M.NoData
          _ -> M.ReadyForQuery
        end

      case Parser.parse(msg) do
        {:ok, [stmt]} ->
          analysis = Parser.analyse(stmt, state)

          # the query analysis sets a tx? flag if the statement should be run 
          # within a transaction
          # if Electric.requires_tx?(analysis) do
          case analysis do
            %{allowed?: false} = analysis ->
              {Electric.command_from_analysis([], analysis, state), {electric, state}}

            %{action: {:electric, cmd}} = analysis ->
              bind =
                %Operation.BindExecuteElectric{
                  commands: Electric.command_from_analysis([], analysis, state),
                  electric: cmd
                }

              {
                [
                  %Operation.AutoTx{
                    ops: [
                      %Operation.FakeBind{msgs: msgs},
                      bind
                    ],
                    tx?: Electric.requires_tx?(analysis)
                  }
                ],
                {electric, state}
              }

            %{action: {:migration_version, framework}} = analysis ->
              bind = %Operation.BindExecuteMigration{
                commands: Electric.command_from_analysis([], analysis, state),
                framework: framework
              }

              {[Operation.Wait.new(msgs, state, signal), bind], {electric, state}}

            analysis ->
              bind = %Operation.BindExecute{
                ops: Electric.command_from_analysis([], analysis, state)
              }

              {[
                 %Operation.AutoTx{
                   ops: [
                     Operation.Wait.new(msgs, state, signal),
                     bind
                   ],
                   tx?: Electric.requires_tx?(analysis)
                 }
               ], {electric, state}}
          end

        # else
        #   {[Operation.Wait.new(msgs, state)], {electric, state}}
        # end

        {:error, error} ->
          {[%Operation.SyntaxError{error: error, msg: msg}], {electric, state}}
      end
    end
  end
end
