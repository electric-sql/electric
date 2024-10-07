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

    def get_all(kv) do
      with {:ok, data} <- PersistentKV.get_all(kv.backend) do
        Enum.reduce_while(data, {:ok, %{}}, fn {k, v}, {:ok, acc} ->
          case decode(kv, v) do
            {:ok, decoded_v} ->
              {:cont, {:ok, Map.put(acc, k, decoded_v)}}

            {:error, reason} ->
              {:halt, {:error, reason}}
          end
        end)
      end
    end

    def delete(kv, key) do
      PersistentKV.delete(kv.backend, key)
    end

    defp encode(%{encoder: {m, f, a}}, term) do
      apply(m, f, [term | a])
    end

    defp decode(%{decoder: {m, f, a}}, json) do
      apply(m, f, [json | a])
    end
  end
end
