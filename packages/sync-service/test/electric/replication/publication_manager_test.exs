defmodule Electric.Replication.PublicationManagerTest do
  use ExUnit.Case, async: true

  import Support.ComponentSetup
  import Support.TestUtils

  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.PublicationManager.RelationFilter
  alias Electric.Replication.PublicationManager

  @shape_handle_1 "shape_handle_1"
  @shape_handle_2 "shape_handle_2"
  @shape_handle_3 "shape_handle_3"
  @where_clause_1 %Expr{query: "id = '1'", used_refs: %{["id"] => :text}}
  @where_clause_2 %Expr{query: "id = '2'", used_refs: %{["id"] => :text}}
  @where_clause_enum %Expr{
    query: "id = '1' AND foo_enum::text = 'bar'",
    used_refs: %{["foo_enum"] => {:enum, "foo_enum"}}
  }

  def clean_all_shapes_for_relations(relations, [parent_pid]) do
    send(parent_pid, {:clean_all_shapes_for_relations, relations})
  end

  setup :with_stack_id_from_test

  setup ctx do
    test_pid = self()

    configure_tables_fn = fn _, _, filters, _ ->
      send(test_pid, {:filters, Map.values(filters)})
      Map.get(ctx, :returned_relations, [])
    end

    %{publication_manager: {_, publication_manager_opts}} =
      with_publication_manager(%{
        module: ctx.module,
        test: ctx.test,
        stack_id: ctx.stack_id,
        update_debounce_timeout: Access.get(ctx, :update_debounce_timeout, 0),
        shape_cache: {__MODULE__, [self()]},
        publication_name: "pub_#{ctx.stack_id}",
        pool: :no_pool,
        configure_tables_for_replication_fn: configure_tables_fn
      })

    %{opts: publication_manager_opts, ctx: ctx}
  end

  describe "add_shape/2" do
    test "should add filters for single shape", %{opts: opts} do
      shape = generate_shape({"public", "items"}, @where_clause_1)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [@where_clause_1]
                        }
                      ]}
    end

    test "should ignore subsequent shapes for same shape handle", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, @where_clause_1)
      shape2 = generate_shape({"public", "items"}, @where_clause_2)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape2, opts)

      # should respect first one only
      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [@where_clause_1]
                        }
                      ]}
    end

    test "should accept multiple shapes for different relations", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, @where_clause_1)
      shape2 = generate_shape({"public", "other"})
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape2, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [@where_clause_1]
                        },
                        %RelationFilter{relation: {"public", "other"}}
                      ]}
    end

    test "should not update publication when only the where clause changes", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, @where_clause_1)
      shape2 = generate_shape({"public", "items"}, @where_clause_2)
      shape3 = generate_shape({"public", "items"}, @where_clause_1)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape2, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_3, shape3, opts)

      # Since only the first addition of the shape makes changes to the publication, we only expect to see the first where clause.
      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [@where_clause_1]
                        }
                      ]}

      refute_receive {:filters, _}, 500
    end

    test "should ignore where clauses that use unsupported column types (enums)", %{opts: opts} do
      shape = generate_shape({"public", "items"}, @where_clause_enum)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)

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
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape2, opts)

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
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.add_shape(@shape_handle_2, shape2, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          selected_columns: nil
                        }
                      ]}
    end

    test "should include selected columns referenced in where clauses", %{opts: opts} do
      where_clause = %Expr{
        query: "id = '1'",
        used_refs: %{["id"] => :int8, ["created_at"] => :timestamp}
      }

      shape =
        generate_shape(
          {"public", "items"},
          where_clause,
          ["id", "value"]
        )

      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [^where_clause],
                          selected_columns: ["value", "id", "created_at"]
                        }
                      ]}
    end

    @tag update_debounce_timeout: 100
    test "should not update publication if new shape adds nothing", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, @where_clause_1)
      shape2 = generate_shape({"public", "items"}, @where_clause_2)
      shape3 = generate_shape({"public", "items"}, @where_clause_1)

      task1 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_1, shape1, opts) end)
      task2 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_2, shape2, opts) end)

      Task.await_many([task1, task2])

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [@where_clause_2, @where_clause_1]
                        }
                      ]}

      assert :ok == PublicationManager.add_shape(@shape_handle_3, shape3, opts)

      refute_receive {:filters, _}, 500
    end

    @tag returned_relations: [{10, {"public", "another_table"}}]
    test "should broadcast clean_all_shapes_for_relations/2 to shape cache", %{opts: opts} do
      shape = generate_shape({"public", "items"}, @where_clause_1)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [@where_clause_1]
                        }
                      ]}

      assert_receive {:clean_all_shapes_for_relations, [{10, {"public", "another_table"}}]}
    end
  end

  describe "remove_shape/2" do
    test "should remove single shape", %{opts: opts} do
      shape = generate_shape({"public", "items"}, @where_clause_1)
      assert :ok == PublicationManager.add_shape(@shape_handle_1, shape, opts)
      assert :ok == PublicationManager.remove_shape(@shape_handle_1, shape, opts)

      assert_receive {:filters, []}
    end

    @tag update_debounce_timeout: 50
    test "should deduplicate calls with the same shape handle", %{opts: opts} do
      shape = generate_shape({"public", "items"}, @where_clause_1)
      task1 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_1, shape, opts) end)
      task2 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_2, shape, opts) end)
      task3 = Task.async(fn -> PublicationManager.remove_shape(@shape_handle_1, shape, opts) end)
      task4 = Task.async(fn -> PublicationManager.remove_shape(@shape_handle_1, shape, opts) end)

      Task.await_many([task1, task2, task3, task4])

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [@where_clause_1]
                        }
                      ]}
    end

    @tag update_debounce_timeout: 50
    test "should reference count to avoid removing needed filters", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, @where_clause_1)
      shape2 = generate_shape({"public", "items"}, @where_clause_2)
      shape3 = generate_shape({"public", "items"}, @where_clause_1)
      task1 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_1, shape1, opts) end)
      task2 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_2, shape2, opts) end)
      task3 = Task.async(fn -> PublicationManager.add_shape(@shape_handle_3, shape3, opts) end)

      Task.await_many([task1, task2, task3])

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [@where_clause_2, @where_clause_1]
                        }
                      ]}

      assert :ok == PublicationManager.remove_shape(@shape_handle_1, shape1, opts)

      refute_receive {:filters, _}, 500
    end
  end

  describe "recover_shape/2" do
    test "should add filters for single shape without updating anything", %{opts: opts} do
      shape = generate_shape({"public", "items"}, @where_clause_1)
      assert :ok == PublicationManager.recover_shape(@shape_handle_1, shape, opts)

      refute_receive {:filters, _}, 500
    end

    test "should ignore subsequent shapes for same shape handle", %{opts: opts} do
      shape1 = generate_shape({"public", "items"}, @where_clause_1)
      shape2 = generate_shape({"public", "items"}, @where_clause_2)
      assert :ok == PublicationManager.recover_shape(@shape_handle_1, shape1, opts)
      assert :ok == PublicationManager.recover_shape(@shape_handle_1, shape2, opts)

      :ok = PublicationManager.refresh_publication(opts)

      # should respect first one only
      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [@where_clause_1]
                        }
                      ]}
    end
  end

  describe "refresh_publication/2" do
    test "should update publication if there are changes to add", %{opts: opts} do
      shape = generate_shape({"public", "items"}, @where_clause_1)
      assert :ok == PublicationManager.recover_shape(@shape_handle_1, shape, opts)

      refute_receive {:filters, _}, 500

      assert :ok == PublicationManager.refresh_publication(opts)

      assert_receive {:filters,
                      [
                        %RelationFilter{
                          relation: {"public", "items"},
                          where_clauses: [@where_clause_1]
                        }
                      ]}
    end
  end
end
