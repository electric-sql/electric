defmodule Electric.Satellite.Protocol.State do
  alias Electric.Replication.Connectors
  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Protocol.InRep
  alias Electric.Satellite.Protocol.OutRep
  alias Electric.Satellite.Protocol.Telemetry
  alias Electric.Postgres.Extension.SchemaLoader

  defstruct auth_passed: false,
            auth: nil,
            last_msg_time: nil,
            client_id: nil,
            expiration_timer: nil,
            in_rep: %InRep{},
            out_rep: %OutRep{},
            auth_provider: nil,
            schema_loader: nil,
            connector_config: [],
            origin: "",
            subscriptions: %{},
            subscription_data_fun: nil,
            move_in_data_fun: nil,
            sql_dialect: Electric.Postgres.Dialect.SQLite,
            permissions: nil,
            schema_version: nil,
            telemetry: nil

  @type t() :: %__MODULE__{
          auth_passed: boolean(),
          auth: nil | Electric.Satellite.Auth.t(),
          last_msg_time: :erlang.timestamp() | nil | :ping_sent,
          client_id: String.t() | nil,
          expiration_timer: {reference(), reference()} | nil,
          in_rep: InRep.t(),
          out_rep: OutRep.t(),
          auth_provider: Electric.Satellite.Auth.provider(),
          schema_loader: SchemaLoader.t(),
          connector_config: Keyword.t(),
          origin: Connectors.origin(),
          subscriptions: map(),
          subscription_data_fun: fun(),
          move_in_data_fun: fun(),
          sql_dialect: Electric.Postgres.Dialect.SQLite | Electric.Postgres.Dialect.Postgresql,
          permissions: Electric.Satellite.Permissions.t() | nil,
          schema_version: SchemaLoader.version() | nil,
          telemetry: Telemetry.t() | nil
        }

  defguard auth_passed?(state) when state.auth_passed == true
  defguard in_rep?(state) when state.in_rep.status == :active
  defguard is_out_rep_active(state) when state.out_rep.status == :active
  defguard is_out_rep_paused(state) when state.out_rep.status == :paused

  defguard is_out_rep_suspended(state) when state.out_rep.status == :suspended

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

  defguard can_send_more_txs(state)
           when state.out_rep.unacked_transaction_count < state.out_rep.allowed_unacked_txs

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

  def add_events_to_buffer(%__MODULE__{out_rep: out} = state, events),
    do: %__MODULE__{state | out_rep: OutRep.add_events_to_buffer(out, events)}

  def set_outgoing_status(%__MODULE__{out_rep: out} = state, status)
      when status in [:active, :paused, :suspended] do
    %{state | out_rep: %OutRep{out | status: status}}
  end

  @spec user_id(t()) :: Electric.Satellite.Auth.user_id() | nil
  def user_id(%__MODULE__{auth: %{user_id: user_id}}), do: user_id
  def user_id(_state), do: nil

  @spec permissions_version(t()) :: pos_integer() | nil
  def permissions_version(%__MODULE__{} = state) do
    case Permissions.fetch_id(state.permissions) do
      {:ok, id} -> id
      :error -> nil
    end
  end
end
