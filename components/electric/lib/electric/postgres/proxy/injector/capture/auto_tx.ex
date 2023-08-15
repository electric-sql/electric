defmodule Electric.Postgres.Proxy.Injector.Capture.AutoTx do
  @moduledoc """
  Wraps a single query in a transaction so that e.g. migrations against
  electrified tables coming from psql can be intercepted and the relevant calls
  to electric functions made within a single transaction.
  """

  defstruct subcommand: nil, buffer: [], status: :begin

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector

  alias Electric.Postgres.Proxy.Injector.{
    Capture,
    Capture.Sink,
    Send,
    State
  }

  @type t() :: %__MODULE__{
          subcommand: Capture.t(),
          buffer: [M.t()],
          status: :begin | :tx
        }

  def begin(msg, state, send) do
    {
      %__MODULE__{buffer: [msg]},
      State.begin(state),
      Send.back(send, [%M.Query{query: "BEGIN"}])
    }
  end

  defimpl Capture do
    def recv_frontend(%{status: :begin} = atx, msg, state, send) do
      {%{atx | buffer: [msg | atx.buffer]}, state, send}
    end

    # here we need to introspect the messages coming from the client
    # in order to inject the right commands 
    def recv_frontend(%{status: :tx} = atx, msg, state, send) do
      {subcommand, state, send} =
        Capture.recv_frontend(atx.subcommand, msg, state, send)

      abort_on_error(%{atx | subcommand: subcommand}, state, send)
    end

    def recv_backend(_atx, %M.ErrorResponse{} = msg, state, send) do
      commit(state, Send.front(send, msg), "ROLLBACK")
    end

    def recv_backend(atx, %M.NoticeResponse{} = msg, state, send) do
      {atx, state, Send.front(send, msg)}
    end

    # our injected 'BEGIN' command has completed, so we're now in a tx
    def recv_backend(%{status: :begin} = atx, %M.ReadyForQuery{status: :tx}, state, send) do
      # here we take what we've received from the client so far and push
      # it through the injection machinery, updating the `subcommand` with the
      # result

      {subcommand, state, send} =
        Injector.recv_frontend(nil, state, send, Enum.reverse(atx.buffer))

      abort_on_error(%{atx | status: :tx, buffer: [], subcommand: subcommand}, state, send)
    end

    # swallow all backend messages until ReadyForQuery{status: :tx}
    def recv_backend(%{status: :begin} = atx, _msg, state, send) do
      {atx, state, send}
    end

    def recv_backend(%{status: :tx} = atx, msg, state, send) do
      case Capture.recv_backend(atx.subcommand, msg, state, send) do
        {nil, state, send} ->
          # has the subcommand completed and has flushed a ready-for-query
          # message to be sent? in which case we want to catch that and inject
          # our commit statement. remember that this injector can only ever
          # wrap a single command from the client (even if that command is
          # split over multiple messages) so a ReadyForQuery message from the
          # server means that single command is done and we should finish up.

          case send.front do
            [%M.ReadyForQuery{} | msgs] = front ->
              send = Send.clear(send, :front)

              case {State.electrified?(state), State.tx_version(state)} do
                {true, :error} ->
                  # we need to include the ReadyForQuery message so that this
                  # branch happens again after the version has been assigned
                  #
                  # the sink reverses the msgs before sending so just pass
                  # then reversed straight from the Send buffer
                  {subcommand, state, send} =
                    Injector.assign_generated_version(front, state, send,
                      direction: :front,
                      autocommit: false
                    )

                  {%{atx | subcommand: subcommand}, state, send}

                {_, _} ->
                  commit(state, Send.front(send, Enum.reverse(msgs)))
              end

            # there's still some messages pending from the server
            _msgs ->
              abort_on_error(%{atx | subcommand: nil}, state, send)
          end

        {subcommand, state, send} ->
          abort_on_error(%{atx | subcommand: subcommand}, state, send)
      end
    end

    defp commit(state, send, query \\ "COMMIT") do
      if State.tx?(state) do
        sink =
          %Sink{
            buffer: [%M.ReadyForQuery{status: :idle}],
            wait: [M.CommandComplete, M.ReadyForQuery],
            after_fun: fn state, send ->
              {nil, State.commit(state), send}
            end
          }

        {sink, state, Send.back(send, [%M.Query{query: query}])}
      else
        {nil, state, Send.front(send, [%M.ReadyForQuery{status: :idle}])}
      end
    end

    defp abort_on_error(atx, state, send) do
      if send_error?(send) do
        {nil, State.rollback(state), send}
      else
        {atx, state, send}
      end
    end

    defp send_error?(send) do
      Enum.any?(send.front, &is_struct(&1, M.ErrorResponse))
    end
  end
end
