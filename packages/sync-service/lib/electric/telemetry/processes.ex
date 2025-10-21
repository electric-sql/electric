defmodule Electric.Telemetry.Processes do
  require Record

  @default_count 5

  @type retval :: %{type: term(), memory: pos_integer()}

  # A record that keeps process type and memory, used as intermediate represenation while
  # collecting the top N process types by memory.
  Record.defrecordp(:proc_mem, [:type, :memory])

  @spec proc_type(pid) :: Module.t() | :unknown | :dead | atom() | binary()
  def proc_type(pid), do: proc_type(pid, info(pid))

  @spec top_memory_by_type() :: retval()
  @spec top_memory_by_type(Enumerable.t() | pos_integer()) :: retval()
  @spec top_memory_by_type(Enumerable.t(), pos_integer()) :: retval()

  def top_memory_by_type, do: top_memory_by_type(@default_count)

  def top_memory_by_type(procs) when is_list(procs) do
    procs
    |> Stream.map(&pid_to_proc_mem/1)
    |> top_memory_by_type(@default_count)
  end

  def top_memory_by_type(count) when is_integer(count) do
    proc_stream(&pid_to_proc_mem/1)
    |> top_memory_by_type(count)
  end

  def top_memory_by_type(procs, count) when is_integer(count) and count > 0 do
    procs
    |> Stream.reject(&(proc_mem(&1, :type) == :dead))
    |> Enum.group_by(&proc_mem(&1, :type), &proc_mem(&1, :memory))
    |> keep_top_n(&memory_sum/1, count)
  end

  defp memory_sum({type, memory_list}) do
    memory = Enum.sum(memory_list)
    {proc_mem(type: type, memory: memory), memory}
  end

  defp keep_top_n(enumerable, trans_fun, n) do
    # Populate the initial accumulator by taking N first items from the list and sorting them.
    {first_n, rest} = Enum.split(enumerable, n)
    first_n = first_n |> Enum.map(trans_fun) |> Enum.sort_by(fn {_, mem} -> mem end, :desc)

    # For the remaining items, try to find a place in the first N positions of the accumulator.
    # The accumulator may grow beyond N because items are inserted at the front without
    # dropping the tail (to minimize the number of traversals), so we just take the needed
    # number of items from the accumulator in the end.
    rest
    |> Stream.map(trans_fun)
    |> Enum.reduce(first_n, fn item, acc -> insert_into_sorted(item, acc, n) end)
    |> Enum.take(n)
    |> Enum.map(fn {rec, _} -> %{type: proc_mem(rec, :type), memory: proc_mem(rec, :memory)} end)
  end

  defp insert_into_sorted(item, acc, limit), do: insert_into_sorted(item, acc, 0, limit)

  # If the item is no greater than the first `limit` elements in `acc`, drop it.
  defp insert_into_sorted(_item, acc, pos, limit) when pos == limit, do: acc

  # Find the right position for `item` within the first `limit` elements of the accumulator.
  defp insert_into_sorted({_, item_mem} = item, [{_, h_mem} = h | t], pos, limit) do
    if item_mem > h_mem do
      [item, h | t]
    else
      [h | insert_into_sorted(item, t, pos + 1, limit)]
    end
  end

  # A stream that iterates over all processes in the VM and calls `fun` on each.
  defp proc_stream(fun) do
    Stream.unfold(:erlang.processes_iterator(), fn iter ->
      case :erlang.processes_next(iter) do
        :none -> nil
        {pid, iter} -> {fun.(pid), iter}
      end
    end)
  end

  defp pid_to_proc_mem(pid) do
    info = info(pid)
    proc_mem(type: proc_type(pid, info), memory: memory_from_info(info))
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
