defmodule Electric.Satellite.Lsn do
  @moduledoc """
  Representation of the Satellite log sequence number
  """
  defstruct [:offset]

  @type t :: %__MODULE__{
          offset: non_neg_integer()
        }

  def compare(%__MODULE__{offset: o1}, %__MODULE__{offset: o2}) when o1 < o2, do: :lt
  def compare(%__MODULE__{offset: o1}, %__MODULE__{offset: o2}) when o1 > o2, do: :gt
  def compare(%__MODULE__{offset: o1}, %__MODULE__{offset: o2}) when o1 == o2, do: :eq
end
