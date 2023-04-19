defmodule Electric.Replication.OffsetStorageTest do
  use ExUnit.Case

  alias Electric.Replication.OffsetStorage
  alias Electric.Postgres.Lsn

  setup do
    {:ok, slot: Ecto.UUID.generate()}
  end

  test "put_relation/3 upserts the relation for a slot and Lsn combination", %{slot: slot} do
    lsn = Lsn.from_integer(1)

    assert is_nil(OffsetStorage.get_vx_offset(slot, lsn))

    assert :ok = OffsetStorage.put_pg_relation(slot, lsn, 1)
    assert 1 = OffsetStorage.get_vx_offset(slot, lsn)

    assert :ok = OffsetStorage.put_pg_relation(slot, lsn, 2)
    assert 2 = OffsetStorage.get_vx_offset(slot, lsn)
  end

  test "get_largest_known_lsn_smaller_than/3 finds the largest acceptable LSN in the table", %{
    slot: slot
  } do
    # Insert multiples of 3
    0..100//3
    |> Enum.each(fn x ->
      lsn = Lsn.from_integer(x)
      OffsetStorage.put_pg_relation(slot, lsn, x)
    end)

    # Searching for 61, get 60
    assert {_lsn, 60} =
             OffsetStorage.get_largest_known_lsn_smaller_than(
               slot,
               Lsn.from_integer(61)
             )
  end

  test "get_largest_known_lsn_smaller_than/3 returns nil if nothing found", %{slot: slot} do
    assert is_nil(
             OffsetStorage.get_largest_known_lsn_smaller_than(
               slot,
               Lsn.from_integer(10)
             )
           )
  end
end
