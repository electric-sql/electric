defmodule ElectricTelemetry.DiskUsage do
  use GenServer

  alias ElectricTelemetry.DiskUsage.Disk

  @default_update_period 60_000
  @default_top_n 10

  def start_link(args) do
    {:ok, stack_id} = Keyword.fetch(args, :stack_id)
    GenServer.start_link(__MODULE__, args, name: name(stack_id))
  end

  def update(pid) do
    GenServer.call(pid, :update)
  end

  def current(stack_id) do
    case lookup(stack_id, :usage_bytes) do
      [{:usage_bytes, bytes, %DateTime{}, duration}] -> {:ok, bytes, duration}
      _ -> :pending
    end
  end

  @doc """
  Returns the top-N largest per-directory subtotals as a list of
  `{dir_name, bytes}` tuples sorted descending by size, or `:pending` if no
  measurement with grouping enabled has completed yet.
  """
  def current_dirs(stack_id) do
    case lookup(stack_id, :top_dirs) do
      [{:top_dirs, dirs}] -> {:ok, dirs}
      _ -> :pending
    end
  end

  # The table doesn't exist until this stack's DiskUsage server has started.
  defp lookup(stack_id, key) do
    :ets.lookup(name(stack_id), key)
  rescue
    ArgumentError -> []
  end

  @impl GenServer
  def init(args) do
    {:ok, stack_id} = Keyword.fetch(args, :stack_id)
    {:ok, storage_dir} = Keyword.fetch(args, :storage_dir)
    update_period = Keyword.get(args, :update_period, @default_update_period)

    table =
      :ets.new(name(stack_id), [
        :named_table,
        :set,
        :protected
      ])

    {usage_bytes, updated_at, immediate_update?} = load_cached_usage(storage_dir)

    state =
      %{
        table: table,
        storage_dir: storage_dir,
        manual_refresh: Keyword.get(args, :manual_refresh, false),
        update_period: update_period,
        group_depth: Keyword.get(args, :group_depth),
        top_n: Keyword.get(args, :top_n, @default_top_n),
        usage_bytes: usage_bytes,
        updated_at: updated_at,
        measurement_duration: 0,
        top_dirs: nil,
        timer: nil
      }
      |> ets_write()

    if immediate_update? do
      {:ok, state, {:continue, :calculate_usage}}
    else
      {:ok, schedule_update(state)}
    end
  end

  @impl GenServer
  def handle_continue(:calculate_usage, state) do
    {:noreply, read_disk_usage(state)}
  end

  @impl GenServer
  def handle_info(:update, state) do
    {:noreply, read_disk_usage(state)}
  end

  @impl GenServer
  def handle_call(:update, _from, state) do
    {:reply, :ok, read_disk_usage(state)}
  end

  defp read_disk_usage(state) do
    exclude = [usage_cache_file(state.storage_dir)]

    {duration, {bytes, buckets}} =
      :timer.tc(
        fn -> Disk.recursive_usage_grouped(state.storage_dir, exclude, state.group_depth) end,
        :millisecond
      )

    %{
      state
      | usage_bytes: bytes,
        updated_at: DateTime.utc_now(),
        measurement_duration: duration,
        top_dirs: state.group_depth && top_n(buckets, state.top_n)
    }
    |> ets_write()
    |> save_usage!()
    |> cancel_timer()
    |> schedule_update()
  end

  # The `n` largest `{name, bytes}` buckets, sorted descending by size. The
  # full bucket map is materialized and sorted once per (~60s) walk before
  # being trimmed; fine at ~10k shapes per stack — replace with a bounded
  # min-heap if a stack ever holds hundreds of thousands.
  defp top_n(buckets, n) do
    buckets
    |> Enum.sort_by(fn {_name, bytes} -> bytes end, :desc)
    |> Enum.take(n)
  end

  defp ets_write(state) do
    :ets.insert(
      state.table,
      {:usage_bytes, state.usage_bytes, state.updated_at, state.measurement_duration}
    )

    if dirs = state.top_dirs, do: :ets.insert(state.table, {:top_dirs, dirs})

    state
  end

  defp name(stack_id) do
    :"ElectricTelemetry.DiskUsage:#{stack_id}"
  end

  @cache_version "1"

  defp load_cached_usage(storage_dir) do
    cache_file = usage_cache_file(storage_dir)

    with true <- File.exists?(cache_file),
         {:ok, data} <- File.read(cache_file),
         [@cache_version, usage_bytes, updated_at] <- String.split(data, "|"),
         {usage_bytes, ""} <- Integer.parse(usage_bytes),
         {:ok, updated_at, 0} = DateTime.from_iso8601(updated_at) do
      {usage_bytes, updated_at, false}
    else
      _ ->
        {0, nil, true}
    end
  end

  defp save_usage!(state) do
    cache_file = usage_cache_file(state.storage_dir)

    data =
      IO.iodata_to_binary([
        @cache_version,
        "|",
        to_string(state.usage_bytes),
        "|",
        DateTime.to_iso8601(state.updated_at)
      ])

    File.mkdir_p!(Path.dirname(cache_file))
    File.write!(cache_file, data, [:binary, :raw])

    state
  end

  defp usage_cache_file(storage_dir) do
    Path.join(storage_dir, ".disk-usage")
  end

  defp schedule_update(%{manual_refresh: true} = state) do
    state
  end

  defp schedule_update(%{timer: nil} = state) do
    timer = Process.send_after(self(), :update, state.update_period)
    %{state | timer: timer}
  end

  defp schedule_update(state) do
    state
  end

  defp cancel_timer(%{timer: nil} = state), do: state

  defp cancel_timer(%{timer: timer} = state) when is_reference(timer) do
    Process.cancel_timer(timer)
    %{state | timer: nil}
  end
end
