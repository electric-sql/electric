defprotocol Electric.Postgres.Proxy.Injector.Operation do
  @moduledoc """
  Defines the interface between the top-level Injector module and the
  particular behaviour of the proxy.

  The behaviour is modelled as a stack of atomic operations, which is handled
  by the implementation of this protocol for `List` below.

  For any of the functions in this protocol, returning `nil` for the operation,
  the first element in the `result` tuple (`{op, state, send}`) means that the
  operation is done and the next in the stack should be moved up to the top.

  At the root of the stack should be an implementation of this protocol which
  never returns `nil` as the next operation, which means it is never popped off
  the stack and will always be called to handle new client requests.

  ## Handling messages from the client


  When messages are received from the client, which calls
  `Injector.recv_client/2`, the process is:

  1. `recv_client/3` this updates the operation stack with whatever operation
     is needed to handle the messages from the client.

  2. `activate/3` is then called on the operation stack with an empty `%Send{}`
     struct so that new operations pushed by `recv_client/3` can make their
     move.

  3. Messages put into the `Send` struct are then returned to the proxy handler
     so they can be forwared onto their destination.


  ## Handling messages from the server

  When messages are received from the server, which calls
  `Injector.recv_server/2`, the process is:

  1. Any error messages are found and split out. See below
  2. The operation stack is updated by calling `Operation.recv_server/4`
     for every message from the server.
  3. If the server hasn't sent any errors, then we look for any errors being
     returned by the operation stack. If any of the operations have returned an
     error to the client, e.g. the user has tried to use an incorrect syntax for
     one of the Electric DDLX commands, then we give the active operations a
     chance to do cleanup (e.g. by rolling back transactions) by calling
     `Operation.send_error/3`

     If no errors were received from the server, and no operations have
     generated an error to the client, then we give the active operations
     a chance to re-write what's being sent to the client by calling
     `Operation.send_client/3`.

     If the server has returned an error, then we give the operations a
     chance to cleanup by calling `Operation.recv_error/4`.

  4. Finally the `Send` struct is flushed and the messages returned to the
     `Handler` to be sent to the client and server.

  """

  alias Electric.Postgres.Proxy.Injector.{Send, State}

  @type op_stack() :: nil | t() | [t()]
  @type op() :: nil | t()
  @type result() :: {op(), State.t(), Send.t()}

  @spec upstream_connection(t(), Connectors.config()) :: Connectors.config()
  def upstream_connection(op, conn_config)

  @doc """
  Given a set of messages from the client returns an updated operation stack.
  """
  @spec recv_client(t(), [PgProtocol.Message.t()], State.t()) :: {op_stack(), State.t()}
  def recv_client(op, msgs, state)

  @doc """
  Tell new operations on the stack to activate and send any initial messages.
  """
  @spec activate(t(), State.t(), Send.t()) :: result()
  def activate(op, state, send)

  @doc """
  Handle a message received from the server.
  """
  @spec recv_server(t(), PgProtocol.Message.t(), State.t(), Send.t()) :: result()
  def recv_server(op, msg, state, send)

  @doc """
  Allow for active operations to re-write messages that are about to be sent to
  the client.
  """
  @spec send_client(t(), State.t(), Send.t()) :: result()
  def send_client(op, state, send)

  @doc """
  The server has returned an error as a result of either a client- or
  proxy-generated command. Operations should use this callback to issue
  any cleanup commands.
  """
  @spec recv_error(t(), [PgProtocol.Message.t()], State.t(), Send.t()) :: result()
  def recv_error(op, msgs, state, send)

  @doc """
  One of the operations is returning an error to the client, so any 
  pending operations on the stack should cleanup.
  """
  @spec send_error(t(), State.t(), Send.t()) :: result()
  def send_error(op, state, send)
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
  @moduledoc """
  Provides some useful utility functions as well as a default implementation of
  the `Operation` protocol functions. This default implementation assumes that
  we mostly want to intercept messages from the server until we get a
  `ReadyForQuery` message, which is the most usual behaviour. Once we receive
  this `ReadyForQuery` we return `nil` which pops the operation off the stack.
  """
  defmacro __using__(_opts) do
    quote do
      import Injector.Operation.Impl

      def upstream_connection(_op, conn_config) do
        conn_config
      end

      # no-op
      def recv_client(op, msgs, state) do
        {op, state}
      end

      # no-op
      def activate(op, state, send) do
        {op, state, send}
      end

      # pop this op off the stack once the server has finished processing
      # whatever query we sent from `activate/3`
      def recv_server(_op, %M.ReadyForQuery{} = msg, state, send) do
        {nil, state, send}
      end

      def recv_server(op, _msg, state, send) do
        {op, state, send}
      end

      # no-op
      def send_client(op, state, send) do
        {op, state, send}
      end

      # default impl that just removes this operation from the stack
      # in the case of a server generated error which means that the
      # next operation in the stack will be called.
      def recv_error(_op, msgs, state, send) do
        {nil, state, send}
      end

      # default impl that just removes this operation from the stack
      # in the case of a proxy generated error, which means that the
      # next operation in the stack will be called.
      def send_error(_op, state, send) do
        {nil, state, send}
      end

      defoverridable upstream_connection: 2,
                     recv_client: 3,
                     activate: 3,
                     recv_server: 4,
                     send_client: 3,
                     recv_error: 4,
                     send_error: 3
    end
  end

  @doc """
  Unwrap an operation or analysis and return any `msg` fields.
  """
  @spec query(
          %{msg: M.Query.t() | M.Parse.t()}
          | %{analysis: QueryAnalysis.t()}
          | QueryAnalysis.t()
          | String.t()
        ) ::
          M.Query.t() | M.Parse.t()
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

  @spec query(String.t(), %{analysis: QueryAnalysis.t()}) :: M.Query.t() | M.Parse.t()
  def query(sql, %{analysis: %QueryAnalysis{mode: mode}}) do
    case mode do
      :simple -> %M.Query{query: sql}
      :extended -> %M.Parse{query: sql}
    end
  end

  @doc """
  Return a quoted version of the introspected table name. Mostly used for error
  messages.
  """
  @spec table_name(QueryAnalysis.t()) :: String.t()
  def table_name(%QueryAnalysis{table: {schema, table}}) do
    "\"#{schema}\".\"#{table}\""
  end

  @doc """
  Map a client message into its expected server-response.

  Used by Electric DDLX commands which fake the responses from
  Parse/Describe and Bind/Execute.
  """
  @spec response(PgProtocol.Message.t(), String.t() | nil, State.t()) :: PgProtocol.Message.t()
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

  def upstream_connection([op | _rest], conn_config) do
    Operation.upstream_connection(op, conn_config)
  end

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

  def activate([], state, send) do
    {[], state, send}
  end

  def activate([op | rest], state, send) do
    case Operation.activate(op, state, send) do
      {nil, state, send} ->
        activate(rest, state, send)

      {op, state, send} ->
        {List.flatten([op | rest]), state, send}
    end
  end

  def recv_server([], msg, state, send) do
    {[], state, Send.client(send, msg)}
  end

  def recv_server([op | rest], msg, state, send) do
    case Operation.recv_server(op, msg, state, send) do
      {nil, state, send} ->
        Operation.activate(rest, state, send)

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
  defstruct [:msgs, :tx, signal: M.ReadyForQuery]

  def new(msgs, state, signal \\ M.ReadyForQuery) do
    %__MODULE__{
      msgs: List.wrap(msgs),
      signal: signal,
      tx: if(State.tx?(state), do: :tx, else: :idle)
    }
  end

  defimpl Operation do
    use Operation.Impl

    # If we're getting messages from the client then according to it
    # the last round of messages is complete so we can just cede control
    # to the next operation
    def recv_client(_op, _msgs, state) do
      {nil, state}
    end

    def activate(%{msgs: []}, state, send) do
      {nil, state, send}
    end

    def activate(op, state, send) do
      {op, state, Send.server(send, op.msgs)}
    end

    def recv_server(%{signal: signal} = op, %signal{} = msg, state, send) do
      {nil, state, Send.client(send, msg, op.tx)}
    end

    def recv_server(op, msg, state, send) do
      {op, state, Send.client(send, msg, op.tx)}
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

    def activate(op, state, send) do
      send =
        case op.direction do
          :client -> Send.client(send, op.msgs)
          :server -> Send.server(send, op.msgs)
        end

      {nil, state, send}
    end
  end
