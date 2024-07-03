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
  @type xid() :: non_neg_integer()
  @type relation() :: {schema :: db_identifier(), table :: db_identifier()}
  @type record() :: %{(column_name :: db_identifier()) => column_data :: binary()}
  @type relation_id() :: non_neg_integer

  @typedoc """
  Tag has the form of `origin@timestamp`, where origin is a unique source id
  (UUID for Satellite clients) and timestamp is millisecond-precision UTC unix timestamp
  """
  @type tag() :: String.t()
  @type pk() :: [String.t(), ...]

  @type data_change() ::
          Changes.NewRecord.t()
          | Changes.UpdatedRecord.t()
          | Changes.DeletedRecord.t()

  @type change() :: data_change() | Changes.TruncatedRelation.t()

  defmodule Transaction do
    alias Electric.Replication.Changes

    @type t() :: %__MODULE__{
            xid: Changes.xid() | nil,
            changes: [Changes.change()],
            affected_relations: MapSet.t(Changes.relation()),
            commit_timestamp: DateTime.t(),
            lsn: Electric.Postgres.Lsn.t()
          }

    defstruct [
      :xid,
      :commit_timestamp,
      :lsn,
      changes: [],
      affected_relations: MapSet.new()
    ]

    @spec prepend_change(t(), Changes.change()) :: t()
    def prepend_change(
          %__MODULE__{changes: changes, affected_relations: rels} = txn,
          %change_mod{relation: rel} = change
        )
        when change_mod in [
               Changes.NewRecord,
               Changes.UpdatedRecord,
               Changes.DeletedRecord,
               Changes.TruncatedRelation
             ] do
      %{
        txn
        | changes: [change | changes],
          affected_relations: MapSet.put(rels, rel)
      }
    end
  end

  defmodule NewRecord do
    defstruct [:relation, :record]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            record: Changes.record()
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

  defmodule TruncatedRelation do
    defstruct [:relation]

    @type t() :: %__MODULE__{relation: Changes.relation()}
  end

  # FIXME: this assumes PK is literally just "id" column
  def build_key(%{relation: {schema, table}, record: record}) do
    IO.iodata_to_binary([schema, ?-, table, ?-, record |> Map.take(["id"]) |> Map.values()])
  end

  def build_key(%{relation: {schema, table}, old_record: record}) do
    IO.iodata_to_binary([schema, ?-, table, ?-, record |> Map.take(["id"]) |> Map.values()])
  end

  def to_json_value(%NewRecord{record: record}), do: record
  def to_json_value(%UpdatedRecord{record: record}), do: record
  def to_json_value(%DeletedRecord{}), do: nil

  def get_action(%NewRecord{}), do: "insert"
  def get_action(%UpdatedRecord{}), do: "update"
  def get_action(%DeletedRecord{}), do: "delete"
end
