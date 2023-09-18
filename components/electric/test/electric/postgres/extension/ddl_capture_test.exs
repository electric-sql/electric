defmodule Electric.Postgres.Extension.DDLCaptureTest do
  use Electric.Extension.Case, async: false

  test_tx "migration of non-electrified tables", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int8 GENERATED ALWAYS AS IDENTITY);"
    sql2 = "CREATE TABLE daisy (id int8 GENERATED ALWAYS AS IDENTITY);"
    sql3 = "ALTER TABLE buttercup ADD COLUMN petal text;"
    sql4 = "ALTER TABLE buttercup ADD COLUMN stem text, ADD COLUMN leaf text;"

    for sql <- [sql1, sql2, sql3, sql4] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, []} = Extension.ddl_history(conn)
  end

  test_tx "ALTER electrified TABLE is captured", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY);"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY);"
    sql3 = "CALL electric.electrify('buttercup')"
    sql4 = "ALTER TABLE buttercup ADD COLUMN petal text;"
    sql5 = "ALTER TABLE daisy ADD COLUMN stem text, ADD COLUMN leaf text;"

    for sql <- [sql1, sql2, sql3, sql4, sql5] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [ddl1, ddl2]} = Extension.ddl_history(conn)

    assert {1, _txid, _timestamp, "CREATE TABLE buttercup" <> _} = ddl1
    assert {2, _txid, _timestamp, ^sql4} = ddl2
  end

  test_tx "CREATE INDEX on electrified table is captured", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);"
    sql3 = "CALL electric.electrify('buttercup')"
    sql4 = "CREATE INDEX buttercup_value_idx ON buttercup (value);"
    sql5 = "CREATE INDEX daisy_value_idx ON daisy (value);"

    for sql <- [sql1, sql2, sql3, sql4, sql5] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [ddl1, ddl2]} = Extension.ddl_history(conn)

    assert {1, _txid, _timestamp, "CREATE TABLE " <> _} = ddl1
    assert {2, _txid, _timestamp, ^sql4} = ddl2
  end

  test_tx "DROP INDEX on electrified table is captured", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);"
    sql3 = "CALL electric.electrify('buttercup')"
    sql4 = "CREATE INDEX buttercup_value_idx ON buttercup (value);"
    sql5 = "DROP INDEX buttercup_value_idx;"

    assert {:ok, []} = Extension.electrified_indexes(conn)

    for sql <- [sql1, sql2, sql3, sql4, sql5] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, []} = Extension.electrified_indexes(conn)
    assert {:ok, [ddl1, ddl2, ddl3]} = Extension.ddl_history(conn)

    assert {1, _txid, _timestamp, "CREATE TABLE " <> _} = ddl1
    assert {2, _txid, _timestamp, ^sql4} = ddl2
    assert {3, _txid, _timestamp, ^sql5} = ddl3
  end

  test_tx "DROP electrified TABLE is rejected", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);"
    sql3 = "CALL electric.electrify('buttercup')"

    assert {:ok, []} = Extension.electrified_indexes(conn)

    for sql <- [sql1, sql2, sql3] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    sql4 = "DROP TABLE buttercup;"

    assert {:error, _error} = :epgsql.squery(conn, sql4)
  end

  test_tx "ALTER electrified TABLE DROP COLUMN is rejected", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);"
    sql3 = "CALL electric.electrify('buttercup')"

    assert {:ok, []} = Extension.electrified_indexes(conn)

    for sql <- [sql1, sql2, sql3] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    sql4 = "ALTER TABLE buttercup DROP COLUMN value;"

    assert {:error, _error} = :epgsql.squery(conn, sql4)
  end

  test_tx "ALTER electrified TABLE RENAME COLUMN is rejected", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);"
    sql3 = "CALL electric.electrify('buttercup')"

    assert {:ok, []} = Extension.electrified_indexes(conn)

    for sql <- [sql1, sql2, sql3] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    sql4 = "ALTER TABLE buttercup RENAME COLUMN value TO variable;"

    assert {:error, _error} = :epgsql.squery(conn, sql4)
  end

  test_tx "ADD column; CREATE INDEX only adds a single migration", fn conn ->
    sql1 =
      "CREATE TABLE public.buttercup (id text PRIMARY KEY, value text);"

    sql2 = "CALL electric.electrify('public.buttercup')"

    for sql <- [sql1, sql2] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [_]} = Extension.ddl_history(conn)

    sql3 =
      "ALTER TABLE public.buttercup ADD COLUMN amount int4; CREATE INDEX buttercup_amount_idx ON public.buttercup (amount); "

    [{:ok, _, _}, {:ok, _, _}] = :epgsql.squery(conn, sql3)

    assert {:ok, [_, {_, _, _, ^sql3}]} = Extension.ddl_history(conn)
  end
end
