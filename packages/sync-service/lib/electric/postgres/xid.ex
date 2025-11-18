defmodule Electric.Postgres.Xid do
  @uint32_max 0xFFFFFFFF
  @uint32_half_max 0x80000000

  # A 64-bit XID with an arbitrary epoch that is equal to @uint32_half_max when truncated to 32
  # bits.
  @uint64_xid 0x1080000000

  @type anyxid :: pos_integer
  @type cmp_result :: :lt | :eq | :gt

  # We don't include 0 in the definition of uint32 because it is not a valid transaction ID.
  defguardp uint32?(num) when num > 0 and num <= @uint32_max

  @doc """
  In Postgres, any 32-bit xid has ~2 billion values preceding it and ~2 billion values following it.
  Regular autovacuuming maintains this invariant. When we see a difference between two
  xids that is larger than 2^31, we know there's been at least one transaction ID wraparound.
  Given the invariant mentioned earlier, we assume there's been only one wraparound and so the xid
  whose value is larger precedes the other one (or, equivalently, the smaller xid belongs to a
  more recent transaction).

  For 64-bit xids (Postgres type `xid8`), the regular integer comparison is used because those
  xids include the epoch number that tracks the number of xid wraparounds that have happened.

  If any one or both arguments are 32-bit xids, the comparison is performed modulo-2^32, the same way it's done in Postgres:
  https://github.com/postgres/postgres/blob/302cf15759233e654512979286ce1a5c3b36625f/src/backend/access/transam/transam.c#L276-L293

  ## Tests

  iex> compare(3, 3)
  :eq

  iex> compare(2, 1)
  :gt

  iex> compare(2, 2)
  :eq

  iex> compare(2, 3)
  :lt

  iex> compare(#{@uint32_max}, #{@uint32_max})
  :eq

  iex> compare(1, #{@uint32_half_max})
  :lt

  iex> compare(1, #{@uint32_half_max + 1})
  :lt

  iex> compare(1, #{@uint32_half_max + 2})
  :gt

  iex> compare(1, #{@uint32_max})
  :gt

  iex> compare(#{@uint32_max}, 1)
  :lt

  iex> compare(#{@uint32_half_max}, 1)
  :gt

  iex> compare(#{@uint32_half_max + 1}, 1)
  :lt

  iex> compare(#{@uint32_half_max}, #{@uint32_max})
  :lt

  iex> compare(#{@uint32_half_max - 1}, #{@uint32_max})
  :lt

  iex> compare(#{@uint32_half_max - 2}, #{@uint32_max})
  :gt

  Any of the two arguments can be 64-bit, the order doesn't matter:

  iex> compare(1, #{@uint64_xid})
  :lt

  iex> compare(1, #{@uint64_xid + 1})
  :lt

  iex> compare(1, #{@uint64_xid + 2})
  :gt

  iex> compare(#{@uint64_xid}, 1)
  :gt

  iex> compare(#{@uint64_xid + 1}, 1)
  :lt

  # When both numbers are 64-bit, regular comparison rules apply:

  iex> compare(#{@uint64_xid + 2}, #{@uint64_xid + 1})
  :gt

  iex> compare(#{@uint64_xid}, #{@uint64_xid + @uint32_half_max + 2})
  :lt
  """
  @spec compare(anyxid, anyxid) :: cmp_result

  # If both numbers do not fit into 32 bits, then both are of type xid8 and we compare them
  # using regular comparison.
  def compare(xid8_l, xid8_r)
      when not uint32?(xid8_l) and not uint32?(xid8_r) and xid8_l > 0 and xid8_r > 0 do
    cmp(xid8_l, xid8_r)
  end

  # If one of the numbers is a 32-bit unsigned integer, we compare the two numbers using
  # modulo-2^32 arithmetic.
  def compare(xid_l, xid_r) when (uint32?(xid_l) or uint32?(xid_r)) and xid_l > 0 and xid_r > 0 do
    # This produces equivalent results to the following C code:
    #
    #     uint32 xid_l, xid_r;
    #     int32 signed_diff = (int32)(xid_l - xid_r);
    #
    <<signed_diff::signed-32>> = <<xid_l - xid_r::unsigned-32>>

    # If signed_diff is a negative number, xid_l precedes xid_r.
    cmp(signed_diff, 0)
  end

  defp cmp(a, b) when a == b, do: :eq
  defp cmp(a, b) when a < b, do: :lt
  defp cmp(a, b) when a > b, do: :gt

  @doc """
  Check if a transaction is after the end of a snapshot - if it's xid is over xmax
  """
  @spec after_snapshot?(anyxid, {anyxid, anyxid, [anyxid]}) :: boolean()
  def after_snapshot?(xid, {_, xmax, _}), do: compare(xid, xmax) != :lt
end
