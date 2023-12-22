defmodule Electric.Postgres.Proxy.Injector.Transparent do
  # need a struct in order to implement the Operation protocol
  defstruct []

  alias Electric.Postgres.Proxy.{
    Injector,
    Injector.Operation,
    Injector.Send
  }

  @type t() :: %__MODULE__{}

  def injector do
    Injector.new(
      [loader: nil, capture_mode: [default: {__MODULE__, []}]],
      username: "transparent"
    )
  end

  defimpl Operation do
    def upstream_connection(_transparent, connector_config) do
      connector_config
    end

    def activate(transparent, state, send) do
      {transparent, state, send}
    end

    def recv_client(transparent, msgs, state) do
      {[Operation.Pass.server(msgs), transparent], state}
    end

    def recv_server(electric, msg, state, send) do
      {electric, state, Send.client(send, msg)}
    end

    def send_client(transparent, state, send) do
      {transparent, state, send}
    end

    def recv_error(transparent, _msgs, state, send) do
      {transparent, state, send}
    end

    def send_error(transparent, state, send) do
      {transparent, state, send}
    end
  end
end
