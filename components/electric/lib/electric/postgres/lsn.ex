defmodule Electric.Postgres.Lsn do
  @moduledoc """
  Encoding, decoding and helper functions for the pg_lsn type.
  """

  import Kernel, except: [to_charlist: 1, to_string: 1]

  alias __MODULE__, as: Lsn

  defstruct segment: 0, offset: 0

  @type int32 :: 0..0xFFFFFFFF
  @type t :: %Lsn{
          segment: int32(),
          offset: int32()
        }

  @doc """
  Format Lsn to its text representation in an iolist.

  ## Examples

      iex> to_iolist(%#{Lsn}{segment: 0, offset: 0})
      ["0", ?/, "0"]

      iex> to_iolist(%#{Lsn}{segment: 127, offset: 1024})
      ["7F", ?/, "400"]
  """
  @spec to_iolist(t) :: iolist
  def to_iolist(%Lsn{segment: segment, offset: offset}) do
    [Integer.to_string(segment, 16), ?/, Integer.to_string(offset, 16)]
  end

  @doc """
  Parse the given string as a pg_lsn value.

  ## Examples

      iex> from_string("0/0")
      %#{Lsn}{segment: 0, offset: 0}

      iex> from_string("7F/400")
      %#{Lsn}{segment: 127, offset: 1024}
  """
  @spec from_string(String.t()) :: t
  def from_string(str) when is_binary(str) do
    [segment, offset] = String.split(str, "/")
    %Lsn{segment: String.to_integer(segment, 16), offset: String.to_integer(offset, 16)}
  end

  @doc """
  Convert the non-negative byte offset into Lsn.

  ## Examples

      iex> from_integer(0)
      %#{Lsn}{segment: 0, offset: 0}

      iex> from_integer(1_000_000)
      %#{Lsn}{segment: 0, offset: 1_000_000}

      iex> from_integer(0xFFFFFFFF)
      %#{Lsn}{segment: 0, offset: 4294967295}

      iex> from_integer(0xFFFFFFFFF)
      %#{Lsn}{segment: 15, offset: 4294967295}

      iex> from_integer(-1)
      ** (FunctionClauseError) no function clause matching in Electric.Postgres.Lsn.from_integer/1
  """
  @spec from_integer(non_neg_integer) :: t
  def from_integer(int) when is_integer(int) and int >= 0 do
    <<segment::32, offset::32>> = <<int::64>>
    %Lsn{segment: segment, offset: offset}
  end

  @doc """
  Convert the Lsn into an equivalent byte offset.

  ## Examples

      iex> to_integer(%#{Lsn}{segment: 0, offset: 0})
      0

      iex> to_integer(%#{Lsn}{segment: 0, offset: 1_000_000})
      1_000_000

      iex> to_integer(%#{Lsn}{segment: 0, offset: 4294967295})
      0xFFFFFFFF

      iex> to_integer(%#{Lsn}{segment: 15, offset: 4294967295})
      0xFFFFFFFFF
  """
  @spec to_integer(t) :: non_neg_integer
  def to_integer(%Lsn{segment: segment, offset: offset}) do
    <<int::64>> = <<segment::32, offset::32>>
    int
  end

  @spec decode_bin(binary) :: t
  def decode_bin(<<segment::32, offset::32>>), do: %Lsn{segment: segment, offset: offset}

  @spec encode_bin(t) :: binary
  def encode_bin(%Lsn{segment: segment, offset: offset}), do: <<segment::32, offset::32>>

  @doc """
  Compare two Lsns and determine if one is less or greater or both are equal.

  ## Examples

      iex> compare(from_integer(0), from_integer(1))
      :lt

      iex> compare(from_integer(99), from_integer(98))
      :gt

      iex> compare(from_integer(127_000_256), from_string("0/791DEC0"))
      :eq
  """
  @spec compare(t, t) :: :eq | :gt | :lt
  def compare(%Lsn{segment: s1}, %Lsn{segment: s2}) when s1 < s2, do: :lt
  def compare(%Lsn{segment: s1}, %Lsn{segment: s2}) when s1 > s2, do: :gt
  def compare(%Lsn{offset: o1}, %Lsn{offset: o2}) when o1 < o2, do: :lt
  def compare(%Lsn{offset: o1}, %Lsn{offset: o2}) when o1 > o2, do: :gt
  def compare(%Lsn{offset: o1}, %Lsn{offset: o2}) when o1 == o2, do: :eq

  @max_offset 0xFFFFFFFF

  @doc """
  Add the given byte offset to the Lsn value.

  The result is capped at the bottom to not go below #Lsn<0/0>.

  ## Examples

      iex> increment(from_integer(0), 8_000_000)
      %#{Lsn}{segment: 0, offset: 8_000_000}

      iex> increment(from_integer(4_000_000_000), 1_000_000_000)
      %#{Lsn}{segment: 1, offset: 705_032_704}

      iex> to_integer(%#{Lsn}{segment: 1, offset: 705_032_704})
      5_000_000_000

      iex> increment(from_integer(4_000_000_000), 10_000_000_000)
      %#{Lsn}{segment: 3, offset: 1_115_098_112}

      iex> to_integer(%#{Lsn}{segment: 3, offset: 1_115_098_112})
      14_000_000_000

      iex> increment(from_integer(14_000_000_000), -8_000_000_000)
      %#{Lsn}{segment: 1, offset: 1_705_032_704}

      iex> increment(from_integer(100), -99)
      %#{Lsn}{segment: 0, offset: 1}

      iex> increment(from_integer(100), -100)
      %#{Lsn}{segment: 0, offset: 0}

      iex> increment(from_integer(100), -101)
      %#{Lsn}{segment: 0, offset: 0}
  """
  @spec increment(t, integer) :: t
  def increment(%Lsn{segment: segment, offset: offset}, incr)
      when (offset + incr) in 0..@max_offset,
      do: %Lsn{segment: segment, offset: offset + incr}

  def increment(%Lsn{segment: segment, offset: offset}, incr) when offset + incr > @max_offset do
    sum = offset + incr
    %Lsn{segment: segment + div(sum, @max_offset + 1), offset: rem(sum, @max_offset + 1)}
  end

  def increment(%Lsn{} = lsn, incr) do
    lsn
    |> to_integer()
    |> Kernel.+(incr)
    |> max(0)
    |> from_integer()
  end

  defimpl Inspect do
    def inspect(lsn, _opts) do
      "#Lsn<#{Electric.Postgres.Lsn.to_iolist(lsn)}>"
    end
  end

  defimpl String.Chars do
    def to_string(lsn), do: "#{Electric.Postgres.Lsn.to_iolist(lsn)}"
  end

  defimpl List.Chars do
    def to_charlist(lsn), do: ~c'#{Electric.Postgres.Lsn.to_iolist(lsn)}'
  end
end
