defmodule Electric.Postgres.CachedWal.Api do
  @moduledoc """
  Behavior for accessing cached WAL.
  """

  alias Electric.Replication.Connectors
  alias Electric.Telemetry.Metrics

  @type lsn :: Electric.Postgres.Lsn.t()

  @typedoc "Position in the cached write-ahead log"
  @type wal_pos :: term()

  @typedoc "Notification reference no notify when new wal segment is available"
  @type await_ref :: reference()

  @typedoc "Wal segment, where segment is just an abstraction term within Electric"
  @type segment :: Electric.Replication.Changes.Transaction.t()

  @type stats :: %{
          transaction_count: non_neg_integer(),
          oldest_transaction_timestamp: DateTime.t() | nil,
          max_cache_size: pos_integer(),
          cache_memory_total: non_neg_integer()
        }

  @callback get_current_position(Connectors.origin()) :: wal_pos() | nil
  @callback next_segment(Connectors.origin(), wal_pos()) ::
              {:ok, segment(), new_position :: wal_pos()} | :latest | {:error, term()}
  @callback request_notification(Connectors.origin(), wal_pos()) ::
              {:ok, await_ref()} | {:error, term()}
  @callback cancel_notification_request(Connectors.origin(), await_ref()) :: :ok
  @callback reserve_wal_position(Connectors.origin(), binary(), wal_pos() | :oldest) ::
              {:ok, wal_pos()} | :error
  @callback cancel_reservation(Connectors.origin(), binary()) :: :ok

  @callback serialize_wal_position(wal_pos()) :: binary()
  @callback parse_wal_position(binary()) :: {:ok, wal_pos()} | :error
  @callback compare_positions(wal_pos(), wal_pos()) :: :lt | :eq | :gt

  @callback telemetry_stats(Connectors.origin()) :: stats() | nil

  def default_module,
    do: Application.fetch_env!(:electric, __MODULE__) |> Keyword.fetch!(:adapter)

  @doc """
  Get the latest LSN that the cached WAL has seen.

  Returns nil if the cached WAL hasn't processed any non-empty transactions yet.
  """
  @spec get_current_position(module(), Connectors.origin()) :: wal_pos | nil
  def get_current_position(module \\ default_module(), origin) do
    module.get_current_position(origin)
  end

  @doc """
  Get the next segment from the cached WAL from the current position.

  If there's a next segment available, returns it along with the new position for the next read,
  otherwise returns an atom `:latest`. There could be a case where lsn is already too old
  (i.e. out of the cached window), in which case an error will be returned, and the client is expected
  to query source database directly to catch up.
  """
  @spec next_segment(module(), Connectors.origin(), wal_pos()) ::
          {:ok, segment(), new_position :: wal_pos()} | :latest
  def next_segment(module \\ default_module(), origin, wal_pos) do
    module.next_segment(origin, wal_pos)
  end

  def compare_positions(module \\ default_module(), wal_pos_1, wal_pos_2),
    do: module.compare_positions(wal_pos_1, wal_pos_2)

  @spec stream_transactions(module(), Connectors.origin(), [{:from, any()} | {:to, any()}, ...]) ::
          Enumerable.t({segment(), wal_pos()})
  def stream_transactions(module \\ default_module(), origin, opts) do
    from_pos = Keyword.fetch!(opts, :from)
    to_pos = Keyword.fetch!(opts, :to)

    Stream.unfold(from_pos, fn from_pos ->
      case next_segment(module, origin, from_pos) do
        {:ok, segment, new_pos} ->
          if module.compare_positions(new_pos, to_pos) != :gt, do: {segment, new_pos}, else: nil

        :latest ->
          nil
      end
    end)
  end

  @doc """
  Request notification to be sent as soon as any segment with position higher than specified shows up.

  The calling process will receive a message in the form of
  `{:cached_wal_notification, ref(), :new_segments_available}`
  as soon as a new segment becomes available in the cache.
  """
  @spec request_notification(module(), Connectors.origin(), wal_pos()) ::
          {:ok, await_ref()} | {:error, term()}
  def request_notification(module \\ default_module(), origin, wal_pos) do
    module.request_notification(origin, wal_pos)
  end

  @doc """
  Cancel a notification request issued previously by `request_notification/2`.
  """
  @spec cancel_notification_request(module(), Connectors.origin(), await_ref()) :: :ok
  def cancel_notification_request(module \\ default_module(), origin, await_ref) do
    module.cancel_notification_request(origin, await_ref)
  end

  @doc """
  Reserve the given wal pos to prevent its garbage collection.

  The reservation is held until a matching `cancel_reservation/3` call.

  If `wal_pos` is behind the cached window, `:error` is returned.
  """
<<<<<<< HEAD
  @spec reserve_wal_position(module(), Connectors.origin(), binary(), wal_pos()) :: :ok | :error
=======
  @spec reserve_wal_position(module(), Connectors.origin(), binary(), wal_pos() | :oldest) ::
          {:ok, wal_pos()} | :error
>>>>>>> e6f66bb2 (Stream WAL records from the replication slot)
  def reserve_wal_position(module \\ default_module(), origin, client_id, wal_pos) do
    module.reserve_wal_position(origin, client_id, wal_pos)
  end

  @doc """
  Release the reservation previously made with `reserve_wal_position/4`.
  """
  @spec cancel_reservation(module(), Connectors.origin(), binary()) :: :ok
  def cancel_reservation(module \\ default_module(), origin, client_id) do
    module.cancel_reservation(origin, client_id)
  end

  @spec parse_wal_position(module(), binary()) :: {:ok, wal_pos()} | :error
  def parse_wal_position(module \\ default_module(), bin) do
    module.parse_wal_position(bin)
  end

  @spec serialize_wal_position(module(), wal_pos()) :: binary()
  def serialize_wal_position(module \\ default_module(), wal_pos) do
    module.serialize_wal_position(wal_pos)
  end

  @spec emit_telemetry_stats(module(), Electric.Telemetry.Metrics.span_name()) :: :ok
  def emit_telemetry_stats(module \\ default_module(), event) do
    module
    |> Electric.reg_names()
    |> Enum.each(fn origin ->
      case module.telemetry_stats(origin) do
        nil -> :ok
        stats -> Metrics.non_span_event(event, stats)
      end
    end)
  end
end
