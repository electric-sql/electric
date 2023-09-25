defprotocol Electric.Postgres.Proxy.Capture.Command do
  def initialise(cmd, state, send)
  def recv_server(cmd, msg, state, send)
  def send_client(cmd, state, send)
  def recv_error(cmd, msgs, state, send)
  def send_error(cmd, state, send)
end

defmodule Electric.Postgres.Proxy.Capture.Command.Impl do
  alias Electric.Postgres.Proxy.{Injector.State, QueryAnalysis}
  alias PgProtocol.Message, as: M

  defmacro __using__(_opts) do
    quote do
      import Electric.Postgres.Proxy.Capture.Command.Impl
      alias Electric.Postgres.Proxy.{Injector.Send, Injector.State, Parser}
      alias PgProtocol.Message, as: M

      def recv_server(_, %M.ReadyForQuery{} = msg, state, send) do
        {nil, state, send}
      end

      def recv_server(c, _msg, state, send) do
        {c, state, send}
      end

      def send_client(c, state, send) do
        {c, state, send}
      end

      def recv_error(c, msgs, state, send) do
        {nil, state, send}
      end

      def send_error(c, state, send) do
        {nil, state, send}
      end

      defoverridable recv_server: 4, send_client: 3, recv_error: 4, send_error: 3
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

alias PgProtocol.Message, as: M
alias Electric.Postgres.Proxy.{Injector.Send, Capture.Command}

defimpl Command, for: List do
  use Command.Impl

  def initialise([], state, send) do
    {[], state, send}
  end

  def initialise([cmd | rest] = cmds, state, send) do
    case Command.initialise(cmd, state, send) do
      {nil, state, send} ->
        initialise(rest, state, send)

      {cmd, state, send} ->
        {List.flatten([cmd | rest]), state, send}
    end
  end

  def recv_server([], msg, state, send) do
    {[], state, Send.front(send, msg)}
  end

  def recv_server([cmd | rest], msg, state, send) do
    case Command.recv_server(cmd, msg, state, send) do
      {nil, state, send} ->
        Command.initialise(rest, state, send)

      {cmd, state, send} ->
        {List.flatten([cmd | rest]), state, send}
    end
  end

  def send_client([], state, send) do
    {[], state, send}
  end

  def send_client([cmd | rest], state, send) do
    {cmd, state, send} = Command.send_client(cmd, state, send)
    {[cmd | rest], state, send}
  end

  def recv_error([], _msgs, state, send) do
    {[], state, send}
  end

  def recv_error([cmd | rest], msgs, state, send) do
    case Command.recv_error(cmd, msgs, state, send) do
      {nil, state, send} ->
        Command.recv_error(rest, msgs, state, send)

      {cmd, state, send} ->
        {List.flatten([cmd | rest]), state, send}
    end
  end

  def send_error([], state, send) do
    {[], state, send}
  end

  def send_error([cmd | rest], state, send) do
    case Command.send_error(cmd, state, send) do
      {nil, state, send} ->
        Command.send_error(rest, state, send)

      {cmd, state, send} ->
        {List.flatten([cmd | rest]), state, send}
    end
  end
end

# FIXME: better name!
defmodule Command.Wait do
  defstruct [:msgs, signal: M.ReadyForQuery]

  defimpl Command do
    use Command.Impl

    def initialise(%{msgs: []}, state, send) do
      # {nil, state, Send.back(send, query(trans))}
      {nil, state, send}
    end

    def initialise(wait, state, send) do
      # {nil, state, Send.back(send, query(trans))}
      {wait, state, Send.back(send, wait.msgs)}
    end

    # FIXME: what about Flush->NoData
    def recv_server(%{signal: signal} = _wait, %signal{} = msg, state, send) do
      {nil, state, Send.front(send, msg)}
    end

    def recv_server(wait, msg, state, send) do
      {wait, state, Send.front(send, msg)}
    end
  end
end

defmodule Command.Transparent do
  defstruct [:msgs]

  defimpl Command do
    use Command.Impl

    def initialise(trans, state, send) do
      {nil, state, Send.back(send, trans.msgs)}
    end
  end
end

defmodule Command.Forward do
  defstruct [:msgs]

  defimpl Command do
    use Command.Impl

    def initialise(fwd, state, send) do
      {nil, state, Send.front(send, fwd.msgs)}
    end
  end
end

