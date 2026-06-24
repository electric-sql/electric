defmodule Electric.ShapeCache.ShapeStatusOwner do
  @moduledoc """
  Owns the ETS table and the ShapeStatus state.

  This process creates the ETS table for shapes and initializes
  `Electric.ShapeCache.ShapeStatus` early in the supervision tree so that
  dependent processes (e.g., shape consumers) can use a single, shared
  ShapeStatus instance regardless of their own supervisor start order.

  Initialization is done asynchronously via `handle_continue` to avoid
  blocking the supervision tree startup on potentially slow SQLite reads.
  """

  use GenServer

  alias Electric.ShapeCache.ShapeStatus
  alias Electric.ShapeCache.ShapeStatus.ShapeDb
  alias Electric.ShapeCache.Storage
  alias Electric.StackSupervisor.ShutdownCoordinator

  require Logger

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            persistent_kv: [type: :any, required: false]
          )

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Refresh shape metadata from SQLite after lock acquisition.

  Uses an infinite timeout because on laggy storage with an incorrectly
  shut-down database this can take a long time.
  """
  def refresh(stack_id) do
    GenServer.call(name(stack_id), :refresh, :infinity)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      opts = Map.new(opts)
      GenServer.start_link(__MODULE__, opts, name: name(opts.stack_id))
    end
  end

  @impl true
  def init(config) do
    stack_id = config.stack_id

    Process.set_label({:shape_status_owner, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    :ok = Electric.LsnTracker.initialize(stack_id)

    {:ok, %{stack_id: stack_id, persistent_kv: Map.get(config, :persistent_kv)},
     {:continue, :initialize}}
  end

  @impl true
  def handle_continue(:initialize, state) do
    maybe_reset_after_dirty_shutdown(state)

    # Initialize shape metadata from SQLite so we can serve shapes in
    # read-only mode before the advisory lock is acquired
    :ok = ShapeStatus.initialize(state.stack_id)

    # Signal that shape metadata is loaded and shapes can be served read-only
    Electric.StatusMonitor.mark_shape_metadata_ready(state.stack_id, self())

    Logger.notice("Shape metadata initialized, entering read-only mode")

    {:noreply, state, :hibernate}
  end

  # If the previous stack shutdown wasn't clean, different shapes' on-disk
  # `last_persisted_txn_offset`s may be at different LSNs (writers flush
  # independently and the supervisor doesn't coordinate a final flush
  # before tear-down). Recovering from such a state would mean that an
  # outer subquery shape's `state.views` (seeded from the materializer,
  # which is rebuilt from the inner shape's history) and its on-disk
  # storage land at different LSNs, producing duplicate inserts and
  # orphan deletes when live events resume.
  #
  # Sound recovery from a partial shutdown is hard; the conservative
  # answer is to throw away every shape's persisted state and force a
  # re-snapshot. Clients re-request their shapes from scratch on the
  # next poll.
  defp maybe_reset_after_dirty_shutdown(%{persistent_kv: nil}), do: :ok

  defp maybe_reset_after_dirty_shutdown(%{persistent_kv: persistent_kv} = state) do
    if ShutdownCoordinator.consume_clean_shutdown_marker(persistent_kv) do
      :ok
    else
      Logger.warning(
        "Stack #{state.stack_id} did not shut down cleanly last time; " <>
          "dropping all shape data to avoid inconsistent recovery"
      )

      # Wipe before ShapeStatus.initialize so that initialize sees an
      # empty SQLite store and creates a fresh, empty ETS cache. We
      # can't call ShapeStatus.reset/1 here because the ETS tables it
      # tries to clear haven't been created yet (initialize is what
      # creates them).
      :ok = ShapeDb.reset(state.stack_id)

      state.stack_id
      |> Storage.for_stack()
      |> Storage.cleanup_all!()

      :ok
    end
  end

  @impl true
  def handle_call(:refresh, _from, state) do
    :ok = ShapeStatus.refresh(state.stack_id)
    {:reply, :ok, state, :hibernate}
  end
end
