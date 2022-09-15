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

  @type relation() :: {schema :: String.t(), table :: String.t()}
  @type record() :: %{(column_name :: String.t()) => column_data :: binary()}
  @type change() ::
          Changes.NewRecord.t()
          | Changes.UpdatedRecord.t()
          | Changes.DeletedRecord.t()

  defmodule Transaction do
    @type t() :: %__MODULE__{
            changes: [Changes.change()],
            commit_timestamp: DateTime.t(),
            origin: String.t(),
            publication: String.t(),
            lsn: Electric.Postgres.Lsn.t(),
            ack_fn: (() -> :ok | {:error, term()})
          }

    defstruct [:changes, :commit_timestamp, :origin, :publication, :lsn, :ack_fn]
  end

  defmodule NewRecord do
    defstruct [:relation, :record]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            record: Changes.record()
          }

    defimpl Electric.Replication.Vaxine.ToVaxine do
      def handle_change(%{record: record, relation: {schema, table}}) do
        %{primary_keys: keys} = SchemaRegistry.fetch_table_info!({schema, table})

        row =
          schema
          |> Row.new(table, record, keys)
          |> Row.force_deleted_update(false)

        case VaxRepo.insert(row) do
          {:ok, _} -> :ok
          error -> error
        end
      end
    end
  end

  defmodule UpdatedRecord do
    defstruct [:relation, :old_record, :record]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            old_record: Changes.record() | nil,
            record: Changes.record()
          }

    defimpl Electric.Replication.Vaxine.ToVaxine do
      def handle_change(%{old_record: old_record, record: new_record, relation: {schema, table}})
          when old_record == %{} or old_record == nil do
        %{primary_keys: keys} = SchemaRegistry.fetch_table_info!({schema, table})

        row = Row.new(schema, table, new_record, keys)

        %Row{row | row: %{}}
        |> Ecto.Changeset.change(row: new_record)
        |> Row.force_deleted_update(false)
        |> Electric.VaxRepo.update()
        |> case do
          {:ok, _} -> :ok
          error -> error
        end
      end

      def handle_change(%{old_record: old_record, record: new_record, relation: {schema, table}}) do
        %{primary_keys: keys} = SchemaRegistry.fetch_table_info!({schema, table})

        schema
        |> Row.new(table, old_record, keys)
        |> Ecto.Changeset.change(row: new_record)
        |> Row.force_deleted_update(false)
        |> Electric.VaxRepo.update()
        |> case do
          {:ok, _} -> :ok
          error -> error
        end
      end
    end
  end

  defmodule DeletedRecord do
    defstruct [:relation, :old_record]

    @type t() :: %__MODULE__{
            relation: Changes.relation(),
            old_record: Changes.record()
          }

    defimpl Electric.Replication.Vaxine.ToVaxine do
      def handle_change(%{old_record: old_record, relation: {schema, table}}) do
        %{primary_keys: keys} = SchemaRegistry.fetch_table_info!({schema, table})

        schema
        |> Row.new(table, old_record, keys)
        |> Row.force_deleted_update(true)
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
end
