defmodule Electric.Postgres.XidTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  import Electric.Postgres.Xid

  doctest Electric.Postgres.Xid, import: true

  @uint32_max 0xFFFFFFFF
  @uint64_max 0xFFFFFFFFFFFFFFFF

  # 2^31
  @half_modulo 0x80000000

  property "compare/2 compares 64-bit xids like ordinary integers" do
    check all xid_l <- xid64_gen(), xid_r <- xid64_gen(), max_runs: 1_000_000, max_run_time: 600 do
      diff = xid_l - xid_r

      cond do
        diff == 0 -> assert compare(xid_l, xid_r) == :eq
        diff < 0 -> assert compare(xid_l, xid_r) == :lt
        diff > 0 -> assert compare(xid_l, xid_r) == :gt
      end
    end
  end

  property "compare/2 treats larger xids as preceding the smaller ones when the difference is > ~2 billion" do
    check all xid1 <- xid32_gen(),
              xid2 <- StreamData.one_of([xid32_gen(), xid64_gen()]),
              # Randomize the order of arguments passed to `compare/2`.
              [xid_l, xid_r] <- StreamData.constant(Enum.shuffle([xid1, xid2])),
              max_runs: 1_000_000,
              max_run_time: 600 do
      # Truncate the 64-bit xid to 32 bits to calculate the correct difference with the 32-bit xid.
      <<diff::signed-32>> = <<xid_l - xid_r::signed-32>>

      cond do
        diff == 0 -> assert compare(xid_l, xid_r) == :eq
        diff > @half_modulo -> assert compare(xid_l, xid_r) == :lt
        diff < -@half_modulo -> assert compare(xid_l, xid_r) == :gt
        diff < 0 and diff >= -@half_modulo -> assert compare(xid_l, xid_r) == :lt
        diff > 0 and diff <= @half_modulo -> assert compare(xid_l, xid_r) == :gt
      end
    end
  end

  defp xid32_gen, do: StreamData.integer(1..@uint32_max)
  defp xid64_gen, do: StreamData.integer((@uint32_max + 1)..@uint64_max)

  describe "after_snapshot?/2" do
    property "returns true iff xid >= xmax (mixed 32/64-bit xids)" do
      check all xid <- StreamData.one_of([xid32_gen(), xid64_gen()]),
                xmax <- StreamData.one_of([xid32_gen(), xid64_gen()]),
                xmin <- StreamData.integer(1..xmax),
                xip_list <- StreamData.list_of(StreamData.integer(xmin..xmax), max_length: 5),
                max_runs: 100_000,
                max_run_time: 600 do
        snapshot = {xmin, xmax, xip_list}

        expected = compare(xid, xmax) != :lt
        assert after_snapshot?(xid, snapshot) == expected
      end
    end
  end
end