end

defmodule Operation.Between do
  defstruct [:commands, buffer: [], status: nil]

  defimpl Operation do
    use Operation.Impl

    def activate(op, state, send) do
      if ready?(send) do
        %{client: client} = Send.flush(send)
        execute(op, client, state, Send.new())
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
      Enum.any?(send.client, &is_struct(&1, M.ReadyForQuery))
    end

    defp execute(op, msgs, state, send) do
      msgs = Enum.map(msgs, &Send.status(&1, op.status))
      Operation.activate(op.commands ++ [Operation.Pass.client(msgs)], state, send)
    end

    def recv_error(op, msgs, state, send) do
      Operation.recv_error(op.commands, msgs, state, send)
    end

    def send_client(op, state, send) do
      if ready?(send) do
        %{client: client} = Send.flush(send)
        execute(op, client, state, Send.new())
      else
        {op, state, send}
      end
    end

    def send_error(op, state, send) do
      Operation.send_error(op.commands, state, send)
    end
  end
end

defmodule Operation.Begin do
  defstruct hidden?: false

  defimpl Operation do
    use Operation.Impl

    def activate(op, state, send) do
      {if(op.hidden?, do: op, else: nil), State.begin(state),
       Send.server(send, [%M.Query{query: "BEGIN"}])}
    end
  end
