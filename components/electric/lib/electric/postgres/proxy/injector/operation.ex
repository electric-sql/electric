defprotocol Electric.Postgres.Proxy.Injector.Operation do
  def initialise(cmd, state, send)
  def recv_client(cmd, msgs, state)
  def recv_server(cmd, msg, state, send)
  def send_client(cmd, state, send)
  def recv_error(cmd, msgs, state, send)
  def send_error(cmd, state, send)
end

alias PgProtocol.Message, as: M

alias Electric.Postgres.Proxy.{
  Injector,
  Injector.Send,
  Injector.State,
  Injector.Operation,
  Parser,
  QueryAnalysis
}

defmodule Operation.Impl do
  defmacro __using__(_opts) do
    quote do
      import Injector.Operation.Impl

      def initialise(op, state, send) do
        {op, state, send}
      end

      def recv_client(op, msgs, state) do
        {op, state}
      end

      def recv_server(_op, %M.ReadyForQuery{} = msg, state, send) do
        {nil, state, send}
      end

      def recv_server(op, _msg, state, send) do
        {op, state, send}
      end

      def send_client(op, state, send) do
        {op, state, send}
      end

      def recv_error(_op, msgs, state, send) do
        {nil, state, send}
      end

      def send_error(_op, state, send) do
        {nil, state, send}
      end

      defoverridable initialise: 3,
                     recv_client: 3,
                     recv_server: 4,
                     send_client: 3,
                     recv_error: 4,
                     send_error: 3
    end
  end

  def query(%{msg: msg}) when is_struct(msg) do
    msg
  end

  def query(%{analysis: %QueryAnalysis{sql: sql}}) do
    %M.Query{query: sql}
  end

  def query(%QueryAnalysis{sql: sql}) do
    %M.Query{query: sql}
  end

  def query(sql) when is_binary(sql) do
    %M.Query{query: sql}
  end

  def query(sql, %{analysis: %QueryAnalysis{mode: mode}}) do
    case mode do
      :simple -> %M.Query{query: sql}
      :extended -> %M.Parse{query: sql}
    end
  end

  def table_name(%QueryAnalysis{table: {schema, table}}) do
    "\"#{schema}\".\"#{table}\""
  end

  def response(msg, tag \\ nil, state)

  def response(%M.Parse{}, _tag, _state) do
    %M.ParseComplete{}
  end

  def response(%M.Describe{}, _tag, _state) do
    %M.ParameterDescription{}
  end

  def response(%M.Flush{}, _tag, _state) do
    %M.NoData{}
  end

  def response(%M.Bind{}, _tag, _state) do
    %M.BindComplete{}
  end

  def response(%M.Execute{}, tag, _state) do
    %M.CommandComplete{tag: tag}
  end

  def response(%M.Close{}, _tag, _state) do
    %M.CloseComplete{}
  end

  def response(%M.Sync{}, _tag, state) do
    if State.tx?(state) do
      %M.ReadyForQuery{status: :tx}
    else
      %M.ReadyForQuery{status: :idle}
    end
  end
end

defimpl Operation, for: List do
  use Operation.Impl

  def recv_client([], _msgs, _state) do
    raise "empty command stack!"
  end

  def recv_client([op | rest], msgs, state) do
    case Operation.recv_client(op, msgs, state) do
      {nil, state} ->
        recv_client(rest, msgs, state)

      {ops, state} ->
        {List.flatten([ops | rest]), state}
    end
  end

  def initialise([], state, send) do
    {[], state, send}
  end

  def initialise([op | rest], state, send) do
    case Operation.initialise(op, state, send) do
      {nil, state, send} ->
        initialise(rest, state, send)

      {op, state, send} ->
        {List.flatten([op | rest]), state, send}
    end
  end

  def recv_server([], msg, state, send) do
    {[], state, Send.front(send, msg)}
  end

  def recv_server([op | rest], msg, state, send) do
    case Operation.recv_server(op, msg, state, send) do
      {nil, state, send} ->
        Operation.initialise(rest, state, send)

      {op, state, send} ->
        {List.flatten([op | rest]), state, send}
    end
  end

  def send_client([], state, send) do
    {[], state, send}
  end

  def send_client([op | rest], state, send) do
    {op, state, send} = Operation.send_client(op, state, send)
    {List.flatten([op | rest]), state, send}
  end

  def recv_error([], _msgs, state, send) do
    {[], state, send}
  end

  def recv_error([op | rest], msgs, state, send) do
    case Operation.recv_error(op, msgs, state, send) do
      {nil, state, send} ->
        Operation.recv_error(rest, msgs, state, send)

      {op, state, send} ->
        {List.flatten([op | rest]), state, send}
    end
  end

  def send_error([], state, send) do
    {[], state, send}
  end

  def send_error([op | rest], state, send) do
    case Operation.send_error(op, state, send) do
      {nil, state, send} ->
        Operation.send_error(rest, state, send)

      {op, state, send} ->
        {List.flatten([op | rest]), state, send}
    end
  end
