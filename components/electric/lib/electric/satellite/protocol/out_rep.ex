defmodule Electric.Satellite.Protocol.OutRep do
  @moduledoc """
  Outgoing replication from Electric to Satellite. Part of the state in `Electric.Satellite.Protocol.State`.
  """

  alias Electric.Replication.Changes
  alias Electric.Utils
  alias Electric.Satellite.Protobuf, as: PB

  defstruct lsn: "",
            status: nil,
            pid: nil,
            stage_sub: nil,
            relations: %{},
            last_seen_wal_pos: 0,
            pause_queue: {nil, :queue.new()},
            outgoing_ops_buffer: :queue.new(),
            subscription_data_to_send: %{},
            move_in_data_to_send: %{},
            move_in_next_ref: 1,
            last_migration_xid_at_initial_sync: 0,
            sent_rows_graph: Graph.new()

  @typedoc """
  Insertion point for data coming from a subscription fulfillment.
  """
  @type subscription_insert_point ::
          {xmin :: non_neg_integer(), :subscription, subscription_id :: binary()}
  @type move_in_insert_point ::
          {xmin :: non_neg_integer(), :move_in, move_in_ref :: non_neg_integer()}

  @type pause_kind :: :subscription | :move_in
  @type pause_point :: subscription_insert_point() | move_in_insert_point()

  @type explicit_head_queue(value) :: {value | nil, :queue.queue(value)}

  @type pause_queue :: explicit_head_queue(pause_point())

  @typedoc """
  Outgoing replication PG -> Satellite
  """
  @type t() :: %__MODULE__{
          pid: pid() | nil,
          lsn: String.t(),
          status: nil | :active | :paused,
          stage_sub: GenStage.subscription_tag() | nil,
          relations: %{Changes.relation() => PB.relation_id()},
          last_seen_wal_pos: non_neg_integer,
          # The first element of the tuple is the head of the queue, which is pulled out to be available in guards/pattern matching
          pause_queue: pause_queue(),
          outgoing_ops_buffer: :queue.queue(),
          subscription_data_to_send: %{optional(String.t()) => term()},
          move_in_data_to_send: %{optional(non_neg_integer()) => term()},
          move_in_next_ref: non_neg_integer(),
          last_migration_xid_at_initial_sync: non_neg_integer,
          sent_rows_graph: Graph.t()
        }

  @spec add_pause_point(t(), pause_point()) :: t()
  def add_pause_point(%__MODULE__{pause_queue: queue} = out, new)
      when is_tuple(new) and tuple_size(new) == 3 and elem(new, 1) in [:subscription, :move_in],
      do: %{out | pause_queue: do_add_pause_point(queue, new)}

  @spec do_add_pause_point(pause_queue(), pause_point()) :: pause_queue()
  defp do_add_pause_point({nil, queue}, new), do: {new, queue}
  defp do_add_pause_point({head, queue}, new), do: {head, :queue.in(new, queue)}

  @spec remove_next_pause_point(t()) :: t()
  def remove_next_pause_point(%__MODULE__{pause_queue: queue} = out),
    do: %{out | pause_queue: do_remove_next_pause_point(queue)}

  @spec do_remove_next_pause_point(pause_queue()) :: pause_queue()
  defp do_remove_next_pause_point({_, queue}) do
    case :queue.out(queue) do
      {{:value, item}, queue} -> {item, queue}
      {:empty, queue} -> {nil, queue}
    end
  end

  @spec remove_pause_point(t(), :subscription, binary()) :: t()
  @spec remove_pause_point(t(), :move_in, non_neg_integer()) :: t()
  def remove_pause_point(%__MODULE__{pause_queue: queue} = out, kind, ref)
      when kind in [:subscription, :move_in],
      do: %{out | pause_queue: do_remove_pause_point(queue, kind, ref)}

  @spec do_remove_pause_point(pause_queue(), :subscription, binary()) :: pause_queue()
  @spec do_remove_pause_point(pause_queue(), :move_in, non_neg_integer()) :: pause_queue()
  defp do_remove_pause_point({nil, _} = queue, _, _), do: queue

  defp do_remove_pause_point({{_, kind, id}, _} = queue, kind, id),
    do: do_remove_next_pause_point(queue)

  defp do_remove_pause_point({head, queue}, kind, id),
    do: {head, :queue.delete_with(&match?({_, ^kind, ^id}, &1), queue)}

  @spec set_status(t(), nil | :active | :paused) :: t()
  def set_status(%__MODULE__{} = out, status) when status in [nil, :active, :paused],
    do: %{out | status: status}

  @spec store_subscription_data(t(), binary(), term()) :: t()
  def store_subscription_data(%__MODULE__{subscription_data_to_send: store} = out, id, data),
    do: %{out | subscription_data_to_send: Map.put(store, id, data)}

  @spec store_move_in_data(t(), non_neg_integer(), term()) :: t()
  def store_move_in_data(%__MODULE__{move_in_data_to_send: store} = out, ref, data),
    do: %{out | move_in_data_to_send: Map.put(store, ref, data)}

  @spec add_events_to_buffer(t(), [term()]) :: t()
  def add_events_to_buffer(%__MODULE__{} = out, events),
    do: %{out | outgoing_ops_buffer: Utils.add_events_to_queue(events, out.outgoing_ops_buffer)}

  @spec set_event_buffer(t(), list(term()) | :queue.queue(term())) :: t()
  def set_event_buffer(%__MODULE__{} = out, buffer) when is_list(buffer),
    do: %{out | outgoing_ops_buffer: :queue.from_list(buffer)}

  def set_event_buffer(%__MODULE__{} = out, {_, _} = buffer),
    do: %{out | outgoing_ops_buffer: buffer}

  @spec subscription_pending?(binary(), t()) :: boolean()
  def subscription_pending?(_, %__MODULE__{pause_queue: {nil, _}}), do: false
  def subscription_pending?(id, %__MODULE__{pause_queue: {{_, :subscription, id}, _}}), do: true

  def subscription_pending?(id, %__MODULE__{pause_queue: {_, queue}}),
    do: :queue.any(&match?({_, :subscription, ^id}, &1), queue)

  @spec merge_in_graph(t(), Graph.t()) :: t()
  def merge_in_graph(%__MODULE__{sent_rows_graph: graph} = out, new_graph),
    do: %__MODULE__{out | sent_rows_graph: Utils.merge_graph_edges(graph, new_graph)}

  @spec row_sent?(t(), term()) :: boolean()
  def row_sent?(%__MODULE__{sent_rows_graph: graph}, id), do: Graph.has_vertex?(graph, id)

  @spec pop_pending_data(t(), :subscription, binary()) :: {data :: term(), t()} | :error
  @spec pop_pending_data(t(), :move_in, non_neg_integer()) :: {data :: term(), t()} | :error
  def pop_pending_data(%__MODULE__{subscription_data_to_send: data} = out, :subscription, id) do
    with {found, rest} <- :maps.take(id, data) do
      {found, %__MODULE__{out | subscription_data_to_send: rest}}
    end
  end

  def pop_pending_data(%__MODULE__{move_in_data_to_send: data} = out, :move_in, id) do
    with {found, rest} <- :maps.take(id, data) do
      {found, %__MODULE__{out | move_in_data_to_send: rest}}
    end
  end

  def increment_move_in_ref(%__MODULE__{move_in_next_ref: ref} = out),
    do: %{out | move_in_next_ref: ref + 1}
end
