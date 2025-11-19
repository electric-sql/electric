defmodule Electric.Shapes.Consumer.MoveInOperation do
  @moduledoc """
  Represents a single move-in operation's lifecycle and state.

  A move-in operation goes through several stages:
  1. `:querying` - Database query in progress, key set unknown
  2. `:filtering` - Query complete, filtering changes by key set
  3. `:completed` - All transactions after snapshot processed

  The operation tracks a PostgreSQL snapshot that defines which
  transactions are visible to the move-in query.
  """

  alias Electric.Postgres.Xid
  alias Electric.Replication.Changes.Transaction

  @type name :: String.t()
  @type pg_snapshot :: {Xid.anyxid(), Xid.anyxid(), list(Xid.anyxid())}
  @type key_set :: MapSet.t(String.t())
  @type status :: :querying | :filtering | :completed

  @type t :: %__MODULE__{
          name: name(),
          pg_snapshot: pg_snapshot(),
          key_set: key_set() | nil,
          status: status()
        }

  defstruct [:name, :pg_snapshot, :key_set, :status]

  @doc """
  Creates a new move-in operation in the `:querying` status.
  """
  @spec new(name(), pg_snapshot()) :: t()
  def new(name, pg_snapshot) do
    %__MODULE__{
      name: name,
      pg_snapshot: pg_snapshot,
      key_set: nil,
      status: :querying
    }
  end

  @doc """
  Marks the operation as complete with the given key set.
  Transitions from `:querying` to `:filtering`.
  """
  @spec complete(t(), list(String.t())) :: t()
  def complete(%__MODULE__{status: :querying} = op, key_list) do
    %{op | key_set: MapSet.new(key_list), status: :filtering}
  end

  @doc """
  Marks the operation as fully completed.
  Transitions from `:filtering` to `:completed`.
  """
  @spec mark_completed(t()) :: t()
  def mark_completed(%__MODULE__{} = op) do
    %{op | status: :completed}
  end

  @doc """
  Returns true if this operation should cause buffering for the given transaction.

  A transaction needs to be buffered if:
  - The operation is still `:querying` (key set unknown)
  - The transaction is not visible in the operation's snapshot
  """
  @spec should_buffer?(t(), Transaction.t()) :: boolean()
  def should_buffer?(%__MODULE__{status: :querying} = op, txn) do
    not Transaction.visible_in_snapshot?(txn, op.pg_snapshot)
  end

  def should_buffer?(%__MODULE__{status: :filtering}, _txn), do: false
  def should_buffer?(%__MODULE__{status: :completed}, _txn), do: false

  @doc """
  Returns true if this operation is complete for the given transaction.

  An operation is considered complete once we see a transaction that's
  after the end of the operation's snapshot (xid >= xmax).
  """
  @spec is_completed_by?(t(), Transaction.t()) :: boolean()
  def is_completed_by?(%__MODULE__{pg_snapshot: snapshot}, %Transaction{xid: xid}) do
    Xid.after_snapshot?(xid, snapshot)
  end

  @doc """
  Returns true if a change with the given key should be filtered out.

  A change should be filtered if:
  - The operation is in `:filtering` status
  - The transaction is visible in the snapshot
  - The key is in the operation's key set
  """
  @spec should_filter?(t(), Transaction.t(), String.t()) :: boolean()
  def should_filter?(
        %__MODULE__{status: :filtering, key_set: key_set, pg_snapshot: snapshot},
        txn,
        key
      ) do
    Transaction.visible_in_snapshot?(txn, snapshot) and MapSet.member?(key_set, key)
  end

  def should_filter?(%__MODULE__{}, _txn, _key), do: false
end
