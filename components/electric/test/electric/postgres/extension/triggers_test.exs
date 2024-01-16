# NOTE(msfstef): tests should ideally also look at shadow table values
defmodule Electric.Postgres.Extension.TriggersTest do
  use ExUnit.Case, async: false
  import Electric.Postgres.TestConnection

  setup do
    context = create_test_db()

    assert {:ok, _versions} = Electric.Postgres.Extension.migrate(context.conn)

    {:ok, Map.merge(context, %{repo: Electric.Postgres.Proxy.TestRepo})}
  end

  test "shadow table update does not fail when a column changes", cxt do
    assert [
      {:ok, [], []},
      {:ok, [], []},
      {:ok, 1},
      {:ok, 1},
      # assert _modified_columns_bit_mask as having changed the flag
      {:ok, _, [{"{t,f,f}"}]}
    ] =
      :epgsql.squery(cxt.conn, """
        CREATE TABLE public.trigger_test (
          val TEXT PRIMARY KEY,
          flag BOOLEAN,
          content TEXT,
          content_json JSONB
        );
        CALL electric.electrify('public.trigger_test');
        INSERT INTO public.trigger_test (val, flag, content_json)
              VALUES ('1', 'false', '{"a": 3}');
        UPDATE public.trigger_test SET flag = 'true' WHERE val = '1';
        SELECT _modified_columns_bit_mask FROM electric.shadow__public__trigger_test;
      """)
  end


  test "shadow table update does not fail even if no columns change", cxt do
    assert [
      {:ok, [], []},
      {:ok, [], []},
      {:ok, 1},
      {:ok, 1},
      # assert _modified_columns_bit_mask as having changed nothing
      {:ok, _, [{"{f,f,f}"}]}
    ] =
      :epgsql.squery(cxt.conn, """
        CREATE TABLE public.trigger_test (
          val TEXT PRIMARY KEY,
          flag BOOLEAN,
          content TEXT,
          content_json JSONB
        );
        CALL electric.electrify('public.trigger_test');
        INSERT INTO public.trigger_test (val, flag, content_json)
              VALUES ('1', 'false', '{"a": 3}');
        UPDATE public.trigger_test SET flag = 'false' WHERE val = '1';
        SELECT _modified_columns_bit_mask FROM electric.shadow__public__trigger_test;
      """)
  end
end
