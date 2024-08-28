defmodule Electric.PersistentKV.Serialized do
  @moduledoc """
  An implementation of PersistentKV that writes values serialised as JSON to the kv `backend`.
  """
  alias Electric.PersistentKV

  defstruct [:backend, encoder: {Jason, :encode, []}, decoder: {Jason, :decode, []}]

  def new!(opts) do
    struct(__MODULE__, opts)
  end

  defimpl Electric.PersistentKV do
    def set(kv, key, value) do
      with {:ok, json} <- encode(kv, value) do
        PersistentKV.set(kv.backend, key, json)
      end
    end

    def get(kv, key) do
      with {:ok, json} <- PersistentKV.get(kv.backend, key) do
        decode(kv, json)
      end
    end

    defp encode(%{encoder: {m, f, a}}, term) do
      apply(m, f, [term | a])
    end

    defp decode(%{decoder: {m, f, a}}, json) do
      apply(m, f, [json | a])
    end
  end
end
