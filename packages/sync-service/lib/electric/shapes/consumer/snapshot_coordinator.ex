defmodule Electric.Shapes.Consumer.SnapshotCoordinator do
  @moduledoc """
  Manages snapshot lifecycle and storage operations.

  Responsible for:
  - Initializing from storage
  - Writing snapshot metadata to storage
  - Managing snapshot state transitions
  - Coordinating with BufferingCoordinator for filtering

  This module owns all snapshot-related side effects (storage writes).
  """

  alias Electric.Shapes.Consumer.ConsumerContext
  alias Electric.Shapes.Consumer.BufferingCoordinator
  alias Electric.ShapeCache.Storage
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes.Transaction

  @doc """
  Initializes the context from storage, reading existing snapshot data.

  Side effects: reads from storage
  """
  @spec initialize_from_storage(ConsumerContext.t(), Storage.shape_storage(), Storage.writer_state()) ::
          ConsumerContext.t()
  def initialize_from_storage(ctx, storage, writer) do
    {:ok, latest_offset, pg_snapshot} = Storage.get_current_position(storage)

    # Normalize the latest offset
    normalized_latest_offset =
      if LogOffset.is_virtual_offset(latest_offset),
        do: LogOffset.last_before_real_offsets(),
        else: latest_offset

    # Extract snapshot and filtering state
    {pg_snapshot, filtering?} =
      case pg_snapshot do
        nil ->
          {nil, true}

        %{xmin: xmin, xmax: xmax, xip_list: xip_list} ->
          {{xmin, xmax, xip_list}, Map.get(pg_snapshot, :filter_txns?, true)}
      end

    # Initialize the buffering coordinator with snapshot info
    coordinator = BufferingCoordinator.initialize(ctx.coordinator, pg_snapshot, filtering?)

    %{ctx |
      latest_offset: normalized_latest_offset,
      storage: storage,
      writer: writer,
      coordinator: coordinator
    }
  end

  @doc """
  Sets the initial snapshot for the shape.

  Side effects: writes to storage
  """
  @spec set_initial_snapshot(ConsumerContext.t(), BufferingCoordinator.pg_snapshot()) ::
          ConsumerContext.t()
  def set_initial_snapshot(ctx, {xmin, xmax, xip_list} = snapshot) do
    # Side effect: persist snapshot to storage
    Storage.set_pg_snapshot(
      %{xmin: xmin, xmax: xmax, xip_list: xip_list, filter_txns?: true},
      ctx.storage
    )

    # Update coordinator
    coordinator = BufferingCoordinator.set_initial_snapshot(ctx.coordinator, snapshot)

    %{ctx | coordinator: coordinator}
  end

  @doc """
  Stops initial snapshot filtering if the transaction is beyond the snapshot.

  Side effects: writes to storage if filtering stops
  """
  @spec maybe_stop_initial_filtering(ConsumerContext.t(), Transaction.t()) :: ConsumerContext.t()
  def maybe_stop_initial_filtering(ctx, txn) do
    new_coord = BufferingCoordinator.maybe_stop_initial_filtering(ctx.coordinator, txn)

    # Side effect: update storage if filtering was stopped
    if BufferingCoordinator.initial_filtering?(ctx.coordinator) and
         not BufferingCoordinator.initial_filtering?(new_coord) do
      case BufferingCoordinator.initial_snapshot_xmin(new_coord) do
        nil ->
          :ok

        xmin ->
          {^xmin, xmax, xip_list} = ctx.coordinator.initial_snapshot

          Storage.set_pg_snapshot(
            %{xmin: xmin, xmax: xmax, xip_list: xip_list, filter_txns?: false},
            ctx.storage
          )
      end
    end

    %{ctx | coordinator: new_coord}
  end

  @doc """
  Marks the snapshot as started.

  Side effects: writes to storage
  """
  @spec mark_snapshot_started(ConsumerContext.t()) :: ConsumerContext.t()
  def mark_snapshot_started(ctx) do
    Storage.mark_snapshot_as_started(ctx.storage)
    %{ctx | snapshot_started?: true}
  end

  @doc """
  Returns the initial snapshot's xmin, or nil if no snapshot set.
  """
  @spec initial_snapshot_xmin(ConsumerContext.t()) :: term() | nil
  def initial_snapshot_xmin(ctx) do
    BufferingCoordinator.initial_snapshot_xmin(ctx.coordinator)
  end
end
