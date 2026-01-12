defmodule ElectricTelemetry.Processes do
  @default_count 5

  def proc_type(pid), do: proc_type(pid, info(pid))

  def top_memory_by_type do
    top_memory_by_type(Process.list(), @default_count)
  end

  def top_memory_by_type(count) when is_integer(count) do
    top_memory_by_type(Process.list(), count)
  end

  def top_memory_by_type(process_list) when is_list(process_list) do
    top_memory_by_type(process_list, @default_count)
  end

  def top_memory_by_type(process_list, count)
      when is_list(process_list) and is_integer(count) and count > 0 do
    process_list
    |> Enum.map(&type_and_memory/1)
    |> Enum.reject(&(&1.type == :dead))
    |> Enum.group_by(& &1.type)
    |> Enum.map(fn {type, list_of_maps} ->
      {proc_mem, binary_mem, ref_count_sum, num_binaries, num_procs} =
        Enum.reduce(list_of_maps, {0, 0, 0, 0, 0}, fn map,
                                                      {proc_mem, binary_mem, ref_count_sum,
                                                       num_binaries, num_procs} ->
          {proc_mem + map.proc_mem, binary_mem + map.binary_mem,
           ref_count_sum + map.ref_count_sum, num_binaries + map.num_binaries, num_procs + 1}
        end)

      %{
        type: type,
        proc_mem: proc_mem,
        binary_mem: binary_mem,
        avg_bin_count: num_binaries / num_procs,
        avg_ref_count: if(num_binaries == 0, do: 0, else: ref_count_sum / num_binaries)
      }
    end)
    |> Enum.sort_by(&(-&1.proc_mem))
    |> Enum.take(count)
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
      name when is_binary(name) -> name
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
end
