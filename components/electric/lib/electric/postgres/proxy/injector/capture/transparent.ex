defmodule Electric.Postgres.Proxy.Injector.Capture.Transparent do
  defstruct []

  alias Electric.Postgres.Proxy.Injector.{Capture, Send}

  @type t() :: %__MODULE__{}

  defimpl Capture do
    def recv_frontend(m, msg, state, send) do
      {m, state, Send.back(send, msg)}
    end

    def recv_backend(m, msg, state, send) do
      {m, state, Send.front(send, msg)}
    end
  end
end
