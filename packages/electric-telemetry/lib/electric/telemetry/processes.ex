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
    |> Enum.group_by(& &1.type, & &1.memory)
    |> Enum.map(fn {type, memory} -> %{type: type, memory: Enum.sum(memory)} end)
    |> Enum.sort_by(&(-&1.memory))
    |> Enum.take(count)
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
