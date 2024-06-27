defmodule Electric.Postgres.Proxy.Injector.Electric do
  defstruct []

  @type t() :: %__MODULE__{}

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.{Parser, QueryAnalysis}
  alias Electric.Postgres.Proxy.Injector.{Operation, Send}
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

  def command_from_analysis(_msg, %{action: {:tx, :commit}}, _state) do
    [%Operation.Commit{}]
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
    shadow_modifications = [%Operation.AlterShadow{analysis: analysis}]

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

  # split messages into groups that will result in a terminating readyforquery msg from the server
  def group_messages(msgs) do
    {current, final} =
      Enum.reduce(msgs, {[], []}, fn
        %M.Query{} = msg, {[], f} ->
          {[], [{:simple, [msg]} | f]}

        %M.Query{} = msg, {c, f} ->
          {[], [{:simple, [msg]}, {:extended, Enum.reverse(c)} | f]}

        %type{} = msg, {c, f} when type in [M.Sync, M.Flush] ->
          {[], [{:extended, Enum.reverse([msg | c])} | f]}

        m, {c, f} ->
          {[m | c], f}
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
    def upstream_connection(_electric, connector_config) do
      connector_config
    end

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

    defp extended_begin_response(msg, tag \\ "BEGIN", status \\ :tx)

    defp extended_begin_response(%M.Parse{}, _, _), do: %M.ParseComplete{}
    defp extended_begin_response(%M.Bind{}, _, _), do: %M.BindComplete{}
    defp extended_begin_response(%M.Describe{}, _, _), do: %M.NoData{}
    defp extended_begin_response(%M.Execute{}, tag, _), do: %M.CommandComplete{tag: tag}
    defp extended_begin_response(%M.Sync{}, _, status), do: %M.ReadyForQuery{status: status}

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

              {stack, state} = bind_execute(bind, msgs, state)

              {[Operation.Wait.new(msgs, state, signal), stack], {electric, state}}

            # psycopg sends its txn commands using the extended protocol, annoyingly
            # it uses a [parse, describe, bind, execute, sync] message block, so all we
            # need to do is pass that on and mark the connection as in a transaction
            %{action: {:tx, :begin}} = _analysis ->
              begin = %Operation.Begin{complete_msgs: Enum.map(msgs, &extended_begin_response/1)}

              {[begin], {electric, state}}

            %{action: {:tx, :commit}} = _analysis ->
              commit =
                %Operation.Commit{
                  complete_msgs: Enum.map(msgs, &extended_begin_response(&1, "COMMIT", :idle))
                }

              {[commit], {electric, state}}

            %{action: {:tx, :rollback}} = _analysis ->
              rollback =
                %Operation.Rollback{
                  complete_msgs: Enum.map(msgs, &extended_begin_response(&1, "ROLLBACK", :idle))
                }

              {[rollback], {electric, state}}

            analysis ->
              bind = %Operation.BindExecute{
                ops: Electric.command_from_analysis([], analysis, state)
              }

              {stack, state} = bind_execute(bind, msgs, state)

              {[
                 %Operation.AutoTx{
                   ops: [
                     Operation.Wait.new(msgs, state, signal),
                     stack
                   ],
                   tx?: Electric.requires_tx?(analysis)
                 }
               ], {electric, state}}
          end

        {:error, error} ->
          {[%Operation.SyntaxError{error: error, msg: msg}], {electric, state}}
      end
    end

    # handle message groups with the full [parse, [describe], bind, execute] sequence included in
    # a single packet (as opposed to a [parse, describe, {sync, flush}], [bind, execute, sync]
    # sequence which is split over two packets, with a sync/flush between)
    defp bind_execute(bind, msgs, state) do
      {_parse_msgs, bind_msgs} = Enum.split_while(msgs, &(!is_struct(&1, M.Bind)))
      Operation.recv_client(bind, bind_msgs, state)
    end
  end
end
