defmodule Electric.Postgres.Proxy.Injector.Capture.Migration do
  @moduledoc """
  Sets up the injector to insert a capture migration command to the backend.

  Only required for the extended protocol version (so prepared statements with
  a Parse and a Bind).

  Once the upstream pg server sends [a `Sync`
  message](https://www.postgresql.org/docs/15/protocol-flow.html#PROTOCOL-FLOW-PIPELINING)
  this replaces itself with an `Inject` instance to do the actual injection of
  the necessary function call.
  """

  defstruct [:ddl, :table]

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector
  alias Electric.Postgres.Proxy.Injector.{Capture, Send}

  @type t() :: %__MODULE__{
          ddl: String.t(),
          table: {String.t(), String.t()}
        }

  defimpl Capture do
    def recv_frontend(m, %M.Bind{} = msg, state, send) do
      # TODO: validate that the param list is empty for migration prepared
      # statements
      {m, state, Send.back(send, msg)}
    end

    def recv_frontend(m, %M.Sync{} = msg, state, send) do
      inject = Injector.inject_ddl_query(m.ddl, state)

      {inject, state, Send.back(send, msg)}
    end

    def recv_frontend(m, msg, state, send) do
      {m, state, Send.back(send, msg)}
    end

    def recv_backend(m, msg, state, send) do
      {m, state, Send.front(send, msg)}
    end
  end
end
