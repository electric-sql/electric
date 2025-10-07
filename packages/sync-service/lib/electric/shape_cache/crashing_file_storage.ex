defmodule Electric.ShapeCache.CrashingFileStorage do
  @moduledoc """
  A thing wrapper module around PureFileStorage that can be configured to raise an error after a
  certain number of writes.
  """
  alias Electric.ShapeCache.PureFileStorage

  @behaviour Electric.ShapeCache.Storage

  defdelegate for_shape(shape_handle, opts), to: PureFileStorage
  defdelegate start_link(opts), to: PureFileStorage
  defdelegate get_all_stored_shape_handles(opts), to: PureFileStorage
  defdelegate get_all_stored_shapes(opts), to: PureFileStorage
  defdelegate metadata_backup_dir(opts), to: PureFileStorage
  defdelegate get_total_disk_usage(opts), to: PureFileStorage
  defdelegate get_current_position(opts), to: PureFileStorage
  defdelegate set_pg_snapshot(pg_snapshot, opts), to: PureFileStorage
  defdelegate snapshot_started?(opts), to: PureFileStorage
  defdelegate make_new_snapshot!(data_stream, opts), to: PureFileStorage
  defdelegate mark_snapshot_as_started(opts), to: PureFileStorage
  defdelegate get_log_stream(offset, max_offset, opts), to: PureFileStorage
  defdelegate get_chunk_end_log_offset(offset, opts), to: PureFileStorage
  defdelegate cleanup!(opts), to: PureFileStorage
  defdelegate cleanup!(opts, shape_handle), to: PureFileStorage
  defdelegate cleanup_all!(opts), to: PureFileStorage
  defdelegate terminate(opts), to: PureFileStorage
  defdelegate hibernate(opts), to: PureFileStorage
  defdelegate compact(opts, keep_complete_chunks), to: PureFileStorage

  defp stack_agent_name(opts) do
    Electric.ProcessRegistry.name(opts, __MODULE__, :agent)
  end

  def stack_start_link(opts) do
    {:ok, _agent} = Agent.start_link(fn -> 0 end, name: stack_agent_name(opts))
    PureFileStorage.stack_start_link(opts)
  end

  def shared_opts(opts) do
    opts
    |> PureFileStorage.shared_opts()
    |> Map.put(:extra_opts, %{num_calls_until_crash: Keyword.fetch!(opts, :num_calls_until_crash)})
  end

  def init_writer!(opts, shape_definition, _storage_recovery_state) do
    Agent.update(stack_agent_name(opts), fn _ -> opts.extra_opts.num_calls_until_crash end)
    PureFileStorage.init_writer!(opts, shape_definition)
  end

  def append_to_log!(log_items, opts) do
    num_calls_until_crash = Agent.get(stack_agent_name(opts), & &1)

    if num_calls_until_crash == 0 do
      Agent.update(stack_agent_name(opts), fn _ -> opts.extra_opts.num_calls_until_crash end)
      raise "Simulated storage failure"
    end

    Agent.update(stack_agent_name(opts), fn n -> n - 1 end)

    PureFileStorage.append_to_log!(log_items, opts)
  end
end
