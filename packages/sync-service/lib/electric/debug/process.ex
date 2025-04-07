defmodule Electric.Debug.Process do
  @default_count 5

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
    |> Enum.reject(&is_dead_or_nil/1)
    |> Enum.group_by(& &1.type, & &1.memory)
    |> Enum.map(fn {type, memory} -> %{type: type, memory: Enum.sum(memory)} end)
    |> Enum.sort_by(&(-&1.memory))
    |> Enum.take(count)
  end

  defp type_and_memory(pid) do
    case type(pid) do
      :dead ->
        %{type: :dead, memory: 0}

      type ->
        case Process.info(pid, [:memory]) do
          [memory: memory] when is_integer(memory) ->
            %{type: type, memory: memory}

          _ ->
            %{type: :dead, memory: 0}
        end
    end
  end

  def type(pid) do
    with :error <- process_type_if_dead(pid),
         :error <- process_label(pid),
         :error <- initial_module(pid) do
      :unknown
    end
  end

  defp process_type_if_dead(pid) do
    if Process.alive?(pid) do
      :error
    else
      :dead
    end
  end

  defp process_label(pid) do
    case :proc_lib.get_label(pid) do
      :undefined -> :error
      {name, _} -> name
      {name, _, _} -> name
      name when is_atom(name) -> name
      name when is_binary(name) -> name
      _ -> :error
    end
  end

  defp initial_module(pid) do
    [dictionary: dictionary] = Process.info(pid, [:dictionary])

    dictionary
    |> Map.new()
    |> Map.get(:"$initial_call")
    |> case do
      {module, _function, _arg_count} ->
        module

      _ ->
        initial_module_from_info(pid)
    end
  end

  defp initial_module_from_info(pid) do
    case Process.info(pid, [:initial_call]) do
      [initial_call: {module, _function, _arg_count}] -> module
      nil -> :error
    end
  end

  defp is_dead_or_nil(nil), do: true
  defp is_dead_or_nil(%{type: :dead}), do: true
  defp is_dead_or_nil(_), do: false
end
