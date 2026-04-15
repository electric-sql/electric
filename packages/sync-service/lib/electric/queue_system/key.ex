defmodule Electric.QueueSystem.Key do
  @moduledoc """
  Key generation and parsing for the queue system.

  Keys are 16-byte binaries: <<lsn::unsigned-big-64, offset::unsigned-big-64>>

  - Snapshot entries use lsn=0, so they sort before all replication entries.
  - Replication entries use the actual LSN from the WAL.
  - Within a given LSN (or snapshot), offset is the index of the update.
  """

  @spec snapshot_key(non_neg_integer()) :: binary()
  def snapshot_key(offset) when is_integer(offset) and offset >= 0 do
    <<0::unsigned-big-integer-size(64), offset::unsigned-big-integer-size(64)>>
  end

  @spec streaming_key(non_neg_integer()) :: binary()
  def streaming_key(seq) when is_integer(seq) and seq >= 0 do
    # For streaming writes where we don't yet have an LSN, use a high
    # synthetic LSN prefix to sort after snapshot entries.
    # The actual LSN-based keys are used by LmdbQueueStorage.
    <<1::unsigned-big-integer-size(64), seq::unsigned-big-integer-size(64)>>
  end

  @spec key(non_neg_integer(), non_neg_integer()) :: binary()
  def key(lsn, offset) when is_integer(lsn) and is_integer(offset) do
    <<lsn::unsigned-big-integer-size(64), offset::unsigned-big-integer-size(64)>>
  end

  @spec parse(binary()) :: {non_neg_integer(), non_neg_integer()}
  def parse(<<lsn::unsigned-big-integer-size(64), offset::unsigned-big-integer-size(64)>>) do
    {lsn, offset}
  end

  @spec type(binary()) :: :snapshot | :streaming
  def type(<<0::unsigned-big-integer-size(64), _::unsigned-big-integer-size(64)>>), do: :snapshot
  def type(<<_::unsigned-big-integer-size(64), _::unsigned-big-integer-size(64)>>), do: :streaming
end
