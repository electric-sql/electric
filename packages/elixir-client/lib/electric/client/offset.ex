defmodule Electric.Client.Offset do
  @moduledoc """
  Represents an offset in the synchronisation stream from Electric.
  """

  @type t :: String.t()

  @before_all "-1"
  @first "0_0"

  @doc """
  Return an offset that is guaranteed to be before any real database
  operations.
  """
  @spec before_all() :: t()
  def before_all(), do: @before_all

  @doc """
  The first possible offset in the log.
  """
  @spec first() :: t()
  def first, do: @first

  @doc """
  Create a new offset string from the given LSN and operation
  offsets.

      iex> new(2349, 3)
      "2349_3"

  """
  @spec new(non_neg_integer(), non_neg_integer()) :: t()
  def new(tx_offset, op_offset)
      when is_integer(tx_offset) and tx_offset >= 0 and is_integer(op_offset) and op_offset >= 0 do
    "#{tx_offset}_#{op_offset}"
  end
end
