defmodule Electric.Replication.Changes do
  @moduledoc """
  This module contain rules to convert changes coming from PostgreSQL
  to Vaxine format.

  Some of the core assumptions in this module:
  - We require PK always to be present for all tables
  - For now PK modification is not supported
  - PG replication protocol is expected to always send the *whole* row
  when dealing with UPDATE changes, and optionally old row if REPLICA
  identity is set to FULL.
  """

  alias Electric.Replication.Row
  alias Electric.VaxRepo
  alias Electric.Postgres.SchemaRegistry
  alias Electric.Replication.Changes

  require Logger

  @type db_identifier() :: String.t()
  @type relation() :: {schema :: db_identifier(), table :: db_identifier()}
  @type record() :: %{(column_name :: db_identifier()) => column_data :: binary()}

  # Tag is of the form 'origin@timestamp' where:
  # origin - is a unique source id (UUID for Satellite clients)
  # timestamp - is an timestamp in UTC in milliseconds
  @type tag() :: String.t()

  @type change() ::
          Changes.NewRecord.t()
          | Changes.UpdatedRecord.t()
          | Changes.DeletedRecord.t()

  defmodule Transaction do
    @type t() :: %__MODULE__{
            changes: [Changes.change()],
            commit_timestamp: DateTime.t(),
            origin: String.t(),
            # this field is only set by Electric when propagating data down to Vaxine
            origin_type: :postgresql | :satellite,
            publication: String.t(),
            lsn: Electric.Postgres.Lsn.t(),
            ack_fn: (() -> :ok | {:error, term()})
          }

    defstruct [:changes, :commit_timestamp, :origin, :publication, :lsn, :ack_fn, :origin_type]
  end

  defmodule NewRecord do
    defstruct [:relation, :record, tags: []]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            record: Changes.record(),
            tags: [Changes.tag()]
          }

    defimpl Electric.Replication.Vaxine.ToVaxine do
      def handle_change(
            %{record: record, relation: {schema, table}, tags: tags},
            %Transaction{} = tx
          ) do
        %{primary_keys: keys} = SchemaRegistry.fetch_table_info!({schema, table})

        row =
          schema
          |> Row.new(table, record, keys, tags)
          |> Ecto.Changeset.change(deleted?: MapSet.new([Changes.generateTag(tx)]))

        case VaxRepo.insert(row) do
          {:ok, _} -> :ok
          error -> error
        end
      end
    end
  end

  defmodule UpdatedRecord do
    defstruct [:relation, :old_record, :record, tags: []]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            old_record: Changes.record() | nil,
            record: Changes.record(),
            tags: [Changes.tag()]
          }

    defimpl Electric.Replication.Vaxine.ToVaxine do
      def handle_change(
            %{old_record: old_record, record: new_record, relation: {schema, table}, tags: tags},
            %Transaction{} = tx
          )
          when old_record != nil and old_record != %{} do
        %{primary_keys: keys} = SchemaRegistry.fetch_table_info!({schema, table})

        schema
        |> Row.new(table, old_record, keys, tags)
        |> Ecto.Changeset.change(row: new_record, deleted?: MapSet.new([Changes.generateTag(tx)]))
        |> Electric.VaxRepo.update()
        |> case do
          {:ok, _} -> :ok
          error -> error
        end
      end
    end
  end

  defmodule DeletedRecord do
    defstruct [:relation, :old_record, tags: []]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            old_record: Changes.record(),
            tags: [Changes.tag()]
          }

    defimpl Electric.Replication.Vaxine.ToVaxine do
      def handle_change(
            %{old_record: old_record, relation: {schema, table}, tags: tags},
            %Transaction{origin_type: type}
          ) do
        %{primary_keys: keys} = SchemaRegistry.fetch_table_info!({schema, table})

        # FIXME: At the moment we do not support tags in PotgreSQL, so in order to
        # make sure data is deleted we get the current clear set and provide it
        # generate remove for all tags in it.
        #
        # This is a temporary hack, till we get Satellite-type tag handling in
        # PostgreSQL
        tags =
          case type do
            :postgresql ->
              %{deleted?: clear_tags} =
                Electric.VaxRepo.reload(
                  Row.new(schema, table, %{"id" => Map.get(old_record, "id")}, keys)
                )

              clear_tags

            :satellite ->
              tags
          end

        schema
        |> Row.new(table, old_record, keys, tags)
        |> Ecto.Changeset.change(deleted?: MapSet.new([]))
        |> Electric.VaxRepo.update()
        |> case do
          {:ok, _} -> :ok
          error -> error
        end
      end
    end
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
end
