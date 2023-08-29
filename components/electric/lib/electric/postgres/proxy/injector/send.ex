defmodule Electric.Postgres.Proxy.Injector.Send do
  @moduledoc """
  Provides a way to send messages to the client (`front`) or the server
  (`back`) simultaneously.

  Before sending you must call `flush/1` to ensure that the messages are in the
  right order. Once `flush/1` has been called any attempt to append messages
  will raise an exception.
  """
  defstruct flush: false, locked: false, front: [], back: []

  alias PgProtocol.Message, as: M

  @type msgs() :: M.t() | [M.t()]
  @type t() :: %__MODULE__{
          flush: boolean(),
          locked: boolean(),
          front: [M.t()],
          back: [M.t()]
        }

  @spec new() :: t()
  def new do
    %__MODULE__{}
  end

  @spec clear(t(), :both | :front | :back) :: t() | no_return()
  def clear(send, side \\ :both)

  def clear(%{flush: true}, _side) do
    raise "cannot clear a flushed Send"
  end

  def clear(send, side) when side in [:both, :front, :back] do
    case side do
      :both -> new()
      s -> Map.put(send, s, [])
    end
  end

  @doc """
  Append a message to be sent to the client.
  """
  @spec front(t(), msgs()) :: t() | no_return()
  def front(send \\ new(), msg)

  def front(%__MODULE__{flush: true}, _msg) do
    raise "Cannot send to a flushed channel"
  end

  def front(%__MODULE__{locked: true} = send, _msg) do
    send
  end

  def front(%__MODULE__{} = send, msgs) when is_list(msgs) do
    Enum.reduce(msgs, send, &front(&2, &1))
  end

  def front(%__MODULE__{front: front} = send, msg) do
    %{send | front: [msg | front]}
  end

  @doc """
  Append a message to be sent to the server.
  """
  @spec back(t(), msgs()) :: t() | no_return()
  def back(send \\ new(), msg)

  def back(%__MODULE__{flush: true}, _msg) do
    raise "Cannot send to a flushed channel"
  end

  def back(%__MODULE__{locked: true} = send, _msg) do
    send
  end

  def back(%__MODULE__{} = send, msgs) when is_list(msgs) do
    Enum.reduce(msgs, send, &back(&2, &1))
  end

  def back(%__MODULE__{back: back} = send, msg) do
    %{send | back: [msg | back]}
  end

  @doc """
  Mark the messages as ready to be sent. Marks the `Send` instance as
  immutable.

  Idempotent.
  """
  @spec flush(t()) :: t()
  def flush(%__MODULE__{flush: false, front: front, back: back}) do
    %__MODULE__{flush: true, front: Enum.reverse(front), back: Enum.reverse(back)}
  end

  def flush(%__MODULE__{flush: true} = send) do
    send
  end

  def lock(%__MODULE__{} = send) do
    %{send | locked: true}
  end

  def pending(%__MODULE__{} = send, side) when side in [:front, :back] do
    Map.fetch!(flush(send), side)
  end
end
