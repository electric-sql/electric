defmodule Electric.Replication.Changes do
  @moduledoc """
  This module contains structs that are intermediate representation of Postgres and Satellite transactions.

  Some of the core assumptions in this module:
  - We require PK always to be present for all tables
  - For now PK modification is not supported
  - PG replication protocol is expected to always send the *whole* row
  when dealing with UPDATE changes, and optionally old row if REPLICA
  identity is set to FULL.
  """

  alias Electric.Replication.Changes

  require Logger

  @type db_identifier() :: String.t()
  @type relation() :: {schema :: db_identifier(), table :: db_identifier()}
  @type record() :: %{(column_name :: db_identifier()) => column_data :: binary()}
  @type relation_id() :: non_neg_integer

  @typedoc """
  Tag has the form of `origin@timestamp`, where origin is a unique source id
  (UUID for Satellite clients) and timestamp is millisecond-precision UTC unix timestamp
  """
  @type tag() :: String.t()

  @type change() ::
          Changes.NewRecord.t()
          | Changes.UpdatedRecord.t()
          | Changes.DeletedRecord.t()

  defmodule Transaction do
    alias Electric.Replication.Changes

    @type referenced_records :: %{
            optional(Changes.relation()) => %{
              optional([String.t(), ...]) => Changes.ReferencedRecord.t()
            }
          }

    @type t() :: %__MODULE__{
            xid: non_neg_integer() | nil,
            changes: [Changes.change()],
            referenced_records: referenced_records(),
            commit_timestamp: DateTime.t(),
            origin: String.t(),
            # this field is only set by Electric
            origin_type: :postgresql | :satellite,
            publication: String.t(),
            lsn: Electric.Postgres.Lsn.t(),
            ack_fn: (-> :ok | {:error, term()}),
            additional_data_ref: non_neg_integer()
          }

    defstruct [
      :xid,
      :changes,
      :commit_timestamp,
      :origin,
      :publication,
      :lsn,
      :ack_fn,
      :origin_type,
      referenced_records: %{},
      additional_data_ref: 0
    ]

    @spec count_operations(t()) :: %{
            operations: non_neg_integer(),
            inserts: non_neg_integer(),
            updates: non_neg_integer(),
            deletes: non_neg_integer(),
            compensations: non_neg_integer(),
            gone: non_neg_integer()
          }
    def count_operations(%__MODULE__{changes: changes}) do
      base = %{operations: 0, inserts: 0, updates: 0, deletes: 0, compensations: 0, gone: 0}

      Enum.reduce(changes, base, fn %module{}, acc ->
        key =
          case module do
            Changes.NewRecord -> :inserts
            Changes.UpdatedRecord -> :updates
            Changes.DeletedRecord -> :deletes
            Changes.Compensation -> :compensations
            Changes.Gone -> :gone
          end

        Map.update!(%{acc | operations: acc.operations + 1}, key, &(&1 + 1))
      end)
    end

    @spec add_referenced_record(t(), Changes.ReferencedRecord.t()) :: t()
    def add_referenced_record(
          %__MODULE__{} = txn,
          %{relation: rel, pk: pk} = referenced
        )
        when is_struct(referenced, Changes.ReferencedRecord) do
      updated =
        Map.update(txn.referenced_records, rel, %{pk => referenced}, &Map.put(&1, pk, referenced))

      %__MODULE__{txn | referenced_records: updated}
    end
  end

  defmodule NewRecord do
    defstruct [:relation, :record, tags: []]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            record: Changes.record(),
            tags: [Changes.tag()]
          }
  end

  defmodule UpdatedRecord do
    defstruct [:relation, :old_record, :record, tags: [], changed_columns: MapSet.new()]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            old_record: Changes.record() | nil,
            record: Changes.record(),
            tags: [Changes.tag()],
            changed_columns: MapSet.t()
          }

    def new(attrs) do
      __MODULE__
      |> struct(attrs)
      |> build_changed_columns()
    end

    defp build_changed_columns(%{old_record: nil} = change) do
      change
    end

    defp build_changed_columns(change) do
      %{old_record: old, record: new} = change

      # if the value is in the new but NOT the old, then it's being updated
      # if it's in the old but NOT the new, then it's staying the same
      changed =
        Enum.reduce(new, MapSet.new(), fn {col_name, new_value}, changed ->
          case Map.fetch(old, col_name) do
            :error ->
              MapSet.put(changed, col_name)

            {:ok, old_value} ->
              if old_value == new_value,
                do: changed,
                else: MapSet.put(changed, col_name)
          end
        end)

      %{change | changed_columns: changed}
    end
  end

  defmodule DeletedRecord do
    defstruct [:relation, :old_record, tags: []]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            old_record: Changes.record(),
            tags: [Changes.tag()]
          }
  end

  defmodule Compensation do
    defstruct [:relation, :record, tags: []]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            record: Changes.record(),
            tags: [Changes.tag()]
          }
  end

  defmodule ReferencedRecord do
    defstruct [:relation, :record, :pk, tags: []]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            record: Changes.record(),
            pk: [String.t(), ...],
            tags: [Changes.tag()]
          }
  end

  defmodule Gone do
    defstruct [:relation, :pk]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            pk: [String.t(), ...]
          }
  end

  defmodule TruncatedRelation do
    defstruct [:relation]
  end

  @spec filter_changes_belonging_to_user(Transaction.t(), binary()) :: Transaction.t()
  def filter_changes_belonging_to_user(%Transaction{changes: changes} = tx, user_id) do
    %{tx | changes: Enum.filter(changes, &Changes.Ownership.change_belongs_to_user?(&1, user_id))}
  end

  @spec generateTag(Transaction.t()) :: binary()
  def generateTag(%Transaction{origin: origin, commit_timestamp: tm}) do
    origin <> "@" <> Integer.to_string(DateTime.to_unix(tm, :millisecond))
  end

  def convert_update(%UpdatedRecord{} = change, to: :new_record) do
    %NewRecord{relation: change.relation, tags: change.tags, record: change.record}
  end

  def convert_update(%UpdatedRecord{} = change, to: :deleted_record) do
    %DeletedRecord{relation: change.relation, tags: change.tags, old_record: change.old_record}
  end

  def convert_update(%UpdatedRecord{} = change, to: :updated_record), do: change
end