end

# FIXME: better name!
defmodule Operation.Wait do
  defstruct [:msgs, signal: M.ReadyForQuery]

  defimpl Operation do
    use Operation.Impl

    # If we're getting messages from the client then according to it
    # the last round of messages is complete so we can just cede control
    # to the next operation
    def recv_client(op, msgs, state) do
      {nil, state}
    end

    def initialise(%{msgs: []}, state, send) do
      {nil, state, send}
    end

    def initialise(op, state, send) do
      {op, state, Send.back(send, op.msgs)}
    end

    def recv_server(%{signal: signal}, %signal{} = msg, state, send) do
      {nil, state, Send.front(send, msg)}
    end

    def recv_server(op, msg, state, send) do
      {op, state, Send.front(send, msg)}
    end
  end
end

defmodule Operation.Pass do
  defstruct [:msgs, :direction]

  def client(msgs) do
    %__MODULE__{direction: :client, msgs: msgs}
  end

  def server(msgs) do
    %__MODULE__{direction: :server, msgs: msgs}
  end

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      send =
        case op.direction do
          :client -> Send.front(send, op.msgs)
          :server -> Send.back(send, op.msgs)
        end

      {nil, state, send}
    end
  end
end

defmodule Operation.Between do
  defstruct [:commands, buffer: [], status: nil]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      if ready?(send) do
        %{front: front} = Send.flush(send)
        execute(op, front, state, Send.new())
      else
        {op, state, send}
      end
    end

    def recv_server(op, %M.ReadyForQuery{} = msg, state, send) do
      msgs = Enum.reverse([msg | op.buffer])

      execute(op, msgs, state, send)
    end

    def recv_server(op, msg, state, send) do
      {%{op | buffer: [msg | op.buffer]}, state, send}
    end

    defp ready?(send) do
      Enum.any?(send.front, &is_struct(&1, M.ReadyForQuery))
    end

    defp execute(op, msgs, state, send) do
      msgs = Enum.map(msgs, &tx_status(&1, op.status))
      Operation.initialise(op.commands ++ [Operation.Pass.client(msgs)], state, send)
    end

    def recv_error(op, msgs, state, send) do
      Operation.recv_error(op.commands, msgs, state, send)
    end

    def send_client(op, state, send) do
      if ready?(send) do
        %{front: front} = Send.flush(send)
        execute(op, front, state, Send.new())
      else
        {op, state, send}
      end
    end

    def send_error(op, state, send) do
      Operation.send_error(op.commands, state, send)
    end

    defp tx_status(m, nil) do
      m
    end

    defp tx_status(%M.ReadyForQuery{}, status) do
      %M.ReadyForQuery{status: status}
    end

    defp tx_status(m, _status) do
      m
    end
  end
end

defmodule Operation.Begin do
  defstruct [:msg, hidden?: false]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      {if(op.hidden?, do: op, else: nil), State.begin(state), Send.back(send, op.msg)}
    end
  end
end

defmodule Operation.Rollback do
  defstruct [:msg, hidden?: false]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      {if(op.hidden?, do: op, else: nil), State.rollback(state), Send.back(send, op.msg)}
    end
  end
end

defmodule Operation.Commit do
  defstruct [:msg, hidden?: false]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      {if(op.hidden?, do: op, else: nil), State.commit(state), Send.back(send, op.msg)}
    end

    def send_error(_op, state, send) do
      %{front: front} = Send.flush(send)

      Operation.initialise(
        [
          %Operation.Rollback{msg: %M.Query{query: "ROLLBACK"}, hidden?: true},
          Operation.Pass.client([front])
        ],
        state,
        Send.new()
      )
    end

    def recv_error(_op, msgs, state, _send) do
      Operation.initialise(
        [
          %Operation.Rollback{msg: %M.Query{query: "ROLLBACK"}, hidden?: true},
          Operation.Pass.client(msgs)
        ],
        state,
        Send.new()
      )
    end
  end
end

defmodule Operation.AssignMigrationVersion do
  defstruct [:version]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      if State.electrified?(state) do
        version = migration_version(op, state)
        query_generator = Map.fetch!(state, :query_generator)
        sql = query_generator.capture_version_query(version)
        {op, State.tx_version(state, version), Send.back(send, [query(sql)])}
      else
        {nil, state, send}
      end
    end

    defp migration_version(%Operation.AssignMigrationVersion{version: nil}, state) do
      generate_version(state)
    end

    defp migration_version(%Operation.AssignMigrationVersion{version: version}, _state)
         when is_binary(version) do
      version
    end

    defp generate_version(state) do
      query_generator = Map.fetch!(state, :query_generator)
      query_generator.migration_version()
    end
  end
