defmodule Electric.DurableStreams.BatchTracker do
  @moduledoc """
  Transforms out-of-order HTTP acks into in-order queue commit and retry actions.

  HTTP/2 responses can arrive in any order. The downstream queue only
  supports sequential FIFO commits per shape. This module buffers acks
  and releases commits in send order per shape. Errors and connection
  loss produce `:retry` actions, signalling the caller to rewind and
  re-peek the shape's queue.

  ## Semantics

  - `register/5` appends a batch to the shape's list in send order.
  - `ack(:ok)` marks the batch as acked and flushes consecutive acked
    batches from the front of the shape's list as commit actions.
  - `ack({:error, _})` drops the failed batch AND every subsequent
    in-flight batch for that shape (whether pending or already acked).
    Returns a single `:retry` action for the shape.
  - `fail_all/2` drops every tracked batch across every shape, emitting
    one `:retry` per shape with in-flight batches.
  - Acks for unknown, already-acked, or dropped slot_ids return `[]`.

  Pure: no process state, no side effects, no HTTP or queue dependencies.
  """

  @type slot_id :: non_neg_integer()
  @type shape_handle :: binary()
  @type count :: non_neg_integer()
  @type metadata :: term()

  @type action ::
          {:commit, shape_handle(), count(), metadata()}
          | {:retry, shape_handle()}

  @typep batch :: {slot_id(), count(), :pending | :acked, metadata()}

  @opaque t :: %__MODULE__{
            shape_batches: %{shape_handle() => [batch()]},
            slot_to_shape: %{slot_id() => shape_handle()}
          }

  defstruct shape_batches: %{}, slot_to_shape: %{}

  @spec new() :: t()
  def new, do: %__MODULE__{}

  @spec register(t(), shape_handle(), slot_id(), count(), metadata()) :: t()
  def register(%__MODULE__{} = t, shape_handle, slot_id, count, metadata) do
    batches = Map.get(t.shape_batches, shape_handle, [])
    batches = batches ++ [{slot_id, count, :pending, metadata}]

    %__MODULE__{
      t
      | shape_batches: Map.put(t.shape_batches, shape_handle, batches),
        slot_to_shape: Map.put(t.slot_to_shape, slot_id, shape_handle)
    }
  end

  @spec ack(t(), slot_id(), :ok | {:error, term()}) :: {t(), [action()]}
  def ack(%__MODULE__{} = t, slot_id, result) do
    case Map.get(t.slot_to_shape, slot_id) do
      nil ->
        {t, []}

      shape_handle ->
        case result do
          :ok -> mark_acked_and_flush(t, shape_handle, slot_id)
          {:error, _reason} -> drop_shape(t, shape_handle)
        end
    end
  end

  @spec fail_all(t(), term()) :: {t(), [action()]}
  def fail_all(%__MODULE__{} = t, _reason) do
    actions =
      t.shape_batches
      |> Enum.filter(fn {_shape, batches} -> batches != [] end)
      |> Enum.map(fn {shape, _} -> {:retry, shape} end)

    {%__MODULE__{}, actions}
  end

  @spec in_flight_count(t(), shape_handle()) :: non_neg_integer()
  def in_flight_count(%__MODULE__{} = t, shape_handle) do
    t.shape_batches
    |> Map.get(shape_handle, [])
    |> length()
  end

  # ------------------------------------------------------------------
  # Internal
  # ------------------------------------------------------------------

  defp mark_acked_and_flush(%__MODULE__{} = t, shape_handle, slot_id) do
    batches = Map.get(t.shape_batches, shape_handle, [])

    case update_batch_status(batches, slot_id) do
      :already_acked ->
        {t, []}

      {:ok, new_batches} ->
        {acked_prefix, remaining} =
          Enum.split_while(new_batches, fn {_, _, status, _} -> status == :acked end)

        commits =
          Enum.map(acked_prefix, fn {_slot, count, :acked, meta} ->
            {:commit, shape_handle, count, meta}
          end)

        committed_slot_ids = Enum.map(acked_prefix, fn {slot, _, _, _} -> slot end)
        new_slot_to_shape = Map.drop(t.slot_to_shape, committed_slot_ids)
        new_shape_batches = Map.put(t.shape_batches, shape_handle, remaining)

        {%__MODULE__{
           t
           | shape_batches: new_shape_batches,
             slot_to_shape: new_slot_to_shape
         }, commits}
    end
  end

  defp update_batch_status(batches, slot_id) do
    Enum.reduce_while(batches, {[], false}, fn batch, {acc, _} ->
      case batch do
        {^slot_id, _, :acked, _} ->
          {:halt, :already_acked}

        {^slot_id, count, :pending, meta} ->
          {:cont, {[{slot_id, count, :acked, meta} | acc], true}}

        other ->
          {:cont, {[other | acc], false}}
      end
    end)
    |> case do
      :already_acked -> :already_acked
      {reversed, _} -> {:ok, Enum.reverse(reversed)}
    end
  end

  defp drop_shape(%__MODULE__{} = t, shape_handle) do
    slot_ids =
      t.shape_batches
      |> Map.get(shape_handle, [])
      |> Enum.map(fn {slot, _, _, _} -> slot end)

    new_slot_to_shape = Map.drop(t.slot_to_shape, slot_ids)
    new_shape_batches = Map.delete(t.shape_batches, shape_handle)

    {%__MODULE__{t | shape_batches: new_shape_batches, slot_to_shape: new_slot_to_shape},
     [{:retry, shape_handle}]}
  end
end
