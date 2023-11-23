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

    @type t() :: %__MODULE__{
            xid: non_neg_integer() | nil,
            changes: [Changes.change()],
            commit_timestamp: DateTime.t(),
            origin: String.t(),
            # this field is only set by Electric
            origin_type: :postgresql | :satellite,
            publication: String.t(),
            lsn: Electric.Postgres.Lsn.t(),
            ack_fn: (-> :ok | {:error, term()})
          }

    defstruct [
      :xid,
      :changes,
      :commit_timestamp,
      :origin,
      :publication,
      :lsn,
      :ack_fn,
      :origin_type
    ]

    def count_operations(%__MODULE__{changes: changes}) do
      base = %{operations: 0, inserts: 0, updates: 0, deletes: 0, compensations: 0}

      Enum.reduce(changes, base, fn %module{}, acc ->
        key =
          case module do
            Changes.NewRecord -> :inserts
            Changes.UpdatedRecord -> :updates
            Changes.DeletedRecord -> :deletes
            Changes.Compensation -> :compensations
          end

        Map.update!(%{acc | operations: acc.operations + 1}, key, &(&1 + 1))
      end)
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
    defstruct [:relation, :old_record, :record, tags: []]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            old_record: Changes.record() | nil,
            record: Changes.record(),
            tags: [Changes.tag()]
          }
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
end
