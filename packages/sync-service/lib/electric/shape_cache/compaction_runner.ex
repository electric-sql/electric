defmodule Electric.ShapeCache.CompactionRunner do
  use GenServer

  require Logger

  alias Electric.ShapeCache.Storage

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            shape_handle: [type: :string, required: true],
            storage: [type: :mod_arg, required: true],
            compaction_period: [type: :non_neg_integer, default: :timer.minutes(10)]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, opts, name: name(opts))
    end
  end

  def name(opts) do
    Electric.ProcessRegistry.name(opts[:stack_id], __MODULE__, opts[:shape_handle])
  end

  @impl GenServer
  def init(opts) do
    clean_after_period(opts)
    Process.set_label({:compaction_runner, opts[:stack_id], opts[:shape_handle]})
    Logger.metadata(stack_id: opts[:stack_id], shape_handle: opts[:shape_handle])
    {:ok, opts}
  end

  @impl GenServer
  def handle_info(:clean, opts) do
    Logger.info("Triggering compaction for shape #{opts[:shape_handle]}")
    clean_after_period(opts)
    Storage.compact(opts[:storage])
    Logger.info("Compaction complete for shape #{opts[:shape_handle]}")

    {:noreply, opts}
  end

  defp clean_after_period(opts) do
    # add a large random jitter to avoid all compactions happening at the same time
    half_period = div(opts[:compaction_period], 2)
    next_msg = opts[:compaction_period] + Enum.random(-half_period..half_period)
    Process.send_after(self(), :clean, next_msg)
  end
end
