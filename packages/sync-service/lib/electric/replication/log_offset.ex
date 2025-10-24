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

  @type t_tuple() :: {int64(), non_neg_integer() | :infinity}

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
      when tx_offset == -1 and op_offset == 0
      when is_integer(tx_offset) and tx_offset >= 0 and is_integer(op_offset) and op_offset >= 0
      when is_integer(tx_offset) and tx_offset >= 0 and op_offset == :infinity do
    %LogOffset{tx_offset: tx_offset, op_offset: op_offset}
  end

  def new(%Lsn{} = lsn, op_offset) do
    new(Lsn.to_integer(lsn), op_offset)
  end

  def new({tx_offset, op_offset}) do
    new(tx_offset, op_offset)
  end

  def new(%__MODULE__{} = offset), do: offset

  @doc """
  Returns the LSN part of the LogOffset.

  ## Examples

      iex> extract_lsn(%LogOffset{tx_offset: 10, op_offset: 0})
      #Lsn<0/A>

      iex> extract_lsn(%LogOffset{tx_offset: 10, op_offset: 5})
      #Lsn<0/A>

      iex> extract_lsn(%LogOffset{tx_offset: 11, op_offset: 5})
      #Lsn<0/B>

      iex> extract_lsn(LogOffset.before_all())
      #Lsn<0/0>
  """
  @spec extract_lsn(t()) :: Lsn.t()
  def extract_lsn(%LogOffset{tx_offset: offset}) when offset < 0, do: Lsn.from_integer(0)
  def extract_lsn(%LogOffset{tx_offset: offset}), do: Lsn.from_integer(offset)

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
  def compare(%LogOffset{}, %LogOffset{op_offset: :infinity}), do: :lt
  def compare(%LogOffset{op_offset: :infinity}, %LogOffset{}), do: :gt
  def compare(%LogOffset{op_offset: a}, %LogOffset{op_offset: b}) when a < b, do: :lt
  def compare(%LogOffset{op_offset: a}, %LogOffset{op_offset: b}) when a > b, do: :gt

  @doc """
  Get a minimum of 2 log offsets

  ## Examples

      iex> LogOffset.min(new(10, 0), new(10, 1))
      new(10, 0)
  """
  def min(%LogOffset{} = a, %LogOffset{} = b) do
    if compare(a, b) == :lt, do: a, else: b
  end

  @doc """
  Get a maximum of 2 log offsets

  ## Examples

      iex> LogOffset.max(new(10, 0), new(10, 1))
      new(10, 1)
  """
  def max(%LogOffset{} = a, %LogOffset{} = b) do
    if compare(a, b) == :gt, do: a, else: b
  end

  defguard is_log_offset_lt(offset1, offset2)
           when offset1.tx_offset < offset2.tx_offset or
                  (offset1.tx_offset == offset2.tx_offset and
                     offset1.op_offset < offset2.op_offset)

  defguard is_log_offset_lte(offset1, offset2)
           when offset1 == offset2 or is_log_offset_lt(offset1, offset2)

  defguard is_min_offset(offset) when offset.tx_offset == -1

  defguard is_virtual_offset(offset) when offset.tx_offset == 0

  defguard is_real_offset(offset) when offset.tx_offset > 0

  defguard is_last_virtual_offset(offset)
           when offset.tx_offset == 0 and offset.op_offset == :infinity

  @doc """
  An offset that is smaller than all offsets in the log.

  ## Examples

      iex> compare(before_all(), first())
      :lt
  """
  @spec before_all() :: t
  def before_all(), do: %LogOffset{tx_offset: -1, op_offset: 0}

  @doc """
  The first possible offset in the log.
  """
  @spec first() :: t
  def first(), do: %LogOffset{tx_offset: 0, op_offset: 0}

  @doc """
  The last possible offset in the log.

  ## Examples

      iex> compare(first(), last())
      :lt

      iex> compare(new(Lsn.from_integer(10), 0), last())
      :lt
  """
  @spec last() :: t
  def last(), do: %LogOffset{tx_offset: 0xFFFFFFFFFFFFFFFF, op_offset: :infinity}

  @doc """
  The last possible offset for the "virtual" part of the log - i.e. snapshots.
  """
  @spec last_before_real_offsets() :: t()
  def last_before_real_offsets(), do: %LogOffset{tx_offset: 0, op_offset: :infinity}

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
    %{log_offset | op_offset: op_offset + increment}
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
  Convert the log offset to a binary representation used on disk, sized to int128
  """
  def to_int128(%LogOffset{tx_offset: tx_offset, op_offset: op_offset}) do
    <<tx_offset::64, op_offset::64>>
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

  def to_iolist(%LogOffset{tx_offset: tx_offset, op_offset: :infinity}) do
    [Integer.to_string(tx_offset), ?_, "inf"]
  end

  def to_iolist(%LogOffset{tx_offset: tx_offset, op_offset: op_offset}) do
    [Integer.to_string(tx_offset), ?_, Integer.to_string(op_offset)]
  end

  @doc """
  Parse the given string as a LogOffset value.

  ## Examples

      iex> from_string("-1")
      {:ok, before_all()}

      iex> from_string("now")
      {:ok, :now}

      iex> from_string("0_0")
      {:ok, %LogOffset{tx_offset: 0, op_offset: 0}}

      iex> from_string("11_13")
      {:ok, %LogOffset{tx_offset: 11, op_offset: 13}}

      iex> from_string("0_02")
      {:ok, %LogOffset{tx_offset: 0, op_offset: 2}}

      iex> from_string("0_inf")
      {:ok, %LogOffset{tx_offset: 0, op_offset: :infinity}}

      iex> from_string("1_2_3")
      {:error, "has invalid format"}

      iex> from_string("1_2 ")
      {:error, "has invalid format"}

      iex> from_string("10")
      {:error, "has invalid format"}

      iex> from_string("10_32.1")
      {:error, "has invalid format"}
  """
  @spec from_string(String.t()) :: {:ok, t | :now} | {:error, String.t()}
  def from_string(str) when is_binary(str) do
    cond do
      str == "-1" ->
        {:ok, before_all()}

      str == "now" ->
        {:ok, :now}

      true ->
        with [tx_offset_str, op_offset_str] <- String.split(str, "_"),
             {tx_offset, ""} <- Integer.parse(tx_offset_str),
             {op_offset, ""} <- parse_int_or_inf(op_offset_str),
             offset <- new(tx_offset, op_offset) do
          {:ok, offset}
        else
          _ -> {:error, "has invalid format"}
        end
    end
  end

  defp parse_int_or_inf("inf"), do: {:infinity, ""}
  defp parse_int_or_inf(int), do: Integer.parse(int)

  defimpl Inspect do
    def inspect(%LogOffset{tx_offset: -1, op_offset: 0}, _opts) do
      "LogOffset.before_all()"
    end

    def inspect(%LogOffset{tx_offset: 0xFFFFFFFFFFFFFFFF, op_offset: :infinity}, _opts) do
      "LogOffset.last()"
    end

    def inspect(%LogOffset{tx_offset: 0, op_offset: :infinity}, _opts) do
      "LogOffset.last_before_real_offsets()"
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
    def encode(offset, opts) do
      [?", Electric.Replication.LogOffset.to_iolist(offset), ?"]
      |> Jason.Fragment.new()
      |> Jason.Encode.value(opts)
    end
  end
end
