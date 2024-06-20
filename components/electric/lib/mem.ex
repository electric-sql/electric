defmodule Mem do
  def observer do
    # Mix.ensure_application!(:observer)
    :observer.start()
  end

  def global do
    :erlang.memory()
    |> size_pretty()
  end

  def processes_summary do
    Process.list()
    |> Enum.map(fn pid ->
      Process.info(pid, [:total_heap_size, :stack_size, :memory])
      |> Map.new()
    end)
    |> sum_all()
  end

  def top_processes do
    process_list()
    |> Enum.take(20)
    |> Enum.each(fn p ->
      IO.puts("#{inspect(p.pid)}\t#{inspect(p.label)}\t#{size_pretty(p.memory)}")
    end)
  end

  def top_pid do
    process_list()
    |> hd
    |> Map.get(:pid)
  end

  def process_memory(pid) do
    info =
      Process.info(pid, [:total_heap_size, :message_queue_len, :memory, :stack_size, :binary])
      |> Map.new()

    %{
      process_label: :proc_lib.get_label(pid),
      total: size_pretty(info.memory),
      heap: words_to_size_pretty(info.total_heap_size),
      stack: words_to_size_pretty(info.stack_size),
      state: term_to_size_pretty(state(pid)),
      binary:
        info.binary
        |> Enum.map(fn {_bin_id, size, _ref_count} -> size end)
        |> Enum.sum()
        |> size_pretty()
      # probably not words as that sometimes becomes greater that total memory
    }
  end

  def state_memory(pid, depth \\ 1), do: pid |> state() |> term_memory(depth)

  def state(pid) do
    :sys.get_state(pid)
  end

  def term_memory(term, depth \\ 1)

  def term_memory(term, 0 = _depth), do: term_to_size_pretty(term)

  def term_memory({x, y} = term, depth) do
    {term_memory(x, depth - 1), term_memory(y, depth - 1), [_total: term_to_size_pretty(term)]}
  end

  def term_memory(struct, depth) when is_struct(struct) do
    struct
    |> Map.from_struct()
    |> term_memory(depth)
    |> Enum.concat(_struct: struct.__struct__)
  end

  def term_memory(%{} = map, depth) do
    map
    |> Enum.sort_by(fn {_, value} -> -:erts_debug.flat_size(value) end)
    |> Enum.map(fn {key, value} -> {key, term_memory(value, depth - 1)} end)
    |> Enum.concat(_total: term_to_size_pretty(map))
  end

  def term_memory(term, _), do: term_to_size_pretty(term)

  def process_list do
    Process.list()
    |> Enum.map(fn pid ->
      Process.info(pid, [:initial_call, :total_heap_size, :message_queue_len, :memory])
      |> Map.new()
      |> Map.merge(%{pid: pid, label: :proc_lib.get_label(pid)})
    end)
    |> Enum.sort_by(&(-&1.memory))
  end

  def size_pretty(list) when is_list(list) do
    for {key, bytes} <- list do
      {key, size_pretty(bytes)}
    end
  end

  def size_pretty(bytes) when bytes < 1042, do: "#{bytes} B"
  def size_pretty(bytes) when bytes < 1042 * 1024, do: "#{round(bytes / 1024)} kB"
  def size_pretty(bytes) when bytes < 1042 * 1024 * 1024, do: "#{round(bytes / 1024 / 1024)} MB"
  def size_pretty(bytes), do: "#{round(bytes / 1024 / 1024 / 1024)} GB"

  def words_to_size_pretty(words) do
    size_pretty(words * :erlang.system_info(:wordsize))
  end

  def term_to_size_pretty(term) do
    "#{term |> :erts_debug.flat_size() |> words_to_size_pretty()} (flattened)"
  end

  def sum_all([first | _] = list) do
    for key <- Map.keys(first), into: %{} do
      {key, list |> Enum.map(&Map.get(&1, key)) |> Enum.sum() |> size_pretty()}
    end
  end

  def gc(pid) do
    :erlang.garbage_collect(pid)
  end
end