end

defmodule Operation.Rollback do
  defstruct hidden?: false

  defimpl Operation do
    use Operation.Impl

    def activate(op, state, send) do
      {if(op.hidden?, do: op, else: nil), State.rollback(state),
       Send.server(send, [%M.Query{query: "ROLLBACK"}])}
    end
  end
end

defmodule Operation.Commit do
  defstruct hidden?: false

  defimpl Operation do
    use Operation.Impl

    def activate(op, state, send) do
      {if(op.hidden?, do: op, else: nil), State.commit(state),
       Send.server(send, [%M.Query{query: "COMMIT"}])}
    end

    def send_error(_op, state, send) do
      %{client: client} = Send.flush(send)

      Operation.activate(
        [
          %Operation.Rollback{hidden?: true},
          Operation.Pass.client([client])
        ],
        state,
        Send.new()
      )
    end

    def recv_error(_op, msgs, state, _send) do
      Operation.activate(
        [
          %Operation.Rollback{hidden?: true},
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

    @generated_version_priority 0
    @session_version_priority 2
    @tx_version_priority 4

    def activate(op, state, send) do
      if State.electrified?(state) do
        {version, priority, state} = migration_version(op, state)
        query_generator = Map.fetch!(state, :query_generator)
        sql = query_generator.capture_version_query(version, priority)
        {op, State.tx_version(state, version), Send.server(send, [query(sql)])}
      else
        {nil, state, send}
      end
    end

    defp migration_version(%Operation.AssignMigrationVersion{version: nil}, state) do
      case State.retrieve_version_metadata(state) do
        {{:ok, version}, state} ->
          # this version is coming from some previous query, outside the
          # current transaction so give it a priority < the priority of any tx
          # assigned version.
          {version, @session_version_priority, state}

        {:error, state} ->
          # priority 0 will only be used if the automatic version assignment
          # wasn't called for some reason
          {generate_version(state), @generated_version_priority, state}
      end
    end

    defp migration_version(%Operation.AssignMigrationVersion{version: version}, state)
         when is_binary(version) do
      # this version is coming from the current transaction, so give it the
      # highest priority of all these options
      {version, @tx_version_priority, state}
    end

    defp generate_version(state) do
      query_generator = Map.fetch!(state, :query_generator)
      query_generator.migration_version()
    end
  end
end

defmodule Operation.Simple do
  defstruct [:stmts, :op, :tx?, complete: [], ready: nil]

  defimpl Operation do
    use Operation.Impl

    def activate(%{stmts: []} = _op, state, send) do
      {nil, state, send}
    end

    def activate(op, state, send) do
      if !op.tx? || (State.tx?(state) || has_tx?(op)) do
        next(op, state, send)
      else
        ops = [
          %Operation.Begin{hidden?: true},
          op,
          %Operation.Between{
            commands: [
              %Operation.AssignMigrationVersion{},
              %Operation.Commit{hidden?: true}
            ],
            status: :idle
          }
        ]

        Operation.activate(ops, state, send)
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
      {command_complete, send} = Send.filter_client(send, M.CommandComplete)

      {op, send} =
        case Send.filter_client(send, M.ReadyForQuery) do
          {[ready], send} ->
            {%{op | complete: [command_complete | op.complete], ready: ready}, send}

          {[], send} ->
            {%{op | complete: [command_complete | op.complete]}, send}
        end

      {op, state, send}
    end

    defp next(%{stmts: []} = op, state, send) do
      {ready, send} =
        case Send.filter_client(send, M.ReadyForQuery) do
          {[ready], send} ->
            {ready, send}

          {[], send} ->
            {op.ready, send}
        end

      {command_complete, send} = Send.filter_client(send, M.CommandComplete)

      complete =
        ready
        |> List.wrap()
        |> Enum.concat(command_complete ++ List.flatten(op.complete))
        |> Enum.reverse()

      {nil, state, Send.client(send, complete)}
    end

    defp next(%{stmts: [analysis | rest]} = op, state, send) do
      # update the electrify status of the analysis taking into account
      # any actions performed in previous statements in this set of queries

      cmd =
        analysis
        |> Parser.refresh_analysis(state)
        |> Injector.Electric.command_from_analysis(state)

      {cmd, state, send} = Operation.activate(cmd, state, send)

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

    def activate(op, state, send) do
      [query | queries] = DDLX.Command.pg_sql(op.command)
      op = %{op | queries: queries}

      {op, State.electrify(state, op.analysis.table), Send.server(send, query(query))}
    end

    def recv_server(%{queries: []} = op, %M.ReadyForQuery{} = msg, state, send) do
      tag = DDLX.Command.tag(op.command)

      reply =
        case op.mode do
          :simple ->
            [%M.CommandComplete{tag: tag}, msg]

          :extended ->
            []
        end

      {nil, state, Send.client(send, reply)}
    end

    def recv_server(%{queries: [query | queries]} = op, %M.ReadyForQuery{}, state, send) do
      {%{op | queries: queries}, state, Send.server(send, query(query))}
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

    def activate(op, state, send) do
      case op.analysis do
        %{table: {schema, table}} ->
          query_generator = Map.fetch!(state, :query_generator)
          sql = query_generator.capture_ddl_query(op.analysis.sql)

          notice =
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
            send
            |> Send.server(query(sql))
            |> Send.client(notice)
          }
      end
    end
  end
end

defmodule Operation.AlterShadow do
  defstruct [:analysis, :modification]

  defimpl Operation do
    use Operation.Impl

    def activate(op, state, send) do
      query_generator = Map.fetch!(state, :query_generator)
      sql = query_generator.alter_shadow_table_query(op.modification)
      {op, State.electrify(state), Send.server(send, query(sql))}
    end
  end
end

defmodule Operation.Disallowed do
  defstruct [:msg, :analysis]

  defimpl Operation do
    use Operation.Impl

    def activate(op, state, send) do
      msgs = [error_response(op.analysis), %M.ReadyForQuery{status: :failed}]
      {nil, state, Send.client(send, msgs)}
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
          struct(
            %M.ErrorResponse{
              code: "EX100",
              severity: "ERROR",
              message:
                "Invalid destructive migration on Electrified table #{table_name(analysis)}",
              detail:
                "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
              schema: schema,
              table: table
            },
            analysis.error
          )
      end
    end
  end
end

defmodule Operation.SyntaxError do
  defstruct [:error, :msg]

  defimpl Operation do
    use Operation.Impl

    def activate(op, state, send) do
      msgs = [error_response(op.error, op.msg), %M.ReadyForQuery{status: :failed}]
      {nil, state, Send.client(send, msgs)}
    end

    defp error_response(%Electric.DDLX.Command.Error{} = error, _msg) do
      %M.ErrorResponse{
        code: "00000",
        severity: "ERROR",
        message: "Invalid ELECTRIC statement",
        detail: error.message,
        line: 1,
        query: error.sql
      }
    end

    defp error_response(%QueryAnalysis{error: error} = analysis, _msg) do
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

    defp error_response(%{cursorpos: cursorpos, message: message}, %{query: query}) do
      %M.ErrorResponse{
        code: "42601",
        severity: "ERROR",
        message: message,
        position: cursorpos,
        query: query
      }
    end
  end
end

defmodule Operation.FakeBind do
  defstruct [:msgs]

  defimpl Operation do
    use Operation.Impl

    def activate(op, state, send) do
      {nil, state, Send.client(send, Enum.map(op.msgs, &response(&1, state)))}
    end
  end
end

defmodule Operation.FakeExecute do
  defstruct [:msgs, :tag]

  defimpl Operation do
    use Operation.Impl

    def activate(op, state, send) do
      {nil, state, Send.client(send, Enum.map(op.msgs, &response(&1, op.tag, state)))}
    end
  end
end

defmodule Operation.AutoTx do
  defstruct [:ops, :tx?]

  @type t() :: %__MODULE__{ops: Operation.t()}

  defimpl Operation do
    use Operation.Impl

    def activate(op, state, send) do
      if State.tx?(state) || !op.tx? do
        Operation.activate(op.ops, state, send)
      else
        ops = [
          %Operation.Begin{hidden?: true},
          op.ops,
          %Operation.Between{
            commands: [
              %Operation.AssignMigrationVersion{},
              %Operation.Commit{hidden?: true}
            ],
            status: :idle
          }
        ]

        Operation.activate(ops, state, send)
      end
    end
  end
end

defmodule Operation.BindExecute do
  defstruct [:ops]

  defimpl Operation do
    use Operation.Impl

    def recv_client(op, [], state) do
      {op, state}
    end

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

    # while we're waiting for the bind, execute stanza from the client
    # forward on any messages from the server
    def recv_server(op, msg, state, send) do
      {op, state, Send.client(send, msg)}
    end
  end
end

defmodule Operation.BindExecuteMigration do
  defstruct [:commands, :framework]

  defimpl Operation do
    use Operation.Impl

    require Logger

    # while we're waiting for the bind, execute stanza from the client
    # forward on any messages from the server
    def recv_server(op, msg, state, send) do
      {op, state, Send.client(send, msg)}
    end

    def recv_client(op, [], state) do
      {op, state}
    end

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

      Logger.debug("Assigning version #{version} to current migration")

      case {State.tx?(state), State.electrified?(state)} do
        {true, true} ->
          {[%Operation.AssignMigrationVersion{version: version}], state}

        {true, false} ->
          {[], state}

        # although we aren't in a tx and may not have any electrified
        # statements we still want to grab the version into some persistent
        # state field because e.g. prisma assigns the migration version before
        # actually running any ddl statements
        {false, _} ->
          {[], State.assign_version_metadata(state, version)}
      end
    end

    defp assign_version(%M.Bind{} = msg, %{framework: {:ecto, 1}} = v) do
      Logger.debug("Detected ecto migration")

      <<version::integer-big-signed-64>> =
        Enum.at(msg.parameters, Map.fetch!(v.columns, "version"))

      {:ok, to_string(version)}
    end

    defp assign_version(%M.Bind{} = msg, %{framework: {:prisma, 1}} = v) do
      Logger.debug("Detected prisma migration")

      name =
        Enum.at(msg.parameters, Map.fetch!(v.columns, "migration_name"))

      [version, _rest] = String.split(name, "_", parts: 2)

      {:ok, to_string(version)}
    end

    defp assign_version(%M.Bind{} = msg, %{framework: {:atdatabases, 1}} = v) do
      Logger.debug("Detected @databases migration")

      version =
        Enum.at(msg.parameters, Map.fetch!(v.columns, "index"))

      {:ok, version}
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
      else
        {op, state}
      end
    end
  end
end