defmodule Command.Between do
  defstruct [:commands, buffer: []]

  defimpl Command do
    use Command.Impl

    def initialise(c, state, send) do
      if ready?(send) do
        %{front: front} = Send.flush(send)
        execute(c, front, state, Send.new())
      else
        {c, state, send}
      end

      # {c, state, send}
    end

    def recv_server(c, %M.ReadyForQuery{} = msg, state, send) do
      msgs = Enum.reverse([msg | c.buffer])

      execute(c, msgs, state, send)
    end

    def recv_server(c, msg, state, send) do
      {%{c | buffer: [msg | c.buffer]}, state, send}
    end

    defp ready?(send) do
      Enum.any?(send.front, &is_struct(&1, M.ReadyForQuery))
    end

    defp execute(c, msgs, state, send) do
      Command.initialise(c.commands ++ [%Command.Forward{msgs: msgs}], state, send)
    end

    def recv_error(c, msgs, state, send) do
      Command.recv_error(c.commands, msgs, state, send)
    end

    def send_error(c, state, send) do
      Command.send_error(c.commands, state, send)
    end
  end
end

defmodule Command.Begin do
  defstruct [:msg, hidden?: false]

  defimpl Command do
    use Command.Impl

    def initialise(c, state, send) do
      {if(c.hidden?, do: c, else: nil), State.begin(state), Send.back(send, c.msg)}
    end
  end
end

defmodule Command.Rollback do
  defstruct [:msg, hidden?: false]

  defimpl Command do
    use Command.Impl

    def initialise(c, state, send) do
      {if(c.hidden?, do: c, else: nil), State.rollback(state), Send.back(send, c.msg)}
    end
  end
end

defmodule Command.Commit do
  defstruct [:msg, hidden?: false]

  defimpl Command do
    use Command.Impl

    def initialise(c, state, send) do
      {if(c.hidden?, do: c, else: nil), State.commit(state), Send.back(send, c.msg)}
    end

    def send_error(_c, state, send) do
      %{front: front} = Send.flush(send)

      Command.initialise(
        [
          %Command.Rollback{msg: %M.Query{query: "ROLLBACK"}, hidden?: true},
          %Command.Forward{msgs: [front]}
        ],
        state,
        Send.new()
      )
    end

    def recv_error(_c, msgs, state, send) do
      # %{front: front} = Send.flush(send)

      Command.initialise(
        [
          %Command.Rollback{msg: %M.Query{query: "ROLLBACK"}, hidden?: true},
          %Command.Forward{msgs: msgs}
        ],
        state,
        Send.new()
      )
    end
  end
end

defmodule Command.AssignMigrationVersion do
  defstruct [:version]

  defimpl Command do
    use Command.Impl

    def initialise(assign, state, send) do
      if State.electrified?(state) do
        version = migration_version(assign, state)
        query_generator = Map.fetch!(state, :query_generator)
        sql = query_generator.capture_version_query(version)
        {assign, State.tx_version(state, version), Send.back(send, [query(sql)])}
      else
        {nil, state, send}
      end
    end

    defp migration_version(%Command.AssignMigrationVersion{version: nil}, state) do
      generate_version(state)
    end

    defp migration_version(%Command.AssignMigrationVersion{version: version}, _state)
         when is_binary(version) do
      version
    end

    defp generate_version(state) do
      query_generator = Map.fetch!(state, :query_generator)
      query_generator.migration_version()
    end
  end
end

defmodule Command.Simple do
  defstruct [:stmts, :cmd, complete: [], ready: nil]

  defimpl Command do
    use Command.Impl
    alias Electric.Postgres.Proxy.{Injector.Capture.Electric, Parser}

    def initialise(%{stmts: []} = _multi, state, send) do
      {nil, state, send}
    end

    def initialise(multi, state, send) do
      if State.tx?(state) || has_tx?(multi) do
        next(multi, state, send)
      else
        cmds = [
          %Command.Begin{msg: %M.Query{query: "BEGIN"}, hidden?: true},
          multi,
          %Command.Between{
            commands: [
              %Command.AssignMigrationVersion{},
              %Command.Commit{msg: %M.Query{query: "COMMIT"}, hidden?: true}
            ]
          }
        ]

        Command.initialise(cmds, state, send)
      end
    end

    def recv_server(%{cmd: cmd} = multi, msg, state, send) do
      case Command.recv_server(cmd, msg, state, send) do
        {nil, state, send} ->
          next(%{multi | cmd: nil}, state, send)

        {[], state, send} ->
          next(%{multi | cmd: nil}, state, send)

        {cmd, state, send} ->
          {%{multi | cmd: cmd}, state, send}
      end
    end

    def send_client(multi, state, send) do
      {command_complete, send} = Send.filter_front(send, M.CommandComplete)

      {multi, send} =
        case Send.filter_front(send, M.ReadyForQuery) do
          {[ready], send} ->
            {%{multi | complete: [command_complete | multi.complete], ready: ready}, send}

          {[], send} ->
            {%{multi | complete: [command_complete | multi.complete]}, send}
        end

      {multi, state, send}
    end

    defp next(%{stmts: []} = multi, state, send) do
      complete =
        multi.ready
        |> List.wrap()
        |> Enum.concat(List.flatten(multi.complete))
        |> Enum.reverse()

      {nil, state, Send.front(send, complete)}
    end

    defp next(%{stmts: [analysis | rest]} = multi, state, send) do
      # update the electrify status of the analysis taking into account
      # any actions performed in previous statements in this set of queries

      cmd =
        analysis
        |> Parser.refresh_analysis(state)
        |> Electric.command_from_analysis(state)

      {cmd, state, send} = Command.initialise(cmd, state, send)

      {%{multi | stmts: rest, cmd: cmd}, state, send}
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

