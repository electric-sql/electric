defmodule Electric.Satellite.Protocol.State do
  alias Electric.Satellite.Protocol.InRep
  alias Electric.Satellite.Protocol.OutRep
  alias Electric.Satellite.Protocol.Telemetry

  defstruct auth_passed: false,
            auth: nil,
            last_msg_time: nil,
            client_id: nil,
            in_rep: %InRep{},
            out_rep: %OutRep{},
            auth_provider: nil,
            connector_config: [],
            subscriptions: %{},
            subscription_data_fun: nil,
            move_in_data_fun: nil,
            telemetry: nil

  @type t() :: %__MODULE__{
          auth_passed: boolean(),
          auth: nil | Electric.Satellite.Auth.t(),
          last_msg_time: :erlang.timestamp() | nil | :ping_sent,
          client_id: String.t() | nil,
          in_rep: InRep.t(),
          out_rep: OutRep.t(),
          auth_provider: Electric.Satellite.Auth.provider(),
          connector_config: Keyword.t(),
          subscriptions: map(),
          subscription_data_fun: fun(),
          move_in_data_fun: fun(),
          telemetry: Telemetry.t() | nil
        }

  defguard auth_passed?(state) when state.auth_passed == true
  defguard in_rep?(state) when state.in_rep.status == :active
  defguard is_out_rep_active(state) when state.out_rep.status == :active
  defguard is_out_rep_paused(state) when state.out_rep.status == :paused

  defguard is_next_pending_subscription(state, subscription_id)
           when is_tuple(elem(state.out_rep.pause_queue, 0)) and
                  elem(elem(state.out_rep.pause_queue, 0), 1) == :subscription and
                  elem(elem(state.out_rep.pause_queue, 0), 2) == subscription_id

  defguard is_next_pending_move_in(state, move_in_ref)
           when is_tuple(elem(state.out_rep.pause_queue, 0)) and
                  elem(elem(state.out_rep.pause_queue, 0), 1) == :move_in and
                  elem(elem(state.out_rep.pause_queue, 0), 2) == move_in_ref

  defguard is_paused_on_subscription(state, subscription_id)
           when is_out_rep_paused(state) and is_next_pending_subscription(state, subscription_id)

  defguard is_paused_on_move_in(state, move_in_ref)
           when is_out_rep_paused(state) and is_next_pending_move_in(state, move_in_ref)

  defguard no_pending_subscriptions(state)
           when is_nil(elem(state.out_rep.pause_queue, 0))

  @spec merge_in_graph(t(), Graph.t()) :: t()
  def merge_in_graph(%__MODULE__{out_rep: out} = state, %Graph{} = graph),
    do: %__MODULE__{state | out_rep: OutRep.merge_in_graph(out, graph)}

  @spec store_subscription_data(t(), String.t(), term()) :: t()
  def store_subscription_data(%__MODULE__{out_rep: out} = state, id, data),
    do: %__MODULE__{state | out_rep: OutRep.store_subscription_data(out, id, data)}

  @spec store_move_in_data(t(), non_neg_integer(), term()) :: t()
  def store_move_in_data(%__MODULE__{out_rep: out} = state, id, data),
    do: %__MODULE__{state | out_rep: OutRep.store_move_in_data(out, id, data)}

  @spec row_sent?(t(), any()) :: boolean()
  def row_sent?(%__MODULE__{out_rep: out}, id), do: OutRep.row_sent?(out, id)

  @spec delete_subscription(t(), String.t()) :: t()
  def delete_subscription(%__MODULE__{subscriptions: subs} = state, id) do
    %__MODULE__{state | subscriptions: Map.delete(subs, id)}
  end

  @spec pop_pending_data(t(), kind, ref :: term()) :: {data :: term(), t()} | :error
        when kind: OutRep.pause_kind()
  def pop_pending_data(%__MODULE__{out_rep: out} = state, kind, ref) do
    with {data, out} <- OutRep.pop_pending_data(out, kind, ref) do
      {data, %__MODULE__{state | out_rep: out}}
    end
  end
end
