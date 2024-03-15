defmodule Electric.Replication.Postgres.LogicalMessages do
  alias Electric.Postgres.LogicalReplication.Messages

  alias Electric.Postgres.LogicalReplication.Messages.{
    Begin,
    Commit,
    Delete,
    Insert,
    Message,
    Origin,
    Relation,
    Truncate,
    Type,
    Update
  }

  alias Electric.Postgres.ShadowTableTransformation

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation,
    ReferencedRecord
  }

  require Logger

  defmodule Context do
    defstruct origin: "",
              publication: "",
              commit_lsn: nil,
              wip_transaction: nil,
              transaction: nil,
              relations: %{}

    @type t :: %__MODULE__{
            origin: binary(),
            publication: binary(),
            commit_lsn: Electric.Postgres.Lsn.t() | nil,
            wip_transaction: Transaction.t() | nil,
            transaction: Transaction.t() | nil,
            relations: %{Messages.relation_id() => Relation.t()}
          }

    def reset_tx(context) do
      %{context | commit_lsn: nil, transaction: nil, wip_transaction: nil}
    end
  end

  @type message ::
          Begin.t()
          | Commit.t()
          | Delete.t()
          | Insert.t()
          | Message.t()
          | Origin.t()
          | Relation.t()
          | Truncate.t()
          | Type.t()
          | Update.t()

  @spec process(message(), Context.t()) :: Context.t()
  def process(
        %Message{transactional?: true, prefix: "electric.fk_chain_touch", content: content},
        context
      ) do
    received = Jason.decode!(content)

    referenced = %ReferencedRecord{
      relation: {received["schema"], received["table"]},
      record: received["data"],
      pk: received["pk"],
      tags:
        ShadowTableTransformation.convert_tag_list_pg_to_satellite(
          received["tags"],
          context.origin
        )
    }

    update_in(context.wip_transaction, &Transaction.add_referenced_record(&1, referenced))
  end

  def process(%Message{} = msg, context) do
    Logger.info("Got a message from PG via logical replication: #{inspect(msg)}")
    context
  end

  def process(%Begin{} = msg, %{wip_transaction: nil} = context) do
    tx = %Transaction{
      xid: msg.xid,
      changes: [],
      commit_timestamp: msg.commit_timestamp,
      origin_type: :postgresql,
      origin: context.origin,
      publication: context.publication
    }

    %{context | commit_lsn: msg.final_lsn, wip_transaction: tx}
  end

  def process(%Origin{} = msg, context) do
    # If we got the "origin" message, it means that the Postgres sending back the transaction we sent from Electric
    # We ignored those previously, when Vaxine was the source of truth, but now we need to fan out those processed messages
    # to all the Satellites as their write has been "accepted"
    Logger.debug("origin: #{inspect(msg.name)}")
    context
  end

  def process(%Type{}, context), do: context

  def process(%Relation{} = rel, context) do
    update_in(context.relations, &Map.put(&1, rel.id, rel))
  end

  def process(%Insert{} = msg, context) do
    relation = Map.fetch!(context.relations, msg.relation_id)
    data = data_tuple_to_map(relation.columns, msg.tuple_data)
    new_record = %NewRecord{relation: {relation.namespace, relation.name}, record: data}
    update_in(context.wip_transaction.changes, &[new_record | &1])
  end

  def process(%Update{} = msg, context) do
    relation = Map.fetch!(context.relations, msg.relation_id)
    old_data = data_tuple_to_map(relation.columns, msg.old_tuple_data)
    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    updated_record =
      UpdatedRecord.new(
        relation: {relation.namespace, relation.name},
        old_record: old_data,
        record: data
      )

    update_in(context.wip_transaction.changes, &[updated_record | &1])
  end

  def process(%Delete{} = msg, context) do
    relation = Map.fetch!(context.relations, msg.relation_id)

    data =
      data_tuple_to_map(
        relation.columns,
        msg.old_tuple_data || msg.changed_key_tuple_data
      )

    deleted_record = %DeletedRecord{
      relation: {relation.namespace, relation.name},
      old_record: data
    }

    update_in(context.wip_transaction.changes, &[deleted_record | &1])
  end

  def process(%Truncate{} = msg, context) do
    truncated_relations =
      for truncated_relation <- Enum.reverse(msg.truncated_relations) do
        relation = Map.fetch!(context.relations, truncated_relation)

        %TruncatedRelation{relation: {relation.namespace, relation.name}}
      end

    update_in(context.wip_transaction.changes, &(truncated_relations ++ &1))
  end

  def process(
        %Commit{lsn: commit_lsn, end_lsn: end_lsn},
        %Context{commit_lsn: commit_lsn, wip_transaction: tx} = context
      ) do
    tx = ShadowTableTransformation.enrich_tx_from_shadow_ops(tx)
    tx = %{tx | lsn: end_lsn}
    %{context | transaction: tx, wip_transaction: nil, commit_lsn: nil}
  end

  ###

  @spec data_tuple_to_map([Relation.Column.t()], list()) :: map()
  defp data_tuple_to_map(_columns, nil), do: %{}

  defp data_tuple_to_map(columns, tuple_data) do
    columns
    |> Enum.zip(tuple_data)
    |> Map.new(fn {column, data} -> {column.name, data} end)
  end
end
