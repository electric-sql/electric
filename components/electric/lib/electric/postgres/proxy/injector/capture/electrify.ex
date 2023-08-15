defmodule Electric.Postgres.Proxy.Injector.Capture.Electrify do
  @moduledoc """
  Re-writes the various DDLX sql extensions into a series of function/procedure
  calls.

  Requires a different capture mode because, unlike other injection methods,
  this doesn't send the original query and then insert additional ones, it
  completely replaces the original command (which isn't valid SQL...).

  In simple-protocol mode the re-written queries are sent immediately. In
  extended-protocol mode we wait for the client to send a Sync message before
  injecting our custom sql call(s).

  Once we've sent all our injected sql, and received the corresponding
  ReadyForQuery message, we then return the relevant "success" messages for the
  protocol mode, with a fake command tag and the final ReadyForQuery.
  """

  defstruct [:queries, :command, :protocol]

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector.Send
  alias Electric.DDLX

  # if we're in simple protocol mode, we need to immediately send the first
  # command query to the backend
  def new(commands, %M.Query{}, state, send) do
    [query | queries] = DDLX.Command.pg_sql(commands)
    capture = %__MODULE__{queries: queries, command: commands, protocol: :simple}
    {capture, state, Send.back(send, %M.Query{query: query})}
  end

  # in extended protocol mode we have to wait for the client to finish its 
  # sequence of pipelined commands before injecting the electric query
  def new(commands, %M.Parse{}, state, send) do
    queries = DDLX.Command.pg_sql(commands)
    capture = %__MODULE__{queries: queries, command: commands, protocol: :extended}
    {capture, state, send}
  end

  defimpl Electric.Postgres.Proxy.Injector.Capture do
    def recv_frontend(%{protocol: :extended} = electric, %M.Flush{}, state, send) do
      msgs = [
        %M.ParseComplete{},
        %M.ParameterDescription{params: []},
        %M.NoData{}
      ]

      {electric, state, Send.front(send, msgs)}
    end

    def recv_frontend(%{protocol: :extended} = electric, %M.Sync{}, state, send) do
      send_query(electric, state, send)
    end

    # ignore the various Bind, Describe etc etc messages from the client in
    # extended mode.
    def recv_frontend(%{protocol: :extended} = electric, _msg, state, send) do
      {electric, state, send}
    end

    def recv_frontend(%{protocol: :simple} = _electric, _msg, _state, _send) do
      raise "shouldn't get a frontend message while sinking responses from backend"
    end

    def recv_backend(_electric, %M.ErrorResponse{} = msg, state, send) do
      {nil, state, Send.front(send, msg)}
    end

    def recv_backend(electric, %M.NoticeResponse{} = msg, state, send) do
      {electric, state, Send.front(send, msg)}
    end

    # the injection is complete, send the protocol-mode-appropriate message
    # sequence that simulates a successful single `ELECTRIC` query
    def recv_backend(%{queries: []} = e, %M.ReadyForQuery{} = msg, state, send) do
      send_complete(e, msg, state, send)
    end

    def recv_backend(%{queries: [_ | _]} = e, %M.ReadyForQuery{}, state, send) do
      # TODO: send a NoticeResponse informing of the successful ddlx command
      send_query(e, state, send)
    end

    def recv_backend(e, _msg, state, send) do
      {e, state, send}
    end

    defp send_query(%{queries: [query | queries]} = e, state, send) do
      msg = %M.Query{query: query}

      {%{e | queries: queries}, state, Send.back(send, msg)}
    end

    defp send_complete(%{protocol: :simple} = e, msg, state, send) do
      tag = DDLX.Command.tag(e.command)
      {nil, state, Send.front(send, [%M.CommandComplete{tag: tag}, msg])}
    end

    defp send_complete(%{protocol: :extended} = e, msg, state, send) do
      tag = DDLX.Command.tag(e.command)

      msgs = [
        %M.BindComplete{},
        %M.CommandComplete{tag: tag},
        %M.CloseComplete{},
        msg
      ]

      {nil, state, Send.front(send, msgs)}
    end
  end
end
