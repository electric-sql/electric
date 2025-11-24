defmodule Electric.Replication.OperationBatcher do
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Commit, Relation}

  defstruct [:buffer, :commits, :flush?]

  @type t() :: %__MODULE__{
          buffer: [Changes.operation()],
          commits: [%Commit{}],
          flush?: boolean()
        }

  @spec new() :: t()
  def new do
    %__MODULE__{buffer: [], commits: [], flush?: false}
  end

  @doc """
  Batch operations according to the following rules:
  - A batch is flushed when a Commit operation is seen
  - A batch is flushed when a Relation operation is seen
  - A batch is flushed when the max batch size is reached
  Returns a tuple of {:ok, batched_operations, commits, updated_batcher}
  or {:buffering, updated_batcher} if no flush occurred.
  """
  @spec batch([Changes.operation()], non_neg_integer(), t()) ::
          {:ok, [Changes.operation()], [%Commit{}], t()} | {:buffering, t()}
  def batch([operation | operations], max_batch_size, batcher) do
    batcher =
      batcher
      |> add_to_buffer(operation)
      |> maybe_add_commit(operation)

    batch(operations, max_batch_size, %{
      batcher
      | flush?: flush?(operation, max_batch_size, batcher)
    })
  end

  def batch([], _, %{flush?: true} = batcher) do
    {:ok, Enum.reverse(batcher.buffer), Enum.reverse(batcher.commits),
     %{batcher | buffer: [], commits: [], flush?: false}}
  end

  def batch([], _, batcher), do: {:buffering, batcher}

  defp flush?(_, _, %{flush?: true}), do: true
  defp flush?(%Commit{}, _, _), do: true
  defp flush?(%Relation{}, _, _), do: true

  defp flush?(_, max_batch_size, %{buffer: buffer})
       when length(buffer) >= max_batch_size, do: true

  defp flush?(_, _, _), do: false

  defp add_to_buffer(%{buffer: buffer} = batcher, operation) do
    %{batcher | buffer: [operation | buffer]}
  end

  defp maybe_add_commit(%{commits: commits} = batcher, %Commit{} = commit) do
    %{batcher | commits: [commit | commits]}
  end

  defp maybe_add_commit(batcher, _), do: batcher
end
