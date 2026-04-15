defmodule Electric.QueueSystem.SnapshotCollector do
  @moduledoc """
  Implements `Collectable` for writing snapshot data from a separate process.
  On stream completion, sends `{:snapshot_complete}` to the consumer pid.
  """

  alias Electric.QueueSystem.Key
  alias Electric.Nifs.LmdbNif

  defstruct [:snapshot_db, :consumer_pid, seq: 0]

  defimpl Collectable do
    def into(collector) do
      {collector, &collect/2}
    end

    defp collect(col, {:cont, value}) do
      key = Key.snapshot_key(col.seq)
      :ok = LmdbNif.put(col.snapshot_db, key, value)
      %{col | seq: col.seq + 1}
    end

    defp collect(col, :done) do
      send(col.consumer_pid, {:snapshot_complete})
      col
    end

    defp collect(_col, :halt) do
      :ok
    end
  end
end
