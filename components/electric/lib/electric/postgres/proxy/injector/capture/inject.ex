defmodule Electric.Postgres.Proxy.Injector.Capture.Inject do
  @moduledoc """
  Buffers responses from the backend until it receives a `ReadyForQuery`
  message. Once it has that message it injects the commands from the `inject`
  field and passes its buffered upstream responses and control to a `Sink` to
  absorb the responses.
  """

  defstruct [:inject, mode: :waiting, buffer: []]

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector
  alias Electric.Postgres.Proxy.Injector.{Capture.Sink, Send}

  require Logger

  @type t() :: %__MODULE__{
          mode: :waiting | :injecting,
          inject: [M.t()],
          buffer: [M.t()]
        }

  def new(back_msgs, buffer \\ []) do
    %__MODULE__{
      inject: back_msgs,
      buffer: buffer
    }
  end

  defimpl Electric.Postgres.Proxy.Injector.Capture do
    def recv_frontend(_m, _msg, _state, _send) do
      raise "shouldn't get a frontend message while sinking responses from backend"
    end

    def recv_backend(_inject, %M.ErrorResponse{} = msg, state, send) do
      {nil, state, Send.front(send, msg)}
    end

    def recv_backend(inject, %M.NoticeResponse{} = msg, state, send) do
      {inject, state, Send.front(send, msg)}
    end

    def recv_backend(%{mode: :waiting} = i, %M.ReadyForQuery{} = msg, state, send) do
      inject(%{i | buffer: [msg | i.buffer], mode: :injecting}, state, send)
    end

    def recv_backend(%{mode: :injecting} = i, %M.ReadyForQuery{}, state, send) do
      inject(i, state, send)
    end

    def recv_backend(%{mode: :waiting} = i, msg, state, send) do
      {%{i | buffer: [msg | i.buffer]}, state, send}
    end

    def recv_backend(%{mode: :injecting} = i, _msg, state, send) do
      {i, state, send}
    end

    defp inject(%{inject: [msg]} = i, state, send) do
      Logger.debug("Injecting final message: #{inspect(msg)}")

      {%Sink{
         buffer: i.buffer
       }, state, Send.back(send, msg)}
    end

    defp inject(%{inject: [msg | rest]} = i, state, send) do
      Injector.debug("Injecting SQL query: #{inspect(msg)}")
      {%{i | inject: rest}, state, Send.back(send, msg)}
    end
  end
end
