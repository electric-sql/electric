defmodule Electric.Shapes.Consumer.EffectList do
  @moduledoc false

  alias Electric.Shapes.Consumer.Effects

  @opaque t() :: [Effects.t()]

  @spec new([Effects.t()]) :: t()
  def new(effects \\ []) when is_list(effects), do: Enum.reverse(effects)

  @spec append(t(), Effects.t()) :: t()
  def append(acc, %_{} = effect), do: [effect | acc]

  @spec append_all(t(), [Effects.t()]) :: t()
  def append_all(acc, effects) when is_list(effects), do: Enum.reverse(effects, acc)

  @spec to_list(t()) :: [Effects.t()]
  def to_list(acc), do: Enum.reverse(acc)
end
