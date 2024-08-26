defmodule Electric.PersistentKV.Memory do
  use Agent

  defstruct [:pid, :parent]

  @type t() :: %__MODULE__{pid: pid(), parent: pid()}

  @type seed_data() :: [{binary(), term()}] | %{binary() => term()}

  @spec new!(seed_data()) :: t()
  def new!(data \\ []) do
    {:ok, pid} = start_link(data)
    %__MODULE__{pid: pid, parent: self()}
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
        notify(memory, {:set, key, value})
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

    defp notify(%{parent: parent}, msg) when is_pid(parent) do
      send(parent, {Electric.PersistentKV.Memory, msg})
    end
  end
end
