defmodule Electric.Client.Offset do
  @moduledoc """
  Represents an offset in the synchronisation stream from Electric.
  """

  import Kernel, except: [to_string: 1]

  defstruct tx: 0, op: 0

  @type int64 :: 0..0xFFFFFFFFFFFFFFFF
  @type tx_offset :: int64() | -1
  @type op_offset :: int64() | :infinity

  @type t :: %__MODULE__{
          tx: tx_offset(),
          op: op_offset()
        }

  @doc """
  Return an offset that is guaranteed to be before any real database
  operations.
  """
  @spec before_all() :: t()
  def before_all(), do: %__MODULE__{tx: -1, op: 0}

  @doc """
  The first possible offset in the log.
  """
  @spec first() :: t()
  def first, do: %__MODULE__{tx: 0, op: 0}

  @doc """
  A guard to test if the given offset is the first possible (as returned by `first/0`).
  """
  defguard is_first(offset)
           when is_struct(offset, __MODULE__) and offset.tx == 0 and offset.op == 0

  @doc """
  Parse an offset value from an HTTP header into a `%#{__MODULE__}{}` struct.

  Raises if the offset header value is invalid.

      iex> from_string!("-1")
      %#{__MODULE__}{tx: -1, op: 0}

      iex> from_string!("1378734_3")
      %#{__MODULE__}{tx: 1378734, op: 3}

      iex> from_string!("not a real offset")
      ** (ArgumentError) has invalid format

  """
  @spec from_string!(String.t()) :: t() | no_return()
  def from_string!(str) when is_binary(str) do
    case from_string(str) do
      {:ok, offset} -> offset
      {:error, reason} -> raise ArgumentError, message: reason
    end
  end

  @doc """
  Parse an offset value from an HTTP header into a `%#{__MODULE__}{}` struct.

      iex> from_string("-1")
      {:ok, %#{__MODULE__}{tx: -1, op: 0}}

      iex> from_string("1378734_3")
      {:ok, %#{__MODULE__}{tx: 1378734, op: 3}}

      iex> from_string("0_inf")
      {:ok, %#{__MODULE__}{tx: 0, op: :infinity}}

      iex> from_string("not a real offset")
      {:error, "has invalid format"}

  """
  @spec from_string(String.t()) :: {:ok, t()} | {:error, String.t()}
  def from_string(str) when is_binary(str) do
    if str == "-1" do
      {:ok, before_all()}
    else
      with [tx_offset_str, op_offset_str] <- :binary.split(str, "_"),
           {tx_offset, ""} <- Integer.parse(tx_offset_str),
           {op_offset, ""} <- parse_int_or_inf(op_offset_str) do
        {:ok, %__MODULE__{tx: tx_offset, op: op_offset}}
      else
        _ -> {:error, "has invalid format"}
      end
    end
  end

  defp parse_int_or_inf("inf"), do: {:infinity, ""}
  defp parse_int_or_inf(int), do: Integer.parse(int)

  @doc """
  Create a new #{__MODULE__} struct from the given LSN and operation
  offsets.

      iex> new(2349, 3)
      %#{__MODULE__}{tx: 2349, op: 3}

  """
  @spec new(non_neg_integer(), non_neg_integer()) :: t()
  def new(tx_offset, op_offset)
      when is_integer(tx_offset) and tx_offset >= 0 and is_integer(op_offset) and op_offset >= 0 do
    %__MODULE__{tx: tx_offset, op: op_offset}
  end

  @doc """
  Output the an Offset as a string for use in query parameters.

      iex> new(2349, 3) |> #{__MODULE__}.to_string()
      "2349_3"

      iex> before_all() |> #{__MODULE__}.to_string()
      "-1"
  """
  @spec to_string(t()) :: String.t()
  def to_string(%__MODULE__{tx: -1}) do
    "-1"
  end

  def to_string(%__MODULE__{tx: tx, op: op}) do
    "#{Integer.to_string(tx)}_#{if op == :infinity, do: "inf", else: Integer.to_string(op)}"
  end

  @spec to_tuple(t()) :: {tx_offset(), op_offset()}
  def to_tuple(%__MODULE__{tx: tx, op: op}), do: {tx, op}

  defimpl String.Chars do
    def to_string(offset) do
      Electric.Client.Offset.to_string(offset)
    end
  end
end
