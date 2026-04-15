defmodule Electric.DurableStreams.InFlightTracker do
  @moduledoc """
  Pure functional ring buffer for tracking in-flight HTTP batches.

  Vendored from durable-replication (DurableReplication.RingBuffer).
  Uses absolute sequence numbers internally. Map key = rem(seq, capacity).
  """

  defstruct capacity: 32,
            head: 0,
            tail: 0,
            slots: %{}

  @type status :: :queued | :sending | :in_flight | :confirmed

  @type slot :: %{
          batch: list(),
          commit_lsn: non_neg_integer(),
          status: status(),
          encoded_body: binary()
        }

  @type t :: %__MODULE__{
          capacity: pos_integer(),
          head: non_neg_integer(),
          tail: non_neg_integer(),
          slots: %{non_neg_integer() => slot()}
        }

  @spec new(pos_integer()) :: t()
  def new(capacity \\ 32) when capacity > 0 do
    %__MODULE__{capacity: capacity}
  end

  @spec full?(t()) :: boolean()
  def full?(%__MODULE__{head: head, tail: tail, capacity: cap}), do: head - tail >= cap

  @spec empty?(t()) :: boolean()
  def empty?(%__MODULE__{head: head, tail: tail}), do: head == tail

  @spec occupied_count(t()) :: non_neg_integer()
  def occupied_count(%__MODULE__{head: head, tail: tail}), do: head - tail

  @spec push(t(), list(), non_neg_integer(), binary()) :: {non_neg_integer(), t()}
  def push(%__MODULE__{} = ring, batch, commit_lsn, encoded_body) do
    if full?(ring), do: raise("InFlightTracker is full")

    seq = ring.head
    key = rem(seq, ring.capacity)

    slot = %{
      batch: batch,
      commit_lsn: commit_lsn,
      status: :queued,
      encoded_body: encoded_body
    }

    {seq, %{ring | head: ring.head + 1, slots: Map.put(ring.slots, key, slot)}}
  end

  @spec get(t(), non_neg_integer()) :: slot() | nil
  def get(%__MODULE__{} = ring, seq) do
    Map.get(ring.slots, rem(seq, ring.capacity))
  end

  @spec update_status(t(), non_neg_integer(), status()) :: t()
  def update_status(%__MODULE__{} = ring, seq, status) do
    key = rem(seq, ring.capacity)

    case Map.get(ring.slots, key) do
      nil -> ring
      slot -> %{ring | slots: Map.put(ring.slots, key, %{slot | status: status})}
    end
  end

  @spec drain_confirmed(t()) :: {non_neg_integer() | nil, t()}
  def drain_confirmed(%__MODULE__{} = ring) do
    do_drain_confirmed(ring, nil)
  end

  defp do_drain_confirmed(%__MODULE__{head: head, tail: tail} = ring, acked_lsn)
       when tail >= head do
    {acked_lsn, ring}
  end

  defp do_drain_confirmed(%__MODULE__{} = ring, acked_lsn) do
    key = rem(ring.tail, ring.capacity)

    case Map.get(ring.slots, key) do
      %{status: :confirmed, commit_lsn: lsn} ->
        ring = %{ring | tail: ring.tail + 1, slots: Map.delete(ring.slots, key)}
        do_drain_confirmed(ring, lsn)

      _ ->
        {acked_lsn, ring}
    end
  end

  @spec requeue_unconfirmed(t()) :: {[{non_neg_integer(), binary(), non_neg_integer()}], t()}
  def requeue_unconfirmed(%__MODULE__{} = ring) do
    {items, new_slots} =
      Enum.reduce(ring.tail..(ring.head - 1)//1, {[], ring.slots}, fn seq, {acc, slots} ->
        key = rem(seq, ring.capacity)

        case Map.get(slots, key) do
          %{status: :confirmed} ->
            {acc, slots}

          %{} = slot ->
            updated = %{slot | status: :queued}
            item = {seq, slot.encoded_body, slot.commit_lsn}
            {[item | acc], Map.put(slots, key, updated)}

          nil ->
            {acc, slots}
        end
      end)

    {Enum.reverse(items), %{ring | slots: new_slots}}
  end
end
