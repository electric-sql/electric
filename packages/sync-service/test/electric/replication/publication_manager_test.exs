defmodule Electric.Replication.PublicationManagerTest do
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.PublicationManager.RelationFilter
  alias Electric.Shapes.Shape
  alias Electric.Replication.PublicationManager

  use ExUnit.Case, async: true

  import Support.ComponentSetup

  defp generate_shape(relation, where_clause \\ nil, selected_columns \\ nil) do
    %Shape{
      root_table: relation,
      root_table_id: 1,
      table_info: %{
        relation => %{
          columns:
            ([
               %{name: "id", type: :text, type_id: {25, 1}},
               %{name: "value", type: :text, type_id: {25, 1}}
             ] ++ (selected_columns || []))
            |> Enum.map(fn col -> %{name: col, type: :text, type_id: {25, 1}} end),
          pk: ["id"]
        }
      },
      where: where_clause,
      selected_columns: selected_columns
    }
  end

  setup :with_stack_id_from_test

  setup ctx do
    test_pid = self()

    configure_tables_fn = fn _, filters, _, _ ->
      send(test_pid, {:filters, Map.values(filters)})
    end

    %{publication_manager: {_, publication_manager_opts}} =
      with_publication_manager(%{
        module: ctx.module,
        test: ctx.test,
        stack_id: ctx.stack_id,
        update_debounce_timeout: Access.get(ctx, :update_debounce_timeout, 0),
        publication_name: "pub_#{ctx.stack_id}",
        pool: :no_pool,
        pg_version: 150_001,
        configure_tables_for_replication_fn: configure_tables_fn
      })

    %{opts: publication_manager_opts}
  end

  describe "add_shape/2" do
    test "should add filters for single shape", %{opts: opts} do
      shape = generate_shape({"public", "items"}, %{query: "id = 1"})
      assert :ok == PublicationManager.add_shape(shape, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [%{query: "id = 1"}]
                        }
                      ]}
    end

    test "should accept multiple shapes for different relations", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, %{query: "id = 1"})
      shape2 = generate_shape({"public", "other"})
      assert :ok == PublicationManager.add_shape(shape1, opts)
      assert :ok == PublicationManager.add_shape(shape2, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [%{query: "id = 1"}]
                        },
                        %RelationFilter{relation: {"public", "other"}}
                      ]}
    end

    test "should merge where clauses for same relation", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, %{query: "id = 1"})
      shape2 = generate_shape({"public", "items"}, %{query: "id = 2"})
      shape3 = generate_shape({"public", "items"}, %{query: "id = 1"})
      assert :ok == PublicationManager.add_shape(shape1, opts)
      assert :ok == PublicationManager.add_shape(shape2, opts)
      assert :ok == PublicationManager.add_shape(shape3, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [%{query: "id = 2"}, %{query: "id = 1"}]
                        }
                      ]}
    end

    test "should remove where clauses when one covers everything", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, %{query: "id = 1"})
      shape2 = generate_shape({"public", "items"}, nil)
      assert :ok == PublicationManager.add_shape(shape1, opts)
      assert :ok == PublicationManager.add_shape(shape2, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: nil
                        }
                      ]}
    end

    test "should merge selected columns for same relation", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, nil, ["id", "value"])
      shape2 = generate_shape({"public", "items"}, nil, ["id", "potato"])
      assert :ok == PublicationManager.add_shape(shape1, opts)
      assert :ok == PublicationManager.add_shape(shape2, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          selected_columns: ["value", "potato", "id"]
                        }
                      ]}
    end

    test "should remove selected columns when all selected by shape", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, nil, ["id", "value"])
      shape2 = generate_shape({"public", "items"}, nil, nil)
      assert :ok == PublicationManager.add_shape(shape1, opts)
      assert :ok == PublicationManager.add_shape(shape2, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          selected_columns: nil
                        }
                      ]}
    end

    test "should include selected columns referenced in where clauses", %{opts: opts} do
      shape =
        generate_shape(
          {"public", "items"},
          %Expr{
            query: "id = 1",
            used_refs: %{["id"] => :int8, ["created_at"] => :timestamp}
          },
          ["id", "value"]
        )

      assert :ok == PublicationManager.add_shape(shape, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [%{query: "id = 1"}],
                          selected_columns: ["value", "id", "created_at"]
                        }
                      ]}
    end

    @tag update_debounce_timeout: 50
    test "should not update publication if new shape adds nothing", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, %{query: "id = 1"})
      shape2 = generate_shape({"public", "items"}, %{query: "id = 2"})
      shape3 = generate_shape({"public", "items"}, %{query: "id = 1"})

      task1 = Task.async(fn -> PublicationManager.add_shape(shape1, opts) end)
      task2 = Task.async(fn -> PublicationManager.add_shape(shape2, opts) end)

      Task.await_many([task1, task2])

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [%{query: "id = 2"}, %{query: "id = 1"}]
                        }
                      ]}

      assert :ok == PublicationManager.add_shape(shape3, opts)

      refute_receive {:filters, _}, 500
    end
  end

  describe "remove_shape/2" do
    test "should remove single shape", %{opts: opts} do
      shape = generate_shape({"public", "items"}, %{query: "id = 1"})
      assert :ok == PublicationManager.add_shape(shape, opts)
      assert :ok == PublicationManager.remove_shape(shape, opts)

      assert_receive {:filters, []}
    end

    @tag update_debounce_timeout: 50
    test "should reference count to avoid removing needed filters", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, %{query: "id = 1"})
      shape2 = generate_shape({"public", "items"}, %{query: "id = 2"})
      shape3 = generate_shape({"public", "items"}, %{query: "id = 1"})
      task1 = Task.async(fn -> PublicationManager.add_shape(shape1, opts) end)
      task2 = Task.async(fn -> PublicationManager.add_shape(shape2, opts) end)
      task3 = Task.async(fn -> PublicationManager.add_shape(shape3, opts) end)

      Task.await_many([task1, task2, task3])

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [%{query: "id = 2"}, %{query: "id = 1"}]
                        }
                      ]}

      assert :ok == PublicationManager.remove_shape(shape1, opts)

      refute_receive {:filters, _}, 500
    end
  end

  describe "recover_shape/2" do
    test "should add filters for single shape without updating anything", %{opts: opts} do
      shape = generate_shape({"public", "items"}, %{query: "id = 1"})
      assert :ok == PublicationManager.recover_shape(shape, opts)

      refute_receive {:filters, _}, 500
    end
  end

  describe "refresh_publication/2" do
    test "should update publication if there are changes to add", %{opts: opts} do
      shape = generate_shape({"public", "items"}, %{query: "id = 1"})
      assert :ok == PublicationManager.recover_shape(shape, opts)

      refute_receive {:filters, _}, 500

      assert :ok == PublicationManager.refresh_publication(opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [%{query: "id = 1"}]
                        }
                      ]}
    end
  end
end
