defmodule Burn.Consumer do
  @moduledoc """
  A module responsible for consuming shape streams.
  """

  alias Electric.Client.Message

  @type key :: atom()
  @type shape :: Phoenix.Sync.shape_definition()
  @type opts :: Electric.Client.stream_options()

  @doc """
  Consumes a stream, emitting batches of messages.

  Messages are batched until an "up-to-date" control message is received,
  at which point the entire batch is sent. If a "must-refetch" control
  message is received, an error is raised.

  This function will run until the stream is exhausted or an error occurs.
  """
  @spec consume(pid(), key(), shape(), opts()) :: :ok
  def consume(pid, key, shape, opts \\ []) do
    shape
    |> Phoenix.Sync.Client.stream(opts)
    |> Stream.transform([], &handle/2)
    |> Stream.each(fn batch -> send(pid, {:stream, key, batch}) end)
    |> Stream.run()
  end

  # Accumulate change messages in the batch
  defp handle(%Message.ChangeMessage{} = message, batch) do
    {[], [message | batch]}
  end

  # When up-to-date is received, emit the accumulated batch
  defp handle(%Message.ControlMessage{control: :up_to_date}, batch) do
    {[Enum.reverse(batch)], []}
  end

  # When must-refetch is received, raise an error
  defp handle(%Message.ControlMessage{control: :must_refetch}, _batch) do
    raise "Must refetch: Shape stream invalidated"
  end
end
