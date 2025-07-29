defmodule Electric.Debug.Process do
  @default_count 5

  def type(pid), do: process_type(pid, info(pid))

  def top_reduction_rate_per_type(duration \\ 50) do
    pids = Process.list()
    types = Enum.map(pids, &type/1)

    start =
      Enum.map(pids, fn pid ->
        time = System.monotonic_time(:microsecond)

        case Process.info(pid, :reductions) do
          {:reductions, reductions} ->
            {time, reductions}

          _ ->
            {time, nil}
        end
      end)

    Process.sleep(duration)

    finish =
      Enum.map(pids, fn pid ->
        time = System.monotonic_time(:microsecond)

        case Process.info(pid, :reductions) do
          {:reductions, reductions} ->
            {time, reductions}

          _ ->
            {time, nil}
        end
      end)

    Enum.zip([pids, types, start, finish])
    |> Enum.reject(fn
      {_, nil, {_, _}, {_, _}} ->
        true

      {_, _, {_, nil}, {_, _}} ->
        true

      {_, _, {_, _}, {_, nil}} ->
        true

      _ ->
        false
    end)
    |> Enum.map(fn {pid, type, {start_time, start_reductions}, {finish_time, finish_reductions}} ->
      reductions = finish_reductions - start_reductions
      time = finish_time - start_time

      %{
        type: type,
        pid: pid,
        time: time,
        reductions: reductions,
        reduction_rate: 1000 * 1000 * reductions / time
      }
    end)
    |> Enum.sort_by(&(-&1.reduction_rate))

    # |> Enum.take(count)
  end

  def group(list, count \\ 5) do
    list
    |> Enum.group_by(& &1.type, & &1.reduction_rate)
    |> Enum.map(fn {t, rs} -> {t, Enum.sum(rs)} end)
    |> Enum.sort_by(fn {_, r} -> -r end)
    |> Enum.take(count)
  end

  def sum(list) do
    list
    |> Enum.map(& &1.reduction_rate)
    |> Enum.sum()
  end

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
    %{type: process_type(pid, info), memory: memory_from_info(info)}
  end

  defp info(pid) do
    Process.info(pid, [:dictionary, :initial_call, :label, :memory, :reductions])
  end

  defp process_type(pid, info) do
    type =
      label_from_info(info) ||
        initial_module_from_info(info) ||
        if(Process.alive?(pid), do: :unknown, else: :dead)

    if is_binary(type) && String.starts_with?(type, "Request ") do
      :request
    else
      type
    end
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
    case info[:memory] do
      bytes when is_integer(bytes) -> bytes
      _ -> 0
    end
  end
end

alias Electric.Debug.Process, as: P
