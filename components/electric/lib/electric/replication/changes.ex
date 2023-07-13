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

  alias Electric.Postgres.SchemaRegistry
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

  defmodule TruncatedRelation do
    defstruct [:relation]
  end

  @spec belongs_to_user?(Transaction.t(), binary()) :: boolean()
  def belongs_to_user?(%Transaction{} = tx, user_id) do
    Changes.Ownership.belongs_to_user?(tx, user_id)
  end

  @spec generateTag(Transaction.t()) :: binary()
  def generateTag(%Transaction{origin: origin, commit_timestamp: tm}) do
    origin <> "@" <> Integer.to_string(DateTime.to_unix(tm, :millisecond))
  end

  defmodule Relation.Column do
    defstruct [:flags, :name, :type, :type_modifier, :primary_key]

    @type t() :: %__MODULE__{
            flags: [:key],
            name: String.t(),
            type: atom(),
            type_modifier: integer()
          }
  end

  defmodule Relation do
    alias Electric.Postgres.SchemaRegistry
    defstruct [:id, :namespace, :name, :replica_identity, :columns]

    @type t() :: %__MODULE__{
            id: Changes.relation_id(),
            namespace: String.t(),
            name: String.t(),
            replica_identity: :default | :nothing | :all_columns | :index,
            columns: [Relation.Column.t()]
          }

    # Convert a Relation message into a table structure as used by the SchemaRegistry
    @spec to_schema_table(t()) :: {SchemaRegistry.replicated_table(), [SchemaRegistry.column()]}
    def to_schema_table(%__MODULE__{} = relation) do
      {%{
         name: relation.name,
         schema: relation.namespace,
         oid: relation.id,
         replica_identity: relation.replica_identity,
         primary_keys: []
       },
       Enum.map(
         relation.columns,
         &%{
           name: &1.name,
           part_of_identity?: :key in &1.flags,
           type: &1.type,
           type_modifier: &1.type_modifier
         }
       )}
    end
  end
end
