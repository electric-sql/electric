defmodule Electric.Replication.Eval.PgQueryFuzzTest do
  @moduledoc """
  Fuzz test for pg_query_ex NIF to reproduce segfaults seen in production
  with subquery parsing. Exercises the full `Shape.new` path which includes
  SQL → AST parsing and AST → SQL reconstruction via `PgQuery.parse/1`.

  Since NIF segfaults crash the entire BEAM VM, each query is logged to
  stderr before parsing. If a crash occurs, the last logged query is the
  likely culprit.

  Run with:
    mix test test/electric/replication/eval/pg_query_fuzz_test.exs

  Increase iterations via:
    PG_QUERY_FUZZ_ITERATIONS=10000 mix test test/electric/replication/eval/pg_query_fuzz_test.exs

  Reproduce a specific failure:
    mix test test/electric/replication/eval/pg_query_fuzz_test.exs --seed <seed>
  """

  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Electric.Shapes.Shape

  @iterations String.to_integer(System.get_env("PG_QUERY_FUZZ_ITERATIONS", "500"))

  # Stub inspector with many tables so subqueries can reference different tables.
  # All tables share the same columns for simplicity — the goal is to exercise
  # the pg_query_ex NIF parser, not column type checking.
  @inspector Support.StubInspector.new(
               tables: [
                 {1, {"public", "t1"}},
                 {2, {"public", "t2"}},
                 {3, {"public", "t3"}},
                 {4, {"public", "t4"}},
                 {5, {"public", "t5"}},
                 {6, {"public", "parent"}},
                 {7, {"public", "child"}},
                 {8, {"public", "users"}},
                 {9, {"public", "items"}},
                 {10, {"public", "orders"}}
               ],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                 %{name: "name", type: "text", pk_position: nil, type_id: {25, 1}},
                 %{name: "value", type: "text", pk_position: nil, type_id: {25, 1}},
                 %{name: "parent_id", type: "int8", pk_position: nil, type_id: {20, 1}},
                 %{name: "active", type: "bool", pk_position: nil, type_id: {16, 1}},
                 %{name: "status", type: "text", pk_position: nil, type_id: {25, 1}}
               ]
             )

  @tables ~w[t1 t2 t3 t4 t5 parent child users items orders]
  @columns ~w[id name value parent_id status]

  @moduletag timeout: :infinity

  # ============================================================================
  # Full pipeline fuzz tests (Shape.new)
  # ============================================================================

  test "humanlayer" do
    where = """
    organization_id = '019c26f8-5a48-7256-a1d3-9b7ab52ff22d'
    AND (
      resource_owner_user_id = 'user_01KG5ZWBTG7SCCC0AMJ155FPT3'
      OR (
        task_id IS NOT NULL
        AND task_id IN (
          SELECT task_id FROM public.task_user_acl WHERE subject_user_id = 'user_01KG5ZWBTG7SCCC0AMJ155FPT3' AND organization_id = '019c26f8-5a48-7256-a1d3-9b7ab52ff22d'
        )
      ) OR (
        task_id IS NOT NULL
        AND task_id IN (
          SELECT task_id FROM public.task_organization_acl WHERE organization_id = '019c26f8-5a48-7256-a1d3-9b7ab52ff22d'
        )
      )
    )
    """
  end

  describe "Shape.new fuzz — subqueries without params" do
    property "does not segfault on IN subqueries" do
      check all(
              {root_table, where} <- in_subquery_clause_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [in]: #{root_table} WHERE #{where}\n")
        result = Shape.new(root_table, where: where, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end

    property "does not segfault on EXISTS subqueries" do
      check all(
              {root_table, where} <- exists_subquery_clause_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [exists]: #{root_table} WHERE #{where}\n")
        result = Shape.new(root_table, where: where, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end

    property "does not segfault on nested subqueries" do
      check all(
              {root_table, where} <- nested_subquery_clause_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [nested]: #{root_table} WHERE #{where}\n")
        result = Shape.new(root_table, where: where, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end

    property "does not segfault on deeply nested subqueries" do
      check all(
              {root_table, where} <- deep_subquery_clause_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [deep]: #{root_table} WHERE #{where}\n")
        result = Shape.new(root_table, where: where, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end

    property "does not segfault on composed boolean subqueries" do
      check all(
              {root_table, where} <- composed_subquery_clause_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [composed]: #{root_table} WHERE #{where}\n")
        result = Shape.new(root_table, where: where, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end
  end

  describe "Shape.new fuzz — subqueries with valid params" do
    property "does not segfault on subqueries with matching parameter references" do
      check all(
              {root_table, where, params} <- parameterized_subquery_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [params]: #{root_table} WHERE #{where} | #{inspect(params)}\n")
        result = Shape.new(root_table, where: where, params: params, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end
  end

  describe "Shape.new fuzz — subqueries with invalid params" do
    property "does not segfault on missing params" do
      check all(
              {root_table, where, _params} <- parameterized_subquery_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [missing-params]: #{root_table} WHERE #{where} | %{}\n")
        result = Shape.new(root_table, where: where, params: %{}, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end

    property "does not segfault on wrong param keys" do
      check all(
              {root_table, where, _params} <- parameterized_subquery_gen(),
              wrong_keys <- wrong_param_keys_gen(),
              max_runs: @iterations
            ) do
        IO.write(
          :stderr,
          "FUZZ [wrong-keys]: #{root_table} WHERE #{where} | #{inspect(wrong_keys)}\n"
        )

        result = Shape.new(root_table, where: where, params: wrong_keys, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end

    property "does not segfault on special characters in param values" do
      check all(
              {root_table, where, params} <- parameterized_subquery_gen(),
              bad_val <- bad_param_value_gen(),
              max_runs: @iterations
            ) do
        # Replace all param values with the bad value
        poisoned = Map.new(params, fn {k, _v} -> {k, bad_val} end)

        IO.write(
          :stderr,
          "FUZZ [bad-vals]: #{root_table} WHERE #{where} | #{inspect(poisoned)}\n"
        )

        result = Shape.new(root_table, where: where, params: poisoned, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end

    property "does not segfault on extra unused params" do
      check all(
              {root_table, where, params} <- parameterized_subquery_gen(),
              extra_count <- integer(1..10),
              max_runs: @iterations
            ) do
        extra = for i <- 50..(50 + extra_count), into: %{}, do: {"#{i}", "extra_#{i}"}
        merged = Map.merge(params, extra)

        IO.write(
          :stderr,
          "FUZZ [extra-params]: #{root_table} WHERE #{where} | #{inspect(merged)}\n"
        )

        result = Shape.new(root_table, where: where, params: merged, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end

    property "does not segfault on subqueries with many param references" do
      check all(
              {root_table, where, params} <- many_params_subquery_gen(),
              max_runs: @iterations
            ) do
        IO.write(
          :stderr,
          "FUZZ [many-params]: #{root_table} WHERE #{where} | #{inspect(params)}\n"
        )

        result = Shape.new(root_table, where: where, params: params, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end
  end

  describe "Shape.new fuzz — exotic subquery patterns" do
    property "does not segfault on scalar, ANY/ALL, and CTE subqueries" do
      check all(
              {root_table, where} <- exotic_subquery_clause_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [exotic]: #{root_table} WHERE #{where}\n")
        result = Shape.new(root_table, where: where, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end
  end

  describe "Shape.new fuzz — malformed subqueries" do
    property "does not segfault on malformed/truncated subqueries" do
      check all(
              {root_table, where} <- malformed_subquery_clause_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [malformed]: #{root_table} WHERE #{where}\n")
        result = Shape.new(root_table, where: where, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end
  end

  describe "Shape.new fuzz — large queries" do
    property "does not segfault on large boolean chains and IN lists" do
      check all(
              {root_table, where} <- large_query_clause_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [large]: #{root_table} WHERE <#{byte_size(where)} bytes>\n")
        result = Shape.new(root_table, where: where, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end

    property "does not segfault on large parameterized queries" do
      check all(
              {root_table, where, params} <- large_parameterized_query_gen(),
              max_runs: @iterations
            ) do
        IO.write(
          :stderr,
          "FUZZ [large-params]: #{root_table} WHERE <#{byte_size(where)} bytes> | #{map_size(params)} params\n"
        )

        result = Shape.new(root_table, where: where, params: params, inspector: @inspector)
        assert match?({:ok, _}, result) or match?({:error, _}, result)
      end
    end
  end

  # ============================================================================
  # Rebuild-targeted fuzz tests
  #
  # rebuild_query_with_substituted_parts is only reached when the query passes
  # full validation (parse_where_stmt succeeds). These tests use type-correct
  # generators that produce queries guaranteed to pass validation, ensuring the
  # rebuild + protobuf_to_query! NIF path is exercised. Assertions require
  # {:ok, _} to confirm we actually reached rebuild rather than failing early.
  # ============================================================================

  describe "rebuild_query_with_substituted_parts — subqueries" do
    property "rebuilds single IN subquery" do
      check all(
              {root_table, where} <- typed_in_subquery_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [rebuild-in]: #{root_table} WHERE #{where}\n")
        assert {:ok, %Shape{}} = Shape.new(root_table, where: where, inspector: @inspector)
      end
    end

    property "rebuilds nested IN subqueries (2-3 levels)" do
      check all(
              {root_table, where} <- typed_nested_subquery_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [rebuild-nested]: #{root_table} WHERE #{where}\n")
        assert {:ok, %Shape{}} = Shape.new(root_table, where: where, inspector: @inspector)
      end
    end

    property "rebuilds deeply nested IN subqueries (4-10 levels)" do
      check all(
              depth <- integer(4..10),
              max_runs: @iterations
            ) do
        {root_table, where} = build_typed_deep_in(depth)
        IO.write(:stderr, "FUZZ [rebuild-deep-#{depth}]: #{root_table} WHERE #{where}\n")
        assert {:ok, %Shape{}} = Shape.new(root_table, where: where, inspector: @inspector)
      end
    end

    property "rebuilds boolean compositions of subqueries" do
      check all(
              {root_table, where} <- typed_composed_subquery_gen(),
              max_runs: @iterations
            ) do
        IO.write(:stderr, "FUZZ [rebuild-composed]: #{root_table} WHERE #{where}\n")
        assert {:ok, %Shape{}} = Shape.new(root_table, where: where, inspector: @inspector)
      end
    end

    property "rebuilds many independent subqueries ANDed together" do
      check all(
              count <- integer(2..8),
              max_runs: @iterations
            ) do
        tables = Enum.take(Stream.cycle(@tables), count + 1)
        root = hd(tables)
        rest = tl(tables)

        where =
          rest
          |> Enum.map(fn tbl -> "id IN (SELECT id FROM #{tbl})" end)
          |> Enum.join(" AND ")

        IO.write(:stderr, "FUZZ [rebuild-multi-#{count}]: #{root} WHERE #{where}\n")
        assert {:ok, %Shape{}} = Shape.new(root, where: where, inspector: @inspector)
      end
    end
  end

  describe "rebuild_query_with_substituted_parts — params" do
    property "rebuilds with single text param" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 30),
              max_runs: @iterations
            ) do
        where = "name = $1 AND id IN (SELECT id FROM #{tbl})"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [rebuild-param-text]: #{root} WHERE #{where}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "rebuilds with single int param" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- integer(-10000..10000),
              max_runs: @iterations
            ) do
        where = "id = $1::int8 AND id IN (SELECT id FROM #{tbl})"
        params = %{"1" => Integer.to_string(val)}
        IO.write(:stderr, "FUZZ [rebuild-param-int]: #{root} WHERE #{where}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "rebuilds with multiple params and subqueries" do
      check all(
              root <- table_gen(),
              t1 <- table_gen(),
              t2 <- table_gen(),
              v1 <- string(:alphanumeric, min_length: 1, max_length: 20),
              v2 <- string(:alphanumeric, min_length: 1, max_length: 20),
              max_runs: @iterations
            ) do
        where =
          "name = $1 AND status = $2 AND id IN (SELECT id FROM #{t1} WHERE id IN (SELECT id FROM #{t2}))"

        params = %{"1" => v1, "2" => v2}
        IO.write(:stderr, "FUZZ [rebuild-multi-param]: #{root} WHERE #{where}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "rebuilds with param inside subquery WHERE" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 20),
              max_runs: @iterations
            ) do
        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [rebuild-param-in-subq]: #{root} WHERE #{where}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "rebuilds with many params" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              count <- integer(2..10),
              vals <-
                list_of(string(:alphanumeric, min_length: 1, max_length: 10),
                  min_length: 10,
                  max_length: 10
                ),
              max_runs: @iterations
            ) do
        param_conditions =
          Enum.map_join(1..count, " OR ", fn i -> "name = $#{i}" end)

        where = "(#{param_conditions}) AND id IN (SELECT id FROM #{tbl})"
        params = for i <- 1..count, into: %{}, do: {"#{i}", Enum.at(vals, i - 1)}

        IO.write(:stderr, "FUZZ [rebuild-many-params-#{count}]: #{root}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end
  end

  describe "rebuild_query_with_substituted_parts — param value edge cases" do
    property "rebuilds with special characters in text param values" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- rebuild_safe_bad_value_gen(),
              max_runs: @iterations
            ) do
        where = "name = $1 AND id IN (SELECT id FROM #{tbl})"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [rebuild-special-val]: #{root} val=#{inspect(val)}\n")
        # These should succeed — the param value goes through rebuild and protobuf_to_query!
        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "rebuilds with special characters in int param values" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- rebuild_int_value_gen(),
              max_runs: @iterations
            ) do
        where = "id = $1::int8 AND id IN (SELECT id FROM #{tbl})"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [rebuild-int-val]: #{root} val=#{inspect(val)}\n")
        # These should succeed — rebuild substitutes the param into the protobuf
        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "does not segfault with invalid encoding in param values" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- rebuild_dangerous_value_gen(),
              max_runs: @iterations
            ) do
        where = "name = $1 AND id IN (SELECT id FROM #{tbl})"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [rebuild-dangerous-val]: #{root} val=#{inspect(val)}\n")

        # These may raise (e.g. invalid UTF-8 in protobuf encoding) but must not segfault.
        # We catch exceptions to distinguish Elixir-level errors from NIF crashes.
        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end
  end

  # ============================================================================
  # Generators — Primitives
  # ============================================================================

  defp table_gen, do: member_of(@tables)
  defp column_gen, do: member_of(@columns)

  defp literal_gen do
    frequency([
      {3, integer(-1000..1000) |> map(&Integer.to_string/1)},
      {3, safe_string_literal_gen()},
      {2, member_of(~w[TRUE FALSE])},
      {1, constant("NULL")}
    ])
  end

  defp safe_string_literal_gen do
    string(:alphanumeric, min_length: 0, max_length: 30)
    |> map(&"'#{String.replace(&1, "'", "''")}'")
  end

  defp comparison_op_gen do
    member_of(~w[= != <> > < >= <=])
  end

  # ============================================================================
  # Generators — Simple conditions (used within subquery WHERE clauses)
  # ============================================================================

  defp simple_condition_gen do
    frequency([
      {4,
       bind({column_gen(), comparison_op_gen(), literal_gen()}, fn {col, op, val} ->
         constant("#{col} #{op} #{val}")
       end)},
      {2,
       bind(column_gen(), fn col ->
         one_of([constant("#{col} IS NULL"), constant("#{col} IS NOT NULL")])
       end)},
      {2,
       bind({column_gen(), literal_gen(), literal_gen()}, fn {col, a, b} ->
         constant("#{col} BETWEEN #{a} AND #{b}")
       end)},
      {2,
       bind({column_gen(), list_of(literal_gen(), min_length: 1, max_length: 5)}, fn {col, vals} ->
         constant("#{col} IN (#{Enum.join(vals, ", ")})")
       end)},
      {1,
       bind({column_gen(), member_of(~w[LIKE ILIKE])}, fn {col, op} ->
         constant("#{col} #{op} '%test%'")
       end)}
    ])
  end

  # ============================================================================
  # Generators — IN subqueries (1 level)
  # ============================================================================

  defp in_subquery_clause_gen do
    bind(
      {table_gen(), column_gen(), table_gen(), column_gen(), optional_where_gen()},
      fn {root, outer_col, inner_tbl, inner_col, where} ->
        one_of([
          constant({root, "#{outer_col} IN (SELECT #{inner_col} FROM #{inner_tbl}#{where})"}),
          constant({root, "#{outer_col} NOT IN (SELECT #{inner_col} FROM #{inner_tbl}#{where})"})
        ])
      end
    )
  end

  defp optional_where_gen do
    frequency([
      {1, constant("")},
      {3, simple_condition_gen() |> map(&" WHERE #{&1}")}
    ])
  end

  # ============================================================================
  # Generators — EXISTS subqueries
  # ============================================================================

  defp exists_subquery_clause_gen do
    bind(
      {table_gen(), table_gen(), column_gen(), column_gen(), optional_where_gen()},
      fn {root, inner_tbl, col1, col2, extra_where} ->
        base_where = "#{col1} = #{col2}"

        full_where =
          if extra_where == "",
            do: base_where,
            else: "#{base_where} AND #{String.trim_leading(extra_where, " WHERE ")}"

        one_of([
          constant({root, "EXISTS (SELECT 1 FROM #{inner_tbl} WHERE #{full_where})"}),
          constant({root, "NOT EXISTS (SELECT 1 FROM #{inner_tbl} WHERE #{full_where})"})
        ])
      end
    )
  end

  # ============================================================================
  # Generators — Nested subqueries (2-3 levels)
  # ============================================================================

  defp nested_subquery_clause_gen do
    frequency([
      {3, nested_2_level_gen()},
      {1, nested_3_level_gen()}
    ])
  end

  defp nested_2_level_gen do
    bind(
      {table_gen(), column_gen(), table_gen(), column_gen(), table_gen(), column_gen(),
       simple_condition_gen()},
      fn {root, outer_col, mid_tbl, mid_col, inner_tbl, inner_col, cond_} ->
        constant(
          {root,
           "#{outer_col} IN (SELECT #{mid_col} FROM #{mid_tbl} WHERE #{mid_col} IN (SELECT #{inner_col} FROM #{inner_tbl} WHERE #{cond_}))"}
        )
      end
    )
  end

  defp nested_3_level_gen do
    bind(
      {table_gen(), column_gen(), table_gen(), column_gen(), table_gen(), column_gen(),
       table_gen(), column_gen(), simple_condition_gen()},
      fn {root, c0, t1, c1, t2, c2, t3, c3, cond_} ->
        constant(
          {root,
           "#{c0} IN (SELECT #{c1} FROM #{t1} WHERE #{c1} IN (SELECT #{c2} FROM #{t2} WHERE #{c2} IN (SELECT #{c3} FROM #{t3} WHERE #{cond_})))"}
        )
      end
    )
  end

  # ============================================================================
  # Generators — Deep nesting (4-15 levels, primary segfault vector)
  # ============================================================================

  defp deep_subquery_clause_gen do
    bind({table_gen(), integer(4..15)}, fn {root, depth} ->
      build_deep_in(depth) |> map(&{root, &1})
    end)
  end

  defp build_deep_in(1) do
    bind({column_gen(), table_gen(), simple_condition_gen()}, fn {col, tbl, cond_} ->
      constant("#{col} IN (SELECT #{col} FROM #{tbl} WHERE #{cond_})")
    end)
  end

  defp build_deep_in(depth) do
    bind({column_gen(), table_gen(), build_deep_in(depth - 1)}, fn {col, tbl, inner} ->
      constant("#{col} IN (SELECT #{col} FROM #{tbl} WHERE #{inner})")
    end)
  end

  # ============================================================================
  # Generators — Boolean compositions of subqueries
  # ============================================================================

  defp composed_subquery_clause_gen do
    bind(table_gen(), fn root ->
      frequency([
        {3, and_subqueries(root)},
        {3, or_subqueries(root)},
        {2, not_subquery(root)},
        {1, multi_subquery_composition(root)}
      ])
    end)
  end

  defp and_subqueries(root) do
    bind({subquery_atom_gen(), subquery_atom_gen()}, fn {l, r} ->
      constant({root, "(#{l}) AND (#{r})"})
    end)
  end

  defp or_subqueries(root) do
    bind({subquery_atom_gen(), subquery_atom_gen()}, fn {l, r} ->
      constant({root, "(#{l}) OR (#{r})"})
    end)
  end

  defp not_subquery(root) do
    bind(subquery_atom_gen(), fn sq ->
      constant({root, "NOT (#{sq})"})
    end)
  end

  defp multi_subquery_composition(root) do
    bind(
      {list_of(subquery_atom_gen(), min_length: 2, max_length: 5),
       list_of(member_of(~w[AND OR]), min_length: 1, max_length: 4)},
      fn {atoms, ops} ->
        combined =
          atoms
          |> Enum.zip(Stream.concat(ops, Stream.repeatedly(fn -> "AND" end)))
          |> Enum.reduce("", fn
            {atom, _op}, "" -> "(#{atom})"
            {atom, op}, acc -> "#{acc} #{op} (#{atom})"
          end)

        constant({root, combined})
      end
    )
  end

  defp subquery_atom_gen do
    frequency([
      {3,
       bind({column_gen(), table_gen(), column_gen(), optional_where_gen()}, fn {oc, it, ic, w} ->
         constant("#{oc} IN (SELECT #{ic} FROM #{it}#{w})")
       end)},
      {2,
       bind({table_gen(), simple_condition_gen()}, fn {tbl, cond_} ->
         constant("EXISTS (SELECT 1 FROM #{tbl} WHERE #{cond_})")
       end)},
      {2, simple_condition_gen()}
    ])
  end

  # ============================================================================
  # Generators — Parameterized subqueries
  # ============================================================================

  defp parameterized_subquery_gen do
    frequency([
      {3, param_in_outer_where()},
      {2, param_in_subquery_where()},
      {1, multi_param_gen()}
    ])
  end

  defp wrong_param_keys_gen do
    frequency([
      # Non-sequential keys (skip $1, start at $5)
      {2, constant(%{"5" => "val", "10" => "val2"})},
      # Zero-indexed (Postgres params are 1-indexed)
      {2, constant(%{"0" => "val"})},
      # Negative
      {1, constant(%{"-1" => "val"})},
      # Very large param number
      {1, constant(%{"99999" => "val"})},
      # Non-numeric key
      {1, constant(%{"abc" => "val"})},
      # Empty key
      {1, constant(%{"" => "val"})}
    ])
  end

  defp bad_param_value_gen do
    frequency([
      # Null bytes
      {2, constant("te\0st")},
      {1, constant("\0")},
      # SQL injection attempts
      {2, constant("'; DROP TABLE t1; --")},
      {2, constant("1 OR 1=1")},
      {1, constant("' UNION SELECT * FROM t2 --")},
      # Very long string
      {1, constant(String.duplicate("x", 10_000))},
      # Empty string
      {2, constant("")},
      # Unicode edge cases
      {1, constant("\u{FFFF}")},
      {1, constant("\u{0000}")},
      {1, constant("café☕")},
      # Backslash sequences
      {1, constant("\\x00\\n\\t")},
      {1, constant("\\\\\\\\")},
      # Type-mismatched values (for int8 columns)
      {2, constant("not_a_number")},
      {1, constant("1.5e999")},
      {1, constant("NaN")},
      {1, constant("Infinity")},
      # Postgres-specific literals
      {1, constant("TRUE")},
      {1, constant("{1,2,3}")},
      {1, constant("(1,2)")},
      # Single quotes that could mess up SQL reconstruction
      {2, constant("it's")},
      {1, constant("'''")},
      {1, constant("\"quoted\"")}
    ])
  end

  defp many_params_subquery_gen do
    bind(
      {table_gen(), column_gen(), table_gen(), column_gen(), integer(3..10)},
      fn {root, outer_col, inner_tbl, inner_col, param_count} ->
        # Build WHERE with many $N references: col = $1 OR col = $2 OR ... AND subquery
        param_conditions =
          Enum.map_join(1..param_count, " OR ", fn i -> "#{outer_col} = $#{i}" end)

        where =
          "(#{param_conditions}) AND #{outer_col} IN (SELECT #{inner_col} FROM #{inner_tbl})"

        # Generate params — sometimes provide all, sometimes only some
        bind(member_of([:all, :partial, :none, :mismatch]), fn mode ->
          params =
            case mode do
              :all ->
                for i <- 1..param_count, into: %{}, do: {"#{i}", "val_#{i}"}

              :partial ->
                # Only provide half the params
                for i <- 1..div(param_count, 2), into: %{}, do: {"#{i}", "val_#{i}"}

              :none ->
                %{}

              :mismatch ->
                # Provide params with wrong keys
                for i <- (param_count + 1)..(param_count * 2),
                    into: %{},
                    do: {"#{i}", "val_#{i}"}
            end

          constant({root, where, params})
        end)
      end
    )
  end

  defp param_in_outer_where do
    bind(
      {table_gen(), column_gen(), table_gen(), column_gen(), optional_where_gen()},
      fn {root, outer_col, inner_tbl, inner_col, inner_where} ->
        bind({column_gen(), safe_string_literal_gen()}, fn {param_col, param_val} ->
          where =
            "#{param_col} = $1 AND #{outer_col} IN (SELECT #{inner_col} FROM #{inner_tbl}#{inner_where})"

          # Strip quotes from the value for the params map
          raw_val = param_val |> String.trim("'")
          constant({root, where, %{"1" => raw_val}})
        end)
      end
    )
  end

  defp param_in_subquery_where do
    bind(
      {table_gen(), column_gen(), table_gen(), column_gen(), column_gen()},
      fn {root, outer_col, inner_tbl, inner_col, param_col} ->
        bind(safe_string_literal_gen(), fn param_val ->
          where =
            "#{outer_col} IN (SELECT #{inner_col} FROM #{inner_tbl} WHERE #{param_col} = $1)"

          raw_val = param_val |> String.trim("'")
          constant({root, where, %{"1" => raw_val}})
        end)
      end
    )
  end

  defp multi_param_gen do
    bind(
      {table_gen(), column_gen(), table_gen(), column_gen(), column_gen(), column_gen(),
       safe_string_literal_gen(), safe_string_literal_gen()},
      fn {root, outer_col, inner_tbl, inner_col, pcol1, pcol2, pval1, pval2} ->
        where =
          "#{pcol1} = $1 AND #{outer_col} IN (SELECT #{inner_col} FROM #{inner_tbl} WHERE #{pcol2} = $2)"

        params = %{"1" => String.trim(pval1, "'"), "2" => String.trim(pval2, "'")}
        constant({root, where, params})
      end
    )
  end

  # ============================================================================
  # Generators — Exotic subquery patterns
  # ============================================================================

  defp exotic_subquery_clause_gen do
    bind(table_gen(), fn root ->
      frequency([
        {3, scalar_subquery_gen(root)},
        {3, any_all_subquery_gen(root)},
        {2, subquery_with_set_ops_gen(root)},
        {2, subquery_with_aggregates_gen(root)},
        {1, cte_subquery_gen(root)},
        {1, subquery_with_ordering_gen(root)}
      ])
    end)
  end

  defp scalar_subquery_gen(root) do
    bind(
      {column_gen(), comparison_op_gen(), table_gen(), column_gen(), optional_where_gen()},
      fn {col, op, tbl, inner_col, where} ->
        constant({root, "#{col} #{op} (SELECT #{inner_col} FROM #{tbl}#{where} LIMIT 1)"})
      end
    )
  end

  defp any_all_subquery_gen(root) do
    bind(
      {column_gen(), comparison_op_gen(), member_of(~w[ANY ALL SOME]), table_gen(), column_gen(),
       optional_where_gen()},
      fn {col, op, quantifier, tbl, inner_col, where} ->
        constant({root, "#{col} #{op} #{quantifier}(SELECT #{inner_col} FROM #{tbl}#{where})"})
      end
    )
  end

  defp subquery_with_set_ops_gen(root) do
    bind(
      {column_gen(), table_gen(), column_gen(), table_gen(), column_gen(),
       member_of(~w[UNION INTERSECT EXCEPT])},
      fn {outer_col, t1, c1, t2, c2, op} ->
        constant(
          {root, "#{outer_col} IN (SELECT #{c1} FROM #{t1} #{op} SELECT #{c2} FROM #{t2})"}
        )
      end
    )
  end

  defp subquery_with_aggregates_gen(root) do
    bind({column_gen(), table_gen(), column_gen()}, fn {col, tbl, group_col} ->
      one_of([
        constant({root, "#{col} IN (SELECT #{group_col} FROM #{tbl} GROUP BY #{group_col})"}),
        constant(
          {root,
           "#{col} IN (SELECT #{group_col} FROM #{tbl} GROUP BY #{group_col} HAVING COUNT(*) > 1)"}
        )
      ])
    end)
  end

  defp cte_subquery_gen(root) do
    bind(
      {column_gen(), table_gen(), column_gen(), simple_condition_gen()},
      fn {col, tbl, inner_col, cond_} ->
        one_of([
          constant(
            {root,
             "#{col} IN (WITH cte AS (SELECT #{inner_col} FROM #{tbl}) SELECT #{inner_col} FROM cte WHERE #{cond_})"}
          ),
          constant(
            {root,
             "#{col} IN (WITH RECURSIVE cte AS (SELECT #{inner_col} FROM #{tbl} WHERE #{cond_} UNION ALL SELECT t.#{inner_col} FROM #{tbl} t JOIN cte ON t.#{inner_col} = cte.#{inner_col}) SELECT #{inner_col} FROM cte)"}
          )
        ])
      end
    )
  end

  defp subquery_with_ordering_gen(root) do
    bind({column_gen(), table_gen(), column_gen(), optional_where_gen()}, fn {col, tbl, ic, w} ->
      constant({root, "#{col} IN (SELECT #{ic} FROM #{tbl}#{w} ORDER BY #{ic} LIMIT 10)"})
    end)
  end

  # ============================================================================
  # Generators — Malformed subqueries (edge cases for NIF)
  # ============================================================================

  defp malformed_subquery_clause_gen do
    bind(table_gen(), fn root ->
      frequency([
        {2, truncated_subquery_gen(root)},
        {2, empty_subquery_gen(root)},
        {2, excess_parens_gen(root)},
        {1, null_byte_gen(root)},
        {2, large_in_list_gen(root)},
        {2, duplicate_subquery_gen(root)},
        {1, comment_in_subquery_gen(root)},
        {1, special_chars_gen(root)}
      ])
    end)
  end

  defp truncated_subquery_gen(root) do
    bind({column_gen(), table_gen(), column_gen()}, fn {col, tbl, ic} ->
      full = "#{col} IN (SELECT #{ic} FROM #{tbl} WHERE #{ic} > 0)"

      bind(integer(1..max(String.length(full) - 1, 1)), fn cut ->
        constant({root, String.slice(full, 0, cut)})
      end)
    end)
  end

  defp empty_subquery_gen(root) do
    member_of([
      {root, "id IN (SELECT)"},
      {root, "id IN (SELECT FROM)"},
      {root, "id IN ()"},
      {root, "EXISTS (SELECT)"},
      {root, "EXISTS ()"},
      {root, "id IN (SELECT 1 FROM)"},
      {root, "id = (SELECT)"},
      {root, "(SELECT) IS NOT NULL"},
      {root, "id IN (SELECT 1 UNION SELECT)"},
      {root, "id IN (SELECT 1 WHERE)"},
      {root, "id IN (SELECT 1 WHERE WHERE)"},
      {root, "id IN (SELECT 1 FROM FROM)"}
    ])
  end

  defp excess_parens_gen(root) do
    bind({integer(1..20), column_gen(), table_gen(), column_gen()}, fn {depth, col, tbl, ic} ->
      open = String.duplicate("(", depth)
      close = String.duplicate(")", depth)

      one_of([
        constant({root, "#{col} IN #{open}SELECT #{ic} FROM #{tbl}#{close}"}),
        constant({root, "EXISTS #{open}SELECT 1 FROM #{tbl}#{close}"})
      ])
    end)
  end

  defp null_byte_gen(root) do
    member_of([
      {root, "id IN (SELECT id FROM t1 WHERE name = 'te\0st')"},
      {root, "id IN (SELECT id FROM t1 WHERE name = '\0')"},
      {root, "\0id IN (SELECT id FROM t1)"},
      {root, "id IN (SELECT id FROM t1)\0"}
    ])
  end

  defp large_in_list_gen(root) do
    bind(integer(50..500), fn count ->
      values = Enum.map_join(1..count, ", ", &Integer.to_string/1)

      one_of([
        constant({root, "id IN (#{values})"}),
        constant({root, "id IN (SELECT id FROM t1 WHERE id IN (#{values}))"}),
        constant({root, "id IN (SELECT id FROM t1 WHERE id = ANY(ARRAY[#{values}]))"})
      ])
    end)
  end

  defp duplicate_subquery_gen(root) do
    bind({column_gen(), table_gen(), column_gen(), simple_condition_gen()}, fn {col, tbl, ic,
                                                                                cond_} ->
      subq = "#{col} IN (SELECT #{ic} FROM #{tbl} WHERE #{cond_})"

      one_of([
        constant({root, "#{subq} AND #{subq}"}),
        constant({root, "#{subq} OR #{subq}"}),
        constant({root, "#{subq} AND #{subq} AND #{subq}"}),
        constant({root, "#{subq} OR #{subq} OR #{subq} OR #{subq} OR #{subq}"})
      ])
    end)
  end

  defp comment_in_subquery_gen(root) do
    bind({column_gen(), table_gen(), column_gen()}, fn {col, tbl, ic} ->
      member_of([
        {root, "#{col} IN (/* comment */ SELECT #{ic} FROM #{tbl})"},
        {root, "#{col} IN (SELECT #{ic} /* mid */ FROM #{tbl})"},
        {root, "#{col} IN (-- line comment\nSELECT #{ic} FROM #{tbl})"},
        {root, "#{col} IN (SELECT #{ic} FROM #{tbl} -- trailing\n)"}
      ])
    end)
  end

  defp special_chars_gen(root) do
    member_of([
      {root, "id IN (SELECT id FROM t1 WHERE name = E'\\x00')"},
      {root, "id IN (SELECT id FROM t1 WHERE name = E'\\'')"},
      {root, "id IN (SELECT id FROM t1 WHERE name = $$dollar$$)"},
      {root, "id IN (SELECT id FROM t1 WHERE name ~ '^[a-z]+$')"},
      {root, "id IN (SELECT id FROM t1 WHERE name ~* 'TEST')"},
      {root, "id IN (SELECT id FROM t1 WHERE name SIMILAR TO '%test%')"}
    ])
  end

  # ============================================================================
  # Generators — Large queries (memory pressure / buffer overflow vectors)
  # ============================================================================

  defp large_query_clause_gen do
    bind(table_gen(), fn root ->
      frequency([
        {3, wide_and_chain_gen(root)},
        {3, wide_or_chain_gen(root)},
        {2, wide_in_list_gen(root)},
        {2, many_subqueries_gen(root)},
        {2, large_string_literals_gen(root)},
        {1, wide_nested_boolean_gen(root)},
        {1, many_columns_subquery_gen(root)},
        {1, repeated_cte_gen(root)}
      ])
    end)
  end

  # col = 1 AND col = 2 AND col = 3 AND ... (wide flat AND chain)
  defp wide_and_chain_gen(root) do
    bind({column_gen(), integer(20..200)}, fn {col, count} ->
      conditions = Enum.map_join(1..count, " AND ", fn i -> "#{col} = #{i}" end)
      constant({root, conditions})
    end)
  end

  # col = 1 OR col = 2 OR col = 3 OR ... (wide flat OR chain)
  defp wide_or_chain_gen(root) do
    bind({column_gen(), integer(20..200)}, fn {col, count} ->
      conditions = Enum.map_join(1..count, " OR ", fn i -> "#{col} = #{i}" end)
      constant({root, conditions})
    end)
  end

  # col IN (1, 2, 3, ..., N) with large N
  defp wide_in_list_gen(root) do
    bind({column_gen(), integer(100..2000)}, fn {col, count} ->
      values = Enum.map_join(1..count, ", ", &Integer.to_string/1)
      constant({root, "#{col} IN (#{values})"})
    end)
  end

  # col IN (SELECT ...) AND col IN (SELECT ...) AND ... many independent subqueries
  defp many_subqueries_gen(root) do
    bind({column_gen(), integer(5..30)}, fn {col, count} ->
      tables = Stream.cycle(@tables)

      conditions =
        tables
        |> Stream.take(count)
        |> Stream.with_index()
        |> Enum.map_join(" AND ", fn {tbl, i} ->
          "#{col} IN (SELECT #{col} FROM #{tbl} WHERE #{col} > #{i})"
        end)

      constant({root, conditions})
    end)
  end

  # Queries with very long string literals
  defp large_string_literals_gen(root) do
    bind({column_gen(), integer(1..5)}, fn {col, literal_count} ->
      bind(list_of(integer(100..5000), length: literal_count), fn sizes ->
        conditions =
          sizes
          |> Enum.with_index()
          |> Enum.map_join(" OR ", fn {size, _i} ->
            big_str = String.duplicate("a", size)
            "#{col} = '#{big_str}'"
          end)

        constant({root, conditions})
      end)
    end)
  end

  # Deeply nested boolean tree: ((((a AND b) OR (c AND d)) AND ((e OR f) AND (g OR h))) ...)
  defp wide_nested_boolean_gen(root) do
    bind({column_gen(), integer(3..7)}, fn {col, depth} ->
      where = build_boolean_tree(col, depth)
      constant({root, where})
    end)
  end

  defp build_boolean_tree(col, 0) do
    "#{col} = #{:rand.uniform(1000)}"
  end

  defp build_boolean_tree(col, depth) do
    left = build_boolean_tree(col, depth - 1)
    right = build_boolean_tree(col, depth - 1)
    op = Enum.random(["AND", "OR"])
    "(#{left}) #{op} (#{right})"
  end

  # Subquery with many selected columns
  defp many_columns_subquery_gen(root) do
    bind({column_gen(), table_gen(), integer(10..100)}, fn {col, tbl, alias_count} ->
      select_list =
        Enum.map_join(1..alias_count, ", ", fn i -> "#{col} AS col_#{i}" end)

      constant({root, "#{col} IN (SELECT #{col} FROM (SELECT #{select_list} FROM #{tbl}) sub)"})
    end)
  end

  # Multiple CTEs in a single query
  defp repeated_cte_gen(root) do
    bind({column_gen(), table_gen(), integer(3..15)}, fn {col, tbl, cte_count} ->
      ctes =
        Enum.map_join(1..cte_count, ", ", fn i ->
          "cte_#{i} AS (SELECT #{col} FROM #{tbl} WHERE #{col} > #{i})"
        end)

      # Final query joins all CTEs with UNION ALL
      final_selects =
        Enum.map_join(1..cte_count, " UNION ALL ", fn i ->
          "SELECT #{col} FROM cte_#{i}"
        end)

      constant({root, "#{col} IN (WITH #{ctes} #{final_selects})"})
    end)
  end

  defp large_parameterized_query_gen do
    bind({table_gen(), column_gen(), integer(10..50)}, fn {root, col, param_count} ->
      conditions =
        Enum.map_join(1..param_count, " OR ", fn i -> "#{col} = $#{i}" end)

      where =
        "(#{conditions}) AND #{col} IN (SELECT #{col} FROM t1)"

      bind(member_of([:all, :partial, :none]), fn mode ->
        params =
          case mode do
            :all -> for i <- 1..param_count, into: %{}, do: {"#{i}", "v#{i}"}
            :partial -> for i <- 1..div(param_count, 3), into: %{}, do: {"#{i}", "v#{i}"}
            :none -> %{}
          end

        constant({root, where, params})
      end)
    end)
  end

  # ============================================================================
  # Generators — Type-safe queries (guaranteed to pass validation and reach
  # rebuild_query_with_substituted_parts + protobuf_to_query!)
  #
  # Column types in our stub inspector:
  #   int8: id, parent_id
  #   text: name, value, status
  #   bool: active
  # ============================================================================

  @int_cols ~w[id parent_id]
  @text_cols ~w[name value status]

  # Type-safe condition: compares column with a compatible literal
  defp typed_condition_gen do
    frequency([
      {3,
       bind({member_of(@text_cols), safe_string_literal_gen()}, fn {col, val} ->
         constant("#{col} = #{val}")
       end)},
      {2,
       bind(member_of(@int_cols), fn col ->
         constant("#{col} = #{:rand.uniform(1000)}")
       end)},
      {1, constant("active = TRUE")},
      {1, constant("active = FALSE")},
      {1, bind(member_of(@text_cols), fn col -> constant("#{col} IS NOT NULL") end)},
      {1, bind(member_of(@int_cols), fn col -> constant("#{col} IS NOT NULL") end)}
    ])
  end

  defp typed_optional_where_gen do
    frequency([
      {1, constant("")},
      {3, typed_condition_gen() |> map(&" WHERE #{&1}")}
    ])
  end

  # Single IN subquery: always uses id IN (SELECT id FROM ...) for type safety
  defp typed_in_subquery_gen do
    bind({table_gen(), table_gen(), typed_optional_where_gen()}, fn {root, inner, where} ->
      one_of([
        # int col subquery
        constant({root, "id IN (SELECT id FROM #{inner}#{where})"}),
        constant({root, "parent_id IN (SELECT parent_id FROM #{inner}#{where})"}),
        # text col subquery
        constant({root, "name IN (SELECT name FROM #{inner}#{where})"}),
        constant({root, "status IN (SELECT status FROM #{inner}#{where})"}),
        # NOT IN
        constant({root, "id NOT IN (SELECT id FROM #{inner}#{where})"})
      ])
    end)
  end

  # 2 or 3 level nested IN subquery
  defp typed_nested_subquery_gen do
    frequency([
      {3,
       bind(
         {table_gen(), table_gen(), table_gen(), typed_condition_gen()},
         fn {root, t1, t2, cond_} ->
           constant(
             {root,
              "id IN (SELECT id FROM #{t1} WHERE id IN (SELECT id FROM #{t2} WHERE #{cond_}))"}
           )
         end
       )},
      {1,
       bind(
         {table_gen(), table_gen(), table_gen(), table_gen(), typed_condition_gen()},
         fn {root, t1, t2, t3, cond_} ->
           constant(
             {root,
              "id IN (SELECT id FROM #{t1} WHERE id IN (SELECT id FROM #{t2} WHERE id IN (SELECT id FROM #{t3} WHERE #{cond_})))"}
           )
         end
       )}
    ])
  end

  # Deterministic deep nesting (not StreamData — just builds a string)
  defp build_typed_deep_in(depth) do
    tables = Enum.take(Stream.cycle(@tables), depth)
    root = Enum.random(@tables)

    innermost = "id > #{:rand.uniform(1000)}"

    where =
      tables
      |> Enum.reverse()
      |> Enum.reduce(innermost, fn tbl, inner ->
        "id IN (SELECT id FROM #{tbl} WHERE #{inner})"
      end)

    {root, where}
  end

  # Boolean compositions of type-safe subqueries
  defp typed_composed_subquery_gen do
    bind(table_gen(), fn root ->
      frequency([
        {3,
         bind({typed_subquery_atom_gen(), typed_subquery_atom_gen()}, fn {l, r} ->
           constant({root, "(#{l}) AND (#{r})"})
         end)},
        {3,
         bind({typed_subquery_atom_gen(), typed_subquery_atom_gen()}, fn {l, r} ->
           constant({root, "(#{l}) OR (#{r})"})
         end)},
        {2,
         bind(typed_subquery_atom_gen(), fn sq ->
           constant({root, "NOT (#{sq})"})
         end)},
        {1,
         bind(list_of(typed_subquery_atom_gen(), min_length: 3, max_length: 5), fn subs ->
           combined = subs |> Enum.map(&"(#{&1})") |> Enum.join(" AND ")
           constant({root, combined})
         end)}
      ])
    end)
  end

  defp typed_subquery_atom_gen do
    frequency([
      {3,
       bind({table_gen(), typed_optional_where_gen()}, fn {tbl, w} ->
         constant("id IN (SELECT id FROM #{tbl}#{w})")
       end)},
      {2, typed_condition_gen()}
    ])
  end

  # Values that are valid UTF-8 for text params but exercise edge cases in
  # protobuf_to_query! (the NIF that converts rebuilt AST back to SQL).
  # All values here must be valid UTF-8 so protobuf encoding succeeds.
  defp rebuild_safe_bad_value_gen do
    frequency([
      {2, constant("it's a test")},
      {2, constant("O'Brien")},
      {1, constant("'quoted'")},
      {1, constant("back\\slash")},
      {1, constant("back\\\\double")},
      {2, constant("")},
      {1, constant(String.duplicate("x", 1000))},
      {1, constant(String.duplicate("x", 10_000))},
      {1, constant("café")},
      {1, constant("日本語")},
      {1, constant("emoji 🎉")},
      {1, constant("\t\n\r")},
      {2, constant("Robert'); DROP TABLE students;--")},
      {1, constant("1 OR 1=1")},
      {1, constant("' UNION SELECT * FROM t2 --")},
      {1, constant("${injection}")},
      {1, constant("$1")},
      {1, constant("$(cmd)")},
      {1, constant("line1\nline2\nline3")},
      # Repeated single quotes
      {1, constant("'''")},
      {1, constant("''''''''")},
      # Long string with embedded quotes
      {1, constant(String.duplicate("it's ", 500))},
      # Mixed unicode scripts
      {1, constant("αβγ δεζ ηθι")},
      {1, constant("مرحبا")},
      {1, constant("👨‍👩‍👧‍👦")},
      # Zero-width characters
      {1, constant("ab\u200Bcd")},
      {1, constant("\u{FEFF}BOM")}
    ])
  end

  # Values that may contain invalid UTF-8 or null bytes. These can crash
  # protobuf encoding (Protox) before reaching the NIF, which is a separate
  # bug from a NIF segfault. Tests using this generator catch exceptions.
  defp rebuild_dangerous_value_gen do
    frequency([
      # Invalid UTF-8 sequences
      {2, constant(<<0xFF, 0xFE>>)},
      {1, constant(<<0x80>>)},
      {1, constant(<<0xC0, 0x80>>)},
      {1, constant(<<0xED, 0xA0, 0x80>>)},
      {1, constant("valid" <> <<0xFF>> <> "after")},
      # Null bytes embedded in otherwise valid strings
      {2, constant("null\0byte")},
      {1, constant("a" <> <<0>> <> "b")},
      {1, constant(<<0, 0, 0>>)},
      # Very long invalid sequences
      {1, constant(String.duplicate(<<0xFF>>, 1000))},
      # Mix of valid UTF-8 and invalid bytes
      {1, constant("café" <> <<0xFF>> <> "日本語")}
    ])
  end

  # Values for int params — valid integers in string form, plus edge cases
  defp rebuild_int_value_gen do
    frequency([
      {3, integer(-100_000..100_000) |> map(&Integer.to_string/1)},
      {1, constant("0")},
      {1, constant("-0")},
      {1, constant("9223372036854775807")},
      {1, constant("-9223372036854775808")},
      {1, constant("00001")},
      {1, constant("+42")}
    ])
  end

  # ============================================================================
  # Targeted tests for rebuild_query_with_substituted_parts scenarios
  #
  # Each test targets a specific code path that could produce invalid protobuf:
  #
  # 1. Double TypeCast: $1::type creates nested TypeCast(TypeCast(...))
  # 2. SubLink re-parse round-trip: deparse→parse normalization differences
  # 3. Node type tag preservation with changed children
  # 4. Multiple SubLinks with counter ordering
  # 5. ANY/ALL/EXISTS SubLink variants
  # 6. Param values that stress the C deparser during round-trip
  # ============================================================================

  describe "targeted: double TypeCast from explicit param casts" do
    # When SQL has $1::type, the AST has TypeCast(ParamRef, TypeName).
    # The walker replaces ParamRef with a NEW TypeCast (for the substituted value).
    # The outer TypeCast's Map.merge preserves its type_name but gets the inner
    # TypeCast as its arg. This creates TypeCast(Node(TypeCast(...)), TypeName).
    # The C deparser sees nested casts like 'val'::type1::type2.

    property "explicit text cast: $1::text" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 50),
              max_runs: @iterations
            ) do
        where = "name = $1::text AND id IN (SELECT id FROM #{tbl})"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [double-cast-text]: #{where}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "explicit int cast: $1::int8" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- integer(0..100_000),
              max_runs: @iterations
            ) do
        where = "id = $1::int8 AND name IN (SELECT name FROM #{tbl})"
        params = %{"1" => Integer.to_string(val)}
        IO.write(:stderr, "FUZZ [double-cast-int]: #{where}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "explicit bool cast: $1::bool" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- member_of(["true", "false"]),
              max_runs: @iterations
            ) do
        where = "active = $1::bool AND id IN (SELECT id FROM #{tbl})"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [double-cast-bool]: #{where}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "multiple explicit casts in same query" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              text_val <- string(:alphanumeric, min_length: 1, max_length: 20),
              int_val <- integer(0..10000),
              bool_val <- member_of(["true", "false"]),
              max_runs: @iterations
            ) do
        where =
          "name = $1::text AND id = $2::int8 AND active = $3::bool AND id IN (SELECT id FROM #{tbl})"

        params = %{
          "1" => text_val,
          "2" => Integer.to_string(int_val),
          "3" => bool_val
        }

        IO.write(:stderr, "FUZZ [double-cast-multi]: #{where}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "cast inside subquery WHERE clause" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 30),
              max_runs: @iterations
            ) do
        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1::text)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [double-cast-in-subq]: #{where}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "cast with special param values that stress deparser" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- deparser_stress_value_gen(),
              max_runs: @iterations
            ) do
        where = "name = $1::text AND id IN (SELECT id FROM #{tbl})"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [double-cast-stress]: val=#{inspect(val)}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end
  end

  describe "targeted: SubLink re-parse round-trip" do
    # rebuild_query_with_substituted_parts calls PgQuery.parse!() on SQL strings
    # that were previously produced by PgQuery.protobuf_to_query!(). If the
    # deparse→parse round-trip isn't idempotent, the re-parsed AST differs from
    # what the outer query expects, potentially creating invalid protobuf.

    property "subquery with param that has single quotes (round-trip escaping)" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              # Generate strings with embedded single quotes
              base <- string(:alphanumeric, min_length: 1, max_length: 10),
              suffix <- string(:alphanumeric, min_length: 1, max_length: 10),
              quote_count <- integer(1..5),
              max_runs: @iterations
            ) do
        quotes = String.duplicate("'", quote_count)
        val = base <> quotes <> suffix

        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [roundtrip-quotes]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "subquery with param that has backslashes" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              base <- string(:alphanumeric, min_length: 1, max_length: 10),
              slash_count <- integer(1..10),
              max_runs: @iterations
            ) do
        slashes = String.duplicate("\\", slash_count)
        val = base <> slashes

        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [roundtrip-backslash]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "subquery with param containing newlines and control chars" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- control_char_value_gen(),
              max_runs: @iterations
            ) do
        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [roundtrip-control]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "subquery with param + explicit cast (double cast + round-trip)" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- deparser_stress_value_gen(),
              max_runs: @iterations
            ) do
        # This combines double TypeCast AND SubLink round-trip:
        # The inner Shape.new rebuilds $1::text to 'val'::text::text,
        # then deparsed SQL goes through parse! in the outer rebuild.
        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1::text)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [roundtrip-double-cast]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "nested subqueries with params at multiple levels" do
      check all(
              root <- table_gen(),
              t1 <- table_gen(),
              t2 <- table_gen(),
              v1 <- string(:alphanumeric, min_length: 1, max_length: 20),
              v2 <- string(:alphanumeric, min_length: 1, max_length: 20),
              max_runs: @iterations
            ) do
        # Param $1 is in the outer WHERE, $2 is in the innermost subquery.
        # $2 gets substituted first (inner Shape.new), then the rebuilt SQL
        # with 'v2'::text goes through parse! in the middle level, then
        # that rebuilt SQL goes through parse! in the outer rebuild.
        # Triple round-trip: deparse→parse→deparse→parse.
        where =
          "name = $1 AND id IN (SELECT id FROM #{t1} WHERE id IN (SELECT id FROM #{t2} WHERE name = $2))"

        params = %{"1" => v1, "2" => v2}
        IO.write(:stderr, "FUZZ [roundtrip-nested-params]: v1=#{inspect(v1)} v2=#{inspect(v2)}\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end

    property "deeply nested subqueries with params at every level" do
      check all(
              depth <- integer(2..5),
              vals <-
                list_of(string(:alphanumeric, min_length: 1, max_length: 10),
                  min_length: 5,
                  max_length: 5
                ),
              max_runs: @iterations
            ) do
        tables = Enum.take(Stream.cycle(@tables), depth + 1)
        root = hd(tables)

        # Build nested subqueries where each level has a param condition
        {where, params} =
          tables
          |> tl()
          |> Enum.with_index(1)
          |> Enum.reverse()
          |> Enum.reduce({"name = $#{depth + 1}", %{"#{depth + 1}" => Enum.at(vals, 0)}}, fn {tbl,
                                                                                              i},
                                                                                             {inner,
                                                                                              params} ->
            new_where = "name = $#{i} AND id IN (SELECT id FROM #{tbl} WHERE #{inner})"
            new_params = Map.put(params, "#{i}", Enum.at(vals, rem(i, length(vals))))
            {new_where, new_params}
          end)

        IO.write(:stderr, "FUZZ [roundtrip-deep-params-#{depth}]: #{map_size(params)} params\n")

        assert {:ok, %Shape{}} =
                 Shape.new(root, where: where, params: params, inspector: @inspector)
      end
    end
  end

  describe "targeted: ANY/ALL/EXISTS SubLink variants" do
    # Different SubLink types have different testexpr shapes.
    # EXISTS has nil testexpr. ANY/ALL have ColumnRef testexpr.
    # The SubLink handler must handle all variants correctly.

    property "ANY subquery with param" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 20),
              max_runs: @iterations
            ) do
        where = "name = ANY(SELECT name FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [any-subq-param]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "EXISTS subquery with param (nil testexpr)" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 20),
              max_runs: @iterations
            ) do
        where = "EXISTS (SELECT 1 FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [exists-param]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "NOT EXISTS subquery with param" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 20),
              max_runs: @iterations
            ) do
        where = "NOT EXISTS (SELECT 1 FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [not-exists-param]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "scalar subquery with param" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 20),
              max_runs: @iterations
            ) do
        where = "id = (SELECT id FROM #{tbl} WHERE name = $1 LIMIT 1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [scalar-subq-param]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "mixed SubLink types in same query with params" do
      check all(
              root <- table_gen(),
              t1 <- table_gen(),
              t2 <- table_gen(),
              t3 <- table_gen(),
              v1 <- string(:alphanumeric, min_length: 1, max_length: 10),
              v2 <- string(:alphanumeric, min_length: 1, max_length: 10),
              v3 <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        # Combines IN, EXISTS, and scalar subqueries in one query.
        # Tests SubLink counter ordering across different SubLink types.
        where =
          "id IN (SELECT id FROM #{t1} WHERE name = $1) AND " <>
            "EXISTS (SELECT 1 FROM #{t2} WHERE name = $2) AND " <>
            "name = (SELECT name FROM #{t3} WHERE name = $3 LIMIT 1)"

        params = %{"1" => v1, "2" => v2, "3" => v3}
        IO.write(:stderr, "FUZZ [mixed-sublink-types]: 3 sublinks\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end
  end

  describe "targeted: multiple SubLinks with counter ordering" do
    # The rebuild walker uses an encountered_sublinks counter to match
    # SubLinks with their pre-computed sublink_queries. If the traversal
    # order differs from extract_subqueries, wrong SQL gets spliced in.

    property "many independent IN subqueries with distinct params" do
      check all(
              count <- integer(2..8),
              vals <-
                list_of(string(:alphanumeric, min_length: 1, max_length: 10),
                  min_length: 8,
                  max_length: 8
                ),
              max_runs: @iterations
            ) do
        tables = Enum.take(Stream.cycle(@tables), count)
        root = hd(@tables)

        {conditions, params} =
          tables
          |> Enum.with_index(1)
          |> Enum.reduce({[], %{}}, fn {tbl, i}, {conds, params} ->
            cond_ = "id IN (SELECT id FROM #{tbl} WHERE name = $#{i})"
            {[cond_ | conds], Map.put(params, "#{i}", Enum.at(vals, i - 1))}
          end)

        where = conditions |> Enum.reverse() |> Enum.join(" AND ")

        IO.write(:stderr, "FUZZ [counter-ordering-#{count}]: #{count} sublinks\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "SubLinks in OR branches (different traversal path)" do
      check all(
              root <- table_gen(),
              t1 <- table_gen(),
              t2 <- table_gen(),
              v1 <- string(:alphanumeric, min_length: 1, max_length: 10),
              v2 <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        # SubLinks in different OR branches — tests that walker visits
        # left branch before right branch consistently.
        where =
          "(id IN (SELECT id FROM #{t1} WHERE name = $1)) OR " <>
            "(id IN (SELECT id FROM #{t2} WHERE name = $2))"

        params = %{"1" => v1, "2" => v2}
        IO.write(:stderr, "FUZZ [counter-or-branches]: 2 sublinks in OR\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "SubLinks in nested AND/OR with params" do
      check all(
              root <- table_gen(),
              t1 <- table_gen(),
              t2 <- table_gen(),
              t3 <- table_gen(),
              v1 <- string(:alphanumeric, min_length: 1, max_length: 10),
              v2 <- string(:alphanumeric, min_length: 1, max_length: 10),
              v3 <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        # Complex boolean tree with SubLinks at different positions.
        # Tests that counter ordering matches extract_subqueries traversal.
        where =
          "((id IN (SELECT id FROM #{t1} WHERE name = $1)) AND " <>
            "(id IN (SELECT id FROM #{t2} WHERE name = $2))) OR " <>
            "(id IN (SELECT id FROM #{t3} WHERE name = $3))"

        params = %{"1" => v1, "2" => v2, "3" => v3}
        IO.write(:stderr, "FUZZ [counter-nested-bool]: 3 sublinks in AND/OR tree\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end
  end

  describe "targeted: deparser stress values through full round-trip" do
    # These tests put adversarial string values through the full pipeline:
    # value → A_Const.sval in protobuf → protobuf_to_query! (C deparser) →
    # SQL string → PgQuery.parse! (re-parse in outer rebuild) → protobuf →
    # protobuf_to_query! (final deparse)
    #
    # The C deparser must correctly escape the sval for SQL. If it doesn't,
    # the re-parse step gets malformed SQL and could crash.

    property "values with many consecutive single quotes through round-trip" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              n <- integer(1..20),
              max_runs: @iterations
            ) do
        val = String.duplicate("'", n)
        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [stress-quotes-#{n}]: #{n} quotes\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "values with mixed quotes and backslashes through round-trip" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- mixed_escape_value_gen(),
              max_runs: @iterations
            ) do
        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [stress-mixed-escape]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "very long values through round-trip with subquery" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              len <- integer(1000..50_000),
              max_runs: div(@iterations, 10)
            ) do
        val = String.duplicate("x", len)
        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [stress-long-#{len}]: #{len} bytes\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "unicode edge cases through round-trip with subquery" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- unicode_stress_value_gen(),
              max_runs: @iterations
            ) do
        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [stress-unicode]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end

    property "values resembling SQL keywords through round-trip" do
      check all(
              root <- table_gen(),
              tbl <- table_gen(),
              val <- sql_keyword_value_gen(),
              max_runs: @iterations
            ) do
        where = "id IN (SELECT id FROM #{tbl} WHERE name = $1)"
        params = %{"1" => val}
        IO.write(:stderr, "FUZZ [stress-keyword]: val=#{inspect(val)}\n")

        try do
          result = Shape.new(root, where: where, params: params, inspector: @inspector)
          assert match?({:ok, _}, result) or match?({:error, _}, result)
        rescue
          _ -> :ok
        end
      end
    end
  end

  # ============================================================================
  # Additional generators for targeted tests
  # ============================================================================

  # Values that stress the C deparser's string escaping during round-trip
  defp deparser_stress_value_gen do
    frequency([
      {2, constant("it's")},
      {2, constant("it''s")},
      {1, constant("'''")},
      {1, constant("O'Brien's \"thing\"")},
      {1, constant("back\\slash")},
      {1, constant("back\\\\double\\\\\\\\quad")},
      {1, constant("line\nbreak")},
      {1, constant("tab\there")},
      {1, constant("cr\rhere")},
      {1, constant("mixed\r\n\t\\'\"\0end")},
      {1, constant(String.duplicate("'", 50))},
      {1, constant(String.duplicate("\\", 50))},
      {1, constant("'\\'\\'")},
      {1, constant("\" \\\" '\\''")},
      {2, string(:alphanumeric, min_length: 1, max_length: 100)},
      {1, constant("café☕日本語🎉")},
      {1, constant(String.duplicate("a'b", 100))},
      {1, constant("$1")},
      {1, constant("SELECT 1; DROP TABLE--")},
      {1, constant("E'escape'")},
      {1, constant("$$dollar$$")}
    ])
  end

  # Values with control characters (valid UTF-8)
  defp control_char_value_gen do
    frequency([
      {2, constant("a\nb")},
      {2, constant("a\tb")},
      {1, constant("a\rb")},
      {1, constant("a\r\nb")},
      {1, constant("\n\n\n")},
      # vertical tab
      {1, constant("a\x0Bb")},
      # form feed
      {1, constant("a\x0Cb")},
      # escape
      {1, constant("a\x1Bb")},
      # DEL
      {1, constant("a\x7Fb")},
      # SOH STX ETX
      {1, constant("abc\x01\x02\x03")},
      {1, constant(String.duplicate("\n", 100))},
      {1, constant(String.duplicate("\t", 100))},
      {1, constant("line1\nline2\nline3\nline4\nline5")}
    ])
  end

  # Values mixing single quotes and backslashes — stress escape handling
  defp mixed_escape_value_gen do
    frequency([
      {2, constant("a'b\\c")},
      {2, constant("'\\")},
      {1, constant("\\'")},
      {1, constant("\\\\''\\\\")},
      {1, constant("'''\\'''")},
      {1, constant("\\'\\'\\'\\'")},
      {1, constant("a'b'c'd'e")},
      {1, constant("\\a\\b\\c")},
      {1, constant("'")},
      {1, constant("''")},
      {1, constant("\\")},
      {1, constant("\\\\")},
      # Patterns that might confuse escape-aware parsers
      {1, constant("E'\\n'")},
      {1, constant("E'\\x00'")},
      {1, constant("$$'\\$$")},
      {1, constant("'\\'\\\\'\\\\\\\\'")},
      # Long patterns
      {1, constant(String.duplicate("'\\", 100))},
      {1, constant(String.duplicate("\\'", 100))}
    ])
  end

  # Unicode values that stress encoding boundaries
  defp unicode_stress_value_gen do
    frequency([
      {2, constant("café")},
      {1, constant("日本語テスト")},
      {1, constant("🎉🎊🎈")},
      # ZWJ sequence
      {1, constant("👨‍👩‍👧‍👦")},
      # BOM
      {1, constant("\u{FEFF}BOM")},
      # zero-width space
      {1, constant("ab\u{200B}cd")},
      # combining accent
      {1, constant("a\u{0300}b")},
      # Greek
      {1, constant("αβγδεζηθικλμ")},
      # Arabic
      {1, constant("مرحبا بالعالم")},
      # Hebrew
      {1, constant("שלום עולם")},
      # Mathematical fraktur
      {1, constant("𝕳𝖊𝖑𝖑𝖔")},
      # First supplementary char
      {1, constant("\u{10000}")},
      # Max Unicode codepoint
      {1, constant("\u{10FFFF}")},
      # Mix of different scripts in one string
      {1, constant("Hello世界مرحبا👋")},
      # Long unicode string
      {1, constant(String.duplicate("日本", 500))}
    ])
  end

  # Values that look like SQL keywords or syntax
  defp sql_keyword_value_gen do
    frequency([
      {2, constant("SELECT")},
      {1, constant("FROM")},
      {1, constant("WHERE")},
      {1, constant("AND")},
      {1, constant("OR")},
      {1, constant("NOT")},
      {1, constant("IN")},
      {1, constant("EXISTS")},
      {1, constant("NULL")},
      {1, constant("TRUE")},
      {1, constant("FALSE")},
      {1, constant("UNION ALL")},
      {1, constant("SELECT 1 FROM t1")},
      {1, constant("'; DROP TABLE t1; --")},
      {1, constant("1; SELECT 1")},
      {1, constant("$1")},
      {1, constant("$1::text")},
      {1, constant("CAST('x' AS text)")},
      {1, constant("/**/")},
      {1, constant("-- comment")}
    ])
  end

  # ============================================================================
  # Exotic operator and type tests
  #
  # These test SQL patterns that real customers might use but our existing
  # generators don't cover: JSON operators, array operators, row comparisons,
  # complex type casts, string concatenation, and regex operators.
  #
  # Many of these may fail validation (unsupported types/operators) but must
  # NEVER segfault — the NIF must handle them gracefully.
  # ============================================================================

  # Inspector with exotic column types for the new tests
  @exotic_inspector Support.StubInspector.new(
                      tables: [
                        {1, {"public", "t1"}},
                        {2, {"public", "t2"}},
                        {3, {"public", "t3"}},
                        {4, {"public", "t4"}},
                        {5, {"public", "t5"}},
                        {6, {"public", "events"}},
                        {7, {"public", "docs"}},
                        {8, {"public", "tags"}},
                        {9, {"public", "logs"}},
                        {10, {"public", "geo"}}
                      ],
                      columns: [
                        %{name: "id", type: "int8", pk_position: 0, type_id: {20, -1}},
                        %{name: "name", type: "text", type_id: {25, -1}},
                        %{name: "value", type: "text", type_id: {25, -1}},
                        %{name: "status", type: "text", type_id: {25, -1}},
                        %{name: "active", type: "bool", type_id: {16, -1}},
                        %{name: "parent_id", type: "int8", type_id: {20, -1}},
                        %{name: "count", type: "int4", type_id: {23, -1}},
                        %{name: "score", type: "float8", type_id: {701, -1}},
                        %{name: "uid", type: "uuid", type_id: {2950, -1}},
                        %{name: "created_at", type: "timestamptz", type_id: {1184, -1}},
                        %{name: "event_date", type: "date", type_id: {1082, -1}},
                        %{name: "event_time", type: "time", type_id: {1083, -1}},
                        %{name: "duration", type: "interval", type_id: {1186, -1}},
                        %{name: "data", type: "jsonb", type_id: {3802, -1}},
                        %{name: "meta", type: "json", type_id: {114, -1}},
                        %{name: "tags", array_type: "text", type_id: {1009, -1}},
                        %{name: "scores", array_type: "int8", type_id: {1016, -1}},
                        %{name: "flags", array_type: "bool", type_id: {1000, -1}}
                      ]
                    )

  @exotic_tables ~w[t1 t2 t3 t4 t5 events docs tags logs geo]

  defp exotic_table_gen, do: member_of(@exotic_tables)

  # Helper to run a shape through the exotic inspector — expects ok OR error, never segfault
  defp assert_no_segfault(root, where, params \\ %{}) do
    IO.write(:stderr, "FUZZ [exotic-op]: #{root} WHERE #{where}\n")

    try do
      result =
        if map_size(params) > 0 do
          Shape.new(root, where: where, params: params, inspector: @exotic_inspector)
        else
          Shape.new(root, where: where, inspector: @exotic_inspector)
        end

      assert match?({:ok, _}, result) or match?({:error, _}, result)
    rescue
      _ -> :ok
    end
  end

  # --------------------------------------------------------------------------
  # JSON operator tests
  # --------------------------------------------------------------------------

  describe "exotic: JSON operators" do
    property "-> (JSON object field access)" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              key <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "data -> '#{key}' IS NOT NULL")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE data -> '#{key}' IS NOT NULL)"
        )
      end
    end

    property "->> (JSON object field as text)" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              key <- string(:alphanumeric, min_length: 1, max_length: 10),
              val <- string(:alphanumeric, min_length: 1, max_length: 20),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "data ->> '#{key}' = '#{val}'")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE data ->> '#{key}' = '#{val}')"
        )
      end
    end

    property "#> and #>> (JSON path access)" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              k1 <- string(:alphanumeric, min_length: 1, max_length: 5),
              k2 <- string(:alphanumeric, min_length: 1, max_length: 5),
              max_runs: @iterations
            ) do
        path = "'{#{k1},#{k2}}'"
        assert_no_segfault(root, "data #> #{path} IS NOT NULL")
        assert_no_segfault(root, "data #>> #{path} = 'val'")
        assert_no_segfault(root, "id IN (SELECT id FROM #{tbl} WHERE data #>> #{path} = 'val')")
      end
    end

    property "@> and <@ (JSON containment)" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              key <- string(:alphanumeric, min_length: 1, max_length: 10),
              val <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        json_val = ~s|'{"#{key}": "#{val}"}'|

        assert_no_segfault(root, "data @> #{json_val}")
        assert_no_segfault(root, "#{json_val} <@ data")
        assert_no_segfault(root, "id IN (SELECT id FROM #{tbl} WHERE data @> #{json_val})")
      end
    end

    property "? and ?| and ?& (JSON key existence)" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              key <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "data ? '#{key}'")
        assert_no_segfault(root, "data ?| array['#{key}', 'other']")
        assert_no_segfault(root, "data ?& array['#{key}', 'other']")
        assert_no_segfault(root, "id IN (SELECT id FROM #{tbl} WHERE data ? '#{key}')")
      end
    end

    property "JSON operators with subqueries and params" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              key <- string(:alphanumeric, min_length: 1, max_length: 10),
              val <- string(:alphanumeric, min_length: 1, max_length: 20),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "data ->> '#{key}' = $1 AND id IN (SELECT id FROM #{tbl})", %{
          "1" => val
        })

        assert_no_segfault(root, "data @> $1::jsonb AND id IN (SELECT id FROM #{tbl})", %{
          "1" => ~s|{"#{key}": "#{val}"}|
        })
      end
    end

    property "nested JSON access with subqueries" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              depth <- integer(1..5),
              max_runs: @iterations
            ) do
        # data -> 'a' -> 'b' -> 'c' ->> 'key'
        chain = Enum.map_join(1..depth, " -> ", fn i -> "'k#{i}'" end)
        assert_no_segfault(root, "data -> #{chain} ->> 'leaf' = 'val'")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE data -> #{chain} IS NOT NULL)"
        )
      end
    end
  end

  # --------------------------------------------------------------------------
  # Array operator tests
  # --------------------------------------------------------------------------

  describe "exotic: array operators" do
    property "@> array containment" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              vals <-
                list_of(string(:alphanumeric, min_length: 1, max_length: 5),
                  min_length: 1,
                  max_length: 5
                ),
              max_runs: @iterations
            ) do
        arr = "ARRAY[" <> Enum.map_join(vals, ",", &"'#{&1}'") <> "]"
        assert_no_segfault(root, "tags @> #{arr}")
        assert_no_segfault(root, "id IN (SELECT id FROM #{tbl} WHERE tags @> #{arr})")
      end
    end

    property "<@ array contained by" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              vals <-
                list_of(string(:alphanumeric, min_length: 1, max_length: 5),
                  min_length: 1,
                  max_length: 5
                ),
              max_runs: @iterations
            ) do
        arr = "ARRAY[" <> Enum.map_join(vals, ",", &"'#{&1}'") <> "]"
        assert_no_segfault(root, "tags <@ #{arr}")
        assert_no_segfault(root, "id IN (SELECT id FROM #{tbl} WHERE tags <@ #{arr})")
      end
    end

    property "&& array overlap" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              vals <-
                list_of(string(:alphanumeric, min_length: 1, max_length: 5),
                  min_length: 1,
                  max_length: 5
                ),
              max_runs: @iterations
            ) do
        arr = "ARRAY[" <> Enum.map_join(vals, ",", &"'#{&1}'") <> "]"
        assert_no_segfault(root, "tags && #{arr}")
        assert_no_segfault(root, "id IN (SELECT id FROM #{tbl} WHERE tags && #{arr})")
      end
    end

    property "|| array concatenation" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              v1 <- string(:alphanumeric, min_length: 1, max_length: 5),
              v2 <- string(:alphanumeric, min_length: 1, max_length: 5),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "tags || ARRAY['#{v1}'] @> ARRAY['#{v2}']")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE tags || ARRAY['#{v1}'] @> ARRAY['#{v2}'])"
        )
      end
    end

    property "ANY/ALL with arrays" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "'#{val}' = ANY(tags)")
        assert_no_segfault(root, "'#{val}' = ALL(tags)")
        assert_no_segfault(root, "'#{val}' <> ALL(tags)")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE '#{val}' = ANY(tags))"
        )
      end
    end

    property "integer array operators with subqueries" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              vals <- list_of(integer(1..1000), min_length: 1, max_length: 5),
              max_runs: @iterations
            ) do
        arr = "ARRAY[" <> Enum.map_join(vals, ",", &Integer.to_string/1) <> "]"
        assert_no_segfault(root, "scores @> #{arr}")
        assert_no_segfault(root, "scores && #{arr}")
        assert_no_segfault(root, "id IN (SELECT id FROM #{tbl} WHERE scores @> #{arr})")
      end
    end

    property "array operators with params" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        assert_no_segfault(
          root,
          "tags @> ARRAY[$1] AND id IN (SELECT id FROM #{tbl})",
          %{"1" => val}
        )

        assert_no_segfault(
          root,
          "$1 = ANY(tags) AND id IN (SELECT id FROM #{tbl})",
          %{"1" => val}
        )
      end
    end

    property "array literal syntax with subqueries" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              vals <-
                list_of(string(:alphanumeric, min_length: 1, max_length: 5),
                  min_length: 1,
                  max_length: 5
                ),
              max_runs: @iterations
            ) do
        # '{a,b,c}' literal syntax
        literal = "'{" <> Enum.join(vals, ",") <> "}'::text[]"
        assert_no_segfault(root, "tags @> #{literal}")
        assert_no_segfault(root, "id IN (SELECT id FROM #{tbl} WHERE tags @> #{literal})")
      end
    end
  end

  # --------------------------------------------------------------------------
  # Row comparison tests
  # --------------------------------------------------------------------------

  describe "exotic: row comparisons" do
    property "(a, b) IN (SELECT x, y FROM ...)" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "(id, name) IN (SELECT id, name FROM #{tbl})")

        assert_no_segfault(
          root,
          "(id, name) IN (SELECT id, name FROM #{tbl} WHERE active = TRUE)"
        )
      end
    end

    property "(a, b) NOT IN (SELECT x, y FROM ...)" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "(id, name) NOT IN (SELECT id, name FROM #{tbl})")
      end
    end

    property "row comparison operators" do
      check all(
              root <- exotic_table_gen(),
              op <- member_of(["=", "<>", "<", ">", "<=", ">="]),
              val1 <- integer(1..100),
              val2 <- string(:alphanumeric, min_length: 1, max_length: 5),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "(id, name) #{op} (#{val1}, '#{val2}')")
        assert_no_segfault(root, "ROW(id, name) #{op} ROW(#{val1}, '#{val2}')")
      end
    end

    property "multi-column row IN with subqueries and params" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        assert_no_segfault(
          root,
          "(id, name) IN (SELECT id, name FROM #{tbl} WHERE name = $1)",
          %{"1" => val}
        )
      end
    end

    property "3+ column row comparisons with subqueries" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              max_runs: @iterations
            ) do
        assert_no_segfault(
          root,
          "(id, name, status) IN (SELECT id, name, status FROM #{tbl})"
        )

        assert_no_segfault(
          root,
          "(id, name, status, active) IN (SELECT id, name, status, active FROM #{tbl})"
        )
      end
    end
  end

  # --------------------------------------------------------------------------
  # Complex type cast tests
  # --------------------------------------------------------------------------

  describe "exotic: complex type casts" do
    property "::uuid casts" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "uid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid")

        assert_no_segfault(
          root,
          "uid IN (SELECT uid FROM #{tbl} WHERE uid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid)"
        )
      end
    end

    property "::uuid cast with param and subquery" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              # Generate valid UUID-like strings
              hex <- string(Enum.concat(?a..?f, ?0..?9), length: 32),
              max_runs: @iterations
            ) do
        uuid =
          String.slice(hex, 0, 8) <>
            "-" <>
            String.slice(hex, 8, 4) <>
            "-" <>
            String.slice(hex, 12, 4) <>
            "-" <>
            String.slice(hex, 16, 4) <>
            "-" <>
            String.slice(hex, 20, 12)

        assert_no_segfault(root, "uid = $1::uuid AND id IN (SELECT id FROM #{tbl})", %{
          "1" => uuid
        })
      end
    end

    property "::timestamptz casts with subqueries" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              year <- integer(2020..2030),
              month <- integer(1..12),
              day <- integer(1..28),
              hour <- integer(0..23),
              max_runs: @iterations
            ) do
        ts =
          "#{year}-#{String.pad_leading("#{month}", 2, "0")}-#{String.pad_leading("#{day}", 2, "0")} #{String.pad_leading("#{hour}", 2, "0")}:00:00+00"

        assert_no_segfault(root, "created_at > '#{ts}'::timestamptz")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE created_at > '#{ts}'::timestamptz)"
        )
      end
    end

    property "::timestamptz cast with param and subquery" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              ts <-
                member_of([
                  "2024-01-15 10:30:00+00",
                  "2025-06-01 00:00:00-05",
                  "2023-12-31 23:59:59.999+12",
                  "2020-02-29 12:00:00Z"
                ]),
              max_runs: @iterations
            ) do
        assert_no_segfault(
          root,
          "created_at > $1::timestamptz AND id IN (SELECT id FROM #{tbl})",
          %{"1" => ts}
        )
      end
    end

    property "::date and ::time casts" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "event_date = '2024-01-15'::date")
        assert_no_segfault(root, "event_time > '10:30:00'::time")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE event_date = '2024-01-15'::date)"
        )
      end
    end

    property "::date cast with param and subquery" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              date <-
                member_of([
                  "2024-01-15",
                  "2025-06-01",
                  "2023-12-31",
                  "2020-02-29"
                ]),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "event_date = $1::date AND id IN (SELECT id FROM #{tbl})", %{
          "1" => date
        })
      end
    end

    property "::interval casts" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              interval <-
                member_of([
                  "1 day",
                  "2 hours",
                  "30 minutes",
                  "1 year 2 months",
                  "3 days 4 hours 5 minutes",
                  "1 week"
                ]),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "duration > '#{interval}'::interval")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE duration > '#{interval}'::interval)"
        )
      end
    end

    property "::jsonb casts" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              key <- string(:alphanumeric, min_length: 1, max_length: 5),
              val <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        json = ~s|'{"#{key}": "#{val}"}'::jsonb|
        assert_no_segfault(root, "data = #{json}")
        assert_no_segfault(root, "data @> #{json}")
        assert_no_segfault(root, "id IN (SELECT id FROM #{tbl} WHERE data @> #{json})")
      end
    end

    property "::jsonb cast with param and subquery" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              key <- string(:alphanumeric, min_length: 1, max_length: 5),
              val <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        assert_no_segfault(
          root,
          "data @> $1::jsonb AND id IN (SELECT id FROM #{tbl})",
          %{"1" => ~s|{"#{key}": "#{val}"}|}
        )
      end
    end

    property "double casts and chained casts" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "name = $1::text::varchar AND id IN (SELECT id FROM #{tbl})", %{
          "1" => "test"
        })

        assert_no_segfault(root, "id = $1::text::int8 AND id IN (SELECT id FROM #{tbl})", %{
          "1" => "42"
        })

        assert_no_segfault(root, "count = $1::text::int4 AND id IN (SELECT id FROM #{tbl})", %{
          "1" => "99"
        })
      end
    end

    property "CAST() syntax with subqueries" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              val <- integer(1..1000),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "id = CAST('#{val}' AS int8)")

        assert_no_segfault(root, "id = CAST($1 AS int8) AND id IN (SELECT id FROM #{tbl})", %{
          "1" => Integer.to_string(val)
        })
      end
    end
  end

  # --------------------------------------------------------------------------
  # String concatenation tests
  # --------------------------------------------------------------------------

  describe "exotic: string concatenation" do
    property "|| operator" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "name || ' suffix' = '#{val} suffix'")
        assert_no_segfault(root, "'prefix ' || name = 'prefix #{val}'")
        assert_no_segfault(root, "name || status = '#{val}'")
      end
    end

    property "|| with subqueries" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE name || ' ' || status = '#{val}')"
        )

        assert_no_segfault(
          root,
          "name || status IN (SELECT name || status FROM #{tbl})"
        )
      end
    end

    property "|| with params and subqueries" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              val <- string(:alphanumeric, min_length: 1, max_length: 10),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "name || $1 = 'test' AND id IN (SELECT id FROM #{tbl})", %{
          "1" => val
        })

        assert_no_segfault(root, "$1 || name = 'test' AND id IN (SELECT id FROM #{tbl})", %{
          "1" => val
        })
      end
    end

    property "chained || concatenation" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              count <- integer(2..10),
              max_runs: @iterations
            ) do
        chain = Enum.map_join(1..count, " || ", fn i -> "'part#{i}'" end)
        assert_no_segfault(root, "name = #{chain}")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE name = #{chain})"
        )
      end
    end
  end

  # --------------------------------------------------------------------------
  # Regex operator tests
  # --------------------------------------------------------------------------

  describe "exotic: regex operators" do
    property "~ (POSIX regex match)" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              pattern <- regex_pattern_gen(),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "name ~ '#{pattern}'")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE name ~ '#{pattern}')"
        )
      end
    end

    property "~* (case-insensitive regex match)" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              pattern <- regex_pattern_gen(),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "name ~* '#{pattern}'")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE name ~* '#{pattern}')"
        )
      end
    end

    property "!~ and !~* (negated regex)" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              pattern <- regex_pattern_gen(),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "name !~ '#{pattern}'")
        assert_no_segfault(root, "name !~* '#{pattern}'")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE name !~ '#{pattern}')"
        )
      end
    end

    property "regex with params and subqueries" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              pattern <- regex_pattern_gen(),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "name ~ $1 AND id IN (SELECT id FROM #{tbl})", %{"1" => pattern})

        assert_no_segfault(root, "name ~* $1 AND id IN (SELECT id FROM #{tbl})", %{"1" => pattern})
      end
    end

    property "SIMILAR TO" do
      check all(
              root <- exotic_table_gen(),
              tbl <- exotic_table_gen(),
              pattern <- member_of(["%test%", "abc%", "%xyz", "a_b", "[a-z]%", "(a|b|c)%"]),
              max_runs: @iterations
            ) do
        assert_no_segfault(root, "name SIMILAR TO '#{pattern}'")

        assert_no_segfault(
          root,
          "id IN (SELECT id FROM #{tbl} WHERE name SIMILAR TO '#{pattern}')"
        )
      end
    end
  end

  # Regex patterns for tests — valid PostgreSQL regex patterns
  defp regex_pattern_gen do
    frequency([
      {3, constant("^[a-z]+$")},
      {2, constant("^test")},
      {2, constant("test$")},
      {1, constant("^[A-Za-z0-9_]+$")},
      {1, constant("\\d+")},
      {1, constant("(foo|bar|baz)")},
      {1, constant("^.{3,10}$")},
      {1, constant("[[:alpha:]]")},
      {1, constant("[[:digit:]]{2,}")},
      {1, constant(".*test.*")},
      {1, constant("^(a|b)(c|d)$")},
      {1, constant("\\w+@\\w+\\.\\w+")},
      {1, constant("(?i)test")},
      # Edge cases
      {1, constant("^$")},
      {1, constant(".")},
      {1, constant(".*")},
      {1, constant("^")},
      {1, constant("$")}
    ])
  end
end
