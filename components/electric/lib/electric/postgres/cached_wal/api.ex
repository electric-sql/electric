defmodule Electric.Postgres.CachedWal.Api do
  @moduledoc """
  Behavior for accessing cached wal
  """
  @type lsn :: Electric.Postgres.Lsn.t()

  @typedoc "Position in the cached write-ahead log"
  @type wal_pos :: term()

  @typedoc "Notification reference no notify when new wal segment is available"
  @type await_ref :: reference()

  @typedoc "Wal segment, where segment is just an abstraction term within Electric"
  @type segment :: Electric.Replication.Changes.Transaction.t()

  @callback lsn_in_cached_window?(wal_pos) :: boolean
  @callback get_current_position() :: wal_pos | nil
  @callback next_segment(wal_pos()) ::
              {:ok, segment(), new_position :: wal_pos()} | :latest | {:error, term()}
  @callback request_notification(wal_pos()) :: {:ok, await_ref()} | {:error, term()}
  @callback cancel_notification_request(await_ref()) :: :ok

  @callback serialize_wal_position(wal_pos()) :: binary()
  @callback parse_wal_position(binary()) :: {:ok, wal_pos()} | :error

  @default_adapter Application.compile_env!(:electric, [__MODULE__, :adapter])
  def default_module(), do: @default_adapter

  @doc """
  Check if the given LSN falls into the caching window maintained by the cached WAL implementation.

  This checks needs to be done for every client. If their LSN is outside of the caching window, we won't be able to
  guarantee data consistency via the replication stream alone.
  """
  @spec lsn_in_cached_window?(module(), wal_pos) :: boolean
  def lsn_in_cached_window?(module \\ @default_adapter, lsn) do
    module.lsn_in_cached_window?(lsn)
  end

  @doc """
  Get the latest LSN that the cached WAL has seen.

  Returns nil if the cached WAL hasn't processed any non-empty transactions yet.
  """
  @spec get_current_position(module()) :: wal_pos | nil
  def get_current_position(module \\ @default_adapter) do
    module.get_current_position()
  end

  @doc """
  Get the next segment from the cached WAL from the current position.

  If there's a next segment available, returns it along with the new position for the next read,
  otherwise returns an atom `:latest`. There could be a case where lsn is already too old
  (i.e. out of the cached window), in which case an error will be returned, and the client is expected
  to query source database directly to catch up.
  """
  @spec next_segment(module(), wal_pos()) ::
          {:ok, segment(), new_position :: wal_pos()} | :latest | {:error, :lsn_too_old}
  def next_segment(module \\ @default_adapter, wal_pos) do
    module.next_segment(wal_pos)
  end

  @doc """
  Request notification to be sent as soon as any segment with position higher than specified shows up.

  The calling process will receive a message in the form of
  `{:cached_wal_notification, ref(), :new_segments_available}`
  as soon as a new segment becomes available in the cache.
  """
  @spec request_notification(module(), wal_pos()) :: {:ok, await_ref()} | {:error, term()}
  def request_notification(module \\ @default_adapter, wal_pos) do
    module.request_notification(wal_pos)
  end

  @doc """
  Cancel a notification request issued previously by `request_notification/2`.
  """
  @spec cancel_notification_request(module(), await_ref()) :: :ok
  def cancel_notification_request(module \\ @default_adapter, await_ref) do
    module.cancel_notification_request(await_ref)
  end

  @spec parse_wal_position(module(), binary()) :: {:ok, wal_pos()} | :error
  def parse_wal_position(module \\ @default_adapter, bin) do
    module.parse_wal_position(bin)
  end

  @spec serialize_wal_position(module(), wal_pos()) :: binary()
  def serialize_wal_position(module \\ @default_adapter, wal_pos) do
    module.serialize_wal_position(wal_pos)
  end
end
