defmodule Electric.ShapeCache.CrashingFileStorage do
  @moduledoc """
  A thing wrapper module around FileStorage that can be configured to raise an error after a
  certain number of writes.
  """
  alias Electric.ShapeCache.FileStorage

  @behaviour Electric.ShapeCache.Storage

  @num_calls_until_crash_key :num_calls_until_crash

  defdelegate for_shape(shape_id, tenant_id, opts), to: FileStorage
  defdelegate start_link(opts), to: FileStorage
  defdelegate set_shape_definition(shape, opts), to: FileStorage
  defdelegate get_all_stored_shapes(opts), to: FileStorage
  defdelegate get_current_position(opts), to: FileStorage
  defdelegate set_snapshot_xmin(xmin, opts), to: FileStorage
  defdelegate snapshot_started?(opts), to: FileStorage
  defdelegate get_snapshot(opts), to: FileStorage
  defdelegate make_new_snapshot!(data_stream, opts), to: FileStorage
  defdelegate mark_snapshot_as_started(opts), to: FileStorage
  defdelegate get_log_stream(offset, max_offset, opts), to: FileStorage
  defdelegate get_chunk_end_log_offset(offset, opts), to: FileStorage
  defdelegate cleanup!(opts), to: FileStorage

  def shared_opts(opts) do
    opts
    |> FileStorage.shared_opts()
    |> Map.put(:extra_opts, %{num_calls_until_crash: Keyword.fetch!(opts, :num_calls_until_crash)})
  end

  def initialise(opts) do
    CubDB.put(opts.db, @num_calls_until_crash_key, opts.extra_opts.num_calls_until_crash)
    FileStorage.initialise(opts)
  end

  def append_to_log!(log_items, opts) do
    num_calls_until_crash = CubDB.get(opts.db, @num_calls_until_crash_key)

    action =
      if num_calls_until_crash == 0 do
        CubDB.put(opts.db, @num_calls_until_crash_key, opts.extra_opts.num_calls_until_crash)
        :crash!
      else
        CubDB.put(opts.db, @num_calls_until_crash_key, num_calls_until_crash - 1)
        nil
      end

    if action == :crash! do
      raise "Simulated storage failure"
    end

    FileStorage.append_to_log!(log_items, opts)
  end
end