end

defmodule Operation.Simple do
  defstruct [:stmts, :op, complete: [], ready: nil]

  defimpl Operation do
    use Operation.Impl

    def initialise(%{stmts: []} = _op, state, send) do
      {nil, state, send}
    end

    def initialise(op, state, send) do
      if State.tx?(state) || has_tx?(op) do
        next(op, state, send)
      else
        ops = [
          %Operation.Begin{msg: %M.Query{query: "BEGIN"}, hidden?: true},
          op,
          %Operation.Between{
            commands: [
              %Operation.AssignMigrationVersion{},
              %Operation.Commit{msg: %M.Query{query: "COMMIT"}, hidden?: true}
            ],
            status: :idle
          }
        ]

        Operation.initialise(ops, state, send)
      end
    end

    def recv_server(%{op: inner} = op, msg, state, send) do
      case Operation.recv_server(inner, msg, state, send) do
        {e, state, send} when e in [nil, []] ->
          next(%{op | op: nil}, state, send)

        {inner, state, send} ->
          {%{op | op: inner}, state, send}
      end
    end

    def send_client(op, state, send) do
      {command_complete, send} = Send.filter_front(send, M.CommandComplete)

      {op, send} =
        case Send.filter_front(send, M.ReadyForQuery) do
          {[ready], send} ->
            {%{op | complete: [command_complete | op.complete], ready: ready}, send}

          {[], send} ->
            {%{op | complete: [command_complete | op.complete]}, send}
        end

      {op, state, send}
    end

    defp next(%{stmts: []} = op, state, send) do
      complete =
        op.ready
        |> List.wrap()
        |> Enum.concat(List.flatten(op.complete))
        |> Enum.reverse()

      {nil, state, Send.front(send, complete)}
    end

    defp next(%{stmts: [analysis | rest]} = op, state, send) do
      # update the electrify status of the analysis taking into account
      # any actions performed in previous statements in this set of queries

      cmd =
        analysis
        |> Parser.refresh_analysis(state)
        |> Injector.Electric.command_from_analysis(state)

      {cmd, state, send} = Operation.initialise(cmd, state, send)

      {%{op | stmts: rest, op: cmd}, state, send}
    end

    defp has_tx?(%{stmts: [analysis | _rest]}) do
      case analysis do
        %{action: {:tx, :begin}} -> true
        _ -> false
      end
    end

    defp has_tx?(%{stmts: []}) do
      false
    end
  end
end

defmodule Operation.Electric do
  defstruct [:analysis, :command, :queries, :mode, :initial_query]

  defimpl Operation do
    use Operation.Impl

    alias Electric.DDLX

    # FIXME: replace single electric command with multiple queries by 
    # multiple electric commands with single queries
    def initialise(op, state, send) do
      [query | queries] = DDLX.Command.pg_sql(op.command)
      op = %{op | queries: queries}

      {op, State.electrify(state, op.analysis.table), Send.back(send, query(query))}
    end

    def recv_server(op, %M.ReadyForQuery{} = msg, state, send) do
      tag = DDLX.Command.tag(op.command)

      reply =
        case op.mode do
          :simple ->
            [%M.CommandComplete{tag: tag}, msg]

          :extended ->
            []
        end

      {nil, state, Send.front(send, reply)}
    end

    def recv_server(op, _msg, state, send) do
      {op, state, send}
    end
  end
end

defmodule Operation.Capture do
  defstruct [:analysis, :msg]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      query_generator = Map.fetch!(state, :query_generator)
      sql = query_generator.capture_ddl_query(op.analysis.sql)
      %{table: {schema, table}} = op.analysis

      _notice =
        %M.NoticeResponse{
          code: "00000",
          severity: "NOTICE",
          message: "Migration affecting electrified table #{table_name(op.analysis)}",
          detail: "Capturing migration: #{op.analysis.sql}",
          schema: schema,
          table: table
        }

      {
        op,
        State.electrify(state),
        send |> Send.back(query(sql))
        # |> Send.front(notice)
      }
    end
  end
end

defmodule Operation.AlterShadow do
  defstruct [:analysis, :modification]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      query_generator = Map.fetch!(state, :query_generator)
      sql = query_generator.alter_shadow_table_query(op.modification)
      {op, State.electrify(state), Send.back(send, query(sql))}
    end
  end
end

