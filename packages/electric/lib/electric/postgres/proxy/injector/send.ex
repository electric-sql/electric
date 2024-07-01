defmodule Electric.Postgres.Proxy.Injector.Send do
  @moduledoc """
  Provides a way to send messages to the client (`client`) or the server
  (`server`) simultaneously.

  Before sending you must call `flush/1` to ensure that the messages are in the
  right order. Once `flush/1` has been called any attempt to append messages
  will raise an exception.
  """
  defstruct flush: false, client: [], server: []

  alias PgProtocol.Message, as: M

  @type msgs() :: M.t() | [M.t()]
  @type t() :: %__MODULE__{
          flush: boolean(),
          client: [M.t()],
          server: [M.t()]
        }

  @spec new() :: t()
  def new do
    %__MODULE__{}
  end

  @spec clear(t(), :both | :client | :server) :: t() | no_return()
  def clear(send, side \\ :both)

  def clear(%{flush: true}, _side) do
    raise "cannot clear a flushed Send"
  end

  def clear(send, side) when side in [:both, :client, :server] do
    case side do
      :both -> new()
      s -> Map.put(send, s, [])
    end
  end

  @doc """
  Append a message to be sent to the client.
  """
  @spec client(t(), msgs()) :: t() | no_return()
  def client(send \\ new(), msg)

  def client(%__MODULE__{flush: true}, _msg) do
    raise "Cannot send to a flushed channel"
  end

  def client(%__MODULE__{} = send, msgs) when is_list(msgs) do
    Enum.reduce(msgs, send, &client(&2, &1))
  end

  def client(%__MODULE__{client: client} = send, msg) do
    %{send | client: [msg | client]}
  end

  def client(%__MODULE__{client: client} = send, msg, status)
      when status in [nil, :tx, :idle, :failed] do
    %{send | client: Enum.map([msg | client], &status(&1, status))}
  end

  @spec status(M.t(), nil | :tx | :idle | :failed) :: M.t()
  def status(%M.ReadyForQuery{} = m, nil) do
    m
  end

  def status(%M.ReadyForQuery{status: status} = m, status) do
    m
  end

  def status(%M.ReadyForQuery{}, status) when status in [:tx, :idle, :failed] do
    %M.ReadyForQuery{status: status}
  end

  def status(m, _status) do
    m
  end

  @doc """
  Append a message to be sent to the server.
  """
  @spec server(t(), msgs()) :: t() | no_return()
  def server(send \\ new(), msg)

  def server(%__MODULE__{flush: true}, _msg) do
    raise "Cannot send to a flushed channel"
  end

  def server(%__MODULE__{} = send, msgs) when is_list(msgs) do
    Enum.reduce(msgs, send, &server(&2, &1))
  end

  def server(%__MODULE__{server: server} = send, msg) do
    %{send | server: [msg | server]}
  end

  @doc """
  Mark the messages as ready to be sent. Marks the `Send` instance as
  immutable.

  Idempotent.
  """
  @spec flush(t()) :: t()
  def flush(%__MODULE__{flush: false, client: client, server: server}) do
    %__MODULE__{flush: true, client: Enum.reverse(client), server: Enum.reverse(server)}
  end

  def flush(%__MODULE__{flush: true} = send) do
    send
  end

  def pending(%__MODULE__{} = send, side) when side in [:client, :server] do
    Map.fetch!(flush(send), side)
  end

  def filter_client(%__MODULE__{} = send, msg_type) when is_atom(msg_type) do
    {filtered, client} = Enum.split_with(send.client, &is_struct(&1, msg_type))
    {filtered, %{send | client: client}}
  end
end