defmodule Command.Electric do
  defstruct [:analysis, :command, :queries, :mode, :initial_query]

  defimpl Command do
    use Command.Impl

    alias Electric.DDLX

    # FIXME: replace single electric command with multiple queries by 
    # multiple electric commands with single queries
    def initialise(electric, state, send) do
      [query | queries] = DDLX.Command.pg_sql(electric.command)
      electric = %{electric | queries: queries}

      {electric, State.electrify(state, electric.analysis.table), Send.back(send, query(query))}
    end

    def recv_server(electric, %M.ReadyForQuery{} = msg, state, send) do
      tag = DDLX.Command.tag(electric.command)

      reply =
        case electric.mode do
          :simple ->
            [%M.CommandComplete{tag: tag}, msg]

          :extended ->
            reply = Enum.map(electric.initial_query, &response(&1, state))
            []
        end

      {nil, state, Send.front(send, reply)}
    end

    def recv_server(electric, _msg, state, send) do
      {electric, state, send}
    end
  end
end

defmodule Command.Capture do
  defstruct [:analysis, :msg]

  defimpl Command do
    use Command.Impl

    def initialise(capture, state, send) do
      query_generator = Map.fetch!(state, :query_generator)
      sql = query_generator.capture_ddl_query(capture.analysis.sql)
      %{table: {schema, table}} = capture.analysis

      _notice =
        %M.NoticeResponse{
          code: "00000",
          severity: "NOTICE",
          message: "Migration affecting electrified table #{table_name(capture.analysis)}",
          detail: "Capturing migration: #{capture.analysis.sql}",
          schema: schema,
          table: table
        }

      {
        capture,
        State.electrify(state),
        send |> Send.back(query(sql))
        # |> Send.front(notice)
      }
    end
  end
end

defmodule Command.AlterShadow do
  defstruct [:analysis, :modification]

  defimpl Command do
    use Command.Impl

    def initialise(shadow, state, send) do
      query_generator = Map.fetch!(state, :query_generator)
      sql = query_generator.alter_shadow_table_query(shadow.modification)
      {shadow, State.electrify(state), Send.back(send, query(sql))}
    end
  end
end

defmodule Command.Disallowed do
  defstruct [:msg, :analysis]

  defimpl Command do
    use Command.Impl

    def initialise(disallow, state, send) do
      msgs = [error_response(disallow.analysis), %M.ReadyForQuery{status: :failed}]
      {nil, state, Send.front(send, msgs)}
    end

    defp error_response(%{table: {schema, table}} = analysis) do
      case analysis do
        %{action: {:drop, "table"}} ->
          %M.ErrorResponse{
            severity: "ERROR",
            message: "Cannot DROP Electrified table #{table_name(analysis)}",
            detail:
              "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
            schema: schema,
            table: table
          }

        _ ->
          %M.ErrorResponse{
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

defmodule Command.SyntaxError do
  defstruct [:error]

  defimpl Command do
    use Command.Impl

    alias Electric.Postgres.Proxy.QueryAnalysis

    def initialise(error, state, send) do
      msgs = [error_response(error.error), %M.ReadyForQuery{status: :failed}]
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

defmodule Command.FakeBind do
  defstruct [:msgs]

  defimpl Command do
    use Command.Impl

    def initialise(fake, state, send) do
      {nil, state, Send.front(send, Enum.map(fake.msgs, &response(&1, state)))}
    end
  end
end

defmodule Command.FakeExecute do
  defstruct [:msgs, :tag]

  defimpl Command do
    use Command.Impl

    def initialise(fake, state, send) do
      {nil, state, Send.front(send, Enum.map(fake.msgs, &response(&1, fake.tag, state)))}
    end
  end
end
