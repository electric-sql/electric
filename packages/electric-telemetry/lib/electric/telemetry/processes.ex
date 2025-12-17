defmodule ElectricTelemetry.Processes do
  @default_count 5
  # Minimum memory threshold for a process group when using :mem_percent mode.
  @min_group_memory 1024 * 1024

  @type limit :: {:count, pos_integer()} | {:mem_percent, 1..100}

  defguardp is_valid_mem_percent(percent)
            when is_integer(percent) and percent >= 1 and percent <= 100

  def validate_mem_percent(percent) do
    if is_valid_mem_percent(percent) do
      {:ok, percent}
    else
      {:error, "mem_percent value must be between 1 and 100, got: #{inspect(percent)}"}
    end
  end

  def proc_type(pid), do: proc_type(pid, info(pid))

  def top_memory_by_type do
    top_memory_by_type(Process.list(), {:count, @default_count})
  end

  def top_memory_by_type({_, _} = limit) do
    top_memory_by_type(Process.list(), limit)
  end

  def top_memory_by_type(process_list) when is_list(process_list) do
    top_memory_by_type(process_list, {:count, @default_count})
  end

  def top_memory_by_type(process_list, {:count, count})
      when is_list(process_list) and is_integer(count) and count > 0 do
    process_list
    |> sorted_groups()
    |> Enum.take(count)
  end

  def top_memory_by_type(process_list, {:mem_percent, percent})
      when is_list(process_list) and is_valid_mem_percent(percent) do
    # :processes_used excludes memory allocated but not yet used by process heaps,
    # giving a more accurate baseline for the percentage calculation.
    total_process_memory = :erlang.memory(:processes_used)
    target = total_process_memory * percent / 100

    process_list
    |> sorted_groups()
    |> take_until_target(target)
  end

  defp sorted_groups(process_list) do
    process_list
    |> Enum.map(&type_and_memory/1)
    |> Enum.reject(&(&1.type == :dead))
    |> Enum.group_by(& &1.type)
    |> Enum.map(fn {type, proc_infos} ->
      proc_infos
      |> mem_stats_for_procs()
      |> Map.put(:type, type)
    end)
    |> Enum.sort_by(&(-&1.proc_mem))
  end

  defp take_until_target(proc_groups, target) do
    {_running_total, selected_groups} =
      Enum.reduce_while(proc_groups, {0, []}, fn
        _proc_group, {running_total, acc} when running_total >= target ->
          {:halt, {running_total, acc}}

        proc_group, {running_total, acc} when proc_group.memory < @min_group_memory ->
          # Include this last process group in the result so it's clear to the caller that the
          # minimum group memory threshold has been reached earlier than the target total mem
          # one.
          {:halt, {running_total, [proc_group | acc]}}

        proc_group, {running_total, acc} ->
          {:cont, {running_total + proc_group.proc_mem, [proc_group | acc]}}
      end)

    Enum.reverse(selected_groups)
  end

  defp mem_stats_for_procs(proc_infos) when is_list(proc_infos) do
    {proc_mem, binary_mem, ref_count_sum, num_binaries, num_procs} =
      Enum.reduce(proc_infos, {0, 0, 0, 0, 0}, fn map,
                                                  {proc_mem, binary_mem, ref_count_sum,
                                                   num_binaries, num_procs} ->
        {
          proc_mem + map.proc_mem,
          binary_mem + map.binary_mem,
          ref_count_sum + map.ref_count_sum,
          num_binaries + map.num_binaries,
          num_procs + 1
        }
      end)

    %{
      proc_mem: proc_mem,
      binary_mem: binary_mem,
      avg_bin_count: num_binaries / num_procs,
      avg_ref_count: if(num_binaries == 0, do: 0, else: ref_count_sum / num_binaries)
    }
  end

  defp type_and_memory(pid) do
    info = info(pid)

    info
    |> memory_from_info()
    |> Map.put(:type, proc_type(pid, info))
  end

  defp info(pid) do
    Process.info(pid, [:dictionary, :initial_call, :label, :memory, :binary])
  end

  defp proc_type(pid, info) do
    label_from_info(info) ||
      initial_module_from_info(info) ||
      if(Process.alive?(pid), do: :unknown, else: :dead)
  end

  defp label_from_info(info) do
    case info[:label] do
      :undefined -> nil
      {name, _} -> name
      {name, _, _} -> name
      name when is_atom(name) -> name
      name when is_binary(name) -> parse_binary_label(name)
      _ -> nil
    end
  end

  defp initial_module_from_info(info) do
    case get_in(info, [:dictionary, :"$initial_call"]) do
      {module, _function, _arg_count} ->
        module

      _ ->
        case info[:initial_call] do
          {module, _function, _arg_count} -> module
          nil -> nil
        end
    end
  end

  defp memory_from_info(info) do
    memory =
      case info[:memory] do
        bytes when is_integer(bytes) -> bytes
        _ -> 0
      end

    case info[:binary] do
      list when is_list(list) ->
        {binary_mem, {ref_sum, num_entries}} =
          Enum.reduce(list, {0, {0, 0}}, fn {_reference, size, ref_count},
                                            {total_size, {ref_sum, num_entries}} ->
            {total_size + size, {ref_sum + ref_count, num_entries + 1}}
          end)

        %{
          proc_mem: memory,
          binary_mem: binary_mem,
          ref_count_sum: ref_sum,
          num_binaries: num_entries
        }

      _ ->
        %{proc_mem: memory}
    end
  end

  defp parse_binary_label(label) do
    case label do
      "Request " <> <<_req_id::binary-20, " - ", rest::binary>> ->
        # This is a request process with the label assigned by Electric.Plug.LabelProcessPlug.
        # We group all requests together to be able to see their aggregated mem footprint.

        # Cut off the URL query part, leaving only the `<method> <path>` prefix.
        part_len =
          case :binary.match(rest, "?") do
            {pos, _} ->
              pos

            :nomatch ->
              # No query string means only path is present. It is either a request to the health endpoint or something unexpected.
              byte_size(rest)
          end

        :binary.part(rest, 0, part_len)

      _ ->
        # Opportunistic grouping by truncating long labels.
        part_len = min(20, byte_size(label))
        :binary.part(label, 0, part_len)
    end
  end
end
