defmodule Electric.Satellite.Protocol.InRep do
  alias Electric.Replication.Changes.Transaction
  alias Electric.Utils
  alias Electric.Satellite.Protobuf, as: PB

  defstruct lsn: "",
            status: nil,
            pid: nil,
            stage_sub: nil,
            relations: %{},
            incomplete_trans: nil,
            demand: 0,
            sub_retry: nil,
            queue: :queue.new(),
            rpc_request_id: 0

  @type column_info :: %{
          name: String.t(),
          type: term(),
          nullable?: boolean(),
          pk_position: non_neg_integer() | nil
        }

  @type(
    cached_relations :: %{
      optional(PB.relation_id()) => %{
        :schema => String.t(),
        :table => String.t(),
        :columns => [column_info()]
      }
    },
    @typedoc("""
    Incoming replication Satellite -> PG
    """)
  )
  @type t() :: %__MODULE__{
          pid: pid() | nil,
          lsn: String.t(),
          status: nil | :active | :paused | :requested,
          # retry is only used when there is an active consumer
          sub_retry: nil | reference(),
          stage_sub: GenStage.subscription_tag() | nil,
          relations: cached_relations(),
          incomplete_trans: nil | Transaction.t(),
          demand: non_neg_integer(),
          queue: :queue.queue(Transaction.t()),
          rpc_request_id: non_neg_integer()
        }

  @spec add_to_queue(t(), [Transaction.t()]) :: t()
  def add_to_queue(%__MODULE__{queue: queue} = rep, events),
    do: %__MODULE__{rep | queue: Utils.add_events_to_queue(events, queue)}
end
