defmodule PgInterop.Postgrex.Extensions.PgLsnTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn

  setup {Support.DbSetup, :with_unique_db}

  test "can decode pg_lsn values", %{db_conn: conn} do
    {:ok, result} = Postgrex.query(conn, "SELECT '0/0'::pg_lsn", [])
    assert %Postgrex.Result{rows: [[lsn]], num_rows: 1} = result
    assert Lsn.from_string("0/0") == lsn

    {:ok, result} = Postgrex.query(conn, "SELECT '2BDC54/6291F4B1'::pg_lsn", [])
    assert %Postgrex.Result{rows: [[lsn]], num_rows: 1} = result
    assert Lsn.from_integer(12_34_56_78_9_87_65_43_21) == lsn
  end

  test "can encode pg_lsn values", %{db_conn: conn} do
    lsn1 = Lsn.from_string("1/0")
    lsn2 = Lsn.from_string("0/0")
    {:ok, result} = Postgrex.query(conn, "SELECT $1::pg_lsn - $2", [lsn1, lsn2])
    assert %Postgrex.Result{rows: [[lsn_diff]], num_rows: 1} = result
    assert :math.pow(2, 32) == Decimal.to_float(lsn_diff)
  end

  test "raises on invalid values", %{db_conn: conn} do
    for val <- [4445, "0/0", Decimal.new("12345")] do
      error_msg =
        "Postgrex expected a value of type Electric.Postgres.Lsn.t(), got #{inspect(val)}. " <>
          "Please make sure the value you are passing matches the definition in your table " <>
          "or in your query or convert the value accordingly."

      assert_raise DBConnection.EncodeError, error_msg, fn ->
        Postgrex.query(conn, "SELECT $1::pg_lsn", [val])
      end
    end
  end
end
