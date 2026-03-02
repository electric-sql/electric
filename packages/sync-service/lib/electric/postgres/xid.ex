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
  Guard function to check if xid_l < xid_r using the same wraparound logic as compare/2.

  This can be used in guard clauses. Since guards don't allow bit-casting, we manually
  handle the modulo-2^32 arithmetic:
  - For 64-bit XIDs (both > 32-bit max), use regular comparison
  - For 32-bit XIDs, we compute the unsigned 32-bit difference and check if it's > 2^31

  ## Examples

      iex> is_lt(3, 3)
      false

      iex> is_lt(2, 1)
      false

      iex> is_lt(2, 2)
      false

      iex> is_lt(2, 3)
      true

      iex> is_lt(#{@uint32_max}, #{@uint32_max})
      false

      iex> is_lt(1, #{@uint32_half_max})
      true

      iex> is_lt(1, #{@uint32_half_max + 1})
      true

      iex> is_lt(1, #{@uint32_half_max + 2})
      false

      iex> is_lt(1, #{@uint32_max})
      false

      iex> is_lt(#{@uint32_max}, 1)
      true

      iex> is_lt(#{@uint32_half_max}, 1)
      false

      iex> is_lt(#{@uint32_half_max + 1}, 1)
      true

      iex> is_lt(#{@uint32_half_max}, #{@uint32_max})
      true

      iex> is_lt(#{@uint32_half_max - 1}, #{@uint32_max})
      true

      iex> is_lt(#{@uint32_half_max - 2}, #{@uint32_max})
      false

      Any of the two arguments can be 64-bit, the order doesn't matter:

      iex> is_lt(1, #{@uint64_xid})
      true

      iex> is_lt(1, #{@uint64_xid + 1})
      true

      iex> is_lt(1, #{@uint64_xid + 2})
      false

      iex> is_lt(#{@uint64_xid}, 1)
      false

      iex> is_lt(#{@uint64_xid + 1}, 1)
      true

      # When both numbers are 64-bit, regular comparison rules apply:

      iex> is_lt(#{@uint64_xid + 2}, #{@uint64_xid + 1})
      false

      iex> is_lt(#{@uint64_xid}, #{@uint64_xid + @uint32_half_max + 2})
      true
  """
  # This produces equivalent results to the following C code:
  #
  #     uint32 xid_l, xid_r;
  #     int32 signed_diff = (int32)(xid_l - xid_r);
  #     return signed_diff < 0;
  #
  defguard is_lt(xid_l, xid_r)
           # Both are 64-bit XIDs - use regular comparison
           # At least one is 32-bit - use modulo-2^32 comparison
           # Case 1: xid_l >= xid_r (difference is non-negative)
           # The unsigned 32-bit difference is >= 2^31, meaning wraparound makes xid_l < xid_r
           # Case 2: xid_l < xid_r (difference is negative)
           # rem() returns a negative value, so we add 2^32 to get the unsigned result
           # Then check if it's >= 2^31 (values 0x80000000-0xFFFFFFFF represent negative signed ints)
           when (not uint32?(xid_l) and not uint32?(xid_r) and xid_l > 0 and xid_r > 0 and
                   xid_l < xid_r) or
                  ((uint32?(xid_l) or uint32?(xid_r)) and xid_l > 0 and xid_r > 0 and
                     ((xid_l - xid_r >= 0 and
                         rem(xid_l - xid_r, @uint32_max + 1) >= @uint32_half_max) or
                        (xid_l - xid_r < 0 and
                           rem(xid_l - xid_r, @uint32_max + 1) + @uint32_max + 1 >=
                             @uint32_half_max)))

  @doc """
  Guard function to check if xid_l == xid_r using the same wraparound logic as compare/2.

  This can be used in guard clauses. For equality, two XIDs are equal if their difference
  is zero modulo 2^32.

  ## Examples

      iex> is_eq(3, 3)
      true

      iex> is_eq(2, 1)
      false

      iex> is_eq(2, 2)
      true

      iex> is_eq(2, 3)
      false

      iex> is_eq(#{@uint32_max}, #{@uint32_max})
      true

      iex> is_eq(1, #{@uint32_half_max})
      false

      iex> is_eq(#{@uint32_max}, 1)
      false

      Any of the two arguments can be 64-bit, the order doesn't matter:

      iex> is_eq(1, #{@uint64_xid})
      false

      iex> is_eq(#{@uint64_xid}, 1)
      false

      # When both numbers are 64-bit, regular comparison rules apply:

      iex> is_eq(#{@uint64_xid}, #{@uint64_xid})
      true

      iex> is_eq(#{@uint64_xid + 2}, #{@uint64_xid + 1})
      false
  """
  # This produces equivalent results to the following C code:
  #
  #     uint32 xid_l, xid_r;
  #     int32 signed_diff = (int32)(xid_l - xid_r);
  #     return signed_diff == 0;
  #
  defguard is_eq(xid_l, xid_r)
           when (not uint32?(xid_l) and not uint32?(xid_r) and xid_l > 0 and xid_r > 0 and
                   xid_l == xid_r) or
                  ((uint32?(xid_l) or uint32?(xid_r)) and xid_l > 0 and xid_r > 0 and
                     rem(xid_l - xid_r, @uint32_max + 1) == 0)

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
  def compare(xid8_l, xid8_r) when is_eq(xid8_l, xid8_r), do: :eq
  def compare(xid8_l, xid8_r) when is_lt(xid8_l, xid8_r), do: :lt
  def compare(_, _), do: :gt

  @type pg_snapshot() :: {anyxid, anyxid, [anyxid]}

  @doc """
  Check if a transaction is in the future from the POV of the snapshot. In other words, if its
  xid is >= xmax, its changes are definitely *not* visible and *won't become* visible in this snapshot.
  """
  @spec after_snapshot?(anyxid, pg_snapshot()) :: boolean()
  def after_snapshot?(xid, {_, xmax, _}) when not is_lt(xid, xmax), do: true
  def after_snapshot?(_, _), do: false

  @doc """
  Compare two snapshots.
  Returns :lt if snapshot1 < snapshot2, :eq if equal, :gt if snapshot1 > snapshot2.

  Comparison rules:
  - snapshot1 < snapshot2 if xmax1 < xmax2 OR (xmax1 == xmax2 AND xmin1 < xmin2)
  - snapshots are equal if both xmin and xmax are equal

  ## Examples

      iex> compare_snapshots({100, 200, []}, {150, 300, []})
      :lt

      iex> compare_snapshots({100, 300, []}, {150, 200, []})
      :gt

      iex> compare_snapshots({100, 300, []}, {150, 300, []})
      :lt

      iex> compare_snapshots({150, 300, []}, {100, 300, []})
      :gt

      iex> compare_snapshots({100, 300, [150]}, {100, 300, [200]})
      :eq

      iex> compare_snapshots({100, 300, []}, {100, 300, [150, 200, 250]})
      :eq
  """
  @spec compare_snapshots(pg_snapshot(), pg_snapshot()) :: :lt | :eq | :gt
  def compare_snapshots({_, xmax1, _}, {_, xmax2, _}) when is_lt(xmax1, xmax2), do: :lt

  def compare_snapshots({_, xmax1, _}, {_, xmax2, _})
      when not is_eq(xmax1, xmax2) and not is_lt(xmax1, xmax2), do: :gt

  def compare_snapshots({xmin1, _, _}, {xmin2, _, _}) when is_lt(xmin1, xmin2), do: :lt

  def compare_snapshots({xmin1, _, _}, {xmin2, _, _})
      when not is_eq(xmin1, xmin2) and not is_lt(xmin1, xmin2), do: :gt

  def compare_snapshots(_, _), do: :eq
end
