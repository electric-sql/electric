defmodule Electric.DurableStreams.StreamPoster do
  @moduledoc """
  Encodes shape log entries for posting to durable streams.

  Vendored from durable-replication. In the Electric sync service context,
  the data in LMDB queues is already in Electric's JSON log item format,
  so this module primarily handles batching queue entries into JSON arrays
  for the HTTP request body.
  """

  @doc """
  Encode a list of LMDB queue entries (already JSON values) into a JSON array.

  Each entry is a `{key, value}` tuple from the LMDB queue where the value
  is already a JSON-encoded string. This wraps them into `[value1, value2, ...]`.
  """
  def encode_queue_entries(entries) do
    entries
    |> Enum.map(fn {_key, value} -> value end)
    |> then(&("[" <> Enum.join(&1, ",") <> "]"))
  end

  @doc """
  Encode a list of raw values (already JSON strings) into a JSON array.
  """
  def encode_values(values) do
    "[" <> Enum.join(values, ",") <> "]"
  end
end
