defmodule Electric.Postgres.Lsn do
  @moduledoc """
  Representation of the Postgres log sequence number.
  """
  defstruct [:segment, :offset]

  @type int32 :: 0..0xFFFFFFFF
  @type t :: %__MODULE__{
          segment: int32(),
          offset: int32()
        }

  def to_string(%__MODULE__{segment: segment, offset: offset}),
    do: Integer.to_string(segment, 16) <> "/" <> Integer.to_string(offset, 16)

  def from_string(x) when is_binary(x) do
    [segment, offset] = String.split(x, "/")
    %__MODULE__{segment: String.to_integer(segment, 16), offset: String.to_integer(offset, 16)}
  end

  def from_integer(x) when is_integer(x) do
    <<segment::32, offset::32>> = <<x::64>>
    %__MODULE__{segment: segment, offset: offset}
  end

  def to_integer(%__MODULE__{segment: s, offset: o}) do
    <<i::64>> = <<s::32, o::32>>
    i
  end

  def compare(%{segment: s1}, %{segment: s2}) when s1 < s2, do: :lt
  def compare(%{segment: s1}, %{segment: s2}) when s1 > s2, do: :gt
  def compare(%{offset: o1}, %{offset: o2}) when o1 < o2, do: :lt
  def compare(%{offset: o1}, %{offset: o2}) when o1 > o2, do: :gt
  def compare(%{offset: o1}, %{offset: o2}) when o1 == o2, do: :eq

  def increment(lsn, step \\ 10)

  def increment(%__MODULE__{segment: s, offset: o}, step) when o + step < 0xFFFFFFFF,
    do: %__MODULE__{segment: s, offset: o + step}

  def increment(%__MODULE__{segment: s, offset: o}, step),
    do: %__MODULE__{segment: s + 1, offset: rem(o + step, 0xFFFFFFFF)}

  defimpl Inspect do
    alias Electric.Postgres.Lsn

    def inspect(%Lsn{segment: segment, offset: offset}, _opts) do
      "#Lsn<#{Integer.to_string(segment, 16)}/#{Integer.to_string(offset, 16)}>"
    end
  end

  defimpl String.Chars do
    alias Electric.Postgres.Lsn
    def to_string(lsn), do: Lsn.to_string(lsn)
  end
end
