defmodule Electric.Replication.OperationBatcher do
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Commit, Relation}

  defstruct [:max_batch_size, :buffer, :flush?]

  @type t() :: %__MODULE__{
          max_batch_size: non_neg_integer(),
          buffer: [Changes.operation()],
          flush?: boolean()
        }

  @spec new(non_neg_integer()) :: t()
  def new(max_batch_size) do
    %__MODULE__{max_batch_size: max_batch_size, buffer: [], flush?: false}
  end

  @doc """
  Batch operations according to the following rules:
  - A batch is flushed when a Commit operation is seen
  - A batch is flushed when a Relation operation is seen
  - A batch is flushed when the max batch size is reached
  Returns a tuple of {batched_operations, updated_batcher}
  """
  @spec batch([Changes.operation()], t()) :: {[Changes.operation()], t()}
  def batch([operation | operations], %{buffer: buffer} = batcher) do
    batcher = %{batcher | buffer: [operation | buffer]}

    batch(operations, %{batcher | flush?: flush?(operation, batcher)})
  end

  def batch([], %{flush?: true} = batcher) do
    {Enum.reverse(batcher.buffer), %{batcher | buffer: [], flush?: false}}
  end

  def batch([], batcher), do: {[], batcher}

  defp flush?(_, %{flush?: true}), do: true
  defp flush?(%Commit{}, _), do: true
  defp flush?(%Relation{}, _), do: true

  defp flush?(_, %{buffer: buffer, max_batch_size: max_batch_size})
       when length(buffer) >= max_batch_size, do: true

  defp flush?(_, _), do: false
end
