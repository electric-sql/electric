defmodule Electric.Postgres.Xid do
  import Bitwise

  @int32_max 0xFFFFFFFF
  @int32_half_max 0x7FFFFFFF

  @type anyxid :: pos_integer
  @type cmp_result :: :lt | :eq | :gt

  defguardp int32?(int) when abs(int) <= @int32_max

  # This is a specialized guard for that specifically determines whether the 32-bit first
  # argument is less than the xid8 argument. For the general principle this is based on, look
  # at the implementation of `compare/2` below.
  defguard xid_lt_xid8(xid, xid8)
           when int32?(xid) and
                  ((xid - band(xid8, @int32_max) <= @int32_half_max and
                      xid < band(xid8, @int32_max)) or
                     (xid - band(xid8, @int32_max) > @int32_half_max and
                        xid > band(xid8, @int32_max)))

  @spec compare(anyxid, anyxid) :: cmp_result

  def compare(xid, xid), do: :eq

  # When both arguments are 32-bit integers or both have values that don't fit in 32 bits, use the
  # direct comparison.
  def compare(xid_l, xid_r)
      when (int32?(xid_l) and int32?(xid_r)) or not (int32?(xid_l) or int32?(xid_r)),
      do: direct_cmp(xid_l, xid_r)

  # When one of the arguments is 32-bit and the other one has a value that doesn't fit in 32 bits,
  # perform the comparison on masked values.
  #
  # In Postgres, any xid has ~2 billion values preceding it and ~2 billion values following it.
  # Regular autovacuuming maintains this invariant. So when we see a difference between two
  # xids that is larger than 2^31, it means the 32-bit argument is a wrapped value, so it
  # must be the most recent one.
  def compare(xid8, xid) when int32?(xid) do
    compare(xid, xid8)
    |> reverse_cmp_result()
  end

  def compare(xid, xid8) when int32?(xid) do
    xid8_masked = band(xid8, @int32_max)

    diff = xid - xid8_masked
    wrapped? = diff > @int32_half_max

    diff_to_cmp_result(wrapped?, diff)
  end

  @spec diff_to_cmp_result(wrapped? :: boolean, diff :: integer) :: cmp_result
  defp diff_to_cmp_result(false, diff) when diff > 0, do: :gt
  defp diff_to_cmp_result(false, diff) when diff < 0, do: :lt
  defp diff_to_cmp_result(true, diff) when diff > 0, do: :lt
  defp diff_to_cmp_result(true, diff) when diff < 0, do: :gt

  ###

  defp direct_cmp(xid_l, xid_r) when xid_l < xid_r, do: :lt
  defp direct_cmp(xid_l, xid_r) when xid_l > xid_r, do: :gt

  defp reverse_cmp_result(:lt), do: :gt
  defp reverse_cmp_result(:gt), do: :lt
end
