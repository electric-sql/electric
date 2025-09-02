defmodule Electric.Client.EctoAdapter.PostgresTest do
  use ExUnit.Case, async: true

  alias Electric.Client.EctoAdapter
  alias Support.Money
  alias Support.ULID

  import Ecto.Query

  defmodule TestTable do
    use Ecto.Schema

    schema "test_table" do
      field(:ii, :integer)
      field(:ff, :float)
      field(:ss, :string)
      field(:uu, :binary_id)
      field(:nd, :naive_datetime)
      field(:ud, :utc_datetime)
      field(:dd, :date)
      field(:aa, {:array, :integer})
      field(:mm, Money)
      field(:ul, ULID, prefix: "ul")
    end
  end

  defmacrop assert_where(query, expected) do
    quote do
      assert unquote(expected) == EctoAdapter.where(unquote(query))
    end
  end

  test "bound parameter is rendered to query" do
    ii = 1234
    ff = 3.14
    ss1 = "my string"
    ss2 = "it's mine"
    uu = "247a6f62-9f05-4ac6-8314-89e77177d1e3"
    nd = ~N[2024-10-23 14:36:39]
    ud = ~U[2024-10-23 14:36:39Z]
    dd = ~D[2024-10-23]
    mm = Decimal.new("199.99")
    ul = "ul_coa2saf4czblth3g5jhleb4574"

    assert_where(where(TestTable, ii: ^ii), ~s[("ii" = 1234)])
    assert_where(where(TestTable, ff: ^ff), ~s[("ff" = 3.14::float)])
    assert_where(where(TestTable, ss: ^ss1), ~s[("ss" = 'my string')])
    assert_where(where(TestTable, ss: ^ss2), ~s[("ss" = 'it''s mine')])
    assert_where(where(TestTable, uu: ^uu), ~s[("uu" = '247a6f62-9f05-4ac6-8314-89e77177d1e3')])
    assert_where(where(TestTable, nd: ^nd), ~s[("nd" = '2024-10-23T14:36:39'::timestamp)])
    assert_where(where(TestTable, ud: ^ud), ~s[("ud" = '2024-10-23T14:36:39Z'::timestamptz)])
    assert_where(where(TestTable, dd: ^dd), ~s[("dd" = '2024-10-23'::date)])

    assert_where(where(TestTable, mm: ^mm), ~s[("mm" = 199990000)])

    assert_where(
      from(t in TestTable, where: t.ul == ^ul),
      ~s[("ul" = '1381a900-bc16-42b9-9f66-ea4eb2079dff')]
    )
  end

  test "where IN (...)" do
    values_ii = [1, 2, 3]
    values_ss = ["1", "2", "3"]
    values_dd = [~D[2024-10-23], ~D[2024-10-24], ~D[2024-10-25]]
    values_ff = [3.14, 2.71, 6.626]
    values_mm = [Decimal.new("3.14"), Decimal.new("2.71"), Decimal.new("6.626")]
    values_mm2 = [Decimal.new("9.99")]
    ff = 3.14

    assert_where(from(t in TestTable) |> where([t], t.ii in [1, 2, 3]), ~s|("ii" IN (1,2,3))|)

    assert_where(
      from(t in TestTable) |> where([t], t.ss in ["1", "2", "3"]),
      ~s|("ss" IN ('1','2','3'))|
    )

    assert_where(from(t in TestTable) |> where([t], t.ii in ^values_ii), ~s|("ii" IN (1,2,3))|)

    assert_where(
      from(t in TestTable) |> where([t], t.ss in ^values_ss),
      ~s|("ss" IN ('1','2','3'))|
    )

    assert_where(
      from(t in TestTable) |> where([t], t.ff in ^values_ff),
      ~s|("ff" IN (3.14::float,2.71::float,6.626::float))|
    )

    assert_where(
      from(t in TestTable) |> where([t], t.mm in ^values_mm),
      ~s|("mm" IN (3140000,2710000,6626000))|
    )

    assert_where(
      from(t in TestTable) |> where([t], t.mm in ^values_mm or t.mm in ^values_mm2),
      ~s|("mm" IN (3140000,2710000,6626000) OR "mm" IN (9990000))|
    )

    assert_where(
      from(t in TestTable) |> where([t], t.ss in ^values_ss and t.ii in ^values_ii),
      ~s|("ss" IN ('1','2','3') AND "ii" IN (1,2,3))|
    )

    assert_where(
      from(t in TestTable) |> where([t], t.dd in ^values_dd),
      ~s|("dd" IN ('2024-10-23'::date,'2024-10-24'::date,'2024-10-25'::date))|
    )

    assert_where(
      from(t in TestTable)
      |> where([t], (t.ss in ^values_ss and t.ii in ^values_ii) or t.ff == ^ff),
      ~s|(("ss" IN ('1','2','3') AND "ii" IN (1,2,3)) OR ("ff" = 3.14::float))|
    )
  end

  test "fragment" do
    ii = 5678
    mm_min = Decimal.new("123.45")
    mm_max = Decimal.new("678.90")

    assert_where(
      from(t in TestTable,
        where: fragment("? = ?", t.ii, ^ii)
      ),
      ~s[("ii" = 5678)]
    )

    assert_where(
      from(t in TestTable,
        where: fragment("? BETWEEN ? AND ?", t.ii, ^10, ^100) and fragment("? IS NOT NULL", t.ss)
      ),
      ~s[("ii" BETWEEN 10 AND 100 AND "ss" IS NOT NULL)]
    )

    assert_where(
      from(t in TestTable,
        where: fragment("? > ? AND ? < ?", t.mm, ^mm_min, t.mm, ^mm_max)
      ),
      ~s[("mm" > 123450000 AND "mm" < 678900000)]
    )

    uu = "364e61cf-cebd-4dff-89a0-8ff3462d36c7"

    assert_where(
      from(t in TestTable,
        where: fragment("? = ?", t.uu, ^uu)
      ),
      ~s[("uu" = '364e61cf-cebd-4dff-89a0-8ff3462d36c7')]
    )
  end

  test "spliced values" do
    ii = 1234
    aa = [1, 2, 3, 4]
    ss = "my string"
    uu = ["247a6f62-9f05-4ac6-8314-89e77177d1e3", "61a8129e-6970-48e8-9dae-b26777c7d225"]
    mm = [Decimal.new("199.99"), Decimal.new("150.00")]

    assert_where(
      from(t in TestTable,
        where: t.id == ^ii and fragment("? in (?)", t.ii, splice(^aa)) and t.ss == ^ss
      ),
      ~s[((("id" = 1234) AND "ii" in (1,2,3,4)) AND ("ss" = 'my string'))]
    )

    assert_where(
      from(t in TestTable,
        where: t.id == ^ii and fragment("? in (?)", t.uu, splice(^uu)) and t.ss == ^ss
      ),
      ~s[((("id" = 1234) AND "uu" in ('247a6f62-9f05-4ac6-8314-89e77177d1e3','61a8129e-6970-48e8-9dae-b26777c7d225')) AND ("ss" = 'my string'))]
    )

    assert_where(
      from(t in TestTable,
        where: t.id == ^ii and fragment("? in (?)", t.mm, splice(^mm)) and t.ss == ^ss
      ),
      ~s[((("id" = 1234) AND "mm" in (199990000,150000000)) AND ("ss" = 'my string'))]
    )
  end
end