defmodule Operation.Disallowed do
  defstruct [:msg, :analysis]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      msgs = [error_response(op.analysis), %M.ReadyForQuery{status: :failed}]
      {nil, state, Send.front(send, msgs)}
    end

    defp error_response(%{table: {schema, table}} = analysis) do
      case analysis do
        %{action: {:drop, "table"}} ->
          %M.ErrorResponse{
            code: "EX100",
            severity: "ERROR",
            message: "Cannot DROP Electrified table #{table_name(analysis)}",
            detail:
              "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
            schema: schema,
            table: table
          }

        _ ->
          %M.ErrorResponse{
            code: "EX100",
            severity: "ERROR",
            message: "Invalid destructive migration on Electrified table #{table_name(analysis)}",
            detail:
              "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
            schema: schema,
            table: table
          }
      end
    end
  end
end

defmodule Operation.SyntaxError do
  defstruct [:error]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      msgs = [error_response(op.error), %M.ReadyForQuery{status: :failed}]
      {nil, state, Send.front(send, msgs)}
    end

    defp error_response(%Electric.DDLX.Command.Error{} = error) do
      %M.ErrorResponse{
        code: "00000",
        severity: "ERROR",
        message: "Invalid ELECTRIC statement",
        detail: error.message,
        line: 1,
        query: error.sql
      }
    end

    defp error_response(%QueryAnalysis{error: error} = analysis) do
      struct(
        %M.ErrorResponse{
          code: "EX000",
          severity: "ERROR",
          line: 1,
          query: analysis.sql
        },
        error
      )
    end
  end
end

defmodule Operation.FakeBind do
  defstruct [:msgs]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      {nil, state, Send.front(send, Enum.map(op.msgs, &response(&1, state)))}
    end
  end
end

defmodule Operation.FakeExecute do
  defstruct [:msgs, :tag]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      {nil, state, Send.front(send, Enum.map(op.msgs, &response(&1, op.tag, state)))}
    end
  end
end

defmodule Operation.AutoTx do
  defstruct [:ops]

  defimpl Operation do
    use Operation.Impl

    def initialise(op, state, send) do
      if State.tx?(state) do
        Operation.initialise(op.ops, state, send)
      else
        ops = [
          %Operation.Begin{msg: %M.Query{query: "BEGIN"}, hidden?: true},
          op.ops,
          %Operation.Between{
            commands: [
              %Operation.AssignMigrationVersion{},
              %Operation.Commit{msg: %M.Query{query: "COMMIT"}, hidden?: true}
            ],
            status: :idle
          }
        ]

        Operation.initialise(ops, state, send)
      end
    end
  end
end

defmodule Operation.BindExecute do
  defstruct [:ops]

  defimpl Operation do
    use Operation.Impl

    def recv_client(op, msgs, state) do
      if Enum.any?(msgs, &is_struct(&1, M.Execute)) do
        {
          [Operation.Pass.server(msgs), %Operation.Between{commands: op.ops}],
          state
        }
      else
        {[Operation.Pass.server(msgs), op], state}
      end
    end
  end
end

defmodule Operation.BindExecuteMigration do
  defstruct [:commands, :framework]

  defimpl Operation do
    use Operation.Impl

    require Logger

    def recv_client(op, msgs, state) do
      if Enum.any?(msgs, &is_struct(&1, M.Execute)) do
        {version_commands, state} = capture_version(msgs, op, state)

        {
          Enum.concat(
            [Operation.Pass.server(msgs)],
            [%Operation.Between{commands: op.commands ++ version_commands}]
          ),
          state
        }
      else
        {[Operation.Pass.server(msgs), op], state}
      end
    end

    defp capture_version(msgs, op, state) do
      {:ok, version} =
        msgs
        |> Enum.find(&is_struct(&1, M.Bind))
        |> assign_version(op.framework)

      case {State.tx?(state), State.electrified?(state)} do
        {_, false} ->
          {[], state}

        {true, true} ->
          {[%Operation.AssignMigrationVersion{version: version}], state}

        {false, true} ->
          {[], State.assign_version_metadata(state, version)}
      end
    end

    defp assign_version(%M.Bind{} = msg, %{framework: {:ecto, 1}} = v) do
      <<version::integer-big-signed-64>> =
        Enum.at(msg.parameters, Map.fetch!(v.columns, "version"))

      Logger.debug("Assigning version #{version} to current migration")
      {:ok, to_string(version)}
    end
  end
end

defmodule Operation.BindExecuteElectric do
  defstruct [:commands, :electric]

  defimpl Operation do
    use Operation.Impl

    alias Elixir.Electric.DDLX

    def recv_client(op, msgs, state) do
      if Enum.any?(msgs, &is_struct(&1, M.Execute)) do
        tag = DDLX.Command.tag(op.electric)

        {
          Enum.concat(
            op.commands,
            [%Operation.FakeExecute{msgs: msgs, tag: tag}]
          ),
          state
        }

        # {op.commands ++ [%Operation.FakeExecute{msgs: msgs, tag: tag}], state}
      else
        {op, state}
      end
    end
  end
end
