defmodule Electric.Replication.LogOffset do
  alias Electric.Postgres.Lsn

  @moduledoc """
  Uniquely identifies an operation inside the shape log.
  Combines a transaction ID with operation ID.
  """

  import Kernel, except: [to_charlist: 1, to_string: 1]

  alias __MODULE__, as: LogOffset

  defstruct tx_offset: 0, op_offset: 0

  @type int64 :: 0..0xFFFFFFFFFFFFFFFF
  @type t :: %LogOffset{
          tx_offset: int64() | -1,
          op_offset: non_neg_integer() | :infinity
        }

  # Comparison operators on tuples work out of the box
  # If we change internal representation to something else than a tuple
  # we may need to overload the comparison operators
  # by importing kernel except the operators and define the operators ourselves

  @doc """
  Create a new LogOffset value.

  ## Examples

      iex> new(Lsn.from_integer(10), 0)
      %LogOffset{tx_offset: 10, op_offset: 0}

      iex> new(11, 3)
      %LogOffset{tx_offset: 11, op_offset: 3}

      iex> new(to_tuple(new(Lsn.from_integer(5), 1)))
      %LogOffset{tx_offset: 5, op_offset: 1}

      iex> new({11, 3})
      %LogOffset{tx_offset: 11, op_offset: 3}

      iex> new({11, 3.2})
      ** (FunctionClauseError) no function clause matching in Electric.Replication.LogOffset.new/2

      iex> new(10, -2)
      ** (FunctionClauseError) no function clause matching in Electric.Replication.LogOffset.new/2
  """
  def new(tx_offset, op_offset)
      when is_integer(tx_offset) and tx_offset >= 0 and is_integer(op_offset) and op_offset >= 0 do
    %LogOffset{tx_offset: tx_offset, op_offset: op_offset}
  end

  def new(%Lsn{} = lsn, op_offset) do
    new(Lsn.to_integer(lsn), op_offset)
  end

  def new({tx_offset, op_offset}) do
    new(tx_offset, op_offset)
  end

  @doc """
  Compare two log offsets

  ## Examples

      iex> compare(new(10, 0), new(10, 1))
      :lt

      iex> compare(new(9, 1), new(10, 1))
      :lt

      iex> compare(new(10, 1), new(10, 0))
      :gt

      iex> compare(new(11, 1), new(10, 1))
      :gt

      iex> compare(new(0, 0), before_all())
      :gt

      iex> compare(new(10, 0), %LogOffset{tx_offset: 10, op_offset: 0})
      :eq
  """
  def compare(%LogOffset{} = offset, offset), do: :eq
  def compare(%LogOffset{tx_offset: a}, %LogOffset{tx_offset: b}) when a < b, do: :lt
  def compare(%LogOffset{tx_offset: a}, %LogOffset{tx_offset: b}) when a > b, do: :gt

  def compare(%LogOffset{tx_offset: tx, op_offset: a}, %LogOffset{tx_offset: tx, op_offset: b})
      when a < b,
      do: :lt

  def compare(%LogOffset{tx_offset: tx, op_offset: a}, %LogOffset{tx_offset: tx, op_offset: b})
      when a > b,
      do: :gt

  defguard is_log_offset_lt(offset1, offset2)
           when offset1.tx_offset < offset2.tx_offset or
                  (offset1.tx_offset == offset2.tx_offset and
                     offset1.op_offset < offset2.op_offset)

  @before_all_tx -1
  @before_all_op 0

  @doc """
  An offset that is smaller than all offsets in the log.

  ## Examples

      iex> compare(before_all(), first())
      :lt
  """
  @spec before_all() :: t
  def before_all(), do: %LogOffset{tx_offset: @before_all_tx, op_offset: @before_all_op}

  @doc """
  The first possible offset in the log.
  """
  @spec first() :: t
  def first(), do: %LogOffset{tx_offset: 0, op_offset: 0}

  @last_tx 0xFFFFFFFFFFFFFFFF
  @last_op :infinity

  @doc """
  The last possible offset in the log.

  ## Examples

      iex> compare(first(), last())
      :lt

      iex> compare(new(Lsn.from_integer(10), 0), last())
      :lt
  """
  @spec last() :: t
  def last(), do: %LogOffset{tx_offset: @last_tx, op_offset: @last_op}

  @doc """
  Tests to see if this is the `last/0` offset.

  ## Examples

      iex> last?(last())
      true

      iex> last?(new(10, 5))
      false

      iex> last?(first())
      false
  """
  @spec last?(t()) :: boolean()
  def last?(%LogOffset{tx_offset: @last_tx, op_offset: @last_op}), do: true
  def last?(_), do: false

  @doc """
  Tests to see if the given offset is the first entry.

  ## Examples

      iex> first?(first())
      true

      iex> first?(new(10, 5))
      false

      iex> first?(last())
      false
  """
  @spec first?(t()) :: boolean()
  def first?(%LogOffset{tx_offset: 0, op_offset: 0}), do: true
  def first?(_), do: false

  @doc """
  Tests to see if the given offset comes before any others.

  ## Examples

      iex> before_all?(before_all())
      true

      iex> before_all?(first())
      false

      iex> before_all?(new(10, 5))
      false

      iex> before_all?(last())
      false
  """
  @spec before_all?(t()) :: boolean()
  def before_all?(%LogOffset{tx_offset: @before_all_tx, op_offset: @before_all_op}), do: true
  def before_all?(_), do: false

  @doc """
  Increments the offset of the change inside the transaction.

  ## Examples

      iex> increment(new(10, 5))
      %LogOffset{tx_offset: 10, op_offset: 6}

      iex> compare(new(10, 5) |> increment, new(10, 5))
      :gt

      iex> increment(new(10, 5), 5)
      %LogOffset{tx_offset: 10, op_offset: 10}

      iex> compare(new(10, 1) |> increment(4), new(10, 5))
      :eq
  """
  def increment(%LogOffset{op_offset: op_offset} = log_offset, increment \\ 1) do
    %LogOffset{log_offset | op_offset: op_offset + increment}
  end

  @doc """
  Returns a tuple with the tx_offset and the op_offset.

  ## Examples
      iex> to_tuple(first())
      {0, 0}

      iex> to_tuple(new(Lsn.from_integer(10), 3))
      {10, 3}
  """
  @spec to_tuple(t) :: {int64(), non_neg_integer()}
  def to_tuple(%LogOffset{tx_offset: tx_offset, op_offset: op_offset}) do
    {tx_offset, op_offset}
  end

  @doc """
  Format a LogOffset value to its text representation in an iolist.

  ## Examples
      iex> to_iolist(first())
      ["0", ?_, "0"]

      iex> to_iolist(new(Lsn.from_integer(10), 3))
      ["10", ?_, "3"]

      iex> to_iolist(before_all())
      ["-1"]
  """
  @spec to_iolist(t) :: iolist
  def to_iolist(%LogOffset{tx_offset: -1, op_offset: _}) do
    [Integer.to_string(-1)]
  end

  def to_iolist(%LogOffset{tx_offset: tx_offset, op_offset: op_offset}) do
    [Integer.to_string(tx_offset), ?_, Integer.to_string(op_offset)]
  end

  @doc """
  Parse the given string as a LogOffset value.

  ## Examples

      iex> from_string("-1")
      {:ok, before_all()}

      iex> from_string("0_0")
      {:ok, %LogOffset{tx_offset: 0, op_offset: 0}}

      iex> from_string("11_13")
      {:ok, %LogOffset{tx_offset: 11, op_offset: 13}}

      iex> from_string("0_02")
      {:ok, %LogOffset{tx_offset: 0, op_offset: 2}}

      iex> from_string("1_2_3")
      {:error, "has invalid format"}

      iex> from_string("1_2 ")
      {:error, "has invalid format"}

      iex> from_string("10")
      {:error, "has invalid format"}

      iex> from_string("10_32.1")
      {:error, "has invalid format"}
  """
  @spec from_string(String.t()) :: {:ok, t} | {:error, String.t()}
  def from_string(str) when is_binary(str) do
    if str == "-1" do
      {:ok, before_all()}
    else
      with [tx_offset_str, op_offset_str] <- String.split(str, "_"),
           {tx_offset, ""} <- Integer.parse(tx_offset_str),
           {op_offset, ""} <- Integer.parse(op_offset_str),
           offset <- new(tx_offset, op_offset) do
        {:ok, offset}
      else
        _ -> {:error, "has invalid format"}
      end
    end
  end

  defimpl Inspect do
    def inspect(%LogOffset{tx_offset: -1, op_offset: 0}, _opts) do
      "LogOffset.before_all()"
    end

    def inspect(%LogOffset{tx_offset: tx, op_offset: op}, _opts) do
      "LogOffset.new(#{tx}, #{op})"
    end
  end

  defimpl String.Chars do
    def to_string(offset), do: "#{Electric.Replication.LogOffset.to_iolist(offset)}"
  end

  defimpl List.Chars do
    def to_charlist(offset), do: ~c'#{Electric.Replication.LogOffset.to_iolist(offset)}'
  end

  defimpl Jason.Encoder, for: LogOffset do
    def encode(value, opts) do
      Jason.Encode.string("#{value}", opts)
    end
  end
end
