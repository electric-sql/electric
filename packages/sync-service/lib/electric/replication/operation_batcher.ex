defmodule Electric.Replication.OperationBatcher do
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Commit, Relation}

  defstruct [:buffer, :flush?]

  @type t() :: %__MODULE__{
          buffer: [Changes.operation()],
          flush?: boolean()
        }

  @spec new() :: t()
  def new do
    %__MODULE__{buffer: [], flush?: false}
  end

  @doc """
  Batch operations according to the following rules:
  - A batch is flushed when a Commit operation is seen
  - A batch is flushed when a Relation operation is seen
  - A batch is flushed when the max batch size is reached
  Returns a tuple of {batched_operations, updated_batcher}
  """
  @spec batch([Changes.operation()], non_neg_integer(), t()) :: {[Changes.operation()], t()}
  def batch([operation | operations], max_batch_size, %{buffer: buffer} = batcher) do
    batcher = %{batcher | buffer: [operation | buffer]}

    batch(operations, max_batch_size, %{
      batcher
      | flush?: flush?(operation, max_batch_size, batcher)
    })
  end

  def batch([], _, %{flush?: true} = batcher) do
    {Enum.reverse(batcher.buffer), %{batcher | buffer: [], flush?: false}}
  end

  def batch([], _, batcher), do: {[], batcher}

  defp flush?(_, _, %{flush?: true}), do: true
  defp flush?(%Commit{}, _, _), do: true
  defp flush?(%Relation{}, _, _), do: true

  defp flush?(_, max_batch_size, %{buffer: buffer})
       when length(buffer) >= max_batch_size, do: true

  defp flush?(_, _, _), do: false
end
