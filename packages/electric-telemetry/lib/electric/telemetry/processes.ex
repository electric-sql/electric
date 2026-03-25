defmodule ElectricTelemetry.Processes do
  @default_count 5
  # Minimum memory threshold for a process group when using :mem_percent mode.
  @min_group_memory 1024 * 1024

  @type limit :: {:count, pos_integer()} | {:mem_percent, 1..100}

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
      when is_list(process_list) and is_integer(percent) and percent >= 1 and percent <= 100 do
    # :processes_used excludes memory allocated but not yet used by process heaps,
    # giving a more accurate baseline for the percentage calculation.
    total_process_memory = :erlang.memory(:processes_used)
    target = div(total_process_memory * percent, 100)

    process_list
    |> sorted_groups()
    |> take_until_target(target, 0, [])
  end

  defp sorted_groups(process_list) do
    process_list
    |> Enum.map(&type_and_memory/1)
    |> Enum.reject(&(&1.type == :dead))
    |> Enum.group_by(& &1.type, & &1.memory)
    |> Enum.map(fn {type, memory} -> %{type: type, memory: Enum.sum(memory)} end)
    |> Enum.sort_by(&(-&1.memory))
  end

  defp take_until_target([], _target, _running_total, acc), do: Enum.reverse(acc)

  defp take_until_target([group | rest], target, running_total, acc) do
    if group.memory < @min_group_memory do
      Enum.reverse(acc)
    else
      new_total = running_total + group.memory
      new_acc = [group | acc]

      if new_total >= target do
        Enum.reverse(new_acc)
      else
        take_until_target(rest, target, new_total, new_acc)
      end
    end
  end

  defp type_and_memory(pid) do
    info = info(pid)
    %{type: proc_type(pid, info), memory: memory_from_info(info)}
  end

  defp info(pid) do
    Process.info(pid, [:dictionary, :initial_call, :label, :memory])
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
    case info[:memory] do
      bytes when is_integer(bytes) -> bytes
      _ -> 0
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
            {pos, _} -> pos
            :nomatch -> min(20, byte_size(rest))
          end

        :binary.part(rest, 0, part_len)

      _ ->
        # Opportunistic grouping by truncating long labels.
        part_len = min(20, byte_size(label))
        :binary.part(label, 0, part_len)
    end
  end
end
