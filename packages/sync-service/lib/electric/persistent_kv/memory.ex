defmodule Electric.PersistentKV.Memory do
  use Agent

  defstruct [:pid]

  def new!(data \\ []) do
    {:ok, pid} = start_link(data)
    %__MODULE__{pid: pid}
  end

  def start_link(data \\ []) do
    Agent.start_link(fn ->
      data
      |> Enum.to_list()
      |> List.flatten()
      |> Enum.reduce(%{}, fn {k, v}, m ->
        Map.put(m, k, v)
      end)
    end)
  end

  def contents(s) do
    s.pid
    |> Agent.get(& &1)
    |> Enum.sort_by(&elem(&1, 0))
  end

  defimpl Electric.PersistentKV do
    def set(memory, key, value) do
      Agent.update(memory.pid, fn data ->
        Map.put(data, key, value)
      end)
    end

    def get(memory, key) do
      case Agent.get(memory.pid, &Map.fetch(&1, key)) do
        {:ok, data} ->
          {:ok, data}

        :error ->
          {:error, :not_found}
      end
    end
  end
end
