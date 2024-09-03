defmodule Electric.PersistentKV.Mock do
  defstruct []

  @type t() :: %__MODULE__{}

  @spec new() :: t()
  def new() do
    %__MODULE__{}
  end

  defimpl Electric.PersistentKV do
    def set(_memory, _key, _value) do
      :ok
    end

    def get(_memory, _key) do
      {:ok, 42}
    end
  end
end
